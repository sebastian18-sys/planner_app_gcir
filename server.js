const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const fetch = require('node-fetch');
//const helmet =require('helmet');

const planner = express();
const port = 89;
//mongoURL = "mongodb://gcirAdmin:Entel1234_@10.30.17.57:27017/fibertx";
//planner.use(helmet());
planner.use(morgan('dev'));


planner.use((req, res, next) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST, PUT, PATCH, DELETE');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
	// res.setHeader('Content-Security-Policy', "default-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline' 'unsafe-eval'");
	res.setHeader(
        'Content-Security-Policy',
        "default-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline' 'unsafe-eval'"
    );
	res.setHeader('X-Content-Type-Options', 'nosniff');
	res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
	res.setHeader('Referrer-Policy','no-referrer')
	res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
	next()

});

// Connecting to the database
//const db = mongoose.connect(mongoURL, { useNewUrlParser: true,  useFindAndModify: false,useUnifiedTopology: true });


// setting body parser middleware 
planner.use(bodyParser.json({limit: '50mb', extended: true}));
planner.use(bodyParser.urlencoded({limit: '50mb', extended: true}));

require('./routes/api/infrastructure/manager')(planner);
require('./routes/api/providers/manager')(planner);

// Running the server
planner.listen(port,  async() => {
	console.log(`http://localhost:${port}`);
	await fetch(`http://10.30.17.57:${port}/gcir/api/gerency_workers/send-birthday-mail-schedule`);
	// await fetch(`http://10.30.17.57:${port}/gcir/api/gerency_workers/generate-report`);
	// await fetch(`http://10.30.17.57:${port}/gcir/api/providers/directory/check-password-expired`)
	await fetch(`http://10.30.17.57:${port}/gcir/api/providers/homologation/send-notification-homologation`);
	await fetch(`http://10.30.17.57:${port}/gcir/api/providers/homologation/update-state`);
	await fetch(`http://10.30.17.57:${port}/gcir/api/providers/contracts/update-state-letter-bail`);
	await fetch(`http://10.30.17.57:${port}/gcir/api/providers/contracts/send-notification-letter-bail-contracts`);
	await fetch(`http://10.30.17.57:${port}/gcir/api/providers/contracts/send-notification-state-contracts`);
});

