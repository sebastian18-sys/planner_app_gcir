const express = require('express');
const {Client} = require('ldapts');
const fs = require('fs');

const moment = require('moment');
var jwt = require('jsonwebtoken');

const db = require('../../db')

//var ACCESO = require('../../models/access/userModel');
//var EXTUSER = require('../../models/access/externalUserModel');

const utils = require('../../custom_modules/utils');

const blockedDevicesPath = '/data/gcir/gcir/resources/files/planner_desktop/blocked_devices.json';

const generateMenu = (menu, menuArray) =>{
    menu = menu.toString();
    for(let i = 1;i<=menu.length;i++){
        let item = parseInt(menu.slice(0,i));
        if(menuArray.indexOf(item) < 0){
            menuArray.push(item);
        }
    }
    return menuArray;
};

const generateUser = (access) => {

    let menu = [];

    for(let s of access.scope){
        menu = generateMenu(s.menu,menu);
    }

    return {
        usuario: access.user,
        nombre: access.name,
        email: access.email,
        gerencia: (access.department?access.department:'N/A'),
        descripcion: (access.description?access.description:'N/A'),
        cargo: (access.title?access.title:'EXT'),
        permisos: 'R',
        tipo: 'EXT',
        menu: menu,
        source: 'DESKTOP'
    };
};

const blockUser = async (user,tmp) => {
    try {
        const { accessGcirExternalUserModel } = await db()
        await accessGcirExternalUserModel.findOneAndUpdate({user:user},{$set:{status:'B'}},{new: false});
        let blocked_devices = JSON.parse(fs.readFileSync(blockedDevicesPath));
        console.log(blocked_devices);
        blocked_devices.push({user,...tmp});
        fs.writeFileSync(blockedDevicesPath,JSON.stringify(blocked_devices));
    }catch (e) {
        console.log(e);
    }
};

const verifyBlock = (tmp) => {
    let blocked_devices = JSON.parse(fs.readFileSync(blockedDevicesPath));
    return !!blocked_devices.find(x => x.machineID === tmp.machineID);
};

const managerRouter = express.Router();

managerRouter.route('/action/:action/:_id')
    .post(async (req, res) => {
        const { accessUserModel } = await db()
        let action = req.params.action, _id = req.params._id;

        let exec = await accessUserModel.findOneAndUpdate(
            {_id: _id},
            {$set: {status:action}},
            {new: true}
        );
        let content = await accessUserModel.find();

        if(req.body.detail !== ''){
            await utils.sendEmail(
                'high',
                '<planner@entel.pe>',
                [`<${exec.email}>`],
                [`<${'frank.rafael@entel.pe'}>`],
                'Solicitud Rechazada',
                utils.generateInfoHTML({
                    title: 'Solicitud Rechazada',
                    message: req.body.detail
                }),
                [
                    {
                        filename: 'planner_footer.png',
                        path: '/data/gcir/gcir/resources/views/img/planner_footer.png',
                        cid: 'footer' //same cid value as in the html img src
                    }
                ]
            );
        }

        res.json({result:'OK', content});
    });

managerRouter.route('/ext/send-credentials')
    .post(async (req, res) => {

        let body = req.body;


        for(let obj of body){

            let cc = [`<${obj.leader}>`,'<erick.cordova@entel.pe>','<hector.flores@entel.pe>','<frank.rafael@entel.pe>'];

            await utils.sendEmail(
                'high',
                '<planner.desktop@entel.pe>',
                [`<${obj.email}>`],
                cc,
                'Credenciales PLANNER-DESKTOP',
                utils.generateInfoHTML({
                    title: `Estimado <b>${obj.name.split(', ')[1]}</b>,`,
                    message: `Descargue la aplicación de escritorio con el siguiente link: <a href="http://186.163.3.23/planner/installers/PLANNER-DESKTOP_SETUP">http://186.163.3.23/planner/installers/PLANNER-DESKTOP_SETUP</a><br><br>Sus credenciales de accesso son las siguientes:<br><br>Usuario: <b>${obj.user}</b><br>Contraseña: <b>${obj.pass}</b>`
                }),
                [
                    {
                        filename: 'planner_footer.png',
                        path: '/data/gcir/gcir/resources/views/img/planner_footer.png',
                        //path: 'http://186.163.3.23/planner/resources/files/img/planner_footer.png',
                        cid: 'footer' //same cid value as in the html img src
                    }
                ]
            );
        }

        res.json({result:'OK'});
    });

