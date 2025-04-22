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
	name: 'other',
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
			path: '/other/precipitation',
			options: {
				description: '降雨天數',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { timeStart, timeEnd } = request.query;

				const [ result ] = await request.tendersql.pool.execute(
					`SELECT
						DATE_FORMAT( date, '%Y-%m' ) AS date,
						SUM(CASE WHEN precipitation > 0 THEN 1 ELSE 0 END) AS rainyCount
					FROM
						weatherRainfall
					WHERE date >= ? AND date < ? 
					GROUP BY DATE_FORMAT(date, '%Y-%m')`, [ timeStart, timeEnd ]);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});
		// ----------------------------------------------------------------------------------------------------

		/* Router End */   
	},
};
