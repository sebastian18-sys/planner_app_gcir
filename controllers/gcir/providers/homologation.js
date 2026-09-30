const express = require('express');
const db=require('../../../db');
const schedule = require('node-schedule');
const listToSend = require('../../../utils/list-send-directory');
const { sendEmail, generateInfoHTML } = require('../../../utils/send-email')
const { dateFormat, GetActualDate } = require('../../../utils/dates');
//var HOMOLOGATION = require('../../../models/gcir/providers/homologation');

const XLSX = require('xlsx');
const managerRouter = express.Router();

function getMonthOrYearDiff(start, end) {

    if(
        start === "" || 
        start === undefined ||
        start === "-" ||
        end === "" ||
        end === undefined ||
        end === "-"
    ) return "-"

    if(
        start === "NA" ||
        end === "NA"
    ) return "NA"

    const start_format = dateFormat(start);
    const end_format = dateFormat(end);
    let years
    let months

    years = end_format.getFullYear() - start_format.getFullYear();
    months = (end_format.getMonth()+1) - (start_format.getMonth()+1);

    if (years > 0 && months < 0) {
        years = years - 1
        months = 12 + months
    } else if (years >= 0 && months >= 0) {
        months = months
    }  else {
        return undefined //fecha vigencia < fecha inicio
    }

    return (years === 0 ? " " : years > 1 ? years + " años" : years + " año") + (months > 0 ? " " + months + " mes" + (months !== 1 ? "es" : "") : "")
}

function updateNewLetterBailState (end_date) {
    let new_state
    const date = new Date() 
    const date_end_cf = dateFormat(end_date)
    const milisecons_month = 1000 * 60 * 60 * 24 * 30   
    
    if(!date_end_cf.getTime()) { 
        if(end_date === "NA") new_state = "NA"
        else new_state = "PENDIENTE"
    } else if(date_end_cf.getTime() <= date.getTime()) {
        new_state = 'VENCIDO';
    } else if(Math.abs(date_end_cf.getTime() - date.getTime()) <= milisecons_month) {
        new_state = 'PROXIMO A VENCER';
    } else {
        new_state = 'VIGENTE';
    }
    
    return new_state
}

function filterNoExistOldData(firstArray, secondArray) {
    return firstArray.filter(obj1 => 
        !secondArray.some(obj2 => obj2.provider === obj1.provider));
}

