const express = require('express');

const fs = require('fs');
const XLSX = require('xlsx');
const json2xls = require('json2xls');
const converter = require('json-2-csv');
const excelToJson = require('convert-excel-to-json');
const geolib = require('geolib');

const json2kmlUtils = require('../../../custom_modules/gcir/maps/json2kmlUtils');
const direccionUtils = require('../../../custom_modules/gcir/maps/direccionUtils');
// const Allproviders = require('../../../models/gcir/infrastructure/enterprise');

const db = require('../../../db')

const mainPath = '/data/html/gcir/resources/files/gcir/infrastructure/data';
const mainPathExport = '/data/html/gcir/resources/files/gcir/infrastructure/export/';

const managerRouter = express.Router();

var fecha = new Date(),
    month = fecha.getMonth(),
    year = fecha.getFullYear(),
    actMonth;

if (month < 9) actMonth = "0" + String(month + 1);
else actMonth = String(month + 1);

function readFile(path) {
    let workbook = XLSX.readFile(path, {type: 'string', raw: true, sheetStubs: true});
    return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
}

function readFileFast(path) {
    let result = excelToJson({sourceFile: path});
    let sheetName = '', sheetData;

    Object.entries(result).forEach(([key, value]) => {
        if (sheetName === '') {
            sheetName = key;
            sheetData = value;
        }
    });

    let headers = [];

    Object.entries(sheetData[0]).forEach(([key, value]) => {
        headers.push({key, value: value.toUpperCase()});
    });

    let latKey = headers.find(x => x.value === 'LAT'),
        lngKey = headers.find(x => x.value === 'LON'),
        id_sitioKey = headers.find(x => x.value === 'ID_SITIO'),
        nombre_sitio = headers.find(x => x.value === 'NOMBRE_SITIO'),
        alt_est = headers.find(x => x.value === 'ALT_TORRE'),
        alt_pre = headers.find(x => x.value === 'ALT_EDIFICACION'),
        alt_total = headers.find(x => x.value === 'ALT_TOTAL'),
        alt_dis = headers.find(x => x.value === 'ALT_DISPONIBLE'),
        tipo_estruc = headers.find(x => x.value === 'TIPO_ESTRUCTURA'),
        depart = headers.find(x => x.value === 'DEPARTAMENTO'),
        provincia = headers.find(x => x.value === 'PROVINCIA'),
        distrito = headers.find(x => x.value === 'DISTRITO'),
        direccion = headers.find(x => x.value === 'DIRECCION'),
        status = headers.find(x => x.value === 'ESTADO');

    if (sheetData[0] && latKey && lngKey) {
        sheetData.shift();
        return sheetData.map(x => ({
            LAT: x[latKey.key],
            LON: x[lngKey.key],
            ID_SITIO: (id_sitioKey ? x[id_sitioKey.key] : ""),
            NOMBRE_SITIO: (nombre_sitio ? x[nombre_sitio.key] : ""),
            ALT_TORRE: (alt_est ? x[alt_est.key] : ""),
            ALT_EDIFICACION: (alt_pre ? x[alt_pre.key] : ""),
            ALT_TOTAL: (alt_total ? x[alt_total.key] : ""),
            ALT_DISPONIBLE: (alt_dis ? x[alt_dis.key] : ""),
            TIPO_ESTRUCTURA: (tipo_estruc ? x[tipo_estruc.key] : ""),
            DEPARTAMENTO: (depart ? x[depart.key] : ""),
            PROVINCIA: (provincia ? x[provincia.key] : ""),
            DISTRITO: (distrito ? x[distrito.key] : ""),
            DIRECCION: (direccion ? x[direccion.key] : ""),
            ESTADO : (status ? x[status.key] : "")
        }));
    } else {
        return false;
    }
}

function FindTowers(camposCheck, enterprises) {
    let finalJSON = [];

    for (let enterprise of enterprises) {
        let last_date = enterprise.info_date, month, year;
        if (last_date.length != 0) {
            last_date = last_date[last_date.length - 1].split('-');
            month = last_date[1];
            year = last_date[2];

            let path = `${mainPath}/${year}/${month}/${enterprise.dir}`;

            if (fs.existsSync(path)) {
                let filesByEnterprise = fs.readdirSync(path).map(function (fileName) {
                    return {
                        name: fileName,
                        time: fs.statSync(path + '/' + fileName).mtime.getTime()
                    };
                });
        
                filesByEnterprise = filesByEnterprise.filter(x => x.name.indexOf('.xlsx') >= 0);
                if (filesByEnterprise.length > 0) {
        
                    let convertedFile = readFileFast(`${path}/${filesByEnterprise[0].name}`);
        
                    if (convertedFile) {
                        convertedFile = convertedFile.map(function (obj) {
                            let aux = {};
                            aux.Proveedor = enterprise.dir;
                            for (let campo of camposCheck) {
                                aux[campo] = obj[campo];
                            }
                            return aux;
                        });
                        finalJSON = finalJSON.concat(convertedFile);
                    }
                }
            }
        }
    }

    return finalJSON;
}

