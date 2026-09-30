const express = require('express');
const XLSX = require('xlsx');
var generator = require('generate-password');
const db=require('../../../db');
const { sendEmail, generateInfoHTML, generateHtmlConfirm } = require('../../../utils/send-email');
const bcrypt = require('bcryptjs')
const json2xls = require("json2xls");
const fs = require("fs");
const {join} = require("path");
const schedule = require('node-schedule');

//var DIRECTORY = require('../../../models/gcir/providers/directory');
const mainPath = '/data/html/gcir/resources/files/gcir/providers/';
//const mainPath = '/data/htm/gcir/resources/files/gcir/providers/';

function readFile(path) {
    let workbook = XLSX.readFile(path, { type: 'string', raw: true, sheetStubs: true });
    let doc = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    if (doc[0]) {
        return doc;
    } else {
        return false;
    }
}

const managerRouter = express.Router();

managerRouter.route('/get-data')
    .get(async (req, res) => {
        const { provDirectory }=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {

            response.content = await provDirectory.find().lean();
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-data/:id')
    .get(async (req, res) => {
        const { provDirectory }=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {

            response.content = await provDirectory.findOne({ _id: req.params.id});
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/save-data')
    .post(async (req, res) => {

        const { provDirectory }=await db()
        let response = { result: 'NOK' }, body = req.body;
        let business, business_short_new;

        try {

            if(body.first_name && body.last_name && body.business_short) {
                //Add Contact Provider
                business = body.business_short.toLowerCase().split(" ").toString()
                business_short_new = business.replace(/,/g,".")
                body.user = body.first_name.toLowerCase()[0] + body.last_name.split(" ")[0].toLowerCase() + '.' + business_short_new;

                response.content = await provDirectory.create(body);

                await sendEmail(
                    'normal',
                    '"Planner Notifier" <planner.notifier@entel.net.pe>',
                    response.content.email,
                    ['sccopaco@nttdata.com'],
                    'Configuración de Contraseña - GCIR Proveedores',
                    generateHtmlConfirm({
                        userMid: response.content._id,
                        username: response.content.user
                    }),
                    []
                );

            } else {
                //Add Provider
                response.content = await provDirectory.create(body);
            }
   
            response.result = 'OK';
            // body.password = generator.generate({
            //     length: 14,
            //     numbers: true,
            //     symbols: false
            // });

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/confirm-password')
    .post(async (req, res) => {

        const { provDirectory }=await db()
        let response = { result: 'NOK' }, body = req.body;
        let password, password_repeat, password_hash;
        const saltRounds = 10;

        try {

            password = body.password
            password_repeat = body.password_repeat

            if(password.length <= 14){
                response.result = 'NOK';
                response.message = 'La contraseña debe tener al menos 14 caracteres';
                return res.status(400).json(response);
            }

            if(!password.match(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@.#$!%*?&])[A-Za-z\d@.#$!%*?&]{8,}$/)){
                response.result = 'NOK';
                response.message = 'La contraseña debe tener al menos una letra mayúscula, una letra minúscula, un caracter especial y un número';
                return res.status(400).json(response);
            }

            if(password !== password_repeat){
                response.result = 'NOK';
                response.message = 'Las contraseñas no coinciden'
                return res.status(400).json(response); 
            }

            password_hash = await bcrypt.hash(password, saltRounds);
            response.content = await provDirectory.findOneAndUpdate({
                _id: body._id
            }, { password: password_hash, passwordLastUpdated: new Date() });

            // response.content = await provDirectory.findOneAndUpdate({
            //     _id: body._id
            // }, { password, passwordLastUpdated: new Date() });
            
            response.result = 'OK';
            
        } catch (e) {

            console.log(e);
        }

        res.json(response);

    });

managerRouter.route('/reset-password')
    .post(async (req, res) => {
    
        const { provDirectory }=await db()
        let response = { result: 'NOK' }, body = req.body;
        const saltRounds = 10;
        let password, password_repeat;

        try {

            password = body.password
            password_repeat = body.password_repeat

            if(password.length <= 14){
                response.result = 'NOK';
                response.message = 'La contraseña debe tener al menos 14 caracteres';
                return res.status(400).json(response);
            }

            if(!password.match(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@.#$!%*?&_])[A-Za-z\d@.#$!%*?&_]{8,}$/)){
                response.result = 'NOK';
                response.message = 'La contraseña debe tener al menos una letra mayúscula, una letra minúscula, un caracter especial y un número';
                return res.status(400).json(response);
            }

            if(password !== password_repeat){
                response.result = 'NOK';
                response.message = 'Las contraseñas no coinciden'
                return res.status(400).json(response); 
            }

            const password_hash = await bcrypt.hash(password, saltRounds);
            response.content = await provDirectory.findOneAndUpdate({
                _id: body._id
            }, { password: password_hash, passwordLastUpdated: new Date() });

            response.result = 'OK';

            
        } catch (e) {
            console.log(e);
        }

        res.json(response);

})

managerRouter.route('/update-data')
    .post(async (req, res) => {

        const { provDirectory }=await db()
        let response = { result: 'NOK' }, body = req.body;

        console.log(body);
        body.user = body.first_name.toLowerCase()[0] + body.last_name.split(" ")[0].toLowerCase() + '.' + body.business_short

        try {

            if(body.password !== "") {
                response.content = await provDirectory.findByIdAndUpdate(
                    { _id: body._id },
                    body,
                    {
                        new: true
                    }
                );
    
                response.result = 'OK';
            } else {
                response.content = await provDirectory.findByIdAndUpdate(
                    { _id: body._id },
                    {
                        password: body.password
                    },
                    {
                        new: true
                    }
                );
    
                response.result = 'OK';
            }

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });

    managerRouter.route('/update-data-by-user')
    .post(async (req, res) => {

        const { provDirectory }=await db()
        let response = { result: 'NOK' }, body = req.body;

        body.user = body.first_name.toLowerCase()[0] + body.last_name.split(" ")[0].toLowerCase() + '.' + body.business_short
   
        try {

            response.content = await provDirectory.updateOne(
                { _id: body._id },
                {
                    $set: body,
                    $unset: { eventApproval: "", newData: "", pendingApproval: "", emailRequesting: ""}
                }
            );

            response.result = 'OK';
            
        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/delete-data')
    .post(async (req, res) => {

        const { provDirectory }=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {

            response.content = await provDirectory.findByIdAndRemove(body._id)
            response.result = 'OK';

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/load-to-db')
    .post(async (req, res) => {

        const {provDirectory}=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {
            await provDirectory.remove();

            let path = body.path;

            let workbook = XLSX.readFile(path, { type: 'string', raw: true, sheetStubs: true });
            let doc = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            response.result = 'OK';
            response.content = doc;

            for (let provider of doc) {
                provider.user = provider.first_name.toLowerCase()[0] + provider.last_name.split(" ")[0].toLowerCase() + '.' + provider.business_short;
                await provDirectory.create(provider);
            }

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/save-massive')
    .post(async (req, res) => {

        const {provDirectory}=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {

            let path = body.path;

            let workbook = XLSX.readFile(path, { type: 'string', raw: true, sheetStubs: true });
            let doc = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            response.result = 'OK';

            for (let provider of doc) {
                provider.user = provider.first_name.toLowerCase()[0] + provider.last_name.split(" ")[0].toLowerCase() + '.' + provider.business_short;
                provider.password = generator.generate({
                    length: 10,
                    numbers: true,
                    symbols: true
                });
                await provDirectory.create(provider);
            }
            response.content = doc;

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-name-providers')
    .get(async (req, res) => {

        const {provDirectory}=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {

            let name_providers = await provDirectory.find().sort({ business_name: 1 });
            name_providers = name_providers.map(x => x.business_name);
            name_providers = new Set(name_providers);
            response.content = [...name_providers];
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-email-providers')
    .get(async (req, res) => {

        const { provDirectory }=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {

            let email_providers = await provDirectory.find().sort({ email: 1 });
            email_providers = email_providers.map(x => x.email);
            email_providers = new Set(email_providers);
            response.content = [...email_providers];
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });



managerRouter.route('/get-name-sites')
    .get(async (req, res) => {

        let response = { result: 'NOK' }, body = req.body;

        try {
            response.content = [{siteName : 1}];
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-info-providers')
    .get(async (req, res) => {

        const { provDirectory }=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {

            let name_providers = await provDirectory.find().sort({ business_name: 1 });
            let info_providers = [];

            for (let index = 0; index < name_providers.length; index++) {
                let business_name = name_providers[index].business_name;
                if (index) {
                    if (business_name !== name_providers[index - 1].business_name) {
                        info_providers.push(name_providers[index]);
                        console.log(business_name);
                    }
                        
                } else {
                    info_providers.push(name_providers[index]);
                }
            }

            response.content = info_providers;
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-id')
    .post(async (req, res) => {

        const { provDirectory }=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {
            let provider = await provDirectory.findOne({ business_name: body.business_name });
            response.content = provider._id;
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-scope/:user/:pass')
// managerRouter.route('/get-scope/:user')
    .get(async (req, res) => {

        const { provDirectory }=await db()
        const saltRounds = 10;
        let response = { result: 'NOK' }, body = req.body;
        let isValid = false;
        let pass = req.params.pass;
        // let pass = decodeURIComponent(req.params.pass);
        console.log(pass);

        try {
            let provider = await provDirectory.findOne({ user: req.params.user });

            if (provider != null) {

                if(provider.passwordLastUpdated) {
                    const daysSinceLastUpdate = (Date.now() - provider.passwordLastUpdated.getTime()) / (1000 * 3600 * 24);
                    if(Math.abs(daysSinceLastUpdate) > 90) {
                        response.result = 'NOK';
                        response.content = null
                        response.message = 'La contraseña expiró, actualice su contraseña en ¿Olvido su contraseña?';
                        return res.json(response);
                    }   
                }

                const isHashed = provider.password.length > 40;

                if(isHashed) {
                    isValid = await bcrypt.compare(pass, provider.password);
                } else {
                    //TEMPORAL while the user's password is not hashed
                    isValid = pass === provider.password;
                    const password_hash = await bcrypt.hash(pass, saltRounds);
                    await provDirectory.findOneAndUpdate({ _id: provider._id }, { password: password_hash, passwordLastUpdated: new Date() });
                }
                console.log("isValid", isValid);

                if (isValid) {
                    response.content = {
                        usuario: provider.user,
                        nombre: provider.first_name + ' ' + provider.last_name,
                        email: provider.email,
                        gerencia: provider.business_name,
                        cargo: provider.title,
                        password: provider.password,
                        descripcion: 'PROVEEDOR'
                    }
                    response.result = 'OK';
                } else {
                    response.content = {};
                    response.message = "Credenciales Incorrectas"
                    response.result = 'NOK';
                }

            } else {
                response.content = null;
                response.message = "Usuario no encontrado"
                response.result = 'NOK';
            }

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

//daliy check password expired 90 days
managerRouter.route('/check-password-expired')
    .get(async (req, res) => {
        
        const { provDirectory }=await db()

        let rule = new schedule.RecurrenceRule();
        rule.hour = 7;
        rule.minute = 0;
        rule.second = 0;
        rule.dayOfWeek = new schedule.Range(0, 6);

        schedule.scheduleJob(rule, async function () {
            console.log('this will run everyday at 7:00am');

            let providers = await provDirectory.find();
            let cc = [];
            let link = "http://10.30.17.57/gcir/forgot"

            for (let provider of providers) {

                if(provider.passwordLastUpdated) {

                    const daysSinceLastUpdate = (Date.now() - provider.passwordLastUpdated.getTime()) / (1000 * 3600 * 24);

                    if (Math.abs(Math.ceil(daysSinceLastUpdate)) === 80) {   //10days before to expire password
                        //send email
                        await sendEmail(
                            'normal',
                            '"Planner Notifier" <planner.notifier@entel.net.pe>',
                            provider.email,
                            cc,
                            'Recordatorio de caducidad de contraseña - Plataforma GCIR Proveedores',
                            generateInfoHTML({
                                title: "CONTRASEÑA PRÓXIMO A VENCER",
                                message: `
                                    <p>Estimado(a) <a href="mailto:${provider.email}">@${provider.email}</a>:</p>
                                    <p>Su contraseña de la plataforma GCIR Proveedores caducará en 10 días. Actualícelo para garantizar el acceso ininterrumpido a su cuenta.</p>
                                    <p>Puede actualizar su password en el siguiente link:</p>
                                    <a href="${link}">${link}</a>
                                    <p>Atentamente.</p>
                                `
                            })
                        );
                    }

                }
                
                
            }
        });   
        
        res.json({result:'OK'});
    })

module.exports = managerRouter;
