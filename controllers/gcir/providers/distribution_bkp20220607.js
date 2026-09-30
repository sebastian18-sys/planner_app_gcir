const express = require('express');
const db=require('../../../db');
const {join} = require("path");

//var DISTRIBUTION = require('../../../models/gcir/providers/distribution');


const fs = require('fs');
const jsPDF = require("jspdf");
const XLSX = require('xlsx');
var json2xls = require('json2xls');
//const mainPath = '/var/www/html/planner/resources/files/gcir/providers/';
const mainPath = '/data/html/gcir/resources/files/gcir/providers/'


const managerRouter = express.Router();

managerRouter.route('/get-data')
    .get(async (req, res) => {

        let response = {result: 'NOK'}, body = req.body;
        const {provDistribution}=await db()
        try {

            response.content = await provDistribution.find();
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/save-data')
    .post(async (req, res) => {

        let response = {result: 'NOK'}, body = req.body;
        const {provDistribution}=await db()
        try {

            response.content = await provDistribution.create(body);
            response.result = 'OK';

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });


managerRouter.route('/export-to-xlsx')
    .post(async (req, res) => {

        let response = {result: 'NOK'}, body = req.body;

        try {
            //body.data = await provDirectory.find()
            var data = body.data;

            var xls = json2xls(data);
            //let path =join(__dirname,'../../../../gcir/resources/files/gcir/providers/' + body.fileName + '.xls');
            let path = mainPath + body.fileName + '.xls';
            console.log(path)

            if (fs.existsSync(path)) {
                fs.unlinkSync(path);
            }

            fs.writeFileSync(path, xls, 'binary');

            response.result = 'OK';
            //response.path = '/planner/resources/files/gcir/providers/' + body.fileName + '.xls';
            response.path = '/gcir/resources/files/gcir/providers/' + body.fileName + '.xls';

        } catch (e) {

            console.log(e);
        }

        const rest = res.json(response);
        console.log(rest)
    });






managerRouter.route('/load-to-db')
    .post(async (req, res) => {

        let response = {result: 'NOK'}, body = req.body;
        const {provDistribution}=await db()
        try {

            let path = body.path;
            let actual_date = new Date(),
                actual_year = actual_date.getFullYear();

            let workbook = XLSX.readFile(path, {type: 'string', raw: true, sheetStubs: true}),
                year = workbook.SheetNames[0];
            doc = XLSX.utils.sheet_to_json(workbook.Sheets[year]),
                year_int = parseInt(year);

            if (year_int && 2020 <= year_int && year_int <= actual_year) {

                await provDistribution.remove({year: year_int});

                for (let row of doc) {
                    row.year = year_int;
                    await provDistribution.create(row);
                }

                response.result = 'OK';
                response.content = doc;
            } else {
                console.log("Año no disponible");
            }

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });

module.exports = managerRouter;