managerRouter.route('/ext/create')
    .post(async (req, res) => {
        const { accessUserModel,accessGcirExternalUserModel } = await db()
        var response = {result: 'OK'}, body = req.body;

        let createUserExt = await accessGcirExternalUserModel.insertMany(body);
        body = body.map(function (x) {
            x.status = 'GRANTED';
            delete x.date;
            return x;
        });
        let content = await accessUserModel.insertMany(body);

        res.json({result:'OK'});
    });

managerRouter.route('/ext/verify-user')
    .post(async (req, res) => {
        const { accessGcirExternalUserModel } = await db()
        var response = {result: 'NOK'}, body = req.body;

        try{

            if(!verifyBlock(body)){
                let access = await accessGcirExternalUserModel.findOne({machineID:body.machineID});
                if(access){
                    if(access.status === 'E'){
                        response.result = 'OK';
                        response.content = {user: access.user, registered: 'YES'};
                    }else{
                        response.code = 1;
                        response.redirect = 'templates/desktop/blocked_user.twig';
                    }
                }else{
                    response.result = 'OK';
                    response.content = {user: '', registered: 'NO'};
                }
            }else{
                response.code = 1;
                response.redirect = 'templates/desktop/blocked_device.twig';
            }
        }catch (e) {
            console.log(e);
            response.error = 'Ocurrió un error, por favor vuelva a intentarlo';
            response.code = 100;
        }

        res.json(response);
    });

managerRouter.route('/ext/login')
    .post(async (req, res) => {
        const { accessGcirExternalUserModel } = await db()
        var response = {result: 'NOK'}, body = req.body;

        console.log('LOGIN:',body);

        try{

            var path = `/data/gcir/gcir/resources/files/planner_desktop/${body.accessID}.json`,
                tmp = JSON.parse(fs.readFileSync(path));

            console.log(tmp);

            let access = await accessGcirExternalUserModel.findOne({user:body.user,pass:body.pass});

            if(access){
                console.log('access.status:',access.status);
                if(access.status === 'E'){
                    if(access.machineID === '' || !access.machineID){
                        response.error = 'Primero registre su dispositivo con el boton [Registrar Dispositivo]';
                    }else if(access.machineID === tmp.machineID){
                        response.result = 'OK';
                        response.content = generateUser(access);
                    }else{
                        response.error = `Esta intentando acceder desde un dispositivo no registrado<br>Intentos Restantes: <b></b>${tmp.attempts}</b>`;
                        tmp.attempts--;
                    }
                }else{
                    response.error = 'Usuario Bloqueado';
                }
            }else{
                response.error = `Credenciales incorrectas<br>Intentos Restantes: <b></b>${tmp.attempts}</b>`;
                tmp.attempts--;
            }

            response.attempts = tmp.attempts;

            /*******************BLOCK USER*******************/
            if(tmp.attempts < 0){
                await blockUser(body.user,tmp);
            }

            fs.writeFileSync(path,JSON.stringify(tmp));

        }catch (e) {
            console.log(e);
            response.error = 'Ocurrió un error, por favor inténtelo de nuevo';
            response.attempts = 3;
        }

        res.json(response);
    });


managerRouter.route('/ext/register-device')
    .post(async (req, res) => {
        const { accessGcirExternalUserModel } = await db()
        let response = {result: 'NOK'}, body = req.body;

        try{

            var path = `/data/gcir/gcir/resources/files/planner_desktop/${body.accessID}.json`,
                tmp = JSON.parse(fs.readFileSync(path));

            let access = await accessGcirExternalUserModel.findOne({user:body.user,pass:body.pass});

            if(access){
                if(access.machineID && access.machineID !== ''){
                    response.error = `El usuario ${body.user} ya tiene un dispositivo registrado`;
                }else{
                    let access = await accessGcirExternalUserModel.findOneAndUpdate(
                        {user:body.user},
                        {
                            $set:{
                                machineID: tmp.machineID,
                                hostname: tmp.hostname,
                                nics: tmp.nics,
                                ip: tmp.ip,
                                date: moment().unix()
                            }
                        },
                        {new: true}
                    );
                    if(access){
                        response.result = 'OK';
                        response.content = generateUser(access);
                    }else{
                        response.error = `Ocurrió un error, por favor intentelo de nuevo`
                    }
                }
            }else{
                response.error = `Credenciales incorrectas<br>Intentos Restantes: <b></b>${tmp.attempts}</b>`
                tmp.attempts--;
            }

            if(tmp.attempts < 0){
                await blockUser(body.user);
            }

            fs.writeFileSync(path,JSON.stringify(tmp));

            response.attempts = tmp.attempts;

        }catch (e) {
            console.log(e);
            response.error = 'Ocurrió un error, por favor inténtelo de nuevo';
            response.attempts = 3;
        }

        console.log(response);

        res.json(response);
    });

module.exports = managerRouter;