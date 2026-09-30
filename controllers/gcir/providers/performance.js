const express = require('express');
const db=require('../../../db');
const json2xls = require("json2xls");
//var PERFORMANCE = require('../../../models/gcir/providers/performance');

const XLSX = require('xlsx');
const fs = require("fs");
const {join} = require("path");

//var DIRECTORY = require('../../../models/gcir/providers/directory');
const mainPath = '/data/html/gcir/resources/files/gcir/providers/';

const managerRouter = express.Router();

managerRouter.route('/get-data')
    .get(async (req, res) => {
        const { provPerformance }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provPerformance.find();
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/save-data')
    .post(async (req, res) => {
        const { provPerformance }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provPerformance.create(body);
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/load-to-db')
    .post(async (req, res) => {

        const { provPerformance }=await db()
        let response = {result: 'NOK'}, body = req.body;

        try {
            //await PERFORMANCE.remove();

            let path = body.path;

            let actual_date = new Date(),
                actual_year = actual_date.getFullYear(),
                previus_data = await provPerformance.find();


            let workbook = XLSX.readFile(path,{ type: 'string', raw:true, sheetStubs: true }),
                year = workbook.SheetNames[0],
                doc = XLSX.utils.sheet_to_json(workbook.Sheets[year]),
                year_int = parseInt(year);

            if (year_int && 2020 <= year_int && year_int <= actual_year) {

                let sameYearsElements = previus_data.filter(p => p.year == year_int);

                console.log("uniqueElements: ", sameYearsElements)

                // Remove old data if not found in new data
                await provPerformance.deleteMany({
                    _id: {$in: sameYearsElements.map(s => s._id)}
                })

                for (let provider of doc) {
                    provider.year = year;
                    provider.provider = provider.provider.trim()

                    // let existent_provider = await provPerformance.findOneAndUpdate({
                    //     "provider": provider.provider,
                    //     "area": provider.area,
                    //     "year": year
                    // }, provider);

                    // if (!existent_provider) {
                    await provPerformance.create(provider);
                    // }
                    
                }

                response.result = 'OK';
                response.content = doc;

            } else {
                console.log("Año no disponible");
            }

        }catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/add-qualification')
    .post(async (req, res) => {
        const { provPerformance }=await db()
        let response = {result: 'NOK'}, 
            body = req.body,
            new_object = {};
            new_object[body.month] = body.qualification;

        try {

            response.content = await provPerformance.findByIdAndUpdate(
                {_id: body._id},
                new_object,
                {
                    new: true
                }
            );

            response.result = 'OK';

        }catch (e) {
            console.log(e);
        }

        res.json(response);
    });



module.exports = managerRouter;