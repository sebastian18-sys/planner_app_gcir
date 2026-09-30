const express = require('express');
const db=require('../../../db');
const { sendEmail, generateSncHtml } = require('../../../utils/send-email');
const fetch = require('node-fetch');
// const XLSX = require('xlsx')
const https = require('https')
const dns = require("dns");

// const agent = https.Agent({
//     rejectUnauthorized: false
// });

const HOST = "desplieguegcir.entel.net.pe";
const IP = "10.30.17.57";

const agent = new https.Agent({
    rejectUnauthorized: false,
    servername: HOST,
    lookup: (hostname, options, callback) => {
        if (hostname === HOST) {
            return callback(null, IP, 4);
        }

        return dns.lookup(hostname, options, callback);
    }
});


//var SNC = require('../../../models/gcir/providers/snc');
const XLSX = require('xlsx');
const fs = require("fs");
const json2xls = require("json2xls");
const jsPDF = require("jspdf");
//const json2pdf = require("json2pdf");
const {join} = require("path");
const { GetActualDate } = require('../../../utils/dates');

//var DIRECTORY = require('../../../models/gcir/providers/directory');
const mainPath = '/data/html/gcir/resources/files/gcir/providers/'

const managerRouter = express.Router();

// function xlsxToXlsb(xlsxPath, xlsbPath) {
//     const workbook = XLSX.readFile(xlsxPath);
  
//     // 2. Generamos un buffer XLSB
//     const xlsbBuffer = XLSX.write(workbook, {
//       bookType: 'xlsb',
//       type: 'buffer'
//     });
  
//     // 3. Escribimos el .xlsb
//     fs.writeFileSync(xlsbPath, xlsbBuffer);
//   }
function xlsxToXlsbKeepDateTimes(xlsxPath, xlsbPath){
    // 1. Leemos el workbook con fechas como Date objects
    const wb = XLSX.readFile(xlsxPath, { cellDates: true });
  
    wb.SheetNames.forEach(sheetName => {
      const ws = wb.Sheets[sheetName];
      if (!ws['!ref']) return;
  
      // rango completo de la hoja
      const range = XLSX.utils.decode_range(ws['!ref']);
      // columnas de interés: T → BG
      const startCol = XLSX.utils.decode_col('T');
      const endCol   = XLSX.utils.decode_col('BG');
  
      for (let C = startCol; C <= endCol; ++C) {
        for (let R = range.s.r; R <= range.e.r; ++R) {
          const addr = XLSX.utils.encode_cell({ c: C, r: R });
          const cell = ws[addr];
          if (!cell) continue;
  
          // si es fecha (t:'d') o número con zona previa de fecha
          if (cell.t === 'd' || (cell.t === 'n' && cell.z && /[dmyhms:\s]/i.test(cell.z))) {
            // forzamos el formato con hora
            cell.z = 'd/mm/yyyy';
          }
        }
      }
    });
  
    // 2. Escribimos a XLSB, tratando de conservar estilos
    const xlsbBuffer = XLSX.write(wb, {
      bookType:   'xlsb',
      type:       'buffer',
      cellStyles: true
    });
  
    fs.writeFileSync(xlsbPath, xlsbBuffer);
  }


