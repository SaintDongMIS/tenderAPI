"use strict";
//process.env.HOST = '127.0.0.1';
//process.env.NODE_ENV = 'production';

const Hapi = require("@hapi/hapi");
//const CatboxRedis = require('@hapi/catbox-redis');
const Blipp = require("blipp");
const Boom = require("@hapi/boom");
const Pack = require("./package");
const H2o2 = require("@hapi/h2o2");

const server = Hapi.server({
	port: process.env.PORT || 8080,
	host: process.env.HOST || "0.0.0.0",
	routes: { cors: true },
	// 內建已經有 catbox-memory, 可以自行依照需求增加 Redis 或是 MongoDB
	// cache: [
	//   {
	//     name: 'redisCache',
	//     provider: {
	//       constructor: CatboxRedis,
	//       options: {
	//         url: process.env.REDIS_URL,
	//         partition: 'cache'
	//       }
	//     }
	//   }
	// ],
	debug: {
		request: [process.env.DEBUG ? "error" : "false"],
	},
});

server.ext("onPreResponse", function (request, reply) {
	const response = request.response;
	if (response && response.header && typeof response.header === "function") {
		response.header(
			"Access-Control-Allow-Headers",
			"Authorization, Accept, Accept-Language, Content-Language, Content-Type, Access-Control-Allow-Headers, Access-Control-Allow-Origin, Access-Control-Allow-Methods, Access-Control-Allow-Credentials, Cache-Control, x-token"
		);
		response.header("Access-Control-Allow-Origin", "*");
		response.header(
			"Access-Control-Allow-Methods",
			"GET, POST, PATCH, PUT, DELETE, OPTIONS"
		);
		response.header("Access-Control-Allow-Credentials", true);
	}

	try {
		if (request.method === "options") {
			return request.response.code(200);
		} else {
			return request.response;
		}
	} catch (err) {
		console.log(err);
	}
});

// Index Router
// Move to Views (viewStatus)

/*
server.route({
	method: 'GET',
	path: '/hello',
	options: {
		tags:['api'],
		//log: { collect: true }
	},
	handler: async function (request, h) {
	  
		const aaa = 1;
		const result = await request.pg.client.query(`SELECT * FROM setting WHERE Id = ${aaa}`);
		console.log(result.rows)
		return result.rows ;
	},
});*/

// Error Contorl
server.route({
	method: "*",
	path: "/{any*}",
	options: {
		description: "Error 404 page",
	},
	handler: function (request, h) {
		const xFF = request.headers['x-forwarded-for'];
		const ip = xFF ? xFF.split(',')[0] : request.info.remoteAddress;
		console.log("looking for path:", request.path);
		console.log('ip', ip);
		return Boom.notFound("Page Not Found");
	},
});

const init = async () => {
	// ----- Features --------------------------------------------
	/** mySQL2 */
	await server.register(require('./plugins/services/mysqqqql'));

	/** postSQL */
	await server.register(require("./plugins/services/postsql"));

	/** swagger */
	if (process.env.SWAGGER == "true") {
		await server.register(require("./plugins/services/swaaaagger"));
	}

	/** Blipp */
	if (process.env.BLIPP == "true") {
		await server.register({ plugin: Blipp, options: { showAuth: true } });
	}

	/** Pino */
	if (process.env.PINO == "true") {
		await server.register(require("./plugins/services/pino"));
	}

	/** Telegram Bot */
	if (process.env.TELEGRAM_BOT_TOKEN != undefined) {
		await server.register(require("./plugins/services/telegramBot"));
	}

	await server.register(H2o2);

	/** Cron Jobs */
	//await server.register(require('./plugins/services/cron_jobs'))

	// ----- views --------------------------------------------
	//await server.register(require('./views/viewPrivacy'))
	await server.register(require("./views/viewStatus"));

	// ----- routers --------------------------------------------
	// Login
	await server.register(require("./plugins/auth/login"));
	await server.register(require("./plugins/users/accounts"));

	// Demo
	// await server.register(require('./plugins/sample'));


	// excel
	// await server.register(require("./plugins/charts/chart_view"));

	// type
	await server.register(require("./plugins/type/type"));

	// road
	await server.register(require("./plugins/road/road"));
	await server.register(require("./plugins/road/case"));
	await server.register(require("./plugins/road/caseV1"));

	// car
	await server.register(require("./plugins/car/car"));

	// case
	await server.register(require("./plugins/case/dispatch_rm100"));
	await server.register(require("./plugins/case/dispatch"));

	// charts
	await server.register(require("./plugins/charts/PCI"));
	await server.register(require("./plugins/charts/case"));
	await server.register(require("./plugins/charts/PI"));
	await server.register(require("./plugins/charts/other"));

	// inspection
	await server.register(require("./plugins/inspection/inspection"));

	await server.register(require("./plugins/app/carGpsTracks"));
	await server.register(require("./plugins/app/insCases"));
	await server.register(require("./plugins/app/inspections"));
	await server.register(require("./plugins/app/upload"));

	// 衛工
	await server.register(require("./plugins/sewerageSys/sewerageSys"));

	// app
	await server.register(require("./plugins/app/app"));

	//tool
	await server.register(require("./plugins/tool/PCIV1"));
	await server.register(require("./plugins/tool/PCI"));
	await server.register(require("./plugins/tool/tools"));

	await server.register(require("./plugins/bimProxy/bimProxy"));

	// Public Files
	await server.register(require("./template/router_file"));

	// SMS Auth
	//await server.register(require('./plugins/auth/sms_auth'))

	// ----- Methods --------------------------------------------
	await server.register(require("./plugins/methods/tender_methodsV1"));
	await server.register(require("./plugins/methods/tender_methods"));
	await server.register(require("./plugins/methods/inspection_methods"));
	await server.register(require("./plugins/methods/pi_methods"));
	await server.register(require('./plugins/methods/GCStorage_methods'));

	// ----- Server --------------------------------------------
	// start
	await server.start();
	console.log(`Server running at: ${server.info.uri}`);
};

process.on("unhandledRejection", (err) => {
	console.log(err);
	process.exit(1);
});

init();
