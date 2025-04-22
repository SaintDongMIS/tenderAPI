'use strict';

const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const AuthBearer = require('hapi-auth-bearer-token');

exports.plugin = {
  //pkg: require('./package.json'),
  name: 'auth',
  version: '1.0.0',
  register: async function (server, options) {
    // 存放 Login token 的 cached
    
    const cachedLogin = server.cache({
      expiresIn: process.env.CACHE_LOGIN_EXPIRE || 86400000,
      // cache: 'redisCache',
      segment: 'accessToken',
      generateFunc: async (token) => {
        const info = { init: false };
        return info;
      },
      generateTimeout: 2000,
    });
    

    await server.register(AuthBearer);
    server.auth.strategy('bearer', 'bearer-access-token', {
      allowQueryToken: false, // optional, false by default
      validate: async (request, token, h) => {
        // here is where you validate your token
        // comparing with token from your database for example


        // isValid 是否驗證成功
        // scope 使用者權限
        const isValid = token === '1234';
        const scope = 'roles';

        // credentials 驗證後的憑證
        // artifacts 使用者所擁有的其他資料
        const credentials = { token, scope };
        const artifacts = { info: 'info', guild: 'guild-ID', uid: 'user-ID' };

        return { isValid, credentials, artifacts };
      },
    });

    server.route({
      method: ['POST'],
      path: '/auth/login',
      options: {
        description: '登入 - 透過這個 API 取得 token',
        tags: ['api'],
        validate: {
          payload: Joi.object().keys({
            username: Joi.string().required(),
            password: Joi.string().alphanum().min(4).max(16).required(),
          }),
        },
      },
      handler: async function (request, h) {
        const { username, password } = request.payload;
        const ip = request.info.remoteAddress;

        let returnCode = 200;
        return {
          returnCode: returnCode,
          code: 20000,
          timeStamp: new Date().getTime() / 1000,
          accessToken: 1234, // 後續驗證用 token, 使用方式 bearer 1234
          //accessScope: JSON.parse(permission.PermitItem),
        };
      },
    });

    server.route({
      method: 'Get',
      path: '/auth/check',
      options: {
        description: '登入 - 測試是否成功登入',
        auth: { strategy: 'bearer', scope: ['roles'] },
        cors: { origin: ['*'], credentials: true },
        tags: ['api'],
        //validate    : { query   : schema, }   // GET
        //validate    : { payload : schema, }   // POST
      },
      handler: async function (request, h) {
        // param 參數
        //let {} = request.query;
        //let {} = request.payload;

        // return 回傳
        let msg = 'msg';
        let returnCode = 200;
        if (returnCode == 200) return { code: 2000, message: 'successful' };
        if (returnCode == 500) msg = 'code500 internal error';
        return Boom.notAcceptable(msg);
      },
    });

    server.route({
      method: 'POST',
      path: '/auth/logout',
      options: {
        description: '登出 - 登出系統',
        auth: { strategy: 'bearer', scope: ['roles'] },
        tags: ['api'],
      },
      handler: (request, h) => {

        // clear token
        
        return {
          code: 20000,
          message: 'successful',
        };
      },
    });

  },
};

