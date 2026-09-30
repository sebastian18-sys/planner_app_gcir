const express = require('express');
const db=require('../../../db');
const {join} = require("path");

//var DISTRIBUTION = require('../../../models/gcir/providers/distribution');


const fs = require('fs');
const XLSX = require('xlsx');
const {jsPDF} = require('jspdf');
const PDFParser  =  require("pdf2json") ;
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


managerRouter.route('/export-to-pdf')
    .post(async (req, res) => {

        let response = {result: 'NOK'}, body = req.body;
        //response.path_ ='nuevo valor';
        //const { provDirectory } = await db()

        /*try {
            //body.data = await provDirectory.find()
            var namer = body.name;
            
           //const pdfParser = new PDFParser();
           */
        response.body=body;
            const doc = new jsPDF();





            //doc.addImage(body.img, 'PNG', 10, 30);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(51, 102, 255);
            doc.text('NO CONFORMIDAD: SNC - '+body.id_s,55,10);
            doc.setTextColor(255, 102, 0);
            doc.text('EN ESTADO: '+body.sta+'-'+body.is_attributab,45,20);
            doc.setTextColor(51, 102, 255);
            doc.setFontSize(15);
            doc.text(30,30,"I. DATOS COMPLETADOS POR COORDINADOR ENTEL");
            doc.setFont(undefined, 'normal');
            doc.setFontSize(10);
            //**************************************************
            doc.setTextColor(51, 102, 255);
            doc.text('DATOS RESPONSABLE ENTEL',10,35,);
            doc.setTextColor(0, 0, 0);
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 40 , 34 , 12 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 40 , 60 , 12 ,'F')
            doc.text('Apellidos y Nombres',10,45)
            doc.text(body.name, 44, 45,{align: 'justify',lineHeightFactor: 1.5,maxWidth:50});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 109 , 40 , 30 , 12 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 139 , 40 , 60 , 12 ,'F')
            doc.text('ÁREA '+'                    '+body.area_re, 110, 45,{align: 'justify',lineHeightFactor: 1.5,maxWidth:88});
            //**************************************************
            doc.setTextColor(51, 102, 255);
            doc.text('DATOS DE PROVEEDOR',10,60,);
            doc.setTextColor(0, 0, 0);
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 65 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 65 , 157 , 7 ,'F')
            doc.text('RAZÓN SOCIAL'+'        '+body.name_pr, 10, 70,{align: 'justify',lineHeightFactor: 1.5,maxWidth:176});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 75 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 75 , 157 , 7 ,'F')
            doc.text('TIPO TRABAJO'+'        '+body.job_ty, 10, 80,{align: 'justify',lineHeightFactor: 1.5,maxWidth:176});
            //**************************************************
            doc.setTextColor(51, 102, 255);
            doc.text('DATOS DEL SITIO',10,90,);
            doc.setTextColor(0, 0, 0);
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 95 , 42 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 95 , 157 , 7 ,'F')
            doc.text('SITE ASOCIADO'+'       '+body.associated_si, 10, 100,{align: 'justify',lineHeightFactor: 1.5,maxWidth:176});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 105 , 42 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 105 , 157 , 7 ,'F')
            doc.text('MOP ASOCIADO'+'      '+body.associated_m, 10, 110,{align: 'justify',lineHeightFactor: 1.5,maxWidth:176});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 115 , 42 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 115 , 157 , 7 ,'F')
            doc.text('P. ASOCIADO'+'           '+body.associated_pro, 10, 120,{align: 'justify',lineHeightFactor: 1.5,maxWidth:176});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 125, 42 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 125 , 157 , 7 ,'F')
            doc.text('OBSERVACIONES'+'   '+body.ob, 10, 130,{align: 'justify',lineHeightFactor: 1.5,maxWidth:176});
            //*************************************************
            doc.setTextColor(51, 102, 255);
            doc.text('DATOS DEL CONTRATO',10,140,);
            doc.setTextColor(0, 0, 0);
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 145 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 145 , 60 , 7 ,'F')
            doc.text('ÁREA/PROCESO '+'    '+body.area_co, 10, 150,{align: 'justify',lineHeightFactor: 1.5,maxWidth:88});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 109 , 145 , 30 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 139 , 145 , 60 , 7 ,'F')
            doc.text('NRO CONTRATO  '+body.id_pe, 110, 150,{align: 'justify',lineHeightFactor: 1.5,maxWidth:88});
            //***********************************************
            doc.setTextColor(51, 102, 255);
            doc.text('PENALIDAD',10,160,);
            doc.setTextColor(0, 0, 0);
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 165 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 165 , 157 , 7 ,'F')
            doc.text('ID PENALIDAD  '+'       '+body.service_co, 10, 170,{align: 'justify',lineHeightFactor: 1.5,maxWidth:176});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 175, 42 , 20 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 175 , 157 , 20 ,'F')
            doc.text('S. NO CONFORME',10,180)
            doc.text(body.breach_co, 44, 180,{align: 'justify',lineHeightFactor: 1.5,maxWidth:154});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 205, 42 , 24 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 205 , 157 , 24,'F')
            doc.text('D. PENALIDAD',10,210)
            doc.text(body.penalty_co, 44, 210,{align: 'justify',lineHeightFactor: 1.5,maxWidth:150});
            //*************************************************
            doc.setTextColor(51, 102, 255);
            doc.text('MONTO',10,240,);
            doc.setTextColor(0, 0, 0);
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 245 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 250);
            doc.rect( 43 , 245 , 60 , 7 ,'F')
            doc.text('N. SERVICIOS'+'          '+body.number_of_se, 10, 250,{align: 'justify',lineHeightFactor: 1.5,maxWidth:88});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 109 , 245 , 30 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 139 , 245 , 60 , 7 ,'F')
            doc.text('TIEMPO'+'                 '+body.time_se, 110, 250,{align: 'justify',lineHeightFactor: 1.5,maxWidth:88});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 255 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 255 , 60 , 7 ,'F')
            doc.text('PORCENTAJE(%)'+'   '+body.perce, 10, 260,{align: 'justify',lineHeightFactor: 1.5,maxWidth:88});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 109 , 255 , 30 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 139 , 255 , 60 , 7 ,'F')
            doc.text('M. Servicio(S/.)'+'   '+body.service_amo, 110, 260,{align: 'justify',lineHeightFactor: 1.5,maxWidth:88});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 265 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 265 , 157 , 7 ,'F')
            doc.text('T. PENALIDAD(S/.)'+'   '+body.penalty_amo, 10, 270,{align: 'justify',lineHeightFactor: 1.5,maxWidth:176});
            doc.addPage();

            //PÁGINA 2
            doc.setFont(undefined, 'bold');
            doc.setTextColor(51, 102, 255);
            doc.setFontSize(15);
            doc.text("II. DATOS COMPLETADOS POR PROVEEDOR",30,10);
            doc.setFont(undefined, 'normal');
            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0);
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 15 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 15 , 157 , 7 ,'F')
            doc.text('Nombre Actividad',10,20)
            doc.text(body.activity_na, 44, 20,{align: 'justify',lineHeightFactor: 1.5,maxWidth:176});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 25 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 25 , 60 , 7 ,'F')
            doc.text('Fecha Detección '+'      '+body.detection_da, 10, 30,{align: 'justify',lineHeightFactor: 1.5,maxWidth:88});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 109 , 25 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 139 , 25 , 60 , 7 ,'F')
            doc.text('Tipo',110,30)
            doc.text(body.scheduled_affectati, 140, 30,{align: 'justify',lineHeightFactor: 1.5,maxWidth:50});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 35 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 35 , 60 , 7 ,'F')
            doc.text('Fecha I. Afectación '+'   '+body.start_d, 10, 40,{align: 'justify',lineHeightFactor: 1.5,maxWidth:88});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 109 , 35 , 30 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 139 , 35 , 60 , 7 ,'F')
            doc.text('Hora I. Afectación '+' '+body.end_da, 110, 40,{align: 'justify',lineHeightFactor: 1.5,maxWidth:88});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 45 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 45 , 60 , 7 ,'F')
            doc.text('Fecha F. Afectación'+'    '+body.start_h, 10, 50,{align: 'justify',lineHeightFactor: 1.5,maxWidth:88});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 109 , 45 , 30 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 139 , 45 , 60 , 7 ,'F')
            doc.text('Hora F. Afectación '+' '+body.end_ho, 110, 50,{align: 'justify',lineHeightFactor: 1.5,maxWidth:88});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 55, 42 , 105 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 55 , 157 , 105,'F')
            doc.text('Antecedentes',10,60)
            doc.text(body.anteceden, 44, 60,{align: 'justify',lineHeightFactor: 1.5,maxWidth:143});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 165, 42 , 20 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 165 , 157 , 20,'F')
            doc.text('S. y S. Afectados',10,170)
            doc.text(body.sites_affec, 44, 170,{align: 'justify',lineHeightFactor: 1.5,maxWidth:145});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 190, 42 , 95 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 190 , 157 , 95,'F')
            doc.text('D. Afectación',10,195)
            doc.text(body.descripti, 44, 195,{align: 'justify',lineHeightFactor: 1.5,maxWidth:145});
            doc.addPage();

            //PÁGINA 3
            doc.setFont(undefined, 'normal');
            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0);
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 10 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 10 , 157 , 7 ,'F')
            doc.text('Ser/Infra/Equip Afec.',10,15)
            doc.text(body.affectedServices_Infra_Equ, 44, 15,{align: 'justify',lineHeightFactor: 1.5,maxWidth:176});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 20 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 20 , 157 , 7 ,'F')
            doc.text('E. Subcontratista(s)',10,25)
            doc.text(body.subcontrating_Comp, 44, 25,{align: 'justify',lineHeightFactor: 1.5,maxWidth:176});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 30 , 34 , 70 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 30 , 157 , 70 ,'F')
            doc.text('Cauza Raíz',10,35)
            doc.text(body.caus, 44, 35,{align: 'justify',lineHeightFactor: 1.5,maxWidth:131});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 105 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 105 , 157 , 7 ,'F')
            doc.text('Responsable',10,110)
            doc.text(body.provider_responsab, 44, 110,{align: 'justify',lineHeightFactor: 1.5,maxWidth:176});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 115 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 115 , 157 , 7 ,'F')
            doc.text('Cargo Responsable',10,120)
            doc.text(body.provider_positi, 44, 120,{align: 'justify',lineHeightFactor: 1.5,maxWidth:176});
            doc.setTextColor(51, 102, 255);
            doc.setFontSize(11);
            doc.text("DATOS DEL PERSONAL QUE PARTICIPÓ DEL INCIDENTE",10,130);
            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0);
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 135 , 34 , 12 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 135 , 60 , 12 ,'F')
            doc.text('Nombres',10,140)
            doc.text(body.name_incide, 44, 140,{align: 'justify',lineHeightFactor: 1.5,maxWidth:50});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 109 , 135 , 30 , 12 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 139 , 135 , 60 , 12 ,'F')
            doc.text('DNI '+'                       '+body.dni_incide, 110, 140,{align: 'justify',lineHeightFactor: 1.5,maxWidth:88});
            doc.setTextColor(51, 102, 255);
            doc.setFontSize(11);
            doc.text("ACCIONES CORRECTIVAS A REALIZAR",10,160);
            doc.setTextColor(0, 0, 0);
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 165, 42 , 20 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 165 , 157 , 20,'F')
            doc.text('Acciones C.',10,170)
            doc.text(body.corrective_actio, 44, 170,{align: 'justify',lineHeightFactor: 1.5,maxWidth:154});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 195 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 195 , 157 , 7 ,'F')
            doc.text('F. Comprometida',10,200)
            doc.text(body.ca_da, 44, 200,{align: 'justify',lineHeightFactor: 1.5,maxWidth:176});
            doc.setTextColor(51, 102, 255);
            doc.setFontSize(11);
            doc.text("ACCIONES PREVENTIVAS A REALIZAR",10,210);
            doc.setTextColor(0, 0, 0);
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 215, 42 , 75 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 215 , 157 , 75,'F')
            doc.text('Acciones P.',10,220)
            doc.text(body.preventive_action, 44, 220,{align: 'justify',lineHeightFactor: 1.5,maxWidth:154});

            //PÁGINA 4
            doc.addPage();
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 10 , 34 , 7 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 10 , 157 , 7 ,'F')
            doc.text('F. Comprometida',10,15)
            doc.text(body.pa_dat, 44, 300,{align: 'justify',lineHeightFactor: 1.5,maxWidth:176});
            doc.setFont(undefined, 'bold');
            doc.setTextColor(51, 102, 255);
            doc.setFontSize(15);
            doc.text("III. SEGUIMIENTO Y CIERRE",30,25);
            doc.setFontSize(10);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(0, 0, 0);
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 30, 42 , 20 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 30 , 157 , 20,'F')
            doc.text('Cierre Proveedor',10,35)
            doc.text(body.tracing_provid, 44, 25,{align: 'justify',lineHeightFactor: 1.5,maxWidth:154});
            doc.setFillColor( 181, 178 ,178);
            doc.rect( 9 , 55, 42 , 20 ,'F')
            doc.setFillColor( 245, 245, 240);
            doc.rect( 43 , 55 , 157 , 20,'F')
            doc.text('Cierre Entel',10,60)
            doc.text(body.tracing_ent, 44, 60,{align: 'justify',lineHeightFactor: 1.5,maxWidth:154});
            doc.setTextColor(51, 102, 255);
            doc.setFontSize(11);
            doc.text("COMENTARIOS",10,90);
            doc.setFillColor( 245, 245, 240);
            doc.rect( 9 , 95 , 190 , 40,'F');
            doc.text(body.coment, 10, 100,{align: 'justify',lineHeightFactor: 1.5,maxWidth:154});


        var namepdf= mainPath +body.fileName+'.pdf';
            doc.save(namepdf)
            response.result='OK';



            response.namepdf=namepdf;
         
           //var namer = body.name;
           //response.namer=namer;
        
/*
          let path = mainPath + body.fileName + '.pdf';
           
            doc.save(path);
            
            /*fs.readFile(path, (err, pdfBuffer) => {
                if (!err) {
                    pdfParser.parseBuffer(pdfBuffer);
                }
            })*/

           
            //response.path = '/planner/resources/files/gcir/providers/' + body.fileName + '.xls';
            response.path = '/gcir/resources/files/gcir/providers/' + body.fileName + '.pdf';

        /*} catch (e) {*/
               
        /*}*/

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