'use strict';

const Hapi_mysql2 = require('hapi-mysql2');

exports.plugin = {
	//pkg: require('./package.json'),
	name: 'mysql2',
	version: '1.0.0',
	register: async function (server, options) {

		//mysql2
		/*
		const clientOpts = {
				settings:   process.env.MYSQL_URL, 
				//mysql://username:password@example.com:port/dbname
				decorate:   'accsql'
		};
		*/

		// if the project need to connect N different sql just use array to setup the connect info.
		// await request.'decorate'.pool.execute()
		// ex: await request.mysql.pool.execute('sql cmd', [parms])

		const clientOpts = [
			{
				settings: process.env.MYSQL_ACC_URL,
				//mysql://user:pass@example.com:port/dbname
				decorate: 'accsql'
			},
			{
				settings: process.env.MYSQL_TENDER_URL,
				//mysql://user:pass@example.com:port/dbname
				decorate: 'tendersql'
			},
		];

		//console.log(process.env.MYSQL_URL);

		await server.register({
			plugin: Hapi_mysql2,
			options: clientOpts
		});
	}
};