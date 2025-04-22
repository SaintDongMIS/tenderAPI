'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const { DateTime, Interval } = require("luxon");

const authStrategy = false; 
//const authStrategy = 'simple';

const sql = require('mssql');

const sqlConfig_1 = {
	user: process.env.MSSQL_USER,
	password: process.env.MSSQL_PWD,
	database: 'rm100',
	requestTimeout: 40000,
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
	name: 'case',
	version: '0.0.0',
	register: async function (server, options) {

		// ----------------------------------------------------------------------------------------------------
		// 維護案件
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/case/caseReport',
			options: {
				description: '維護數量',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().required().description('行政區'),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { zipCode, timeStart, timeEnd } = request.query;
				// const timeStart = DateTime.fromISO("2022-06-01").toFormat("yyyy-MM-dd");
				// const timeEnd = DateTime.now().toFormat("yyyy-MM-dd");

				const { rows: [{ district }] } = await request.pg.client.query(
					`SELECT "District" AS "district" FROM "public"."unitZip" WHERE "zipCode" = $1 `,
					[ zipCode ]);

				await sql.connect(sqlConfig_1);

				const { recordsets: [ result_1 ] } = await sql.query
					`SELECT 
						ISNULL(COUNT(CASE WHEN caseList.DeviceType ='1' AND caseList.WCSN = '倢立' AND caseList.Delmuch = 4 THEN caseList.CaseNo ELSE NULL END), 0) AS 'hotRepair.count',
						ISNULL(SUM(CASE WHEN caseList.DeviceType ='1' AND caseList.WCSN = '倢立' AND caseList.Delmuch = 4 THEN caseList.Blength1 * caseList.Elength1 ELSE NULL END), 0) AS 'hotRepair.area',
						ISNULL(COUNT(CASE WHEN caseList.DeviceType ='1' AND caseList.WCSN != '倢立' AND caseList.Delmuch != 4 THEN caseList.CaseNo ELSE NULL END), 0) AS 'AC.count',
						ISNULL(SUM(CASE WHEN caseList.DeviceType ='1' AND caseList.WCSN != '倢立' AND caseList.Delmuch != 4 THEN caseList.Blength1 * caseList.Elength1 ELSE NULL END), 0) AS 'AC.area',
						ISNULL(COUNT(CASE WHEN caseList.DeviceType ='3' THEN caseList.CaseNo ELSE NULL END), 0) AS 'ditch.count',
						ISNULL(SUM(CASE WHEN caseList.DeviceType ='3' THEN caseList.Blength1 * caseList.Elength1 ELSE NULL END), 0) AS 'ditch.area',
						ISNULL(COUNT(CASE WHEN caseList.DeviceType ='2' THEN caseList.CaseNo ELSE NULL END), 0) AS 'sidewalk.count',
						ISNULL(SUM(CASE WHEN caseList.DeviceType ='2' THEN caseList.Blength1 * caseList.Elength1 ELSE NULL END), 0) AS 'sidewalk.area'
					FROM
						tbl_case AS caseList
						INNER JOIN tbl_BType AS distressType ON caseList.BType = distressType.SerialNo
						INNER JOIN tbl_block AS blockList ON blockList.serialno = caseList.bsn 
					WHERE
						caseList.RecControl = '1'
						AND caseList.caseno = caseList.recaseno
						AND blockList.dteam IN ( '41', '81', '91', '71', '72' )
						AND blockList.TBName = ${district}
						AND (caseList.ctype2 = '1' OR caseList.ctype4 = '3')
						AND CAST ( caseList.CaseDate AS datetime ) >= ${timeStart} AND CAST ( caseList.CaseDate AS datetime ) < ${timeEnd}`;

				const { recordsets: [ result_serialNo ] } = await sql.query
					`SELECT 
						caseList.SerialNo
					FROM
						tbl_case AS caseList
						INNER JOIN tbl_BType AS distressType ON caseList.BType = distressType.SerialNo
						INNER JOIN tbl_block AS blockList ON blockList.serialno = caseList.bsn 
					WHERE
						caseList.RecControl = '1'
						AND caseList.caseno = caseList.recaseno
						AND blockList.dteam IN ( '41', '81', '91', '71', '72' )
						AND blockList.TBName = ${district}
						AND (caseList.ctype2 = '1' OR caseList.ctype4 = '3')
						AND CAST ( caseList.CaseDate AS datetime ) >= ${timeStart} AND CAST ( caseList.CaseDate AS datetime ) < ${timeEnd}`;

				const sqlCMS_dteam = (zipCode == 104) ? `AND list.dteam IN ('41', '91', '71', '72')  ` : `AND list.dteam IN ('41', '81', '71', '72')  `;
				const { recordsets: [ result_2 ] } = await sql.query(
				`SELECT
					ISNULL(SUM(CASE WHEN detail.項次 = '1.1.304' THEN detail.數量 ELSE NULL END), 0) AS 'hotRepair.area',
					ISNULL(SUM(CASE WHEN detail.項次 IN ('1.1.2', '1.1.4') THEN detail.數量 ELSE NULL END), 0) AS 'AC.area',
					ISNULL(SUM(CASE WHEN detail.項次 = '1.1.82' THEN detail.數量 ELSE NULL END), 0) AS 'ditch.area',
					ISNULL(SUM(CASE WHEN detail.項次 = '1.1.202' THEN detail.數量 ELSE NULL END), 0) AS 'sidewalk.area'
				FROM
					計價組套 AS list
					LEFT JOIN 計價組套實際 AS detail ON detail.組套名稱序號 = list.serialno
				WHERE
					list.reccontrol = '1' 
					${sqlCMS_dteam}
					AND detail.項次 IN ('1.1.82', '1.1.202', '1.1.304', '1.1.2', '1.1.4')
					AND detail.case_serialno IN (${result_serialNo.map(r => r.SerialNo).join(",")})`);

				sql.close();

				const resultMerge = Object.keys(result_1[0]).reduce((acc, curr) => {
					const [key, subkey] = curr.split(".");
					if (!acc.hasOwnProperty(key)) acc[key] = {};
					if (['ditch', 'sidewalk'].includes(key) && subkey == 'area') acc[key][subkey] = result_2[0][curr];
					else if (subkey != undefined) acc[key][subkey] = result_1[0][curr];
					
					return acc
				}, {})

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: resultMerge }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/case/mCaseList',
			options: {
				description: '維護案件列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().required().description('行政區'),
						caseType: Joi.number().required().description('案件類型'),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { zipCode, caseType, timeStart, timeEnd } = request.query;
				// const timeStart = DateTime.fromISO("2022-06-01").toFormat("yyyy-MM-dd");
				// const timeEnd = DateTime.now().toFormat("yyyy-MM-dd");
				const [ type, subType ] = String(caseType).split("");

				let sqlCMD = "";
				switch (subType) {
					case '1':
						sqlCMD = ` AND caseList.WCSN = '倢立' AND caseList.Delmuch0 = 4`;
						break;
					case '2':
						sqlCMD = ` AND caseList.WCSN != '倢立' AND caseList.Delmuch0 != 4`;
						break;
				}

				// if (sqlCMD.length == 0) return Boom.notAcceptable('type is invalid');
				// console.log(sqlCMD);

				const { rows: [{ district }] } = await request.pg.client.query(
					`SELECT "District" AS "district" FROM "public"."unitZip" WHERE "zipCode" = $1 `,
					[ zipCode ]);

				await sql.connect(sqlConfig_1);

				sqlCMD = `SELECT 
					caseList.CaseNo,
					COALESCE(expan.organ_assign, 0) AS organAssign,
					caseList.CaseName,
					caseList.CaseDate,
					(CASE WHEN caseList.CType1Date != '0' THEN caseList.CType1Date ELSE caseList.CType4Date END) AS dispatchDate,
					caseList.acrendate AS estFinishDate,
					caseList.CType2Date AS finishDate,
					caseList.page4t AS actualFinishDate,
					caseList.SCType3Date AS markerFinishDate,
					caseList.DeviceType,
					caseList.BrokeType,
					caseList.BType,
					distressType.BTName,
					caseList.Blength0 * caseList.Elength0 AS dispatchArea,
					caseList.Blength1 * caseList.Elength1 AS actualArea,
					ISNULL(markline.markerArea, 0) AS markerArea
				FROM
					tbl_case AS caseList
					LEFT JOIN tbl_case_expan AS expan ON expan.casecsn = caseList.SerialNo
					LEFT JOIN tbl_BType AS distressType ON caseList.BType = distressType.SerialNo
					LEFT JOIN tbl_block AS blockList ON blockList.serialno = caseList.bsn 
					LEFT JOIN (SELECT casecsn, SUM(area2) AS markerArea FROM tbl_sctype2num GROUP BY casecsn) AS markline ON markline.casecsn = caseList.SerialNo
				WHERE
					caseList.RecControl = '1' 
					AND caseList.caseno = caseList.recaseno 
					AND blockList.dteam IN ( '41', '81', '91', '71', '72' ) 
					AND blockList.TBName = '${district}'
					AND (caseList.ctype2 = '1' OR caseList.ctype4 = '3')
					AND caseList.DeviceType ='${type}'
					${sqlCMD}
					AND CAST ( caseList.CaseDate AS datetime ) >= '${timeStart}' AND CAST ( caseList.CaseDate AS datetime ) < '${timeEnd}'
				ORDER BY caseList.CaseNo, caseList.SystemNo`;

				const { recordsets: [ result ] } = await sql.query(sqlCMD);

				sql.close();

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/case/caseList',
			options: {
				description: '案件紀錄',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().required().description('行政區'),
						reportType: Joi.number().default(2).description('1: 分派; 2: 完工'),
						caseType: Joi.number().required().description('案件類型'),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { zipCode, reportType, caseType, timeStart, timeEnd } = request.query;
				// const timeStart = DateTime.fromISO("2022-06-01").toFormat("yyyy-MM-dd");
				// const timeEnd = DateTime.now().toFormat("yyyy-MM-dd");
				const [type, subType] = String(caseType).split("");

				const { rows: [{ district }] } = await request.pg.client.query(
					`SELECT "District" AS "district" FROM "public"."unitZip" WHERE "zipCode" = $1 `,
					[ zipCode ]);

				let sqlCMD = "";
				switch (subType) {
					case '1':
						sqlCMD = ` AND caseList.WCSN = '倢立' AND caseList.Delmuch0 = 4`;
						break;
					case '2':
						sqlCMD = ` AND caseList.WCSN != '倢立' AND caseList.Delmuch0 != 4`;
						break;
				}

				switch (reportType) {
					case 1:
						sqlCMD +=
							`	AND caseList.ctype0 = '1'
							AND CAST( caseList.CType0Date AS datetime ) >= '${timeStart}' AND CAST( caseList.CType0Date AS datetime ) < '${timeEnd}'`;
						break;
					case 2:
						sqlCMD +=
							` AND (caseList.ctype2 = '1' OR caseList.ctype4 = '3')
							AND CAST( caseList.page4t AS datetime ) >= '${timeStart}' AND CAST( caseList.page4t AS datetime ) < '${timeEnd}'`;
						break;
				}

				// if (sqlCMD.length == 0) return Boom.notAcceptable('type is invalid');
				// console.log(sqlCMD);

				await sql.connect(sqlConfig_1);

				sqlCMD = `SELECT 
					caseList.CaseNo,
					COALESCE(expan.organ_assign, 0) AS organAssign,
					caseList.CaseName,
					caseList.CaseDate,
					caseList.CType0Date AS directDispatchDate,
					(CASE WHEN caseList.CType1Date != '0' THEN caseList.CType1Date ELSE caseList.Ctype4Date END) AS dispatchDate,
					caseList.acrendate AS estFinishDate,
					caseList.CType2Date AS finishDate,
					caseList.page4t AS actualFinishDate,
					caseList.SCType3Date AS markerFinishDate,
					caseList.DeviceType,
					caseList.BrokeType,
					caseList.BType,
					distressType.BTName,
					caseList.Blength0 * caseList.Elength0 AS dispatchArea,
					caseList.Blength1 * caseList.Elength1 AS actualArea,
					ISNULL(markline.markerArea, 0) AS markerArea
				FROM
					tbl_case AS caseList
					LEFT JOIN tbl_case_expan AS expan ON expan.casecsn = caseList.SerialNo
					LEFT JOIN tbl_BType AS distressType ON caseList.BType = distressType.SerialNo
					LEFT JOIN tbl_block AS blockList ON blockList.serialno = caseList.bsn 
					LEFT JOIN (SELECT casecsn, SUM(area2) AS markerArea FROM tbl_sctype2num GROUP BY casecsn) AS markline ON markline.casecsn = caseList.SerialNo
				WHERE
					caseList.RecControl = '1' 
					AND caseList.caseno = caseList.recaseno 
					AND blockList.dteam IN ( '41', '81', '91', '71', '72' ) 
					AND blockList.TBName = '${district}'
					AND caseList.DeviceType ='${type}'
					${sqlCMD}
				ORDER BY caseList.CaseNo, caseList.SystemNo`;

				// console.log(sqlCMD);

				const { recordsets: [result] } = await sql.query(sqlCMD);

				sql.close();

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});
		
		// ----------------------------------------------------------------------------------------------------
		// 交辦案件金額
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/case/assignCaseAmt',
			options: {
				description: '交辦案件金額',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().required().description('行政區')
					}) }   // GET
			},
			handler: async function (request, h) {
				const { zipCode } = request.query;
				const { rows: result } = await request.pg.client.query(
					`SELECT * 
					FROM "assignCaseAmt" 
					WHERE 
						"zip" = $1
						AND "active" = TRUE 
					ORDER BY "month"`,
					[ zipCode ]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/case/assignCaseAmt',
			options: {
				description: '交辦案件金額(新增/修改)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: { 
					payload : Joi.object({
						zipCode: Joi.number().required().description('行政區'),
						month: Joi.string().required().description("月份"),
						implement: Joi.number().min(0).required().description("聖東執行金額"),
						assign: Joi.number().min(0).required().description("機關交辦金額")
					})
				}   // POST
			},
			handler: async function (request, h) {
				const { zipCode, month, implement, assign } = request.payload;

				// Step1: 先將之前的欄位disable
				await request.pg.client.query(
					`UPDATE "assignCaseAmt" SET "active" = FALSE FROM (SELECT "id" FROM "assignCaseAmt" WHERE "active" = TRUE AND "zip" = $1 AND "month" = $2 ) AS "assignCaseAmt2" WHERE "assignCaseAmt"."id" = "assignCaseAmt2"."id"`,
					[ zipCode, month ] );

				// Step2: 新增
				await request.pg.client.query(
					`INSERT INTO "assignCaseAmt" ("month", "implement", "assign", "createdAt", "operatorId", "zip") VALUES ($1, $2, $3, NOW(), $4, $5)`,
					[ month, implement, assign, 0, zipCode ]);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'DELETE',
			path: '/case/assignCaseAmt/{id}',
			options: {
				description: '交辦案件金額(刪除)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: { 
					params: Joi.object({
						id: Joi.number().required()
					}),
					// payload: schema    // POST
				}
			},
			handler: async function (request, h) {
				const { id } = request.params;

				await request.pg.client.query(
					`UPDATE "assignCaseAmt" SET "active" = FALSE WHERE "id" = $1`,
					[ id ]);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 經費類別
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/case/expType',
			options: {
				description: '經費類別',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				// validate: { query: schema }   // GET
			},
			handler: async function (request, h) {
				const { rows: result } = await request.pg.client.query(`SELECT * FROM "expType" WHERE "active" = TRUE`);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/case/expType',
			options: {
				description: '經費類別(新增)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						type: Joi.string().required().description("經費類別")
					})
				}   // POST
			},
			handler: async function (request, h) {
				const { type } = request.payload;

				// Step1: 
				const { rows: [ result ] } = await request.pg.client.query(
					`SELECT "id" FROM "expType" WHERE "active" = TRUE AND type = $1`,
					[ type ]);

				if (result != undefined) {
					return  {
						statusCode: 20000,
						message: 'successful',
						typeId: result.id
					};
				}

				// Step2: 新增欄位
				await request.pg.client.query(
					`INSERT INTO "expType" ("type", "createdAt", "operatorId") VALUES ($1, NOW(), $2)`,
					[ type, 0 ]);

				// Step3: 回傳新增欄位的Id
				const { rows: [{ id }] } = await request.pg.client.query(
					`SELECT "id" FROM "expType" WHERE "active" = TRUE AND type = $1`,
					[ type ]);

				return {
					statusCode: 20000,
					message: 'successful',
					typeId: id
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'DELETE',
			path: '/case/expType/{id}',
			options: {
				description: '經費類別(刪除)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					// payload: schema    // POST
				}
			},
			handler: async function (request, h) {
				const { id } = request.params;

				await request.pg.client.query(
					`UPDATE "expType" SET "active" = FALSE WHERE "id" = $1`,
					[ id ]);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 經費估算
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/case/expEstimate',
			options: {
				description: '經費估算',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().required().description('行政區'),
						dataTime: Joi.string().required()
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { zipCode, dataTime } = request.query;
				const timeStart = DateTime.fromISO(dataTime).startOf("month").toFormat("yyyy-MM-dd");
				const timeEnd = DateTime.fromISO(dataTime).endOf("month").toFormat("yyyy-MM-dd");

				const { rows: result } = await request.pg.client.query(
					`SELECT * 
					FROM "expEstimate" 
					WHERE 
						"zip" = $1
						AND "active" = TRUE 
						AND "dataTime" >= $2 AND "dataTime" < $3`,
					[ zipCode, timeStart, timeEnd ]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/case/expEstimate',
			options: {
				description: '經費估算(新增/修改)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						zipCode: Joi.number().required().description('行政區'),
						id: Joi.number().default(0),
						dataTime: Joi.string().required().description("時間"),
						typeId: Joi.number().required().description("經費類別"),
						amount: Joi.number().min(0).required().description("金額")
					})
				}   // POST
			},
			handler: async function (request, h) {
				const { zipCode, id, dataTime, typeId, amount } = request.payload;
				const timeStart = DateTime.fromISO(dataTime).startOf("month").toFormat("yyyy-MM-dd");
				const timeEnd = DateTime.fromISO(dataTime).endOf("month").toFormat("yyyy-MM-dd");

				// Step1-1: 先將之前的欄位disable
				if (id != 0) {
					await request.pg.client.query(
						`UPDATE "expEstimate" SET "active" = FALSE WHERE "id" = $1`,
						[ id ]);
				}

				// Step1-2: 重複類別欄位disable
				await request.pg.client.query(
					`UPDATE "expEstimate" SET "active" = FALSE FROM (SELECT "id" FROM "expEstimate" WHERE "active" = TRUE AND "zip" = $1 AND "typeId" = $2 AND "dataTime" >= $3 AND "dataTime" < $4) AS "expEstimate2" WHERE "expEstimate"."id" = "expEstimate2"."id"`,
					[ zipCode, typeId, timeStart, timeEnd ]);

				// Step2: 新增欄位
				await request.pg.client.query(
					`INSERT INTO "expEstimate" ( "dataTime", "typeId", "amount", "createdAt", "operatorId", "zip") VALUES ($1, $2, $3, NOW(), $4, $5)`,
					[ timeStart, typeId, amount, 0, zipCode ]);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'DELETE',
			path: '/case/expEstimate/{id}',
			options: {
				description: '經費估算(刪除)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					// payload: schema    // POST
				}
			},
			handler: async function (request, h) {
				const { id } = request.params;

				await request.pg.client.query(
					`UPDATE "expEstimate" SET "active" = FALSE WHERE "id" = $1`,
					[ id ]);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 經費執行
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/case/expExecution',
			options: {
				description: '經費執行',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: { query: Joi.object({
					zipCode: Joi.number().required().description('行政區'),
					dataTime: Joi.string().required()
				}) }   // GET
			},
			handler: async function (request, h) {
				const { zipCode, dataTime } = request.query;
				const timeStart = DateTime.fromISO(dataTime).startOf("month").toFormat("yyyy-MM-dd");
				const timeEnd = DateTime.fromISO(dataTime).endOf("month").toFormat("yyyy-MM-dd");

				const { rows: result } = await request.pg.client.query(
					`SELECT * 
					FROM "expExecution" 
					WHERE 
						"zip" = $1
						AND "active" = TRUE 
						AND "dataTime" >= $2 AND "dataTime" < $3`,
					[ zipCode, timeStart, timeEnd ]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/case/expExecution',
			options: {
				description: '經費執行(新增/修改)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						zipCode: Joi.number().required().description('行政區'),
						id: Joi.number().default(0),
						dataTime: Joi.string().required().description("時間"),
						typeId: Joi.number().required().description("經費類別"),
						amount: Joi.number().min(0).required().description("金額")
					})
				}   // POST
			},
			handler: async function (request, h) {
				const { zipCode, id, dataTime, typeId, amount } = request.payload;
				const timeStart = DateTime.fromISO(dataTime).startOf("month").toFormat("yyyy-MM-dd");
				const timeEnd = DateTime.fromISO(dataTime).endOf("month").toFormat("yyyy-MM-dd");

				// Step1-1: 先將之前的欄位disable
				if(id != 0) {
					await request.pg.client.query(
						`UPDATE "expExecution" SET "active" = FALSE WHERE "id" = $1`,
						[ id ]);
				}

				// Step1-2: 重複類別欄位disable
				await request.pg.client.query(
					`UPDATE "expExecution" SET "active" = FALSE FROM (SELECT "id" FROM "expExecution" WHERE "active" = TRUE AND "zip" = $1 AND "typeId" = $2 AND "dataTime" >= $3 AND "dataTime" < $4) AS "expExecution2" WHERE "expExecution"."id" = "expExecution2"."id"`,
					[ zipCode, typeId, timeStart, timeEnd ]);

				// Step2: 新增欄位
				await request.pg.client.query(
					`INSERT INTO "expExecution" ( "dataTime", "typeId", "amount", "createdAt", "operatorId", "zip") VALUES ($1, $2, $3, NOW(), $4, $5)`,
					[ timeStart, typeId, amount, 0, zipCode ]);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'DELETE',
			path: '/case/expExecution/{id}',
			options: {
				description: '經費執行(刪除)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					// payload: schema    // POST
				}
			},
			handler: async function (request, h) {
				const { id } = request.params;

				await request.pg.client.query(
					`UPDATE "expExecution" SET "active" = FALSE WHERE "id" = $1`,
					[ id ]);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 經費比較
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/case/expCompare',
			options: {
				description: '經費比較',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().required().description('行政區')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { zipCode } = request.query;

				const timeStart = DateTime.fromISO("2022-06-01").startOf("month").toFormat("yyyy-MM-dd");
				const timeEnd = DateTime.now().startOf("month").toFormat("yyyy-MM-dd");

				// console.log(timeStart, timeEnd);

				const { rows: result_est } = await request.pg.client.query(
					`SELECT * 
					FROM "expEstimate" 
					WHERE 
						"zip" = $1
						AND "active" = TRUE 
						AND "dataTime" >= $2 AND "dataTime" <= $3 
					ORDER BY "dataTime", "typeId"`,
					[ zipCode, timeStart, timeEnd ] );
				
				const { rows: result_exec } = await request.pg.client.query(
					`SELECT * 
					FROM "expExecution" 
					WHERE
						"zip" = $1
						AND "active" = TRUE 
						AND "dataTime" >= $2 AND "dataTime" <= $3 
					ORDER BY "dataTime", "typeId"`,
					[ zipCode, timeStart, timeEnd ] );

				return {
					statusCode: 20000,
					message: 'successful',
					data: { estList: result_est, execList: result_exec }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 巡查數量
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/case/inspectCase',
			options: {
				description: '巡查數量',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().required().description('行政區'),
						inspectType: Joi.number().required().description('巡查類型'),
						// timeStart: Joi.string().required().description('起始時間'),
						// timeEnd: Joi.string().required().description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { zipCode, inspectType } = request.query;
				const timeStart = (zipCode == 104) ? DateTime.fromISO("2022-06-01").toFormat("yyyy-MM-dd") : DateTime.fromISO("2023-02-01").toFormat("yyyy-MM-dd");
				const timeEnd = DateTime.now().toFormat("yyyy-MM-dd");

				const { rows: [{ district }] } = await request.pg.client.query(
					`SELECT "District" AS "district" FROM "public"."unitZip" WHERE "zipCode" = $1 `,
					[ zipCode ]);

				await sql.connect(sqlConfig_1);

				const { recordsets: [ result ] } = await sql.query
					`SELECT
							distressType.BTName AS caseName,
							COUNT ( caseList.SerialNo ) AS total
						FROM
							tbl_case AS caseList
							INNER JOIN tbl_BType AS distressType ON caseList.BType = distressType.SerialNo 
							INNER JOIN tbl_block AS blockList ON caseList.bsn = blockList.serialno
						WHERE
							caseList.RecControl = '1' 
							AND caseList.caseno = caseList.recaseno 
							AND blockList.dteam IN ( '41', '81', '91', '71', '72' )
							AND blockList.TBName = ${district}
							AND caseList.RoadType = ${inspectType} 
							AND CAST ( caseList.CaseDate AS datetime ) >= ${timeStart} AND CAST ( caseList.CaseDate AS datetime ) < ${timeEnd}
						GROUP BY distressType.BTName
						ORDER BY total DESC`;

				sql.close();

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		/* Router End */   
	},
};
