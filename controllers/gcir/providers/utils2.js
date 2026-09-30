const nodemailer = require('nodemailer');
const express = require("express");
let transporter = null;
const db = require('../../db');

const managerRouter = express.Router();

function generateInfoHTML({to,cc,subject,title,message,attachments}) {
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
