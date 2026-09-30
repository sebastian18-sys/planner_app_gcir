const express = require('express');
const db=require('../../../db');

//var CONTRACT = require('../../../models/gcir/providers/no_compliance_contract');


const fs = require('fs');
const XLSX = require('xlsx');
var json2xls = require('json2xls');
const mainPath = '/data/html/gcir/resources/files/gcir/providers/';

const managerRouter = express.Router();

managerRouter.route('/get-data')
    .get(async (req, res) => {
        const { provNo_Compliance_Contract }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provNo_Compliance_Contract.find().lean();
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/save-data')
    .post(async (req, res) => {
        const { provNo_Compliance_Contract }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provNo_Compliance_Contract.create(body);
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/load-to-db')
    .post(async (req, res) => {

        const { provNo_Compliance_Contract }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {
            await provNo_Compliance_Contract.remove();

            let path = body.path;

            let workbook = XLSX.readFile(path, {type: 'string', raw: true, sheetStubs: true});
            let doc = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            response.result = 'OK';
            response.content = doc;

            for (let provider of doc) {
                provider.id_detail = provider.id_detail.toString().split(',').map(x => parseInt(x));
                provider.service = provider.service.replace(/\r\n/g, " "); //remove line breaks
                await provNo_Compliance_Contract.create(provider);
            }

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });

module.exports = managerRouter;
