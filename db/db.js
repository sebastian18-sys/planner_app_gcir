'use strict'

const Mongoose = require('mongoose')
Mongoose.set('useUnifiedTopology', true)


// let mongo/ose = null
let conn = null

// singleton db
module.exports = async function setupDatabase() {
        if (!conn) {
            conn = await
                Mongoose.createConnection(`mongodb://gcirAdmin:Entel1234_@10.30.17.57:27017`,
                    // Mongoose.createConnection('10.30.17.81','gcir',27017,
                    {
                        useNewUrlParser: true,
                        useCreateIndex: true,
                        useFindAndModify: false,
                    })
            conn = conn.useDb('gcir')
            console.log(conn.db)
            Mongoose.set('debug', false)
            return conn

            /**
             * Backup Connection
             * */
            // mongoose = await Mongoose.connect(`mongodb://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}`, { useNewUrlParser: true, useCreateIndex: true })

            // mongoose.set('useFindAndModify', false)
        }
    return conn
}
