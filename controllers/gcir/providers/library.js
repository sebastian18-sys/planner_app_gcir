const express = require('express');
const db=require('../../../db');
const { GetActualDate } = require('../../../utils/dates')

const XLSX = require('xlsx');
const managerRouter = express.Router();

managerRouter.route('/get-data')
    .get(async (req, res) => {

        const { provLibrary } = await db()

        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provLibrary.find();
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-data/:id')
    .get(async (req, res) => {

        const { provLibrary }=await db()
        let response = {result: 'NOK'}, body = req.body;
        
        try {
            response.content = await provLibrary.findOne({ _id: req.params.id});
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    })

managerRouter.route('/save-data')
    .post(async (req, res) => {

        const { provLibrary } = await  db()

        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await provLibrary.create(body);
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/update-data')
    .post(async (req, res) => {

        const { provLibrary }=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {

            response.content = await provLibrary.findByIdAndUpdate(
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

managerRouter.route('/update-data-by-user')
    .post(async (req, res) => {

        const { provLibrary }=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {

            response.content = await provLibrary.updateOne(
                { _id: body._id },
                {
                    $set: body,
                    $unset: { eventApproval: "", newData: "", pendingApproval: "", emailRequesting: ""}
                }
            );

            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    })

managerRouter.route('/delete-data')
    .post(async (req, res) => {

        const { provLibrary }=await db()
        let response = { result: 'NOK' }, body = req.body;

        try {

            response.content = await provLibrary.findByIdAndRemove(body._id)
            response.result = 'OK';

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/load-to-db')
    .post(async (req, res) => {

        let response = {result: 'NOK'}, body = req.body;
        const { provLibrary } = await db()
        const { provHistory } = await db()

        /**
         * Guardar los datos anteriores en el histórico
         */
        let previus_data = await provLibrary.find();
        await provHistory.create({
            original_data: previus_data,
            date_change: GetActualDate(),
            user_change: body.user,
            event_change: "insert-massive",
            document: "library"
        });

        try {
            await provLibrary.remove();

            let path = body.path;

            let workbook = XLSX.readFile(path,{ type: 'string', raw:true, sheetStubs: true });
            let doc = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

            response.result = 'OK';
            response.content = doc;

            for (let provider of doc){
                provider.status = true
                provider.data_files_evidence = []
                await provLibrary.create(provider);
            }

        }catch (e) {
            console.log(e);
        }

        res.json(response);
    });

module.exports = managerRouter;