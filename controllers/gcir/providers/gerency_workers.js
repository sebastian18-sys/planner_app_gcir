const express = require('express');
const XLSX = require('xlsx');
const db = require('../../db');

const managerRouter = express.Router();

managerRouter.route('/load-to-db')
.post(async (req, res) => {

    const {gcirGrency_workers}=await db()
    let response = { result: 'NOK' }, body = req.body;

    try {
        await gcirGrency_workers.remove();

        let path = body.path;

        let workbook = XLSX.readFile(path, { type: 'string', raw: true, sheetStubs: true });
        let doc = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        response.result = 'OK';
        response.content = doc;

        for (let gwc of doc) {
            gwc.user = gwc.first_name.toLowerCase()[0] + gwc.last_name.split(" ")[0].toLowerCase() + '.' + gwc.business_short;
            await gwc.create(gwc);
        }

    } catch (e) {
        console.log(e);
    }

    res.json(response);
});


module.exports = managerRouter;