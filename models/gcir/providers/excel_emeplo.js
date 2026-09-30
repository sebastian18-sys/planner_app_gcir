const xlsx = require('xlsx')
//const express = require('express');
//var CONTRACT = require('../../../models/gcir/providers/no_compliance_contract');

//const managerRouter = express.Router();

const worksheet = xlsx.readFile('./Matriz SNC_TX_2021_2.xlsx', {type: 'base64'})
const sncs = xlsx.utils.sheet_to_json(worksheet.Sheets['FO'])

for (const snc of sncs){
     const details = snc['ID DE DETALLE DEL CONCURSO'].split(',').map(x =>parseInt(x))
   console.log(details)

}