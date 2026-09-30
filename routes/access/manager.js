const express = require('express');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const moment = require('moment');
const {Client} = require('ldapts');

const dominio = 'nextelperu.net';
const ip = '14.240.4.146';
const url = `ldap://${ip}:389`;
const adSuffix = `dc=nextelperu,dc=net`;

const searchType = {
    'email': 'mail',
    'user':  'samaccountname'
};

var ACCESO = require('../../models/access/userModel');
var EXTUSER = require('../../models/access/externalUserModel');

var menuModulo_ = {
    212: 'NAPS'
};

function generateMenu(menu, menuArray){
    menu = menu.toString();
    for(let i = 1;i<=menu.length;i++){
        let item = parseInt(menu.slice(0,i));
        if(menuArray.indexOf(item) < 0){
            menuArray.push(item);
        }
    }
    return menuArray;
}

const accessManagerRouter = express.Router();

accessManagerRouter.route('/add')
    .post(async (req, res) => {
        let response = {result:'OK'};
        try {
            response.content = await EXTUSER.create(req.body);
        }catch (e) {
            response.result = 'NOK';
        }
        res.json(response);
    });

accessManagerRouter.route('/get-scope/:user/:mac/:host')
    .get(async (req, res) => {
        let response = {result:'OK'},
            user = req.params.user,
            mac = req.params.mac,
            host = req.params.host,
            menu = [];

        try{

            let access = await EXTUSER.findOne({user:user, mac:mac});
            let access_ = await EXTUSER.findOne({user:user, host:host});

            access = (access ? access : undefined);
            access = (!access ? (access_?access_:undefined) : access);
            
            if(access){

                for(let s of access.scope){
                    menu = generateMenu(s.menu,menu);
                }

                response.content = {
                    usuario: access.user,
                    nombre: access.name,
                    email: access.email,
                    gerencia: (access.department?access.department:'N/A'),
                    descripcion: (access.description?access.description:'N/A'),
                    cargo: (access.title?access.title:'EXT'),
                    permisos: 'R',
                    tipo: 'EXT',
                    menu: menu,
                    mac: access.mac,
                    host: access.host
                };
            }
        }catch (e) {
            response.result = 'NOK';
            response.error = 'No se pudo validar el usuario, por favor vuelva a intentarlo';
        }
        console.log(response);
        res.json(response);
    });

accessManagerRouter.route('/register-device')
    .post(async (req, res) => {
        let response = {result: 'OK'}, body = req.body, menu = [];

        let user = await EXTUSER.findOne({user:body.user});
        let device = await EXTUSER.findOne({mac:body.mac});

        console.log(user);
        console.log(device);

        if(user.mac !== ''){
            response.result = 'NOK';
            response.message = 'La cuenta ya tiene un dispositivo registrado';
        }else{
            let access = await EXTUSER.findOneAndUpdate({user:body.user},{$set:{mac:body.mac, host:body.host, date: moment().unix()}},{new: true});
            if(access){
                function generateMenu(menu, menuArray){
                    menu = menu.toString();
                    for(let i = 1;i<=menu.length;i++){
                        let item = parseInt(menu.slice(0,i));
                        if(menuArray.indexOf(item) < 0){
                            menuArray.push(item);
                        }
                    }
                    return menuArray;
                }

                for(let s of access.scope){
                    menu = generateMenu(s.menu,menu);
                }

                response.content = {
                    usuario: access.user,
                    nombre: access.name,
                    email: access.email,
                    gerencia: (access.department?access.department:'N/A'),
                    descripcion: (access.description?access.description:'N/A'),
                    cargo: (access.title?access.title:'EXT'),
                    permisos: 'R',
                    tipo: 'EXT',
                    menu: menu,
                    mac: access.mac
                };
            }
        }

        res.json(response);
    });

accessManagerRouter.route('/validate-user')
    .post(async (req, res) => {
        let response = {result: 'NOK'}, body = req.body;
        let user = await EXTUSER.findOne({user:body.user});
        if(user.mac === body.mac){
            response.result = 'OK';
        }else if(user.mac === ''){
            response.message = 'Por favor registre su dispositivo';
        }else if(user.mac !== body.mac){
            response.message = 'Esta intentando acceder desde un dispositivo no registrado';
        }
        res.json(response);
    });


accessManagerRouter.route('/verify-mac/:mac/:host')
    .get(async (req, res) => {
        let response = {result: 'OK'};
        try{
            console.log(req.params.mac,req.params.host);
            let access = await EXTUSER.findOne({mac:req.params.mac, host: req.params.host});
            if(access){
                if(access.mac === req.params.mac && access.status === 'E'){
                    response.content = {code:1, user: access.user};
                }else if((access.mac === req.params.mac || access.attempts.find(x=>x.mac === req.params.mac)) && access.status === 'B'){
                    response.content = {code:2}
                }
            }else{
                response.content = {code:0}
            }
        }catch (e) {
            console.log(e);
            response.result = 'NOK';
        }
        console.log('verify-mac:',response);
        res.json(response);
    });

accessManagerRouter.route('/block-user/:user')
    .get(async (req, res) => {
        let response = {result: 'OK'};
        try{
            await EXTUSER.findOneAndUpdate({user:req.params.user},{$set:{status:'B'}},{new: false});
        }catch (e) {
            console.log(e);
            response.result = 'NOK';
        }
        res.json(response);
    });

