const express = require('express');
const db=require('../../../db');

//var ENTERPRISE = require('../../../models/gcir/infrastructure/enterprise');


const managerRouter = express.Router();

managerRouter.route('/save')
    .post(async (req, res) => {

        const { infrastEnterprise }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await infrastEnterprise.create(body);
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });


managerRouter.route('/get-all')
    .get(async (req, res) => {
        const { infrastEnterprise }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await infrastEnterprise.find();
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/add-date')
    .post(async (req, res) => {
        const { infrastEnterprise }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await infrastEnterprise.findByIdAndUpdate(
                body._id,
                {
                    $push: {
                        info_date: body.date
                    }
                },
                { new: true }
            );

            response.result = 'OK';

        }catch (e) {
            console.log(e);
        }

        res.json(response);
    });

module.exports = managerRouter;