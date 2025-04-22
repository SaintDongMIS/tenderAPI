'use strict';

const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const cryptiles = require('@hapi/cryptiles');

// Twilio
const accountSid = process.env.TWILIO_SID;
const authToken = process.env.TWILIO_TOKEN;
const sendFrom = process.env.TWILIO_NUMBER;
const twilioClient = require('twilio')(accountSid, authToken);
const enableClient = process.env.TWILIO_ENABLE || false;

/**
 * Dont forget add twilio model
 */

exports.plugin = {
  //pkg: require('./package.json'),
  name: 'sms',
  version: '1.0.0',
  register: async function (server, options) {
    // 存放 SMS Code 用的 cached
    
    const cachedVerifyCode = server.cache({
      expiresIn: process.env.CACHE_SMS_EXPIRE || 600000,  // 10min
      // cache: 'redisCache',
      segment: 'codeSMS',
      generateFunc: async (token) => {
        const code = { code: '000000' };
        return code;
      },
      generateTimeout: 2000,
    });
  

    server.route({
      method: 'POST',
      path: '/sms/send',
      options: {
        description: '送出驗證碼',
        //auth: { strategy: 'bearer', scope: ['roles'] },
        tags: ['api'],
        validate: {
          payload: Joi.object({
            number: Joi.string().required(),
          }),
        },
      },
      handler: async function (request, h) {
        // Param
        const { number } = request.payload;
        const { code } = await cachedVerifyCode.get(String(number));
        
        // check CD? 
        if ( code != '000000' ) return Boom.notAcceptable('冷卻中...') 
        
        // verify code
        const verifyCode = cryptiles.randomDigits(6);
        console.log(verifyCode);
        await cachedVerifyCode.set( 
          String(number), 
          {
            code: verifyCode
          }
        );

        // switch
        if ( !enableClient ) return {statusCode: 20000, message:'successful', data:{ code: verifyCode } };
        
        // send
        await twilioClient.messages
          .create({
            body: 'Your Verification Code is: ' + verifyCode,  
            from: sendFrom,
            to: '+' + number
          })
          .then(message => console.log(message));
        

        return {statusCode: 20000, message:'successful', data:{ } };
      },
    });

    server.route({
      method: 'POST',
      path: '/sms/confirm',
      options: {
        description: '確認驗證碼是否有效',
        //auth: { strategy: 'bearer', scope: ['roles'] },
        cors: { origin: ['*'], credentials: true },
        tags: ['api'],
        validate    : { payload : Joi.object({
          number: Joi.string().required(),
          verify: Joi.string().required()
        }), }   // POST
      },
      handler: async function (request, h) {
        // param 參數
        const {number, verify} = request.payload;
        const {code} = await cachedVerifyCode.get(String(number));
        
        // 防呆
        if (verify == '000000') return Boom.notAcceptable('驗證失敗')
        
        // 驗證失敗
        if (code != verify) return Boom.notAcceptable('驗證失敗')

        /* TODO 驗證成功的時候要做的事情寫在這裡*/ 

        // 驗證完畢的就銷毀
        await cachedVerifyCode.drop(String  (number))

        // return 回傳
        return {statusCode: 20000, message:'successful', data:{ } };
      },
    });


  },
};
