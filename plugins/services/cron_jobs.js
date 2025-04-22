'use strict';
const HapiCron  = require('hapi-cron');
const Wreck     = require('@hapi/wreck');
const moment    = require('moment');


const Job_1m = {
    name: 'report1m',
    time: ' */1 * * * *',           // 1分鐘
    timezone: 'Asia/Taipei',        // UTC+8
    request :{ 
        method: 'GET',
        url:'/cronDemo',
    },
    onComplete: (res) => {
        console.log(res); // 'return something'
        console.log(new Date())      
    }
}

const Job_1d = {
    name: 'diamond1day',
    time: '0 1 * * *',           // 每天 1 點            
    timezone: 'Asia/Taipei',        // UTC+8
    request :{
        method: 'GET',
        url:'/cronDemo',
    },
    onComplete: (res) => {
        console.log(res); // 'return something'
        console.log(new Date())      
    }
}

console.log("setting the cron jobs")
console.log('===================================')
const cronJobs = [
    //Job_1m,
    //Job_1d
]
console.log(cronJobs);
console.log('===================================')

exports.plugin = {
    //pkg: require('./package.json'),
    name : 'cron_jobs',    
    version : '1.0.0',
    register: async function (server, options) {
        // How to use crontab
        // https://crontab.guru
        
        await server.register({
            plugin: HapiCron,
            options:    {
                jobs:cronJobs
            }
        });

        server.route({
            method: 'GET',
            path: '/cronDemo',
            options: {
                //tags: ['api'],
            },
            handler: async function (request, h) {
                console.log( moment() );
                return {code:200, message:'show successful!!'}
            }
        })

     



    }
};