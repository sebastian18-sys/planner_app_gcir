"use strict";
const nodemailer = require("nodemailer");
async function main() {

// create reusable transporter object using the default SMTP transport
  let transporter = nodemailer.createTransport({
    host: "10.68.143.121",
    port: 25,
    secure: false, // true for 465, false for other ports
    /*auth: {
      user: testAccount.user, // generated ethereal user
      pass: testAccount.pass, // generated ethereal password
    },*/
  });

// send mail with defined transport object
  let info = await transporter.sendMail({
    from: '"Fred Foo 👻" <planner.notifier@entel.net.pe>', // sender address
    to: "julio.jurado@entel.pe, daniel.saravia@entel.pe", // list of receivers
    subject: "Hello ✔", // Subject line
    text: "Hello world?", // plain text body
    html: "<b>Hello world?</b>", // html body
  });

	console.log("Message sent: %s", info.messageId);
  // Message sent: <b658f8ca-6296-ccf4-8306-87d57a0b4321@example.com>

  // Preview only available when sending through an Ethereal account
  console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info));
  // Preview URL: https://ethereal.email/message/WaQKMgKddxQDoou...

}

main().catch(console.error);
