'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const { DateTime, Interval } = require("luxon");

const authStrategy = false;
//const authStrategy = 'simple';

const sql = require('mssql');
const snLimit = 4868469; // 2022/5/1之後的案件

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
	name: 'dispatchV0',
	version: '0.0.0',
	register: async function (server, options) {

		// ----------------------------------------------------------------------------------------------------
		// 案件檢視
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatchV0/detail',
			options: {
				description: '案件檢視',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						SerialNo: Joi.number().required().description("tbl_case serialno"),
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { SerialNo } = request.query;

				await sql.connect(sqlConfig_1);

				//TODO: 設施種類: 熱再生、設施、標線
				const { recordsets: [result] } = await sql.query
					`SELECT
						caseType.casetype,
						caseList.SerialNo,
						caseList.CaseSN,
						caseList.paperkind,
						caseList.run1tflag,
						blockList.TBName,
						caseList.lining,
						caseList.succ,
						caseList.CaseNo,
						tbl_User.[姓名] AS reporter,
						caseList.CaseName,
						caseList.CType0,
						caseList.CType0date,
						caseList.SCType1Flag,
						caseList.CType1,
						caseList.CType1date,
						caseList.CType2,
						caseList.CType2date,
						caseList.page4t,
						caseList.SCType2Flag,
						caseList.CType4,
						caseList.CType4date,
						caseList.RoadType,
						deviceType.DName,
						distressType.BTName,
						caseList.BrokeType,
						caseList.acsum0,
						caseList.delmuch0,
						caseList.delmuch,
						caseList.CaseDate,
						caseList.XX,
						caseList.YY,
						caseList.PicPath1,
						caseList.PicPath3
					FROM
						tbl_case AS caseList
						LEFT JOIN tbl_casetype AS caseType ON caseList.CaseType = caseType.seq
						LEFT JOIN tbl_BType AS distressType ON caseList.BType = distressType.SerialNo
						LEFT JOIN tbl_DeviceType AS deviceType ON caseList.devicetype = deviceType.serialno
						LEFT JOIN tbl_block AS blockList ON caseList.bsn = blockList.serialno
						LEFT JOIN tbl_User ON caseList.UserSN = tbl_User.SerialNo
					WHERE caseList.SerialNo = ${SerialNo}`;

				sql.close();

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 計價套組
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatchV0/kit',
			options: {
				description: '計價套組',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						dteamSN: Joi.string().required().description("Dteam serialno"),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { dteamSN, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				await sql.connect(sqlConfig_1);

				const { recordsets: [result] } = await sql.query
					`SELECT 
						serialno,
						組套名稱 AS kitName,
						reccreatetime,
						設計施作數量 AS kitNumber,
						設計施工方式 AS kitMethod,
						設計施作人力 AS kitLabor
					FROM 設施組套
					WHERE 
						reccontrol='1' 
						AND dteam = ${dteamSN} 
					ORDER BY reccreatetime
					OFFSET ${offset} ROWS
					FETCH NEXT ${pageSize} ROWS ONLY`;

				const { recordsets: [[{ total }]] } = await sql.query
					`SELECT 
						COUNT(serialno) AS total
					FROM 設施組套 
					WHERE 
						reccontrol='1' 
						AND dteam = ${dteamSN}`;

				sql.close();

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result, total: total }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatchV0/kitDetail',
			options: {
				description: '計價套組詳細',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						kitSN: Joi.string().required().description("設施組套 serialno")
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { kitSN } = request.query;

				await sql.connect(sqlConfig_1);

				const { recordsets: [result] } = await sql.query
					`SELECT DISTINCT
						設施組套詳細.serialno,
						設施組套詳細.項次 AS itemId,
						估驗詳細表.工程項目 AS itemName,
						估驗詳細表.單位 AS unit,
						估驗詳細表.單價 AS uPrice,
						設施組套詳細.數量 AS number,
						估驗詳細表.項次排序 AS itemOrder
					FROM
						估驗詳細表
						RIGHT OUTER JOIN 設施組套詳細 ON (估驗詳細表.項次 = 設施組套詳細.項次 AND 估驗詳細表.dteam = 設施組套詳細.dteam)
					WHERE
						設施組套詳細.項次 IS NOT NULL
						AND 設施組套詳細.reccontrol = '1' 
						AND 設施組套詳細.組套序號 = ${kitSN}
					ORDER BY 估驗詳細表.項次排序`;

				sql.close();

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});


		// ----------------------------------------------------------------------------------------------------
		// 派工管理
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/dispatchV0/list',
			options: {
				description: '主任分派列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						dteamSN: Joi.string().default("").description("Dteam serialno"),
						reportSN: Joi.string().default("").description("通報單號"),
						keywords: Joi.string().default("").description("地點關鍵字"),
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { dteamSN, reportSN, keywords, deviceType, timeStart, timeEnd } = request.query;

				let sqlCMD_dType = "";
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_dType =
							` AND caseList.roadtype = '1'
							AND caseList.recoverflag = '0'
							AND caseList.sctype1flag NOT IN ( '1', '2', '3' ) 
							AND caseList.casesn <> '0'
							AND ( caseList.paperflag= '1' OR ( caseList.paperflag= '0' AND caseList.casetype= '5' ) ) 
							AND caseList.devicetype <> '5' 
							AND caseList.paperkind IN ( '1', '2', '3', '5' ) 
							AND caseList.btype NOT IN ( '20', '23' )  `;
						break;
					case 2:	// 熱再生
						sqlCMD_dType =
							` AND caseList.roadtype = '1'
							AND caseList.recoverflag = '2'
							AND caseList.sctype1flag NOT IN ( '1', '2', '3' ) 
							AND caseList.casesn <> '0' 
							AND ( caseList.paperflag= '1' OR ( caseList.paperflag= '0' AND caseList.casetype= '5' ) ) 
							AND caseList.devicetype <> '5' 
							AND caseList.paperkind IN ( '1', '2', '3', '5', '7' ) 
							AND caseList.btype NOT IN ( '20', '23' )  `;
						break;
					case 3:	// 設施
						sqlCMD_dType =
							` AND caseList.roadtype IN (2, 3)
							AND caseList.recoverflag = '0'
							AND caseList.sctype1flag = '0'
							AND ( ( caseList.paperflag = '1' ) OR ( caseList.btype = '20' AND caseList.paperflag = '0' ) )  `;
						break;
					case 4:	// 標線
						sqlCMD_dType =
							` AND caseList.sctype1flag NOT IN ( '2', '3' ) 
							AND caseList.casesn <> '0' 
							AND ( caseList.paperflag= '1' OR ( caseList.paperflag= '0' AND caseList.casetype= '5' ) ) 
							AND markline.casecsn IS NOT NULL`;
						break;
				}

				let sqlCMD_filter = "";
				if (dteamSN.length != 0) sqlCMD_filter += ` AND caseList.BSN IN (SELECT serialno from tbl_block where dteam = '${dteamSN}') `;
				if (reportSN.length != 0) sqlCMD_filter += ` AND caseList.succ = '${reportSN}' `;
				if (keywords.length != 0) sqlCMD_filter += ` AND caseList.CaseName LIKE '%${keywords}%' `;

				await sql.connect(sqlConfig_1);

				const sqlCMD = `SELECT DISTINCT
						caseList.SerialNo,
						caseList.CaseName,
						caseList.accountflag0,
						caseList.account0,
						caseList.acsum0,
						caseList.CaseSN,
						caseList.CaseNo,
						caseList.elength,
						caseList.devicetype,
						caseList.blength,
						caseList.CaseDate,
						caseList.acrendate AS estFinishDate, 
						caseList.CloseDate,
						caseList.page2t,
						caseList.c5type,
						deviceType.DName,
						blockList.TBName,
						caseType.CaseType
					FROM
						tbl_case AS caseList
						LEFT JOIN tbl_casetype AS caseType ON caseList.casetype = caseType.seq
						LEFT JOIN tbl_DeviceType AS deviceType ON caseList.DeviceType = deviceType.SerialNo
						LEFT JOIN tbl_block AS blockList ON caseList.bsn = blockList.serialno
						LEFT JOIN tbl_sctype2num0 AS markline ON markline.casecsn = caseList.SerialNo
					WHERE
						caseList.SerialNo >= ${snLimit}
						AND caseList.ctype0= '0'
						AND caseList.ctype1= '0'
						AND caseList.ctype1f <> '1'
						AND caseList.ctype2 <> '1'
						AND caseList.reccontrol= '1' 
						AND caseList.casetype <> '5'
						AND caseList.recaseno = caseList.caseno 
						${sqlCMD_dType}
						${sqlCMD_filter}
						AND CAST ( caseList.CaseDate AS datetime ) >= '${timeStart}' AND CAST ( caseList.CaseDate AS datetime ) < '${timeEnd}'
					ORDER BY caseList.casename`;

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
		server.route({
			method: 'GET',
			path: '/dispatchV0/jobTicket',
			options: {
				description: '廠商派工單列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						dteamSN: Joi.string().default("").description("Dteam serialno"),
						reportSN: Joi.string().default("").description("通報單號"),
						keywords: Joi.string().default("").description("地點關鍵字"),
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線"),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { dteamSN, reportSN, keywords, deviceType, timeStart, timeEnd } = request.query;

				//TODO: 設施種類: 設施、標線
				let sqlCMD_dType = "";
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_dType =
							` AND (
								(caseList.devicetype <> '4' AND caseList.btype IN ( '20', '23' ) )
								OR (
									caseList.roadtype = '1'
									AND caseList.devicetype <> '4'
									AND caseList.recoverflag = '0'
									AND ( caseList.paperflag= '1' OR ( caseList.paperflag= '0' AND caseList.casetype= '5' ) ) 
								)
							) `;
						break;
					case 2:	// 熱再生
						sqlCMD_dType =
							` AND caseList.roadtype = '1'
							AND CType4 = '0'
							AND caseList.recoverflag = '2'
							AND caseList.casesn <> '0' 
							AND caseList.devicetype <> '5' `;
						break;
					case 3:	// 設施
						// sqlCMD_dType =
						// 	` AND caseList.roadtype IN (2, 3)
						// 	AND caseList.recoverflag = '0'
						// 	AND caseList.sctype1flag = '0'
						// 	AND ( ( caseList.paperflag = '1' ) OR ( caseList.btype = '20' AND caseList.paperflag = '0' ) )  `;
						break;
					case 4:	// 標線
						// sqlCMD_dType =
						// 	` AND caseList.sctype1flag NOT IN ( '2', '3' ) 
						// 	AND caseList.casesn <> '0' 
						// 	AND ( caseList.paperflag= '1' OR ( caseList.paperflag= '0' AND caseList.casetype= '5' ) ) 
						// 	AND markline.casecsn IS NOT NULL`;
						break;
				}

				let sqlCMD_filter = "";
				if (dteamSN.length != 0) sqlCMD_filter += ` AND caseList.BSN IN (SELECT serialno from tbl_block where dteam = '${dteamSN}') `;
				if (reportSN.length != 0) sqlCMD_filter += ` AND caseList.succ = '${dteamSN}' `;
				if (keywords.length != 0) sqlCMD_filter += ` AND caseList.CaseName LIKE '%${keywords}%' `;

				await sql.connect(sqlConfig_1);

				const sqlCMD = `SELECT DISTINCT
						caseList.SerialNo,
						caseList.SystemNo,
						caseList.CaseSN,
						caseList.CaseNo,
						caseList.lining,
						caseList.CaseName,
						caseList.CType0date AS assignDate,
						caseList.acrendate AS estFinishDate, 
						caseList.accountflag0,
						caseList.account0,
						caseList.acsum0,
						caseList.delmuch0,
						caseList.elength,
						caseList.wcsn0 AS company,
						caseList.devicetype,
						caseList.blength,
						caseList.CaseDate,
						caseList.CloseDate,
						caseList.page2t,
						caseList.c5type,
						caseList.PicPath3,
						deviceType.DName,
						distressType.BTName,
						blockList.TBname,
						caseType.CaseType
					FROM
						tbl_case AS caseList
						LEFT JOIN tbl_casetype AS caseType ON caseList.casetype = caseType.seq
						LEFT JOIN tbl_BType AS distressType ON caseList.BType = distressType.SerialNo
						LEFT JOIN tbl_DeviceType AS deviceType ON caseList.DeviceType = deviceType.SerialNo
						LEFT JOIN tbl_block AS blockList ON caseList.bsn = blockList.serialno
						LEFT JOIN tbl_sctype2num0 AS markline ON markline.casecsn = caseList.SerialNo
						INNER JOIN 派工審核 AS assignCase ON caseList.SerialNo = assignCase.csn
					WHERE
						caseList.SerialNo >= ${snLimit}
						AND caseList.ctype0 = '1'
						AND caseList.ctype1 = '0'
						AND caseList.ctype1f <> '1'
						AND caseList.ctype2 = '0'
						AND caseList.reccontrol = '1' 
						AND picpath3 <> '0' 
						AND caseList.recaseno = caseList.caseno 
						${sqlCMD_dType}
						${sqlCMD_filter}
						AND CAST ( caseList.CType0date AS datetime ) >= '${timeStart}' AND CAST ( caseList.CType0date AS datetime ) < '${timeEnd}'
					ORDER BY caseList.CType0date`;

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
		server.route({
			method: 'GET',
			path: '/dispatchV0/finRegister',
			options: {
				description: '完工登錄列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						dteamSN: Joi.string().default("").description("Dteam serialno"),
						dispatchSN: Joi.string().default("").description("派工單號"),
						keywords: Joi.string().default("").description("地點關鍵字"),
						deviceType: Joi.number().required().description("維護類型- 1: 道路, 2: 熱再生, 3: 設施, 4: 標線")
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { dteamSN, dispatchSN, keywords, deviceType } = request.query;

				//TODO: 設施種類(需驗證)
				let sqlCMD_dType = "";
				switch (deviceType) {
					case 1: // 道路
						sqlCMD_dType = ` AND caseList.RoadType = '1' AND caseList.CType4 = '0'`;
						break;
					case 2:	// 熱再生
						sqlCMD_dType = ` AND caseList.RoadType = '1' AND caseList.CType4 IN ('2', '3') `;
						break;
					case 3:	// 設施
						sqlCMD_dType = ` AND caseList.RoadType = '2' `;
						break;
					case 4:	// 標線
						sqlCMD_dType = ` AND caseList.SCType1Flag IN ( '2', '3' ) `;
						break;
				}

				let sqlCMD_filter = "";
				if (dteamSN.length != 0) sqlCMD_filter += ` AND caseList.BSN IN (SELECT serialno from tbl_block where dteam = '${dteamSN}') `;
				if (dispatchSN.length != 0) {
					const firstLettr = dispatchSN.substring(0, 1);
					switch(firstLettr) {
						case "Y":
							sqlCMD_filter += ` AND caseList.SCType1No = '${dispatchSN}' `;
							break;
						case "Z":
						case "H":
							sqlCMD_filter += ` AND caseList.CType4No = '${dispatchSN}' `;
							break;
						case "P": //TODO: 塗佈待補
							// sqlCMD_filter += ` AND caseList.CType1NO = '${dispatchSN}' `;
							break;
						case "W":
						default:
							sqlCMD_filter += ` AND caseList.CType1NO = '${dispatchSN}' `;
							break;
					}
				}
				if (keywords.length != 0) sqlCMD_filter += ` AND caseList.CaseName LIKE '%${keywords}%' `;

				await sql.connect(sqlConfig_1);

				const sqlCMD = `SELECT DISTINCT
						caseList.SerialNo,
						caseList.SystemNo,
						caseList.CaseSN,
						caseList.CaseNo,
						caseList.CType1NO,
						caseList.CType4No,
						caseList.SCType1No,
						caseList.CaseName,
						caseList.SCType1Flag,
						caseList.wcsn0 AS company,
						caseList.elength1,
						caseList.blength1,
						caseList.acsum,
						caseList.accountflag,
						caseList.account,
						caseList.delmuch,
						caseList.workmemo,
						caseList.ins1,
						caseList.ins2,
						caseList.checklai,
						caseList.checklaitype,
						caseList.checklaivalue,
						caseList.checklaitype1,
						caseList.checklai2,
						caseList.checklai2type,
						caseList.checklai2value,
						caseList.checklai2type1,
						caseList.devicetype,
						caseList.CaseDate,
						caseList.CType0date,
						caseList.CloseDate,
						caseList.c5type,
						deviceType.DName,
						distressType.BTName,
						blockList.TBname,
						caseType.CaseType
					FROM
						tbl_case AS caseList
						LEFT JOIN tbl_casetype AS caseType ON caseList.casetype = caseType.seq
						LEFT JOIN tbl_BType AS distressType ON caseList.BType = distressType.SerialNo
						LEFT JOIN tbl_DeviceType AS deviceType ON caseList.DeviceType = deviceType.SerialNo
						LEFT JOIN tbl_block AS blockList ON caseList.bsn = blockList.serialno
						LEFT JOIN tbl_sctype2num0 AS markline ON markline.casecsn = caseList.SerialNo
					WHERE
						caseList.SerialNo >= ${snLimit}
						AND caseList.CType0 = '1'
						AND caseList.CType1 = '1'
						AND caseList.CType1 = '1'
						AND caseList.reccontrol = '1' 
						AND caseList.recaseno = caseList.caseno 
						${sqlCMD_dType}
						${sqlCMD_filter}
					ORDER BY caseList.CType0date`;

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

		/* Router End */
	},
};
