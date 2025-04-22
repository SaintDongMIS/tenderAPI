'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');

const authStrategy = false; 
//const authStrategy = 'simple';

exports.plugin = {
  //pkg: require('./package.json'),
  name: 'accounts',
  version: '0.0.0',
  register: async function (server, options) {

    // Validate with Joi 
    const sCreate = Joi.object({
      codec : Joi.number().required().description('組織編碼'),
      name : Joi.string().required().description('組織名稱'),
      hierarchy : Joi.number().required().description('組織層數'),
      note : Joi.string().description('說明')
    });

    const setMaster = Joi.object({
      codec : Joi.number().required().description('組織編碼'),
      name : Joi.string().required().description('組織名稱'),
      hierarchy : Joi.number().required().description('組織層數'),
      note : Joi.string().description('說明')
    });


    
    // ----------------------------------------------------------------------------------------------------
    server.route({
      method: 'POST',
      path: '/guild',
      options: {
        description: '建立組織',
        //auth: { strategy: 'auth', scope: ['roles'] },
        //auth: { strategy: 'bearer', scope: ['roles'] },
        cors: { origin: ['*'], credentials: true },
        tags: ['api'],
        validate: { payload: sCreate, }   // GET
      },
      handler: async function (request, h) {
        // param 參數
        const { codec, name, hierarchy, note } = request.payload;    //GET
        console.log(codec, name, hierarchy, note)
        // auth 參數
        //const { guildId, uid, isChief } = request.auth.artifacts;
    
        // SQL CMD
        const [ res ] = await request.accsql.pool.execute( 
          `INSERT INTO guilds (
            GuildCode, 
            Name, 
            hierarchy, 
            Note
            ) 
          VALUES (?, ?, ?, ?)`, 
          [ codec, name, hierarchy, note]
        );
    
        console.log(res)
        return { 
          statusCode: 20000, 
          message: 'successful', 
          data: {res:res} 
        };

        // return with Boom
        //return Boom.notAcceptable(msg);
      },
    });

    // ----------------------------------------------------------------------------------------------------
    server.route({
      method: 'GET',
      path: '/guild',
      options: {
        description: '列出組織',
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
        const [res] = await request.accsql.pool.execute( `SELECT * FROM guilds`, []);
        
        // return
        return { 
          statusCode: 20000, 
          message: 'successful', 
          data: {list:res, total:res.length} 
        };

        // return with Boom
        // return Boom.notAcceptable(msg);
      },
    });

    // ----------------------------------------------------------------------------------------------------
    /*
    server.route({
      method: 'POST',
      path: '/account',
      options: {
        description: '新增帳號',
        //auth: { strategy: 'auth', scope: ['roles'] },
        //auth: { strategy: 'bearer', scope: ['roles'] },
        cors: { origin: ['*'], credentials: true },
        tags: ['api'],
        validate: { payload: sCreate, }   // GET
      },
      handler: async function (request, h) {
        // param 參數
        const { codec, name, hierarchy, note } = request.payload;    //GET
        console.log(codec, name, hierarchy, note)
        // auth 參數
        //const { guildId, uid, isChief } = request.auth.artifacts;
    
        // SQL CMD
        const [ res ] = await request.accsql.pool.execute( 
          ``, 
          [ ]
        );
    
        console.log(res)
        // return
        return { 
          statusCode: 20000, 
          message: 'successful', 
          data: {res:res} 
        };

        // return with Boom
        //return Boom.notAcceptable(msg);
      },
    });
    */
    /* Router End */   
  },
};
