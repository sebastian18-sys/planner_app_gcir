const express = require('express');
const fs = require('fs');

const {Client} = require('ldapts');
const fsp = fs.promises;

const moment = require('moment');
var jwt = require('jsonwebtoken');

//var USERS = require('../../../models/gcir/access/userModel');

const db = require('../../../db')

const managerRouter = express.Router();

managerRouter.route('/user')
    .post(async (req, res) => {

        const { accessUserModel } = await db()

        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await accessUserModel.create(body);
            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    })
    .patch(async (req, res) => {

        const { accessUserModel } = await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await accessUserModel.findByIdAndUpdate(
                body._id,
                {
                    $set: {
                        title: body.title
                    }
                },
                { new: true }
            );

            response.result = 'OK';

        }catch (e) {

            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/add-menu')
    .post(async (req, res) => {

        const { accessUserModel } = await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await accessUserModel.findByIdAndUpdate(
                body._id,
                {
                    $push: {
                        scope: body.menu
                    }
                },
                { new: true }
            );

            response.result = 'OK';

        }catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/delete-menu')
    .post(async (req, res) => {

        const { accessUserModel } = await db()
        let response = {result: 'NOK'}, body = req.body;

        try {

            response.content = await accessUserModel.findByIdAndUpdate(
                body._id,
                {
                    $pull: {
                        scope: {"_id": body._id_menu_a_eliminar}
                    }
                },
                { new: true }
            );

            response.result = 'OK';

        }catch (e) {
            console.log(e);
        }

        res.json(response);
    });

managerRouter.route('/get-scope/:user')
    .get(async (req, res) => {
        const { accessUserModel } = await db()
        var datos = await accessUserModel.findOne({"user": req.params.user});
        res.json({result:'OK', content: datos});
    });


module.exports = managerRouter;