'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');

const authStrategy = false; 
//const authStrategy = 'simple';

const sql = require('mssql');

const sqlConfig_1 = {
  user: process.env.MSSQL_USER,
  password: process.env.MSSQL_PWD,
  database: 'rm100',
  server: process.env.MSSQL_HOST,
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  options: {
    cryptoCredentialsDetails: {
        minVersion: 'TLSv1',
    },
    trustServerCertificate: true
  }
}

exports.plugin = {
  //pkg: require('./package.json'),
  name: 'execl_view',
  version: '0.0.0',
  register: async function (server, options) {

    // Validate with Joi 
    const schema = Joi.object({
      //username : Joi.string().required().description('user name'),
      //password : Joi.string().required().description('user password')
    });
    
    // ----------------------------------------------------------------------------------------------------
    server.route({
      method: 'GET',
      path: '/pci/month',
      options: {
        description: 'API description',
        //auth: { strategy: 'auth', scope: ['roles'] },
        //auth: { strategy: 'bearer', scope: ['roles'] },
        cors: { origin: ['*'], credentials: true },
        tags: ['api'],
        //validate: { query: schema, }   // GET
      },
      handler: async function (request, h) {


        await sql.connect(sqlConfig_1);
        const result = await sql.query`select CaseNo from tbl_case where serialno = 5074831`
        sql.close()

        return { 
          statusCode: 20000, 
          message: 'successful', 
          data: {list:result, total:0} 
        };

        // return with Boom
        //return Boom.notAcceptable(msg);
      },
    });
    // ----------------------------------------------------------------------------------------------------

    /* Router End */   
  },
};