managerRouter.route('/get-data')
    .get(async (req, res) => {

        const { provHomologation } = await db()

        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provHomologation.find();
            response.result = 'OK';
-+9
        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-data/:id')
    .get(async (req, res) => {

        const { provHomologation }=await db()
        let response = {result: 'NOK'}, body = req.body;
        
        try {
            response.content = await provHomologation.findOne({ _id: req.params.id});
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    })

managerRouter.route('/save-data')
    .post(async (req, res) => {

        const { provHomologation } = await  db()

        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provHomologation.create(body);
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/update-data')
    .post(async (req, res) => {

        const { provHomologation }=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {

            response.content = await provHomologation.findByIdAndUpdate(
                { _id: body._id },
                body,
                {
                    new: true
                }
            );

            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/load-to-db')
    .post(async (req, res) => {

        let response = {result: 'NOK'}, body = req.body;
        const { provHomologation } = await db()
        const { provHistory } = await db()

        /**
         * Guardar los datos anteriores en el histórico
         */
        let previus_data = await provHomologation.find();
        await provHistory.create({
            original_data: previus_data,
            date_change: GetActualDate(),
            user_change: body.user,
            event_change: "insert-massive",
            document: "homologations"
        });

        try {
            // await provHomologation.remove();
            let path = body.path;

            let workbook = XLSX.readFile(path,{ type: 'string', raw:true, sheetStubs: true });
            let doc = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            response.result = 'OK';
            response.content = doc;

            let uniqueElements = filterNoExistOldData(previus_data, doc);

            await provHomologation.deleteMany({
                _id: {$in: uniqueElements.map(s => s._id)}
            })

            for (let provider of doc){

                provider.contract_duration = getMonthOrYearDiff(provider.start_date, provider.life_date);
                provider.state = updateNewLetterBailState(provider.life_date);

                let existent_provider = await provHomologation.findOneAndUpdate({
                    "provider": provider.provider,
                }, provider);

                if (!existent_provider) {
                    provider.data_files_evidence = [];
                    provider.comments = [];
                    await provHomologation.create(provider);
                }

            }

        }catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/update-state')
    .get(async (req, res) => {
        const { provHomologation }=await db()
        
        let rule = new schedule.RecurrenceRule();
        rule.hour = 8;
        rule.minute = 1;
        rule.second = 0;
        rule.dayOfWeek = new schedule.Range(0, 6);

        schedule.scheduleJob(rule, async function () {
            console.log('this will run everyday at 8:01am');

            let homologations = await provHomologation.find();

            for (let homologation of homologations) {

                let new_state
                const date = new Date() 
                const date_end = dateFormat(homologation.life_date)
                const milisecons_month = 1000 * 60 * 60 * 24 * 30   

                if(!date_end.getTime()) {
                    continue;
                } else if(date_end.getTime() <= date.getTime()) {
                    new_state = 'VENCIDO';
                } else if(Math.abs(date_end.getTime() - date.getTime()) <= milisecons_month) {
                    new_state = 'PROXIMO A VENCER';
                } else {
                    new_state = 'VIGENTE';
                }
    
                if(homologation.state !== 'PENDIENTE DE REVISIÓN' && homologation.state !== 'PENDIENTE') {
                    if (new_state !== homologation.state) {

                        await provHomologation.findByIdAndUpdate(
                            { _id: homologation._id },
                            { state: new_state },
                            {
                                new: true
                            }
                        );
                    }
                }
            }
        });   
        
        res.json({result:'OK'});
    })

managerRouter.route('/send-notification-homologation')
    .get(async (req, res) => {
        const { provHomologation, provDirectory, provSettings }=await db()

        let rule = new schedule.RecurrenceRule();
        rule.hour = 8;
        rule.minute = 40;
        rule.second = 0;
        rule.dayOfWeek = new schedule.Range(0, 6);

        schedule.scheduleJob(rule, async function () {
            console.log('this will run everyday at 8:40am');

            let homologations = await provHomologation.find();
            let directory_workers = await provDirectory.find();
            let setting = await provSettings.find();

            // Settings STANDAR VALUES
            const LIST_TO_SEND = setting[0].homologations_settings.list_to_send;
            const cc_expiration = setting[0].homologations_settings.homologation[0].cc;
            const cc_end = setting[0].homologations_settings.homologation[1].cc;
            const days_of_expiration = setting[0].homologations_settings.homologation[0].notification_day
            const reminder_expiration = setting[0].homologations_settings.homologation[0].reminder
            const reminder_end = setting[0].homologations_settings.homologation[1].reminder

            // console.log('list to send', LIST_TO_SEND);

            for (let homologation of homologations) {

                let to_workers = [],
                intervalDays;

                let worker_for_company = directory_workers.filter(w => w.business_name === homologation.provider)
                                    
                for(let worker_email of worker_for_company) {
                    if(LIST_TO_SEND.includes(worker_email.email)) {
                        to_workers.push(worker_email.email);
                    }
                }

                const date = new Date() 
                const date_end_cf = dateFormat(homologation.life_date)
                const timeDiff = (date_end_cf.getTime() - date.getTime())
                const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24))

                let link = 'http://10.30.17.57/gcir/proveedores/homologacion/' + homologation._id;

                if(homologation.state === "PROXIMO A VENCER"){
                    intervalDays = reminder_expiration
                    if(daysDiff <= days_of_expiration && daysDiff >= 0){
                        if((daysDiff % intervalDays) === 0) {   //Send notify every 7 days
                            await sendEmail(
                                'normal',
                                '"Planner Notifier" <planner.notifier@entel.net.pe>',
                                to_workers,
                                cc_expiration,
                                'CERTIFICADO DE HOMOLOGACIÓN PROXIMO A VENCER',
                                generateInfoHTML({
                                    title: "CERTIFICADO DE HOMOLOGACIÓN",
                                    message: `
                                        <p>Estimado ${homologation.provider}:</p>
                                        <p>EL CERTIFICADO DE HOMOLOGACIÓN con alcance ${homologation.scope} se encuentra PRÓXIMO A VENCER el día ${homologation.life_date}.</p>
                                        <p>Por favor, realizar las gestiones necesarias, cargar el nuevo documento vigente y datos solicitados en el siguiente link de la plataforma de proveedores de la GCIR:</p>
                                        <a href="${link}">${link}</a>
                                        <p>Atentamente, COMITE DE CALIDAD GCIR.</p>
                                    `
                                })
                            );
                        }
                        
                    }
                }
    
                if(homologation.state === "VENCIDO"){
                    intervalDays = reminder_end
                    if(daysDiff <= 0) {
                        if((daysDiff % intervalDays) === 0) {  //Send notify every 7 days
                            await sendEmail(
                                'normal',
                                '"Planner Notifier" <planner.notifier@entel.net.pe>',
                                to_workers,
                                cc_end,
                                'CERTIFICADO DE HOMOLOGACIÓN VENCIDO',
                                generateInfoHTML({
                                    title: "CERTIFICADO DE HOMOLOGACIÓN",
                                    message: `
                                        <p>Estimado ${homologation.provider}:</p>
                                        <p>EL CERTIFICADO DE HOMOLOGACIÓN con alcance ${homologation.scope} se encuentra VENCIDO desde la fecha ${homologation.life_date}.</p>
                                        <p>La asignación de trabajos se encuentra BLOQUEADA para su representada, hasta la regularización del documento.</p>
                                        <p>Por favor, realizar las gestiones necesarias, cargar el nuevo documento vigente y datos solicitados en el siguiente link de la plataforma de proveedores de la GCIR:</p>
                                        <a href="${link}">${link}</a>
                                        <p>Atentamente, COMITE DE CALIDAD GCIR.</p>
                                    `
                                })
                            );
                        }
                    }
                }
            }
        });   
        
        res.json({result:'OK'});
    })


module.exports = managerRouter;