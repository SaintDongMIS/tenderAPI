'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');

const authStrategy = false; 
//const authStrategy = 'simple';

exports.plugin = {
  //pkg: require('./package.json'),
  name: 'template_routers',
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
      path: '/template/get',
      options: {
        description: 'API description',
        //auth: { strategy: 'auth', scope: ['roles'] },
        //auth: { strategy: 'bearer', scope: ['roles'] },
        cors: { origin: ['*'], credentials: true },
        tags: ['api'],
        //validate: { query: schema, }   // GET
      },
      handler: async function (request, h) {
        // param 參數
        //const { } = request.query;    //GET

        // auth 參數
        //const { guildId, uid, isChief } = request.auth.artifacts;
    
        // SQL CMD
        //const [[{ sqlresult }]] = await request.mysql.pool.execute( 'call sp(?,?)', [ p1, p2]);
    
        // return
        return { 
          statusCode: 20000, 
          message: 'successful', 
          data: {list:sqlresult, total:0} 
        };

        // return with Boom
        //return Boom.notAcceptable(msg);
      },
    });

    // ----------------------------------------------------------------------------------------------------
    server.route({
      method: 'POST',
      path: '/template/post',
      options: {
        description: 'API description',
        //auth: { strategy: 'auth', scope: ['roles'] },
        //auth: { strategy: 'bearer', scope: ['roles'] },
        cors: { origin: ['*'], credentials: true },
        tags: ['api'],
        //validate: { payload : schema, }   // POST
      },
      handler: async function (request, h) {
        // param 參數
        //const { } = request.payload;  //POST

        // auth 參數
        //const { guildId, uid, isChief } = request.auth.artifacts;

        // SQL CMD
        //const [[{ sqlresult }]] = await request.mysql.pool.execute( 'call sp(?,?)', [ p1, p2]);
        
        // return
        return { 
          statusCode: 20000, 
          message: 'successful', 
          data: {list:sqlresult, total:0} 
        };

        // return with Boom
        // return Boom.notAcceptable(msg);
      },
    });

    /* Router End */   
  },
};