managerRouter.route('/get-data')
    .get(async (req, res) => {
        const { provSnc }=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {
            response.content = await provSnc.find({});
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-data-dashboard')
    .post(async (req, res) => {
        const { provSnc }=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {

            let snc_data = await provSnc.find({year: parseInt(body.year)}, {
                business_name: true,
                creation_date: true,
                id_snc: true,
                state: true,
                name_responsable: true,
                is_attributable: true,
                amount: true
            });

            let content = [];

            for (let snc of snc_data) {
                let year = parseInt((snc.id_snc / 1000).toFixed(0)),
                    month = parseInt(snc.creation_date.split('/', 2)[1]),
                    amount = snc.amount || '0';
                content.push({
                    business_name: snc.business_name,
                    state: snc.state,
                    name_responsable: snc.name_responsable,
                    is_attributable: snc.is_attributable,
                    amount: parseFloat(parseFloat(amount).toFixed(3)),
                    year: year,
                    month: month
                });
            }

            response.content = content;
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-data/:id')
    .get(async (req, res) => {

        const { provSnc }=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {
            response.content = await provSnc.findOne({ _id: req.params.id });
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/save-data')
    .post(async (req, res) => {
        const { provSnc }=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {

            let collection = await provSnc.find().sort({ "id_snc": 1 });
            let date = new Date(),
                actual_year = date.getFullYear(),
                last_id,
                last_year;

            if (collection.length) {
                last_id = collection[collection.length - 1].id_snc;
                last_year = (last_id / 1000).toFixed(0);
            }

            if (last_year != actual_year || collection.length == 0) {
                body.id_snc = actual_year * 1000 + 1;
            } else {
                body.id_snc = last_id + 1;
            }

            response.content = await provSnc.create(body);
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/update-data')
    .post(async (req, res) => {

        const { provSnc }=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {

            /*
            let new_body = {};
            for (let key in body) {
                if (key != '_id') new_body[key] = body[key];
            }
            */

            response.content = await provSnc.findByIdAndUpdate(
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

managerRouter.route('/export-to-xlsx')
    .post(async (req, res) => {

        let response = {result: 'NOK'}, body = req.body;

        //const { provDirectory } = await db()

        try {
            //body.data = await provDirectory.find()
            var data = body.data;

            var xls = json2xls(data);
            //let path =join(__dirname,'../../../../gcir/resources/files/gcir/providers/' + body.fileName + '.xls');
            let path = mainPath + body.fileName + '.xls';
            console.log(path)

            if (fs.existsSync(path)) {
                fs.unlinkSync(path);
            }

            fs.writeFileSync(path, xls, 'binary');

            response.result = 'OK';
            //response.path = '/planner/resources/files/gcir/providers/' + body.fileName + '.xls';
            response.path = '/gcir/resources/files/gcir/providers/' + body.fileName + '.xls';

        } catch (e) {

            console.log(e);
        }

        const rest = res.json(response);
        console.log(rest)
    });



managerRouter.route('/send-email')
    .post(async (req, res) => {
        
        await sendEmail(
            'normal',
            '"Planner Notifier" <planner.notifier@entel.net.pe>',
            req.body.to,
            req.body.cc,
            req.body.subject,
            generateSncHtml({
                title: req.body.title,
                message: req.body.message
            }),
            [
                {
                    filename: 'planner_footer.png',
                    path: '/data/html/planner_app_gcir/resources/images/planner_footer.png',
                    cid: 'footer' //same cid value as in the html img src
                },
                ...req.body.attachments
            ]
        );

        res.json({result: req.body});
    });


managerRouter.route('/report-planner')
    .get(async (req, res) => {
        
        // fetch api GET https://10.30.17.57:84/control/api/subprojects/reporte-planner
        const data = await fetch('https://desplieguegcir.entel.net.pe:84/control/api/subprojects/reporte-planner', { agent });
        const result = await data.json()

        console.log("DATA", result)

        const filename = result.substring(
            result.lastIndexOf('/') + 1,
            result.lastIndexOf('.')
          );

        const xlsxPath = `/data/planner/planner-web/public/files/control/subProject/${filename}.xlsx`;
        const xlsbPath = `/data/planner/planner-web/public/files/control/subProject/${filename}.xlsb`;
        xlsxToXlsbKeepDateTimes(xlsxPath, xlsbPath);

        await sendEmail(
            'normal',
            '"Planner Notifier" <planner.notifier@entel.net.pe>',
            // to_workers,
            ['ntt_sccopacondo@externo.entel.pe', 'jhonnattan.villegas@entel.pe', 'ntt_mbarbozar@externo.entel.pe'],
            [],
            // cc_expiration_letter,
            'Reporte Planner - ' + GetActualDate(),
            generateSncHtml({
                title: "Reporte Planner",
                message: ``
            }),
            [
                {
                    filename: `${filename}.xlsb`,
                    path: xlsbPath,
                    cid: 'footer' //same cid value as in the html img src
                }
            ]
        );


        // let rule = new schedule.RecurrenceRule();
        // rule.hour = 8;
        // rule.minute = 45;
        // rule.second = 0;
        // rule.dayOfWeek = new schedule.Range(0, 6);

        // schedule.scheduleJob(rule, async function () {
        //     console.log('this will run everyday at 8:45am');

        //     await sendEmail(
        //         'normal',
        //         '"Planner Notifier" <planner.notifier@entel.net.pe>',
        //         // to_workers,
        //         ['ntt_sccopacondo@externo.entel.pe', 'sebastian99_19@hotmail.com'],
        //         // cc_expiration_letter,
        //         'Reporte Planner - ' + dateFormat(new Date()),
        //         generateInfoHTML({
        //             title: "Reporte Planner",
        //             message: ``
        //         }),
        //         [
        //             {
        //                 filename: 'planner_footer.png',
        //                 path: '/data/html/planner_app_gcir/resources/images/planner_footer.png',
        //                 cid: 'footer' //same cid value as in the html img src
        //             },
        //             ...req.body.attachments
        //         ]
        //     );
        // });   
        console.log("FIN")
        
        res.json({result:'OK'});
    })


module.exports = managerRouter;
