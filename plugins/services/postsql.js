'use strict';

const HapiPostgresConnection = require('hapi-postgres-connection');

exports.plugin = {
    //pkg: require('./package.json'),
    name : 'postgres',    
    version : '1.0.0',
    register: async function (server, options) {

        // DATABASE_URL in the format: postgres://username:password@localhost/database
        await server.register({
            plugin: HapiPostgresConnection
        });

        // demo
        // const result = await request.pg.client.query(`SELECT * FROM setting`);
        // console.log(result.rows)
    }
};