'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');

//const fs = require('fs');

//const authStrategy = false; 
//const authStrategy = 'simple';

exports.plugin = {
  //pkg: require('./package.json'),
  name: 'template_file',
  version: '1.0.0',
  register: async function (server, options) {

    // Validate with Joi 
    const schema = Joi.object({
      //username : Joi.string().required().description('user name'),
      //password : Joi.string().required().description('user password')
    });

    await server.register({
      plugin:require('@hapi/inert')
    })

    // ----------------------------------------------------------------------------------------------------
    server.route({
      method: 'GET',
      path: '/public/{param*}',
      options: {
        description: 'static file',
        //auth: { strategy: 'auth', scope: ['roles'] },
        //auth: { strategy: 'bearer', scope: ['roles'] },
        cors: { origin: ['*'], credentials: true },
        tags: ['api'],
        //validate: { query: schema, }   // GET
      },
      handler:{
        directory: {  // 路徑，位於 server.js 的相對目錄
            path:'public'
        }
      }
    });

    // ----------------------------------------------------------------------------------------------------
    /*
    server.route({
      method: ['POST'],
      path: '/upload',
      options: {
        description: '上傳檔案，key 必續為 file',
        //auth: { strategy: 'auth', scope: ['roles'] },
        //auth: { strategy: 'bearer', scope: ['roles'] },
        cors: { origin: ['*'], credentials: true },
        tags: ['api'],
        payload: {
          output: 'stream',
          parse: true,
          allow: 'multipart/form-data'
        }
      },
      handler: async function (request, h) {

        const { payload } = request;
        const response = await handleFileUpload(payload.file);
        return response;     
      },
    });

    const handleFileUpload = (file) => {
      return new Promise((resolve, reject) => {
        const filename = Date.now() + '.jpg';
        const data = file._data;

        fs.writeFile(`./upload/${filename}`, data, (err) => {
          //console.log('uploading');
          
          if (err) {
            reject(err);
          }

          resolve({
            message: 'Upload successfully!',
            filename: filename,
            imageUrl: `${server.info.uri}/upload/${filename}`
          });
        });

      });
    };
*/
    /* Router End */   
  },
};
