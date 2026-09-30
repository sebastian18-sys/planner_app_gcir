const express = require('express');
const db=require('../../../db');

//var SST = require('../../../models/gcir/providers/sst');


const XLSX = require('xlsx');

const managerRouter = express.Router();

managerRouter.route('/get-data')
    .get(async (req, res) => {
        const { provSst }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provSst.find();
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/save-data')
    .post(async (req, res) => {
        const { provSst }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provSst.create(body);
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/load-to-db')
    .post(async (req, res) => {

        const { provSst }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {
            await provSst.remove();

            let path = body.path;

            let workbook = XLSX.readFile(path,{ type: 'string', raw:true, sheetStubs: true });
            let doc = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            response.result = 'OK';
            response.content = doc;

            for (let provider of doc){
                await provSst.create(provider);
            }

        }catch (e) {
            console.log(e);
        }

        res.json(response);
    });


module.exports = managerRouter;