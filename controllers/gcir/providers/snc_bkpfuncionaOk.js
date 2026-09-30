const express = require('express');
const db=require('../../../db');
const nodemailer = require('nodemailer');

//var SNC = require('../../../models/gcir/providers/snc');


const XLSX = require('xlsx');
const fs = require("fs");
const json2xls = require("json2xls");
const {join} = require("path");

//var DIRECTORY = require('../../../models/gcir/providers/directory');
const mainPath = '/data/html/gcir/resources/files/gcir/providers/';

const managerRouter = express.Router();
function generateInfoHTML({title,message}) {
    return `
        <!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
        <html xmlns="http://www.w3.org/1999/xhtml">
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
            <title>PLANNER NOTIFIER</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        </head>
        <body style="margin: 0; padding: 0;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                    <td style="padding: 0px 0 0px 0;">
                        <table align="center" border="0" cellpadding="0" cellspacing="0" width="600">
                            <tr>
                                <td bgcolor="#ffffff" style="padding: 40px 30px 40px 30px;">
                                    <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                        <tr>
                                            <td style="color: #153643; font-family: Arial, sans-serif; font-size: 19px;">
                                                ${title}
                                            </td>
                                        </tr>
                                        <tr>
                                            <td style="padding: 25px 0 30px 0; color: #153643; font-family: Arial, sans-serif; font-size: 16px; line-height: 20px;">
                                                ${message}
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                            <tr></tr>
                            <tr>
                                <td style="background-color: #221e78; text-align: center;">
                                    <img src="cid:footer"/>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </body>
        </html>
    `;
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

        const { provDirectory }=await db()

        await sendEmail(
            'high',
            '<planner.notifier@entel.net.pe>',
            to,
            cc,
            subject,
            generateInfoHTML({
                title: title,
                message: message
            }),
            [
                {
                    filename: 'planner_footer.png',
                    path: '/var/www/html/planner/resources/views/img/planner_footer.png',
                    cid: 'footer' //same cid value as in the html img src
                },
                ...body.attachments
            ]
        );

        res.json({result: 'OK'});


    });

    async function sendEmail(
        priority = 'normal',
        from = '<planner.notifier@entel.net.pe>',
        to,
        cc,
        subject,
        html,
        attachments
    ) {
        if (!transporter) {
            transporter = nodemailer.createTransport({
                host: '10.68.143.121',
                port: 25,
                //secure: false,
                //tls: {ciphers: 'SSLv3'}
            })
        }
        return new Promise((resolve, reject) => {
            transporter.sendMail(
                {
                    priority,
                    from,
                    to,
                    cc,
                    subject,
                    html,
                    attachments
                },
                (err, data) => {
                    if (err) return reject(err);
                    //console.log(err);
                    transporter.close();
                    resolve(data);
                }
            )
        })
    }

module.exports = managerRouter;