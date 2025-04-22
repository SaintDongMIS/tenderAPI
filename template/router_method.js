'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');

const authStrategy = false; 
//const authStrategy = 'simple';

exports.plugin = {
  //pkg: require('./package.json'),
  name: 'template_methods',
  version: '0.0.0',
  register: async function (server, options) {

    // Validate with Joi 
    const schema = Joi.object({
      x : Joi.number().required().description('any number'),
    });
    
    const new_method = async function (x) {
      const result = x+1;
      return result
    }

    // register method
    server.method('fnName', new_method);

    // register method with cached
    // - Server method 可以加上快取
    // - 快取的說明可以參考 catbox
    server.method('fnNameCached', new_method, {
      cache:{
        expiresIn:60000,        //项目保存在缓存中的时间，超过这个时间将失效。其中时间以毫秒数表示(ms)，不能与 expiresAt一同使用
        //expiresAt:'23:59',      //使用以 'HH:MM' 格式以24小时为指定时间, 这个时间之后路由所有的缓存记录都将失效。这个时间使用本地时间，不能与 expiresIn 一同使用
        staleIn:30000,          //缓存失效时，尝试重新生成它毫秒数，必须小于 expiresI
        staleTimeout:10000,     //在 generateFunc 生成新值时返回之前，可以允许返回过期值的毫秒数
        generateTimeout:100,    //当返回时间太长时，如返回超时错误之前，等待的毫秒数。但当这个值最终被返回时，它将储存在缓存中以便将来的请求使用
        segment:'method_fn',    //用于隔离缓存项的可选分段名称
        //cache:'redisCache',     //服务器上配置的缓存连接的名称，沒寫表示使用 memorycache
      }});
    
    

    // ----------------------------------------------------------------------------------------------------
    server.route({
      method: 'GET',
      path: '/template/methods',
      options: {
        description: ' API description',
        //auth: { strategy: 'auth', scope: ['roles'] },
        //auth: { strategy: 'bearer', scope: ['roles'] },
        cors: { origin: ['*'], credentials: true },
        tags: ['api'],
        validate: { query: schema, }   // GET
      },
      handler: async function (request, h) {
        // param 參數
        const {x} = request.query;    //GET

        // auth 參數
        //const { guildId, uid, isChief } = request.auth.artifacts;
    
        // resoult
        const noCached = await server.methods.fnName(x);
        const withcached = await server.methods.fnNameCached(x)
        
        return { 
          statusCode: 20000, 
          message: 'successful', 
          data: {
            noCache: noCached,
            withCache: withcached
          } 
        };

        // return with Boom
        //return Boom.notAcceptable(msg);
      },
    });

    // ----------------------------------------------------------------------------------------------------

    /* Router End */   
  },
};
