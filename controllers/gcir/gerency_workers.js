const express = require('express');
const XLSX = require('xlsx');
const schedule = require('node-schedule');
const db = require('../../db');
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const { sendEmail, generateBirthdayHTML, generateInfoHTML } = require('../../utils/send-email');

const managerRouter = express.Router();

function readFile(path) {
    let workbook = XLSX.readFile(path, {type: 'string', raw: true, sheetStubs: true});
    let doc = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    return doc[0] ? doc : false;
}

managerRouter.route('/save-data')
    .post(async (req, res) => {


        const { gcirGrency_workers }=await db()

        let response = {result: 'NOK'}, body = req.body;

        try {


            response.content = await gcirGrency_workers.create(body);

            response.result = 'OK';

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-data')
    .get(async (req, res) => {
        const { gcirGrency_workers }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await gcirGrency_workers.create(body);
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/save-massive-data')
    .post(async (req, res) => {

        const { gcirGrency_workers }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {
            await gcirGrency_workers.remove();

            let employees = readFile(body.path);

            for (let employee of employees) {
                employee.day = parseInt(employee.day);
                employee.month = parseInt(employee.month);
                await gcirGrency_workers.create(employee);
            }

            response.result = 'OK';
            response.content = doc;

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/send-birthday-mail')
    .post(async (req, res) => {

        const {gcirGrency_workers}=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            let date = new Date();
            let actual_day = date.getDate();
            let actual_month = date.getMonth() + 1;


            let gerency_workers = await gcirGrency_workers.find();
            let to_workers = [],
                cc_workers = [],
                workers_names = '',
                image_number = actual_day % 3,
                plural_flag = false;

            for (let worker of gerency_workers) {
                let worker_email = worker.email;
                if (worker.day === actual_day && worker.month === actual_month) {
                    to_workers.push(worker_email);
                    if (workers_names !== '') workers_names += ', ';
                    workers_names += worker.first_name.split(' ', 1)[0];
                } else cc_workers.push(worker_email);
            }

            if (to_workers.length > 1) plural_flag = true;

            if (to_workers.length !== 0) {
                await sendEmail(
                    'normal',
                    '<planner.gcir-birthday@entel.pe>',
                    to_workers,
                    cc_workers,
                    '¡Feliz Cumpleaños!',
                    generateBirthdayHTML({
                        workers_names: workers_names,
                        plural_flag: plural_flag
                    }),
                    [
                        {
                            filename: `image${image_number}.png`,
                            path: `/data/html/planner_app_gcir/resources/images/image${image_number}.png`,
                            cid: 'general_image' //same cid value as in the html img src
                        }
                    ]
                );
            }

            response.result = 'OK';
            //response.content = doc;

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/send-birthday-mail-schedule')
    .get(async (req, res) => {
        const { gcirGrency_workers }=await db()
        let rule = new schedule.RecurrenceRule();
        rule.hour = 3;
        rule.minute = 0;
        rule.second = 0;
        rule.dayOfWeek = new schedule.Range(0, 6);


        schedule.scheduleJob(rule, async function () {
            console.log('this will run everyday at 8:30am');

            let date = new Date();
            let actual_day = date.getDate();
            let actual_month = date.getMonth() + 1;

            let gerency_workers = await gcirGrency_workers.find();
            let to_workers = [],
                cc_workers = [],
                workers_names = '',
                image_number = actual_day % 3,
                plural_flag = false;

            for (let worker of gerency_workers) {
                let worker_email = worker.email;
                if (worker.day === actual_day && worker.month === actual_month) {
                    to_workers.push(worker_email);
                    if (workers_names !== '') workers_names += ', ';
                    workers_names += worker.first_name.split(' ', 1)[0];
                } else cc_workers.push(worker_email);
            }

            if (to_workers.length > 1) plural_flag = true;

            if (to_workers.length !== 0) {
                await sendEmail(
                    'normal',
                    '<planner.gcir-birthday@entel.net.pe>',
                    to_workers,
                    cc_workers,
                    '¡Feliz Cumpleaños!',
                    generateBirthdayHTML({
                        workers_names: workers_names,
                        plural_flag: plural_flag
                    }),
                    [
                        {
                            filename: `image${image_number}.png`,
                            path: `/data/html/planner_app_gcir/resources/images/image${image_number}.png`,
                            cid: 'general_image' //same cid value as in the html img src
                        }
                    ]
                );
            }

        });

        res.json({result:'OK'});

    });


managerRouter.route('/get-report-form')
    .get(async (req, res) => {

        const filePath = path.resolve(__dirname, '..', '..', 'views', 'form-report-capex.html');

        res.sendFile(filePath);
    });

managerRouter.route('/generate-report')
    .get(async (req, res) => {

        const execAsync = promisify(exec);

        let fileXlsx = ""
        const pwd = '/data/html/planner_app_gcir/scripts/capex'
        // const pwd2 = '/planner_app_gcir/scripts/capex'

        try {
            const py = '/data/html/planner_app_gcir/scripts/venv/bin/python'
            await execAsync(`${py} /data/html/planner_app_gcir/scripts/capex/reporte_capex.py`);

            console.log('✅ Reporte generado');

            fileXlsx = path.join(pwd, 'Reporte_Capex.xlsx');
            // const fileXlsb = path.join('/data/html/planner_app_gcir/scripts/capex', 'Reporte_Capex.xlsb');

            // const wb = XLSX.readFile(fileXlsx, { cellDates: true }); // lee .xlsx
            // XLSX.writeFile(wb, fileXlsb, { bookType: 'xlsb' });      // escribe .xlsb

            res.setHeader('Content-Disposition', `attachment; filename="Ejecucion_CAPEX_2025 v2.xlsx"`);

            // Enviar el archivo como descarga
            // res.download(fileXlsx, path.basename(fileXlsx), (err) => {
            //     if (err) {
            //     console.error('Error al descargar archivo:', err);
            //     return res.status(500).send('Error al descargar el archivo');
            //     }
            // });
            return fs.createReadStream(fileXlsx)
                .on('error', (err) => {
                    console.error('Stream error:', err);
                    if (!res.headersSent) res.sendStatus(500);
                })
                .pipe(res);

        } catch (err) {
            console.error('Error en el script:', err);
            return res.status(500).json({ error: String(err) });
        }

        // res.json({file: fileXlsx , result:'OK'});

    });

managerRouter.route('/load-to-db')
    .post(async (req, res) => {
	   
        const {gcirGrency_workers}=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {
            await gcirGrency_workers.remove();

            let path = body.path;

            let workbook = XLSX.readFile(path, { type: 'string', raw: true, sheetStubs: true });
            let doc = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            response.result = 'OK';
            response.content = doc;

	for (let gwc of doc) {
                await gcirGrency_workers.create({last_name:gwc.Apellidos,first_name:gwc.Nombres,day:gwc.DIA,month:gwc.MES,email:gwc.Email,title_name:gwc.Nombre_del_puesto,area_name:gwc.Nombre_de_Area});
            }

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });



module.exports = managerRouter;