function GetPuntos(nameFile) {
    let path = `/data/html/gcir/resources/files/gcir/infrastructure/tower_finder/${nameFile}`;
    return readFile(path);
}

managerRouter.route('/xlsx-to-kml')
    .post(async (req, res) => {

        const { infrastEnterprise } = await db()

        let response = {result: 'NOK'},
            body = req.body,
            camposCheck = body.campos,
            enterprises = await infrastEnterprise.find();

        try {

            let finalJSON = [], index = 0;

            for (let filter of body.filters) {

                let enterprise = enterprises[enterprises.findIndex(x => x.dir === filter.enterprise)],
                    info_date = enterprise.info_date;
                
                if (info_date.length != 0) {
                    let last_date = info_date[info_date.length - 1].split('-'),
                        last_month = last_date[1],
                        month_to_use = (filter.month > last_month ? last_month : filter.month);

                    let path = `${mainPath}/${filter.year}/${month_to_use}/${filter.enterprise}`;

                    if (fs.existsSync(path)) {
                        let files = fs.readdirSync(path).map(function (fileName) {
                            return {
                                name: fileName,
                                time: fs.statSync(path + '/' + fileName).mtime.getTime()
                            };
                        });
                        files = files.filter(x => x.name.indexOf('.xlsx') >= 0);
                        if (files.length > 0) {
                            let convertedFile = readFileFast(`${path}/${files[0].name}`);
                            if (convertedFile) {
                                let markers = convertedFile.map(function (obj) {
                                    index++;
                                    let desc = `<p>PROVEEDOR: ${filter.enterprise}</p>`;
                                    for (let campo of camposCheck) {
                                        desc += `<p>${campo}: ${obj[campo]}</p>`;
                                    }
    
                                    return {
                                        id: index,
                                        description: desc,
                                        coordinates: [obj.LON, obj.LAT, 0]
                                    }
                                });
                                finalJSON.push({
                                    enterprise: filter.enterprise,
                                    icon: enterprise.icon,
                                    markers
                                });
                            }
                        }
                    } else {
                        console.log(path, ' NO EXISTE');
                    }
                }
            }

            response.path = json2kmlUtils.JSON2KML(finalJSON, body.fileName);
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/export-xlsx')
    .post(async (req, res) => {
        const { infrastEnterprise } = await db()
        let response = {result: 'NOK'},
            body = req.body,
            camposCheck = body.campos,
            enterprises = await infrastEnterprise.find();

        try {

            let finalJSON = [];

            for (let filter of body.filters) {

                let enterprise = enterprises[enterprises.findIndex(x => x.dir === filter.enterprise)],
                    info_date = enterprise.info_date;
                
                if (info_date.length != 0) {
                    let last_date = info_date[info_date.length - 1].split('-'),
                        last_month = last_date[1],
                        month_to_use = (filter.month > last_month ? last_month : filter.month),
                        path = `${mainPath}/${filter.year}/${month_to_use}/${filter.enterprise}`;

                    if (fs.existsSync(path)) {
                        let files = fs.readdirSync(path).map(function (fileName) {
                            return {
                                name: fileName,
                                time: fs.statSync(path + '/' + fileName).mtime.getTime()
                            };
                        });
                        files = files.filter(x => x.name.indexOf('.xlsx') >= 0);
                        if (files.length > 0) {
                            let convertedFile = readFileFast(`${path}/${files[0].name}`);

                            if (convertedFile) {

                                convertedFile = convertedFile.map(function (obj) {
                                    var aux = {};
                                    for (let campo of camposCheck) {
                                        aux[campo] = obj[campo];
                                    }
                                    return aux;
                                });

                                if (body.diferenciacion) {
                                    convertedFile = convertedFile.map(function (obj) {
                                        return {...obj, "Torrera": filter.enterprise};
                                    });
                                }

                                finalJSON = finalJSON.concat(convertedFile);

                            } else {
                                response.file = "No se pudo convertir";
                            }
                        }
                    } else {
                        console.log(path, ' NO EXISTE');
                    }
                }
     
            }

            let xls = json2xls(finalJSON);

            fs.writeFileSync(mainPathExport + body.fileName + '.xls', xls, 'binary');

            response.result = 'OK';
            response.path = '/planner/resources/files/gcir/infrastructure/export/' + body.fileName + '.xls';

            response.result = 'OK';

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/convert-to-csv')
    .post(async (req, res) => {
        const { infrastEnterprise } = await db()
        let response = {result: 'NOK', path: 'NULL'},
            body = req.body,
            camposCheck = body.campos,
            enterprises = await infrastEnterprise.find();

        try {

            let finalJSON = [];

            for (let filter of body.filters) {

                let enterprise = enterprises[enterprises.findIndex(x => x.dir === filter.enterprise)],
                    info_date = enterprise.info_date;

                if (info_date.length != 0) {
                    let last_date = enterprise.info_date[enterprise.info_date.length - 1].split('-'),
                        last_month = last_date[1],
                        month_to_use = (filter.month > last_month ? last_month : filter.month),
                        path = `${mainPath}/${filter.year}/${month_to_use}/${filter.enterprise}`;

                    if (fs.existsSync(path)) {
                        let files = fs.readdirSync(path).map(function (fileName) {
                            return {
                                name: fileName,
                                time: fs.statSync(path + '/' + fileName).mtime.getTime()
                            };
                        });
                        files = files.filter(x => x.name.indexOf('.xlsx') >= 0);
                        if (files.length > 0) {
                            let convertedFile = readFileFast(`${path}/${files[0].name}`);

                            if (convertedFile) {

                                convertedFile = convertedFile.map(function (obj) {
                                    var aux = {};
                                    for (let campo of camposCheck) {
                                        aux[campo] = obj[campo];
                                    }
                                    return aux;
                                });

                                if (body.diferenciacion) {
                                    convertedFile = convertedFile.map(function (obj) {
                                        return {...obj, "Torrera": filter.enterprise};
                                    });
                                }

                                finalJSON = finalJSON.concat(convertedFile);

                            } else {
                                response.file = "NO se pudo convertir";
                            }
                        }
                    } else {
                        console.log(path, ' NO EXISTE');
                    }
                }
            }

            let csv = await converter.json2csvAsync(finalJSON);
            const express = require('express');

            // write CSV to a file
            let finalPath = `/data/html/gcir/resources/files/gcir/infrastructure/export/${body.fileName}.csv`;
            fs.writeFileSync(finalPath, csv, 'binary');

            response.path = '/planner/resources/files/gcir/infrastructure/export/' + `${body.fileName}.csv`;
            response.result = 'OK';

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/to-xlsx')
    .post(async (req, res) => {

        let response = {result: 'NOK'}, body = req.body;
        let camposChecked = ["ID_SITIO", "NOMBRE_SITIO", "LAT", "LON", "ALT_TORRE", "ALT_EDIFICACION",
            "ALT_TOTAL", "ALT_DISPONIBLE", "TIPO_ESTRUCTURA", "DEPARTAMENTO", "PROVINCIA", "DISTRITO", "DIRECCION", 'ESTADO']
        let JSON = body.data;

        try {
            JSON = JSON.map(function (obj) {
                let aux = {};

                aux.PUNTO_BUSCADO = obj.PUNTO_BUSCADO;
                aux.Proveedor = obj.Proveedor;

                for (let campo of camposChecked) {
                    aux[campo] = obj[campo];
                }
                aux["DISTANCIA (metros)"] = obj.DISTANCIA;

                return aux;
            });

            var xls = json2xls(JSON);

            fs.writeFileSync(mainPathExport + body.fileName + '.xls', xls, 'binary');

            response.result = 'OK';
            response.path = '/planner/resources/files/gcir/infrastructure/export/' + body.fileName + '.xls';

            response.result = 'OK';

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/tower-finder')
    .post(async (req, res) => {
        const { infrastEnterprise } = await db()
        var response = {result: 'NOK'}, body = req.body;
        var camposCheck = ["ID_SITIO", "NOMBRE_SITIO", "LAT", "LON", "ALT_TORRE", "ALT_EDIFICACION",
                "ALT_TOTAL", "ALT_DISPONIBLE", "TIPO_ESTRUCTURA", "DEPARTAMENTO", "PROVINCIA", "DISTRITO", "DIRECCION", 'ESTADO'],
            finalJSON, 
            rptaJSON = [], 
            Puntos;

        let enterprises = await infrastEnterprise.find();
        finalJSON = FindTowers(camposCheck, enterprises);

        if (body.flag === "UnicoPunto") {
            Puntos = body.punto;
        } else if (body.flag === "VariosPuntos") {
            Puntos = GetPuntos(body.fileName);
            Puntos = Puntos.map(function (obj) {
                return {
                    tipo: obj.TIPO,
                    valor: obj["DIRECCION/COORDENADA"]
                }
            });
        }

        try {
            for (let punto of Puntos) {

                let coordinates;

                if (punto.tipo === "C") {
                    coordinates = punto.valor.split(',');
                    coordinates = [parseFloat(coordinates[0]), parseFloat(coordinates[1])];
                } else if (punto.tipo === "D") {
                    let address = punto.valor;
                    let geodata = await direccionUtils.geocodeGOOGLE('address', address);
                    coordinates = [parseFloat(geodata.coordinates[1]), parseFloat(geodata.coordinates[0])];
                }

                if (body.distancia === 0) {
                    /***********************SACAR LOS  PUNTOS MAS CERCANOS A LA COORDENADA PROPORCIONADA***********************/
                    let cantidadPuntos = body.cantTorres;

                    let finalJSON_AUX = [];

                    for (let point of finalJSON) {
                        let tmp = {...point};
                        tmp.DISTANCIA = geolib.getDistance(
                            {latitude: parseFloat(point.LAT), longitude: parseFloat(point.LON)},
                            {latitude: coordinates[0], longitude: coordinates[1]}
                        );
                        tmp.PUNTO_BUSCADO = `${coordinates[0]}, ${coordinates[1]}`;
                        finalJSON_AUX.push(tmp);
                    }

                    finalJSON_AUX = finalJSON_AUX.sort((a, b) => a.DISTANCIA - b.DISTANCIA).slice(0, cantidadPuntos);

                    rptaJSON.push({
                        point_latitud: coordinates[0],
                        point_longitud: coordinates[1],
                        points_around: finalJSON_AUX
                    });

                } else if (body.cantTorres === 0) {

                    let pointsInRadius = [];

                    for (let point of finalJSON) {
                        let tmp = {...point};
                        let isWithin = geolib.isPointWithinRadius(
                            {latitude: point.LAT, longitude: point.LON},
                            {latitude: coordinates[0], longitude: coordinates[1]},
                            body.distancia
                        );

                        if (isWithin) {
                            tmp.DISTANCIA = geolib.getDistance(
                                {latitude: point.LAT, longitude: point.LON},
                                {latitude: coordinates[0], longitude: coordinates[1]}
                            );

                            tmp.PUNTO_BUSCADO = `${coordinates[0]}, ${coordinates[1]}`;
                            pointsInRadius.push(tmp);
                        }
                    }

                    rptaJSON.push({
                        point_latitud: coordinates[0],
                        point_longitud: coordinates[1],
                        points_around: pointsInRadius
                    });
                }
            }

            response.content = rptaJSON;
            response.result = 'OK';

        } catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/view-all-towers')
    .get(async (req, res) => {
        const { infrastEnterprise } = await db()
        let response = {result: 'NOK'};
        let camposCheck = ["ID_SITIO", "NOMBRE_SITIO", "LAT", "LON", "ALT_TORRE", "ALT_EDIFICACION", "ALT_TOTAL", "ALT_DISPONIBLE",
                "TIPO_ESTRUCTURA", "DEPARTAMENTO", "PROVINCIA", "DISTRITO", "DIRECCION", 'ESTADO'],
            finalJSON = [],
            enterprises = await infrastEnterprise.find();

        try {

            finalJSON = FindTowers(camposCheck, enterprises);
            response.content = finalJSON;
            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-cant-towers')
    .get(async (req, res) => {
        const { infrastEnterprise } = await db()
        let response = {
                result: 'NOK',
                cantTotalTowers: 0,
                cantByProvider: [],
                providers: []
            },
            enterprises = await infrastEnterprise.find();

        try {

            for (let enterprise of enterprises) {
                let tmp = {
                        name: enterprise.name,
                        dir: enterprise.dir,
                        isFileLoaded: false,
                        cantTowers: 0,
                        icon: enterprise.icon,
                        info_date: enterprise.info_date
                    },
                    last_date = enterprise.info_date;
                    month,
                    year;

                if (last_date.length != 0) {
                    last_date = last_date[last_date.length - 1].split('-');
                    let month = last_date[1], 
                        year = last_date[2],
                        path = `${mainPath}/${year}/${month}/${enterprise.dir}`;

                    if (fs.existsSync(path)) {
                        let filesByEnterprise = fs.readdirSync(path).map(function (fileName) {
                            return {
                                name: fileName,
                                time: fs.statSync(path + '/' + fileName).mtime.getTime()
                            };
                        });
    
                        filesByEnterprise = filesByEnterprise.filter(x => x.name.indexOf('.xlsx') >= 0);
                        if (filesByEnterprise.length > 0) {
    
                            let convertedFile = readFileFast(`${path}/${filesByEnterprise[0].name}`);
    
                            if (convertedFile) {
                                let length = convertedFile.length;
                                if (month === actMonth) tmp.isFileLoaded = true;
    
                                tmp.cantTowers += length;
                                response.cantTotalTowers += length;
                                response.cantByProvider.push([tmp.dir + `(${convertedFile.length})`, convertedFile.length]);
                            }
    
                        }
                    }
                }

                response.providers.push(tmp);
            }

            response.result = 'OK';

        } catch (e) {

            console.log(e);
        }

        res.json(response);
    });

module.exports = managerRouter;