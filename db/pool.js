var mongoose = require('mongoose');
var db = require('./db')

const mainPool = db()

var fibertx = mainPool.useDb('fibertx');
var fibertxTest = mainPool.useDb('fibertxTest');
var factibilidades = mainPool.useDb('planner_factibilidades');
var plannerControl = mainPool.useDb('planner_control');
var plannerTX = mainPool.useDb('plannerTX');
var plannerTXTest = mainPool.useDb('plannerTX_TEST');
var controltx = mainPool.useDb('controltx');
var palantir = mainPool.useDb('palantir');
var pext = mainPool.useDb('pext');
var gcir = mainPool.useDb('gcir');

//planner_factibilidades|planner:Pl4nn3r2020
//use admin
//db.createUser({ user: "plannertx" , pwd: "pl4nn3rtx2019", roles: ["userAdminAnyDatabase", "dbAdminAnyDatabase", "readWriteAnyDatabase"]})

module.exports = {
    fibertx: () => fibertx,
    fibertxTest: () => fibertxTest,
    plannerTX: () => plannerTX,
    plannerTXTest: () => plannerTXTest,
    controltx: () => controltx,
    palantir: () => palantir,
    plannerControl: () => plannerControl,
    factibilidades: () => factibilidades,
    pext: () => pext,
    gcir: () => gcir
};