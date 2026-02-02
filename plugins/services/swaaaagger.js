'use strict';

const Hapi_Swagger = require('hapi-swagger');
const Vision = require('@hapi/vision');
const Inert = require('@hapi/inert');
const Pack = require('../../package');


// --- auth ---
const auth_basic = require('@hapi/basic');
const validate = async (request, username, password) => {
  if (username != 'adm') return { credentials: null, isValid: false };
  if (password != 'pass') return { credentials: null, isValid: false };

  const credentials = { id: 'id', name: 'name', scope: [ 'dev' ] };

  return { isValid: true, credentials };
};

exports.plugin = {
  //pkg: require('./package.json'),
  name: 'swagger',
  version: '1.0.0',
  register: async function(server, options) {
    // --- auth ---
    await server.register(auth_basic);
    server.auth.strategy('simple', 'basic', { validate });

    //swagger
    const swaggerOptions = {
      info: {
        title: 'Wellcome API docs',
        version: Pack.version,
        description: Pack.description
      },

      // setting the auth method for APIS
      securityDefinitions: {
        Bearer: {
          type: 'apiKey',
          name: 'Authorization',
          in: 'header'
        }
      },  
      security: [ { Bearer: [] } ],

      tags: [
        { name: 'view',   description: 'web view'},
        { name: 'auth',   description: 'auth function' },
        { name: 'database', description: 'database operations' },
        { name: 'sync',   description: 'database synchronization' },
      ],

      //expanded: 'full', 
      //expanded: 'list', 
      auth: { strategy: 'simple', scope: [ 'dev' ] },
      documentationPath: '/docs'
    };

    await server.register({
      plugin: Hapi_Swagger,
      options: swaggerOptions
    });

    // swagger 需要這兩個相依的 plugin
    await server.register([ Inert, Vision ]);
  }
};
