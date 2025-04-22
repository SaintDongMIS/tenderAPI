'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const vision = require('@hapi/vision')
const handlebars = require('handlebars')
const Pack = require('../package.json');

const authStrategy = false; 
//const authStrategy = 'simple';

exports.plugin = {
  //pkg: require('./package.json'),
  name: 'template_views',
  version: '0.0.0',
  register: async function (server, options) {

    await server.register({
      plugin: vision,
      options: {
        engines:{ html:handlebars },
        relativeTo: __dirname,
        path: './tamplates',
        //isCached: false 每次都重新進行編譯，建議使用在開發站
      }
    })
    
    // ----------------------------------------------------------------------------------------------------
    server.route({
      method: 'GET',
      path: '/handlebars/view1',
      options: {
        description: ' API description',
        //auth: { strategy: 'auth', scope: ['roles'] },
        //auth: { strategy: 'bearer', scope: ['roles'] },
        cors: { origin: ['*'], credentials: true },
        tags: ['api'],
        //validate: { query: schema, }   // GET
      },
      handler: async function (request, h) {
    
        return h.view('index', {
          title:'Hello World',
          message:'Here is some message....',
          ver: Pack.version
        })

      },
    });

    // ----------------------------------------------------------------------------------------------------
    server.route({
      method: 'GET',
      path: '/handlebars/view2',
      options: {
        description: ' API description',
        //auth: { strategy: 'auth', scope: ['roles'] },
        //auth: { strategy: 'bearer', scope: ['roles'] },
        cors: { origin: ['*'], credentials: true },
        tags: ['api'],
        //validate: { query: schema, }   // GET
      },
      handler: {
        view:{
          template: 'index',
          context: {
            title:'Hello World 2',
            message:'Here is some message....',
            ver: Pack.version
          }
        }
      }
    });
    /* Router End */   
  },
};
