const express = require('express');
const db=require('../../../db');

//var SAC_FILES = require('../../../models/gcir/providers/sac_files');


const managerRouter = express.Router();

managerRouter.route('/save-new-file')
    .post(async (req, res) => {
        const { provSac_files }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provSac_files.create(body);
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-date-files')
    .get(async (req, res) => {
        const { provSac_files }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provSac_files.find();
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-date-files/:name')
    .get(async (req, res) => {
        const { provSac_files }=await db()
        let response = {result: 'NOK'};

        try {

            response.content = await provSac_files.findOne({'name_file':req.params.name});
            response.result = 'OK';
            

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/add-date-file')
    .post(async (req, res) => {

        const { provSac_files }=await db()
        let response = {result: 'NOK'}, body = req.body;


        try {

            response.content = await provSac_files.findByIdAndUpdate(
                body._id,
                {
                    $push: {
                        date_file: body.date
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