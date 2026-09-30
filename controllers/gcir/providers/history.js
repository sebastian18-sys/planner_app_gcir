const express = require('express');
const db=require('../../../db');

const managerRouter = express.Router();

managerRouter.route('/get-data')
    .get(async (req, res) => {

        const { provHistory } = await db()

        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provHistory.find();
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/save-data')
    .post(async (req, res) => {

        const { provHistory } = await  db()

        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provHistory.create(body);
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });


module.exports = managerRouter;