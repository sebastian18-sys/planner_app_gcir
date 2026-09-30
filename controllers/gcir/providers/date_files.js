const express = require('express');
const db=require('../../../db');

//var DATE_FILES = require('../../../models/gcir/providers/date_files');

const managerRouter = express.Router();

managerRouter.route('/save-new-file')
    .post(async (req, res) => {

        let response = {result: 'NOK'}, body = req.body;
        const { provDate_files }=await db()
        try {

            response.content = await provDate_files.create(body);
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-date-files')
    .get(async (req, res) => {

        let response = {result: 'NOK'}, body = req.body;
        const { provDate_files }=await db()
        try {

            response.content = await provDate_files.find();
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-date-files/:name')
    .get(async (req, res) => {

        let response = {result: 'NOK'};
        const { provDate_files }=await db()
        try {

            response.content = await provDate_files.findOne({'name_file':req.params.name});
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/add-date-file')
    .post(async (req, res) => {

        let response = {result: 'NOK'}, body = req.body;
        const { provDate_files }=await db()

        try {

            response.content = await provDate_files.findByIdAndUpdate(
                body._id,
                {
                    week: body.week,
                    $push: {
                        "date_file": body.date
                    }
                }
            );

            response.result = 'OK';

        }catch (e) {
            console.log(e);
        }

        res.json(response);
    });


module.exports = managerRouter;