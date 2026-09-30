const express = require('express');
const db=require('../../../db');

//var PERFORMANCE_REPORT = require('../../../models/gcir/providers/performance_report');


const managerRouter = express.Router();

managerRouter.route('/get-data')
    .get(async (req, res) => {
        const { provPerformance_report }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provPerformance_report.find();
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/save-data')
    .post(async (req, res) => {
        const { provPerformance_report }=await db()

        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provPerformance_report.create(body);
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

module.exports = managerRouter;