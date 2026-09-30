const express = require('express');
const db=require('../../../db');

const managerRouter = express.Router();

managerRouter.route('/get-data')
    .get(async (req, res) => {

        const { provSettings } = await db()

        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provSettings.find();
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/save-data')
    .post(async (req, res) => {

        const { provSettings } = await  db()

        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provSettings.create(body);
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/update-data')
    .post(async (req, res) => {

        const { provSettings }=await db()
        let response = { result: 'NOK' }, body = req.body;

        console.log(body)

        try {

            response.content = await provSettings.findByIdAndUpdate(
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


module.exports = managerRouter;