accessManagerRouter.route('/auth')
    .post(async (req, res) => {

        let response = {result:'NOK'}, body = req.body, status = 406;

        try {

            if(body.user && body.pass){

                let payload = {user: body.user, pass: body.pass};

                let access = await EXTUSER.findOne(payload);

                if(access){

                    if(access.jwt === ''){
                        response.token = jwt.sign(payload, 'planner-api-huawei-secret', {
                            expiresIn: '24h'
                        });
                        await EXTUSER.findOneAndUpdate(payload,{$set:{jwt:response.token}});
                        status = 200;
                        response.result = 'OK';
                    }else{
                        response.error = 'USER ALREADY HAS A TOKEN';
                    }

                }else{
                    response.error = 'USER NOT FOUND';
                }

            }else{
                response.error = 'WRONG CREDENTIALS';
            }

        }catch (e) {
            status = 500;
            response.error = 'UNAVAILABLE SERVICE';
            console.log(e);
        }
        res.status(status).json(response);
    });

accessManagerRouter.route('/app-login')
    .post(async (req, res) => {

        var body = req.body, resp = {result:'NOK'}, data = {};

        if(body.user === '' || body.pass === ''){
            resp.error = {message:'Campos Invalidos.'};
        }else{

            const client = new Client({url});

            try {
                await client.bind(`${body.user}${(body.type==='user'?'@'+dominio:'')}`, body.pass);
                // search data
                const {searchEntries} = await client.search(adSuffix, {scope: 'sub', filter: `(${searchType[body.type]}=${body.user})`});
                //console.log(searchEntries[0]);
                const {samaccountname, sn, givenName, title, physicalDeliveryOfficeName, department, company, mailNickname, mail} = searchEntries[0];
                data = {
                    user: body.user,
                    name: givenName,
                    lastName: sn,
                    email: mail,
                    title:title,
                    company:company,
                    department:department,
                    image: (givenName.split(' ')[0].slice(0,1)+sn.split(' ')[0].slice(0,1)).toUpperCase()
                };

                let acceso = await ACCESO.findOne({user:data.user});

                if(acceso.status !== 'BLOCKED'){
                    let menu = [];
                    for(let obj of acceso.scope){
                        if(menuModulo_[obj.scope]){
                            menu.push({id:obj.id, name: menuModulo_[obj.scope]});
                        }
                    }
                    data.menu = menu;
                    resp.content = data;
                }

            } catch (e) {
                if(e.code === 49){
                    resp.error = {message:'Credenciales Incorrectas.'};
                }else{
                    resp.error = {message:'Ocurrió un error.'};
                }
            } finally {
                await client.unbind()
            }
        }


        res.json(resp);
    });

accessManagerRouter.route('/get-app-user-info/:deviceID')
    .get(async (req, res) => {

        console.log('/get-app-user-info/');

        var resp = {result:'NOK'}, data = {};

        let acceso = await ACCESO.findOne({deviceID:req.params.deviceID});

        if(acceso && acceso.status !== 'BLOCKED'){
            let menu = [];
            for(let obj of acceso.scope){
                if(menuModulo_[obj.menu]){
                    //menu.push({id:obj.menu, name: menuModulo_[obj.menu]});
                    menu.push(`${obj.menu}:${menuModulo_[obj.menu]}`);
                }
            }

            resp.content = {
                user: acceso.user,
                name: acceso.name.split(', ')[1],
                lastName: acceso.name.split(', ')[0],
                email: acceso.email,
                title: acceso.title,
                image: (acceso.name.split(', ')[1].split(' ')[0].slice(0,1)+acceso.name.split(', ')[0].split(' ')[0].slice(0,1)).toUpperCase(),
                menu
            };
            resp.result = 'OK';
        }

        res.json(resp);
    });

accessManagerRouter.route('/ldap-test')
    .post(async (req, res) => {

        let body = req.body, user = body.user, pass = body.pass;

        const dominio = 'nextelperu.net';
        const ip = '14.240.4.146';
        const url = `ldap://${ip}:389`;
        const adSuffix = `dc=nextelperu,dc=net`;

        const client = new Client({url});

        let isAuthenticate;
        let data = {};
        try {
            await client.bind(`${user}@${dominio}`, pass);
            isAuthenticate = true;
            console.log('Connection validate');
            // search data
            const {searchEntries} = await client.search(adSuffix, {scope: 'sub', filter: `(samaccountname=${user})`});
            const {sn, givenName, title, physicalDeliveryOfficeName, department, company, mailNickname, mail} = searchEntries[0];
            data = {
                firstName: givenName,
                lastName: sn,
                email: mail,
                title,
                company,
                companyShort: company,
                department,
                mailNickname,
                office: physicalDeliveryOfficeName
            }
        } catch (e) {
            console.log(e);
            isAuthenticate = false;
            console.log('Error connection')
        } finally {
            await client.unbind();
            console.log('Close connection')
        }
        let tmp =  (isAuthenticate ? {auth: true, ...data} : {auth: false});
        res.json({tmp});

    });

module.exports = accessManagerRouter;