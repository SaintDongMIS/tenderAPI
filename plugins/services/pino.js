'use strict';

const pino = require('hapi-pino');

exports.plugin = {
    //pkg: require('./package.json'),
    name : 'pino',    
    version : '1.0.0',
    register: async function (server, options) {

        //mysql2
        const clientOpts = {
            prettyPrint: (process.env.PRETTY_PRINT) ? process.env.PRETTY_PRINT : false,
            redact: {paths: ['res.headers','req.headers', 'req.id', 'req.remotePort'], remove:true},
        };
        
        await server.register({
            plugin:     pino,
            options:    clientOpts
        });
    }
};