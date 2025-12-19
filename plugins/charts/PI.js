'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const { DateTime, Interval } = require("luxon");
const superagent = require("superagent");
const sharp = require('sharp');

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
	name: 'PI',
	version: '0.0.0',
	register: async function (server, options) {
		// ----------------------------------------------------------------------------------------------------
		// 案件稽核
		// ----------------------------------------------------------------------------------------------------
		// 案件列表(rm100、postgres)
		server.route({
			method: 'GET',
			path: '/PI/caseList',
			options: {
				description: '案件稽核列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						isList: Joi.bool().default(true).description('是否為列表: 案件列表(true) / 案件上傳(false)'),
						filterType: Joi.number().allow(1,2).default(1).description('1: 成案日期(CaseDate); 2: 通報日期(ReportDate)'),
						caseType: Joi.number().allow(1, 2).default(1).description('1: 廠商自巡; 2: 其他'),
						zipCode: Joi.number().required().description('行政區'), 
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { isList, filterType, caseType, zipCode, timeStart, timeEnd } = request.query;
				// const timeStart = DateTime.fromISO("2022-06-01").toFormat("yyyy-MM-dd");
				// const timeEnd = DateTime.now().toFormat("yyyy-MM-dd");

				// if (sqlCMD.length == 0) return Boom.notAcceptable('type is invalid');
				// console.log(sqlCMD);
				const dateStart = DateTime.fromFormat(timeStart, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');
				const dateEnd = DateTime.fromFormat(timeEnd, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');

				const sqlCMD_DateCol = (filterType == 1) ? "CaseDate" : "ReportDate";
				const sqlCMD1_Filter_PG1 = (caseType == 1) ? `AND "DistressSrc" = '廠商' ` : `AND "DistressSrc" != '廠商' `;

				const { rows: result_gcp1 } = await request.pg.client.query(
					`SELECT * FROM "PICaseList" 
					WHERE 
						"Active" = TRUE 
						${sqlCMD1_Filter_PG1}
						AND "zip" = $1 
						AND "${sqlCMD_DateCol}" >= $2 AND "${sqlCMD_DateCol}" < $3 
					ORDER BY "UploadCaseNo"`,
					[ zipCode, dateStart, dateEnd ]);

				if (isList) {
					const sqlCMD1_Filter_PG2 = (caseType == 1) ? `AND (("State" & 32)::boolean OR ("State" & 64)::boolean) ` : `AND (("State" & 2)::boolean OR ("State" & 4)::boolean) `;

					const { rows: result_gcp2 } = await request.pg.client.query(
						`SELECT * FROM "PICaseList" 
						WHERE 
							"Active" = TRUE 
							${sqlCMD1_Filter_PG1}
							AND "zip" = $1 
							AND "${sqlCMD_DateCol}"  >= $2 AND "${sqlCMD_DateCol}" < $3  
							${sqlCMD1_Filter_PG2}
						ORDER BY "UploadCaseNo"`,
						[ zipCode, dateStart, dateEnd ]);
					
					return {
						statusCode: 20000,
						message: 'successful',
						data: { list: result_gcp1, resultList: result_gcp2 }
					};
				}

				const { rows: [{ district }] } = await request.pg.client.query(
					`SELECT "District" AS "district" FROM "public"."unitZip" WHERE "zipCode" = $1 `,
					[ zipCode ]);

				const sqlCMD_Filter_MS = (caseType == 1) ? `AND caseList.CaseType =  '4'` : `AND caseList.CaseType != '4' `;

				await sql.connect(sqlConfig_1);

				const sqlCMD = `SELECT 
					caseList.SerialNo AS CaseSN,
					(CASE WHEN caseList.CaseType != '4' THEN caseList.CaseNo ELSE uploadOffice.新工處編號2 END) AS UploadCaseNo,
					(CASE WHEN caseList.CaseType != '4' AND LEN(exportOffice.來源編號) != 0 THEN exportOffice.來源編號 ELSE caseList.CaseNo END) AS CaseNo,
					COALESCE(expan.organ_assign, 0) AS organAssign,
					caseList.CaseName,
					caseList.CaseDate,
					caseList.RoadType,
					caseList.DeviceType,
					caseType.casetype AS DistressSrc,
					deviceType.DName,
					caseList.BrokeType,
					caseList.BType,
					distressType.BTName,
					caseList.YY AS lat,
					caseList.XX AS lng,
					1 AS IsObserve
				FROM
					tbl_case AS caseList
					LEFT JOIN tbl_case_expan AS expan ON expan.casecsn = caseList.SerialNo
					LEFT JOIN tbl_casetype AS caseType on caseList.CaseType = caseType.seq
					LEFT JOIN tbl_DeviceType AS deviceType ON caseList.DeviceType = deviceType.SerialNo
					LEFT JOIN tbl_BType AS distressType ON caseList.BType = distressType.SerialNo
					LEFT JOIN tbl_block AS blockList ON blockList.serialno = caseList.bsn 
					LEFT JOIN net_updateR AS uploadOffice ON caseList.SerialNo = uploadOffice.casecsn
					LEFT JOIN 新工處匯出 AS exportOffice ON caseList.CaseNo = exportOffice.案件編號
				WHERE
					caseList.SerialNo >= ${snLimit}
					AND caseList.RecControl = '1' 
					AND caseList.caseno = caseList.recaseno 
					AND blockList.dteam IN ( '41', '81', '91', '71', '72' ) 
					${sqlCMD_Filter_MS}
					AND blockList.TBName = '${district}'
					AND caseList.RoadType IN ( '1', '2' )
					AND CAST ( caseList.CaseDate AS datetime ) >= dateadd(hour,8,'${dateStart}') AND CAST ( caseList.CaseDate AS datetime ) < dateadd(hour,8,'${dateEnd}')
				ORDER BY caseList.CaseNo, caseList.SystemNo`;
				console.log(sqlCMD);
				const { recordsets: [ result_rm ] } = await sql.query(sqlCMD);
				sql.close();

				// NOTE: 找出未上傳案件
				const uploadedIdList = result_gcp1.map(caseSpec => Number(caseSpec.UploadCaseNo));
				const rmCaseListFilter = result_rm.filter(caseSpec => !uploadedIdList.includes(Number(caseSpec.UploadCaseNo)));

				return { 
					statusCode: 20000,
					message: 'successful',
					data: { list: rmCaseListFilter, uploadedIdList }
				};
			},
		});
		
		// ----------------------------------------------------------------------------------------------------
		// 案件上傳
		server.route({
			method: 'POST',
			path: '/PI/caseList',
			options: {
				description: '案件稽核列表(新增)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						zipCode: Joi.number().required().description('行政區'), 
						caseList: Joi.array().min(1).items(Joi.object({
							UploadCaseNo: Joi.number().required().description("新工處 案件編號"),
							DistressSrc: Joi.string().required().description("新工處 查報來源"),
							CaseSN: Joi.number().default(0).description("tbl_case SerialNo"),
							CaseDate: Joi.string().required().description("tbl_case 查報日期"),
							ReportDate: Joi.string().required().description("通報日期 (認列日期)"),							
							DeviceType: Joi.number().required().description("tbl_case 設施類型"),
							rDeviceType: Joi.number().required().description("設施類型 (廠商認列)"),
							organAssign: Joi.number().allow(0, 1).default(0).description("tbl_case_expan 是否交辦"),
							IsObserve: Joi.number().allow(0, 1).default(0).description("tbl_case_expan 是否交辦"),
							CaseName: Joi.string().required().description("tbl_case 查報地點"),
							CaseNo: Joi.string().required().description("來源編號(自巡-tbl_case 案件編號)"),
							BType: Joi.number().required().description("tbl_case 損壞態樣"),
							BrokeType: Joi.number().required().description("tbl_case 損壞程度"),
							CaseType: Joi.string().required().description("新工處 損壞情況"),
							lat: Joi.number().default(0).description("tbl_case 案件緯度(lat)"),
							lng: Joi.number().default(0).description("tbl_case 案件緯度(lng)"),
						}))
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { zipCode, caseList } = request.payload;
				
				let sqlCMD_list = "";
				for (const caseItem of caseList) {
					caseItem.State = (caseItem.DistressSrc == '廠商') ? 1 : 0;
					caseItem.DuplicateCase = (caseItem.DistressSrc == '廠商') ? caseItem.CaseNo : '';

					caseItem.geoJSON = { type: "Point", coordinates: [ caseItem.lng, caseItem.lat ]};
					sqlCMD_list += `(${zipCode}, ${caseItem.UploadCaseNo}, '${caseItem.DistressSrc}', ${caseItem.CaseSN}, '${caseItem.CaseDate}', '${caseItem.ReportDate}', '${caseItem.DeviceType}', '${caseItem.rDeviceType}', '${caseItem.organAssign}', '${caseItem.IsObserve}', '${caseItem.CaseName}', '${caseItem.CaseNo}', '${caseItem.BType}', '${caseItem.BrokeType}', '${caseItem.CaseType}', '${caseItem.State}', '${caseItem.DuplicateCase}', ST_GeomFromGeoJSON('${JSON.stringify(caseItem.geoJSON)}'), NOW(), 0),`;
				}
				sqlCMD_list = sqlCMD_list.replace(/,$/, "");

				// console.log(sqlCMD_list);
				await request.pg.client.query(`INSERT INTO "PICaseList" ("zip", "UploadCaseNo", "DistressSrc", "CaseSN", "CaseDate", "ReportDate", "DeviceType", "rDeviceType", "organAssign", "IsObserve", "CaseName", "CaseNo", "BType", "BrokeType", "CaseType", "State", "DuplicateCase", "wkb_geometry", "CreatedAt", "OperatorId") VALUES ${sqlCMD_list}`);

				server.methods.insert.PICaseMap(request.pg.client, caseList, zipCode);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});
		
		// ----------------------------------------------------------------------------------------------------
		// 提交結果
		server.route({
			method: 'PUT',
			path: '/PI/caseList/{id}',
			options: {
				description: '案件稽核列表(修改/提交結果)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					payload: Joi.object({
						zipCode: Joi.number().required().description('行政區'), 
						rDeviceType: Joi.number().default(0).description("設施類型 (廠商認列)"),
						organAssign: Joi.number().allow(0, 1).default(0).description("是否交辦"),
						BType: Joi.number().default(0).description("損壞態樣"),
						BrokeType: Joi.number().allow(1, 2, 3).default(0).description("損壞程度"),
						PCIValue: Joi.number().min(0).max(100).description("PCI值"),
						State: Joi.number().allow(0, 1).default(0).description("廠商判定不合理(0: 正常; 1: 廠商判定不合理)"),
						StateNotes: Joi.string().allow('').description("狀態說明(主要用於記錄不合理原因)"),
						DuplicateCase: Joi.string().allow('').default('').description("佐證案件 (重複案件編號)")
					})
				}
			},
			handler: async function (request, h) {
				const { id } = request.params;
				const { zipCode, rDeviceType, organAssign, BType, BrokeType, PCIValue, State, StateNotes, DuplicateCase } = request.payload;
				// console.log(`/PI/caseList/${id}`);

				// Step1: 先將之前的欄位disable
				const res = await request.pg.client.query(
					`UPDATE "PICaseList" SET "Active" = FALSE WHERE "UploadCaseNo" IN ( SELECT "UploadCaseNo" FROM "PICaseList" WHERE "id" = $1)`,
					[ id ]);
				// console.log(res.rowCount);

				// Step2: 新增
				await request.pg.client.query(
					`INSERT INTO "PICaseList" ("zip", "UploadCaseNo", "CaseSN", "CaseDate", "ReportDate", "DistressSrc", "DeviceType", "rDeviceType", "organAssign", "CaseName", "CaseNo", "BType", "BrokeType", "CaseType", "PCIValue", "State", "StateNotes", "DuplicateCase", "wkb_geometry", "CreatedAt", "OperatorId")
					(SELECT $1, "UploadCaseNo", "CaseSN", "CaseDate", "ReportDate", "DistressSrc", "DeviceType", ${rDeviceType == 0 ? '"rDeviceType"' : rDeviceType}, $2, "CaseName", "CaseNo", $3, $4, "CaseType", $5, $6, $7, $8, "wkb_geometry", NOW(), $9 FROM "PICaseList" WHERE Id = $10)`,
					[ zipCode, organAssign, BType, BrokeType, PCIValue, State, StateNotes, DuplicateCase, 0, id ]);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 刪除案件
		server.route({
			method: 'DELETE',
			path: '/PI/caseList/{id}',
			options: {
				description: '案件稽核列表(刪除)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required().description('0: 全部')
					}),
					payload: Joi.object({
						zipCode: Joi.number().required().description('行政區'), 
						opType: Joi.number().required().allow(0,1).description('操作方式 - 0: 刪除; 1: 恢復'),
						caseType: Joi.number().allow(1, 2).default(1).description('1: 廠商自巡; 2: 其他'),
						timeStart: Joi.string().allow('').default('').description('起始時間'),
						timeEnd: Joi.string().allow('').default('').description('結束時間')
					})
				}
			},
			handler: async function (request, h) {
				const { id } = request.params;
				const { zipCode, opType, caseType, timeStart, timeEnd } = request.payload;
				if (id == 0 && timeStart.length == 0 && timeEnd.length == 0) return Boom.notAcceptable("Non-allowed Method");

				const dateStart = DateTime.fromFormat(timeStart, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');
				const dateEnd = DateTime.fromFormat(timeEnd, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');

				let sqlCMD = (id == 0) ? ` WHERE "CaseDate" >= '${dateStart}' AND "CaseDate" < '${dateEnd}'` : ` WHERE "id" = ${id} `; 
				sqlCMD += (caseType == 1) ? ` AND "DistressSrc" = '廠商'` : ` AND "DistressSrc" != '廠商'`;
				sqlCMD += ` AND "zip" = ${zipCode}`;
				if(opType == 0) await request.pg.client.query(`UPDATE "PICaseList" SET "Active" = FALSE, "UpdatedAt" = NOW() ${sqlCMD}`);
				if(opType == 1) {
					await request.pg.client.query(
						`UPDATE "PICaseList" 
							SET "Active" = TRUE, "UpdatedAt" = NOW() 
							WHERE "id" IN (
								SELECT MAX("id")
								FROM "PICaseList"
								${sqlCMD}
								GROUP BY "UploadCaseNo"
							)`
					);
				}

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 案件封存
		server.route({
			method: 'PUT',
			path: '/PI/caseList',
			options: {
				description: '案件稽核列表(封存)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						zipCode: Joi.number().required().description('行政區'), 
						isArchive: Joi.boolean().default(true).description("是否封存"),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間')
					})
				}
			},
			handler: async function (request, h) {
				const { zipCode, isArchive, timeStart, timeEnd } = request.payload;
				const dateStart = DateTime.fromFormat(timeStart, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');
				const dateEnd = DateTime.fromFormat(timeEnd, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');

				await request.pg.client.query(
					`UPDATE "PICaseList" SET "Archive" = $1 WHERE "DistressSrc" = '廠商' AND "zip" = $2 AND "CaseDate" >= $3 AND "CaseDate" < $4`,
					[ isArchive, zipCode, dateStart, dateEnd ]);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 稽核結果列表
		server.route({
			method: 'GET',
			path: '/PI/checkResult',
			options: {
				description: '稽核結果',
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
				const dateStart = DateTime.fromFormat(timeStart, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');
				const dateEnd = DateTime.fromFormat(timeEnd, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');

				const { rows: [ res_summary ] } = await request.pg.client.query(
					`SELECT
						COUNT(*) AS "caseTotal",
						SUM(CASE WHEN ((("State" & 2)::boolean OR ("State" & 32)::boolean) AND "DeviceType" = 1) THEN 1 ELSE 0 END) AS "SV.AC.check",
						SUM(CASE WHEN (("State" & 32)::boolean AND "DeviceType" = 1) THEN 1 ELSE 0 END) AS "SV.AC.fail",
						SUM(CASE WHEN ((("State" & 2)::boolean OR ("State" & 32)::boolean) AND "DeviceType" != 1) THEN 1 ELSE 0 END) AS "SV.facility.check",
						SUM(CASE WHEN (("State" & 32)::boolean AND "DeviceType" != 1) THEN 1 ELSE 0 END) AS "SV.facility.fail",
						SUM(CASE WHEN ((("State" & 4)::boolean OR ("State" & 64)::boolean) AND "DeviceType" = 1) THEN 1 ELSE 0 END) AS "Organ.AC.check",
						SUM(CASE WHEN (("State" & 64)::boolean AND "DeviceType" = 1) THEN 1 ELSE 0 END) AS "Organ.AC.fail",
						SUM(CASE WHEN ((("State" & 4)::boolean OR ("State" & 64)::boolean) AND "DeviceType" != 1) THEN 1 ELSE 0 END) AS "Organ.facility.check",
						SUM(CASE WHEN (("State" & 64)::boolean AND "DeviceType" != 1) THEN 1 ELSE 0 END) AS "Organ.facility.fail"
					FROM
						"PICaseList" 
					WHERE
						"Active" = TRUE 
						AND "DistressSrc" = '廠商'
						AND "zip" = $1
						AND "ReportDate" >= $2 
						AND "ReportDate" < $3`,
					[ zipCode, dateStart, dateEnd] );

				const summary = Object.keys(res_summary).reduce((acc, curr) => {
					const [key, subKey1, subKey2] = curr.split(".");
					if (key == 'caseTotal') return acc;
					if (!acc.hasOwnProperty(key)) acc[key] = {};
					if (!acc[key].hasOwnProperty(subKey1)) acc[key][subKey1] = {};
					if (subKey1 != undefined && subKey2 == undefined) acc[key][subKey1] = res_summary[curr];
					if (subKey1 != undefined && subKey2 != undefined) acc[key][subKey1][subKey2] = res_summary[curr];

					return acc
				}, {})

				const { rows: result } = await request.pg.client.query(
					`SELECT * 
					FROM "PICaseList" 
					WHERE 
						"Active" = TRUE 
						AND "DistressSrc" = '廠商'
						AND "zip" = $1 
						AND "ReportDate" >= $2 
						AND "ReportDate" < $3 
						AND (("State" & 32)::boolean OR ("State" & 64)::boolean) 
					ORDER BY "UploadCaseNo"`,
					[ zipCode, dateStart, dateEnd ]);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result, summary, caseTotal: res_summary.caseTotal }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 案件統計數量
		server.route({
			method: 'GET',
			path: '/PI/caseCount',
			options: {
				description: '案件稽核列表統計數量',
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
				const dateStart = DateTime.fromFormat(timeStart, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');
				const dateEnd = DateTime.fromFormat(timeEnd, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');

				const { rows: [ result ] } = await request.pg.client.query(
					`SELECT
						COALESCE( SUM( CASE WHEN "DistressSrc" = '廠商' THEN 1 ELSE 0 END), 0) AS "caseTotal_report",
						COALESCE( SUM( CASE WHEN "DistressSrc" != '廠商' THEN 1 ELSE 0 END), 0) AS "caseTotal_inform",
						COALESCE( ARRAY_AGG( DISTINCT "DistressSrc") FILTER (WHERE "DistressSrc" != '廠商'), '{}') AS "caseTotal_informSrc",
						COALESCE( SUM( CASE WHEN "DistressSrc" != '廠商' AND ("State" & 16)::boolean AND "StateNotes" ->> 'Firm' != '優於民眾查報' THEN 1 ELSE 0 END ), 0 ) AS "caseTotal_unreasonable",
						COALESCE( SUM( CASE WHEN "DistressSrc" LIKE '%1999%' AND "rDeviceType" = 1 THEN 1 ELSE 0 END), 0) AS "AC1999",
						COALESCE( SUM( CASE WHEN "DistressSrc" LIKE '%1999%' AND "rDeviceType" != 1 THEN 1 ELSE 0 END), 0) AS "fac1999",
						COALESCE( SUM( CASE WHEN "DistressSrc" LIKE '%1999%' AND "rDeviceType" = 1 AND ("State" & 16)::boolean AND  "StateNotes" ->> 'Firm' != '優於民眾查報' THEN 1 ELSE 0 END), 0) AS "AC1999_unreasonable",
						COALESCE( SUM( CASE WHEN "DistressSrc" LIKE '%1999%' AND "rDeviceType" != 1 AND ("State" & 16)::boolean AND  "StateNotes" ->> 'Firm' != '優於民眾查報' THEN 1 ELSE 0 END), 0) AS "fac1999_unreasonable",
						COALESCE( SUM( CASE WHEN "DistressSrc" = '廠商' AND "rDeviceType" = 1 AND "IsObserve" = 1 THEN 1 ELSE 0 END ), 0 ) AS "ACTotal_Obs",
						COALESCE( SUM( CASE WHEN "DistressSrc" = '廠商' AND "rDeviceType" = 1 AND "IsObserve" = 0 THEN 1 ELSE 0 END ), 0 ) AS "ACTotal_Reg",
						COALESCE( SUM( CASE WHEN "DistressSrc" = '廠商' AND "rDeviceType" != 1 AND "IsObserve" = 1 THEN 1 ELSE 0 END ), 0 ) AS "facTotal_Obs",
						COALESCE( SUM( CASE WHEN "DistressSrc" = '廠商' AND "rDeviceType" != 1 AND "IsObserve" = 0 THEN 1 ELSE 0 END ), 0 ) AS "facTotal_Reg"
					FROM
						"PICaseList" 
					WHERE
						"Active" = TRUE 
						AND "zip" = $1
						AND "ReportDate" >= $2 
						AND "ReportDate" < $3`,
					[ zipCode, dateStart, dateEnd ]);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 案件稽核(環景)
		// ----------------------------------------------------------------------------------------------------
		// 案件列表(caseDistress)
		server.route({
			method: 'GET',
			path: '/PI/insCaseList',
			options: {
				description: '案件稽核列表(環景)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						surveyId: Joi.number().default(0).description("TendersSurvey id"),
						zipCode: Joi.number().default(0).description('行政區'),
						timeStart: Joi.string().allow('').default('').description('起始時間'),
						timeEnd: Joi.string().allow('').default('').description('結束時間'),
						pageCurrent: Joi.number().default(0),
						pageSize: Joi.number().default(0)
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { surveyId, zipCode, timeStart, timeEnd, pageCurrent, pageSize } = request.query;
				const dateStart = DateTime.fromFormat(timeStart, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');
				const dateEnd = DateTime.fromFormat(timeEnd, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');

				let result_gcp1 = [];
				let total = 0;
				let sqlCMD_filter = '';
				if (surveyId != 0) sqlCMD_filter += ` AND SurveyId = ${surveyId}`;
				if (zipCode != 0 && timeStart.length != 0 && timeEnd.length != 0) sqlCMD_filter += ` AND Tenders.ZipCode = ${zipCode} AND DateUpload >= '${dateStart}' AND DateUpload < '${dateEnd}'`;
					
				if(pageCurrent != 0 && pageSize != 0) {
					const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;
					// 案件列表
					[result_gcp1] = await request.tendersql.pool.execute(
						`SELECT 
							caseDistress.SerialNo,
							caseDistress.CaseNo,
							caseDistress.DateCreate,
							caseDistress.DateUpload,
							caseDistress.DeviceType,
							caseDistress.Place,
							caseDistress.DistressType,
							caseDistress.DistressLevel,
							caseDistress.ImgZoomIn,
							caseDistress.ImgZoomOut,
							IFNULL(PIState, 0) AS PIState,
							IFNULL(PIStateNotes, '{}') AS PIStateNotes,
							IFNULL(PCIValue, 0) AS PCIValue,
							IFNULL(Active, 1) AS Active,
							IFNULL(OperatorId, 0) AS OperatorId
						FROM 
							caseDistress 
							LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active = 1
						WHERE 
							NOT (IFNULL(PIState, 0) & 16)
							AND caseDistress.CaseNo != 0
							${sqlCMD_filter}
						ORDER BY CaseNo = 0, CaseNo
						LIMIT ? OFFSET ?`,
						[ String(pageSize), String(offset) ]);

					[[{ total }]] = await request.tendersql.pool.execute(
						`SELECT 
							COUNT(*) AS total 
						FROM 
							caseDistress 
							LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active = 1
						WHERE 
							NOT (IFNULL(PIState, 0) & 16)
							AND caseDistress.CaseNo != 0
							${sqlCMD_filter}`);
				}

				// 稽核結果列表
				const [ result_gcp2 ] = await request.tendersql.pool.execute(
					`SELECT 
						caseDistress.SerialNo,
						caseDistress.CaseNo,
						caseDistress.DateCreate,
						caseDistress.DateUpload,
						caseDistress.DeviceType,
						caseDistress.Place,
						caseDistress.DistressType,
						caseDistress.DistressLevel,
						IFNULL(PIState, 0) AS PIState,
						IFNULL(PIStateNotes, '{}') AS PIStateNotes,
						IFNULL(PCIValue, 0) AS PCIValue,
						IFNULL(Active, 1) AS Active,
						IFNULL(OperatorId, 0) AS OperatorId
					FROM 
						caseDistress
						LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active = 1
						LEFT JOIN TendersSurvey ON TendersSurvey.id = caseDistress.surveyId
						LEFT JOIN Tenders ON Tenders.tenderId = TendersSurvey.tenderId
					WHERE 
						NOT (IFNULL(PIState, 0) & 16)
						AND ((PIState & 32) OR (PIState & 64)) 
						AND caseDistress.CaseNo != 0
						${sqlCMD_filter}
					ORDER BY CaseNo`);
					
				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result_gcp1, total, resultList: result_gcp2 }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 提交結果(caseDistress)
		server.route({
			method: 'PUT',
			path: '/PI/insCaseList/{id}',
			options: {
				description: '案件稽核列表(環景)(修改/提交結果)',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					payload: Joi.object({
						PCIValue: Joi.number().min(0).max(100).description("PCI值"),
						PIState: Joi.number().allow(0, 1).default(0).description("廠商判定不合理(0: 正常; 1: 廠商判定不合理)"),
						PIStateNotes: Joi.string().allow('').description("狀態說明(主要用於記錄不合理原因)")
					})
				}
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { id } = request.params;
				const { PCIValue, PIState, PIStateNotes } = request.payload;

				// Step1: 先將之前的欄位disable
				const [ res ] = await request.tendersql.pool.execute(
					`UPDATE caseDistressPI SET Active = 0 WHERE caseSID = ?`,
					[ id ]);
				// console.log(res.affectedRows);

				// Step2: 新增
				await request.tendersql.pool.execute(
					`INSERT INTO caseDistressPI (caseSID, PIState, PIStateNotes, PCIValue, OperatorId)
					VALUES (?, ?, ?, ?, ?)`,
					[ id, PIState, PIStateNotes, PCIValue, uid ]);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 案件統計數量
		server.route({
			method: 'GET',
			path: '/PI/insCaseCount',
			options: {
				description: '案件稽核列表(環景)統計數量',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						surveyId: Joi.number().required().description("TendersSurvey id")
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { surveyId } = request.query;

				const [[ result ]] = await request.tendersql.pool.execute(
					`SELECT
						IFNULL( SUM( CASE WHEN (((PIState & 2) OR (PIState & 32)) AND DeviceType = 1 ) THEN 1 ELSE 0 END), 0) AS "SV_AC_check",
						IFNULL( SUM( CASE WHEN ((PIState & 32) AND DeviceType = 1) THEN 1 ELSE 0 END), 0) AS "SV_AC_fail",
						IFNULL( SUM( CASE WHEN (((PIState & 2) OR (PIState & 32)) AND DeviceType != 1 ) THEN 1 ELSE 0 END), 0) AS "SV_facility_check",
						IFNULL( SUM( CASE WHEN ((PIState & 32) AND DeviceType != 1) THEN 1 ELSE 0 END), 0) AS "SV_facility_fail",
						IFNULL( SUM( CASE WHEN (((PIState & 4) OR (PIState & 64)) AND DeviceType = 1 ) THEN 1 ELSE 0 END), 0) AS "Organ_AC_check",
						IFNULL( SUM( CASE WHEN ((PIState & 64) AND DeviceType = 1) THEN 1 ELSE 0 END), 0) AS "Organ_AC_fail",
						IFNULL( SUM( CASE WHEN (((PIState & 4) OR (PIState & 64)) AND DeviceType != 1 ) THEN 1 ELSE 0 END), 0) AS "Organ_facility_check",
						IFNULL( SUM( CASE WHEN ((PIState & 64) AND DeviceType != 1) THEN 1 ELSE 0 END), 0) AS "Organ_facility_fail"
					FROM 
						caseDistress 
						LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active = 1
					WHERE 
						NOT (IFNULL(PIState, 0) & 16)
						AND SurveyId = ?`,
					[ surveyId ]);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { result }
				};
			},
		});
		
		// ----------------------------------------------------------------------------------------------------
		// 保固案件列表
		// ----------------------------------------------------------------------------------------------------
		// 保固案件列表 (PI4.2)
		server.route({
			method: 'GET',
			path: '/PI/caseWarrantyList',
			options: {
				description: '保固案件列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().required().description('行政區'),
						caseType: Joi.number().required().description("案件種類(2: 派工; 4: 保固)"),
						filter: Joi.boolean().default(false).description("是否篩選「已刪除」"),
						filterType: Joi.number().default(1).description('篩選類型 - 1: 保固日期(之後); 2: 預計完工日期(區間)'),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().allow('').required().description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { zipCode, caseType, filter, filterType, timeStart, timeEnd } = request.query;
				// const dateStart = DateTime.fromFormat(timeStart, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');
				// const dateEnd = DateTime.fromFormat(timeEnd, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');
				

				const sqlCMD = (filterType == 1) 
					? `AND "DateWarranty" >= '${timeStart}' ` 
					: `AND "DateDeadline" >= '${timeStart}' AND "DateDeadline" < '${timeEnd}' `;

				const { rows: result } = await request.pg.client.query(
					`SELECT * FROM "PICaseWarranty" 
					WHERE 
						"Active" = $1
						AND ("State" & $2)::boolean
						AND "Zip" = $3
						${sqlCMD}
					ORDER BY "DateDeadline", "DateWarranty"`,
					[ !filter, caseType, zipCode ]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// 案件上傳
		server.route({
			method: 'POST',
			path: '/PI/caseWarrantyList',
			options: {
				description: '保固案件列表(新增/修改)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						zipCode: Joi.number().required().description('行政區'),
						caseList: Joi.array().min(1).items(Joi.object({
							UploadCaseNo: Joi.number().required().description("新工處 案件編號"),
							DistressSrc: Joi.string().required().description('查報來源'),
							CaseDate: Joi.string().required().description("查報日期"),
							Place: Joi.string().required().description("查報地點"),
							State: Joi.number().required().description("狀態(1: 成案; 2: 派工, 4: 保固)"),
							DeviceType: Joi.string().required().description("設施類型"),
							DistressType: Joi.string().required().description("損壞情形"),
							DistressTypeR: Joi.string().required().description("缺失種類(認列)"),
							DistressLevel: Joi.string().required().description("損壞狀況"),
							DateDeadline: Joi.string().required().description("預計完工日期"),
							DateCompleted: Joi.string().required().description("實際完工日期"),
							DateWarranty: Joi.string().allow('').default('').description("保固日期")
						}))
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { zipCode, caseList } = request.payload;

				let sqlCMD_list = "";
				for (const caseItem of caseList) {
					sqlCMD_list += `(${zipCode}, ${caseItem.UploadCaseNo}, '${caseItem.DistressSrc}', '${caseItem.CaseDate}', '${caseItem.Place}', ${caseItem.State}, '${caseItem.DeviceType}', '${caseItem.DistressType}', '${caseItem.DistressTypeR}', '${caseItem.DistressLevel}', '${caseItem.DateDeadline}', '${caseItem.DateCompleted}', `+ (caseItem.DateWarranty.length == 0 ? 'NULL' : `'${caseItem.DateWarranty}'`) + `, 0),`;
				}
				sqlCMD_list = sqlCMD_list.replace(/,$/, "");

				// console.log(sqlCMD_list);
				await request.pg.client.query(
					`INSERT INTO "PICaseWarranty" ("Zip", "UploadCaseNo", "DistressSrc", "CaseDate", "Place", "State", "DeviceType", "DistressType", "DistressTypeR", "DistressLevel", "DateDeadline", "DateCompleted", "DateWarranty", "OperatorId") 
					VALUES ${sqlCMD_list}
					ON CONFLICT ("UploadCaseNo")
					DO UPDATE SET 
						"DistressSrc" = EXCLUDED."DistressSrc", "CaseDate" = EXCLUDED."CaseDate", "Place" = EXCLUDED."Place", "State" = EXCLUDED."State",
						"DeviceType" = EXCLUDED."DeviceType", "DistressType" = EXCLUDED."DistressType", "DistressTypeR" = EXCLUDED."DistressTypeR", 
						"DistressLevel" = EXCLUDED."DistressLevel", "DateDeadline" = EXCLUDED."DateDeadline", "DateCompleted" = EXCLUDED."DateCompleted", 
						"DateWarranty" = EXCLUDED."DateWarranty", "OperatorId" = EXCLUDED."OperatorId", "Zip" = ${zipCode}, "Active" = true, "UpdatedAt" = NOW()`);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// 刪除案件
		server.route({
			method: 'DELETE',
			path: '/PI/caseWarrantyList',
			options: {
				description: '保固案件列表(刪除)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						opType: Joi.number().required().allow(0, 1).description('操作方式 - 0: 刪除; 1: 恢復'),
						CNList: Joi.array().required().min(1).items(Joi.number()).description('UploadCaseNo List'),
					})
				}
			},
			handler: async function (request, h) {
				const { opType, CNList } = request.payload;

				await request.pg.client.query(
					`UPDATE "PICaseWarranty" 
					SET "Active" = $1
					WHERE "UploadCaseNo" IN (${CNList.join(",") })`, 
					[ Boolean(opType == 1) ] );

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// 案件統計數量
		server.route({
			method: 'GET',
			path: '/PI/caseWarrantyCount',
			options: {
				description: '保固案件列表統計數量',
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
				const dateStart = DateTime.fromFormat(timeStart, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');
				const dateEnd = DateTime.fromFormat(timeEnd, 'yyyy-MM-dd').minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');

				const { rows: [result] } = await request.pg.client.query(
					`SELECT
						COALESCE( SUM( CASE WHEN ("State" & 1)::boolean THEN 1 ELSE 0 END), 0) AS "caseTotal",
						COALESCE( SUM( CASE WHEN ("State" & 1)::boolean AND "DeviceType" = 'AC' AND "DistressTypeR" = '坑洞' THEN 1 ELSE 0 END), 0) AS "caseTotal_hole_AC",
						COALESCE( SUM( CASE WHEN ("State" & 1)::boolean AND "DeviceType" = 'AC' AND "DistressTypeR" != '坑洞' THEN 1 ELSE 0 END), 0) AS "caseTotal_other_AC",
						COALESCE( SUM( CASE WHEN ("State" & 1)::boolean AND "DeviceType" = '設施' AND "DistressTypeR" = '人行道' THEN 1 ELSE 0 END), 0) AS "caseTotal_sidewalk_FA",
						COALESCE( SUM( CASE WHEN ("State" & 2)::boolean AND "DeviceType" = 'AC' AND "DistressTypeR" = '坑洞' THEN 1 ELSE 0 END), 0) AS "caseDispatch_hole_AC",
						COALESCE( SUM( CASE WHEN ("State" & 2)::boolean AND "DeviceType" = 'AC' AND "DistressTypeR" = '人孔高差' THEN 1 ELSE 0 END), 0) AS "caseDispatch_holeCover_AC",
						COALESCE( SUM( CASE WHEN ("State" & 2)::boolean AND "DeviceType" = 'AC' AND "DistressTypeR" = '縱橫向裂縫/龜裂' THEN 1 ELSE 0 END), 0) AS "caseDispatch_crack_AC",
						COALESCE( SUM( CASE WHEN ("State" & 2)::boolean AND "DeviceType" = 'AC' AND "DistressTypeR" = '車轍/隆起與凹陷' THEN 1 ELSE 0 END), 0) AS "caseDispatch_uplift_AC",
						COALESCE( SUM( CASE WHEN ("State" & 2)::boolean AND "DeviceType" = '設施' AND "DistressTypeR" = '人行道' THEN 1 ELSE 0 END), 0) AS "caseDispatch_sidewalk_FA"
					FROM
						"PICaseWarranty" 
					WHERE
						"Active" = TRUE
						AND "Zip" = $1
						AND "DateDeadline" >= $2 
						AND "DateDeadline" < $3`,
					[zipCode, dateStart, dateEnd]);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 成效式契約指標報表
		// ----------------------------------------------------------------------------------------------------
		// 總表
		server.route({
			method: 'GET',
			path: '/PI/perfReport',
			options: {
				description: '成效指標報表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().required().description("行政區"),
						reportType: Joi.number().required().description("報表類型(1: 日報表, 2: 周報表, 3: 月報表)"),
						timeStart: Joi.string().required().description('報表日期: 起始時間'),
						timeEnd: Joi.string().allow('').required().description('報表日期: 結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { zipCode, reportType, timeStart, timeEnd } = request.query;
				const dateStart = DateTime.fromFormat(timeStart, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');
				const dateEnd = DateTime.fromFormat(timeEnd, "yyyy-MM-dd").minus({ hours: 8 }).toFormat('yyyy-MM-dd HH:mm:ss');

				const [ result ] = await request.tendersql.pool.execute(
					`SELECT 
						perfReport.*,
						users.UserName AS dutyWithName,
						contentInfo.contentFin,
						contentInfo.contentTotal,
						contentInfo.pageCountTotal
					FROM 
						perfReport
						LEFT JOIN account.users ON users.UserId = perfReport.dutyWith
						LEFT JOIN (
							SELECT 
								perfId, 
                                 SUM(CASE 
                                 WHEN (perfItem = 302 AND perfAtt = 2 AND (pageCount = '-' OR pageCount = 0))
                                 OR JSON_LENGTH(content) > 0
                                 THEN 1 
                                 ELSE 0 
                                END) AS contentFin,
								COUNT(perfId) AS contentTotal,
								SUM(pageCount) AS pageCountTotal
							FROM perfContent
							GROUP BY perfId
						) AS contentInfo ON contentInfo.perfId = perfReport.id
					WHERE
						zipCode = ?
						AND reportType = ?
						AND reportDate >= ? AND reportDate < ?
					ORDER BY reportDate`,
					[ zipCode, reportType, dateStart, dateEnd ]
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
			path: '/PI/perfReport',
			options: {
				description: '成效指標報表(新增)',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						zipCode: Joi.number().required().description("行政區"),
						reportType: Joi.number().required().description("報表類型(1: 日報表, 2: 周報表, 3: 月報表)"),
						reportDate: Joi.string().required().description('報表日期'),
						checkDate: Joi.string().required().description('檢查日期'),
						perfItems: Joi.array().min(1).items(
							Joi.object({
								perfItem: Joi.number().required().description("報表項目"),
								perfAtt: Joi.array().min(1).items(Joi.number()).required().description("報表類型(0: 主表, 1: 附件1, 2: 附件2)"),
								perfPages: Joi.array().items(Joi.number()).default([]).description("頁數")
							})
						).required().description("項目Array")
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { zipCode, reportType, reportDate, checkDate, perfItems } = request.payload;

				// 檢查是否重複
				const [ res_reportCheck ] = await request.tendersql.pool.execute(
					`SELECT * FROM perfReport WHERE zipCode = ? AND reportType = ? AND reportDate = ?`,
					[ zipCode, reportType, reportDate ]
				);
				if (res_reportCheck.length > 0) return Boom.notAcceptable("Duplicate!");

				for (const perfItem of perfItems) {
					if (perfItem.perfPages.length == 0) perfItem.perfPages = Array.from({ length: perfItem.perfAtt.length }, () => 0 );
					if (perfItem.perfPages.length != perfItem.perfAtt.length) return Boom.notAcceptable("Not-allow Array!");
				}

				const [ res_report ] = await request.tendersql.pool.execute(
					`INSERT INTO perfReport ( zipCode, reportType, reportDate, dutyWith ) VALUES ( ?, ?, ?, ? )`,
					[ zipCode, reportType, reportDate, uid ]
				);
				// console.log(res_report);

				for(const perfItem of perfItems) {
					let sql_cmd = '';
					for (let i = 0; i < perfItem.perfAtt.length; i++) {
						for (let j = 0; j <= perfItem.perfPages[i]; j++)
							sql_cmd += ` ( ${res_report.insertId}, ${perfItem.perfItem}, ${j}, ${perfItem.perfAtt[i]}, '${checkDate}', '{}' ),`
					}
					sql_cmd = sql_cmd.replace(/,$/, "");
					
					const [ res_content ] = await request.tendersql.pool.execute(
						`INSERT INTO perfContent ( perfId, perfItem, perfPages, perfAtt, checkDate, content ) VALUES ${sql_cmd}`
					);
					// console.log(res_content);
				}

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'PUT',
			path: '/PI/perfReport/{id}',
			options: {
				description: '成效指標報表(修改)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required().description("perfReport id")
					}),
					// payload: Joi.object({
					// 	checkDate: Joi.string().required().description("檢查日期"),
					// 	content: Joi.string().required().description("報表內容(JSON)")
					// }).error(err => console.log(err))
				}
			},
			handler: async function (request, h) {
				const { id } = request.params;

				const [ res_report ] = await request.tendersql.pool.execute(
					`UPDATE perfReport SET dateComplete_At = NOW() WHERE id = ?`,
					[ id ]
				);

				// console.log(res_content); 

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 個別列表
		server.route({
			method: 'GET',
			path: '/PI/perfReportList',
			options: {
				description: '成效指標報表_列表',
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						reportId: Joi.number().required().description("perfReport id")
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { reportId } = request.query;
		
				// Step 1: 查找報表基本信息
				const [[ res_report ]] = await request.tendersql.pool.execute(
					`SELECT id, zipCode, reportType, reportDate FROM perfReport WHERE id = ?`,
					[ reportId ]
				);
		
				// Step 2: 查找報表內容
				const [ res_content ] = await request.tendersql.pool.execute(
					`SELECT 
						id, 
						perfId, 
						perfItem, 
						perfPages, 
						perfAtt, 
						pageCount, 
						CAST(content -> '$.inputs.caseNumber' AS UNSIGNED) AS caseNumber,
						JSON_LENGTH(content) > 0 AS IsFinished 
					FROM perfContent WHERE perfId = ?`,
					[ reportId ]
				);
		
				// Step 3: 自動標記pageCount為"-"或0的項目為完成
				res_content.forEach(content => {
					if (
						(content.pageCount === '-' || content.pageCount === 0 || !content.pageCount) &&
						content.perfItem === 302 &&
						content.perfAtt === 2
					  ) {
						content.IsFinished = true;  // 如果是 PI3.2附件2，且頁數為 "-", 0 或空集合，則標記為已完成
					  }
					});
		
				// Step 4: 返回結果
				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: res_content, reportInfo: res_report }
				};
			}
		});
		

		// ----------------------------------------------------------------------------------------------------
		// 個別
		server.route({
			method: 'GET',
			path: '/PI/perfContent',
			options: {
				description: '成效指標報表_個別',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						contentId: Joi.string().default('').description("perfContent id"),
						reportId: Joi.number().default(0).description("perfReport id"),
						perfItem: Joi.number().default(0).description("報表項目"),
						perfAtt: Joi.number().default(0).description("報表類型(0: 主表, 1: 附件1, 2: 附件2)"),
						perfPages: Joi.number().default(0).description("頁數")
					}).error((err) => {console.log(err)})
				}   // GET
			},
			handler: async function (request, h) {
				const { contentId, reportId, perfItem, perfAtt, perfPages } = request.query;

				let result = [];
				if (contentId != 0) {
					[ result ] = await request.tendersql.pool.execute(
						`SELECT 
						perfContent.*,
						perfReport.zipCode,
						perfReport.reportDate
					FROM 
						perfContent 
						LEFT JOIN perfReport ON perfReport.id = perfContent.perfId
					WHERE perfContent.id = ?`,
						[contentId]
					);
				} else if (reportId != 0 && perfItem != 0 && perfAtt != 0) {
					[ result ] = await request.tendersql.pool.execute(
						`SELECT * FROM perfContent WHERE perfId = ? AND perfItem = ? AND perfAtt = ? AND perfPages = ?`,
						[ reportId, perfItem, perfAtt, perfPages]
					);
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'PUT',
			path: '/PI/perfContent/{id}',
			options: {
				description: '成效指標報表_個別(修改)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required().description("perfContent id")
					}),
					payload: Joi.object({
						caseNo: Joi.number().default(0).description("PICaseWarranty UploadCaseNo"),
						checkDate: Joi.string().required().description("檢查日期"),
						pageCount: Joi.number().required().description("頁數"),
						content: Joi.string().required().description("報表內容(JSON)"),
						imgObj: Joi.string().default('{}').description("上傳圖片"),
						perfItems: Joi.string().default('[]').description("項目Array")
						// perfItems: Joi.array().items(
						// 	Joi.object({
						// 		reportId: Joi.number().required().description("perfReport id"),
						// 		perfItem: Joi.number().required().description("報表項目"),
						// 		perfAtt: Joi.array().min(1).items(Joi.number()).required().description("報表類型(0: 主表, 1: 附件1, 2: 附件2)"),
						// 		perfPages: Joi.array().items(Joi.number()).default([]).description("頁數")
						// 	})
						// ).default([]).description("項目Array")
					}).error(err => console.log(err))
				},
				payload: {
					maxBytes: 1048576 * 5,
					output: "stream",
					allow: "multipart/form-data",
					multipart: true,
					timeout: 60000
				},
			},
			handler: async function (request, h) {
				const { id } = request.params;
				let { content } = request.payload;
				const { caseNo, checkDate, pageCount } = request.payload;
				const imgObj = JSON.parse(request.payload.imgObj);
				const perfItems = JSON.parse(request.payload.perfItems);

				if(Object.keys(imgObj).length != 0) {
					// console.log(imgObj);
					let contentJSON = JSON.parse(content);
					const regex = /^data:.+\/(.+);base64,(.*)$/;

					for (const imgKey in imgObj) {
						if (imgObj[imgKey].length == 0) continue;
						if (imgObj[imgKey].includes("storage.google")) contentJSON.inputs[imgKey] = imgObj[imgKey];
						else {
							const destFileName = `perf_image/${id}_${checkDate}_${imgKey}`;
							// console.log(imgObj[imgKey]);

							// 照片上傳至GCP
							server.methods.setBucket('adm_pref_report');
							try {
								await server.methods.getFileList(destFileName).then(async (existFileList) => {
									let buffer, destFileNameSpec;
									if (new RegExp("^http").test(imgObj[imgKey])) {
										await superagent.get(imgObj[imgKey]).buffer(true).parse(superagent.parse.image).then(async (res) => {
											await sharp(res.body, { failOnError: false }).resize(1024).toBuffer().then(data => {
												buffer = data;
												destFileNameSpec = `${destFileName}_${existFileList.length + 1}.jpg`;
											}).catch(err => console.log(err));
										});
									} else {
										const [ext, baseStr] = imgObj[imgKey].split(regex).filter(str => str.length != 0);
										// console.log(baseStr, ext);
										buffer = Buffer.from(baseStr, 'base64');
										destFileNameSpec = `${destFileName}_${existFileList.length + 1}.${ext}`;
									}

									await server.methods.uploadFile(buffer, destFileNameSpec).then(async (publicUrl) => {
										contentJSON.inputs[imgKey] = imgObj[imgKey] = decodeURIComponent(publicUrl);
									}).catch(err => console.log(err));
								}).catch(err => console.log(err));
							} catch(err) { console.log(err) }
						}
					}

					content = JSON.stringify(contentJSON);
				} 

				// 調整項目頁數
				if (perfItems.length != 0) {
					for (const perfItem of perfItems) {
						if (perfItem.perfPages.length == 0) perfItem.perfPages = Array.from({ length: perfItem.perfAtt.length }, () => 0);
						if (perfItem.perfPages.length != perfItem.perfAtt.length) return Boom.notAcceptable("Not-allow Array!");

						let sql_cmd = '';
						for (let i = 0; i < perfItem.perfAtt.length; i++) {
							for (let j = 1; j <= perfItem.perfPages[i]; j++) {
								const [ res_perfItem ] = await request.tendersql.pool.execute(
									`SELECT * FROM perfContent WHERE perfId = ? AND perfItem = ? AND perfPages IN (0, ?) AND perfAtt = ?`,
									[ perfItem.reportId, perfItem.perfItem, j, perfItem.perfAtt[i] ]
								);
								if (res_perfItem.length > 0) {
									await request.tendersql.pool.execute(
										`UPDATE perfContent SET perfPages = ? WHERE id = ?`,
										[ j, res_perfItem[0].id ]
									);
								} else sql_cmd += ` ( ${perfItem.reportId}, ${perfItem.perfItem}, ${j}, ${perfItem.perfAtt[i]}, '${checkDate}', '{}' ),`;
							} 
						}
						sql_cmd = sql_cmd.replace(/,$/, "");
						// console.log(sql_cmd);

						if(sql_cmd.length != 0) {
							const [res_content] = await request.tendersql.pool.execute(
								`INSERT INTO perfContent ( perfId, perfItem, perfPages, perfAtt, checkDate, content ) VALUES ${sql_cmd}`
							);	
							
						}
					}
				}

				const [ res_content ] = await request.tendersql.pool.execute(
					`UPDATE perfContent SET checkDate = ?, pageCount = ?, content = ?, DateUpdate_At = NOW() WHERE id = ?`,
					[ checkDate, pageCount, content, id ]
				);

				if (caseNo != 0) {
					const perfContent = JSON.stringify({ perfContentId: id, ...imgObj });
					await request.pg.client.query(
						`UPDATE "PICaseWarranty" SET "PerfContent" = $1 WHERE "UploadCaseNo" = $2`,
						[ perfContent, caseNo ]
					)
				}

				const [ res_contentList ] = await request.tendersql.pool.execute(
					`SELECT id FROM perfContent
					WHERE perfId IN ( SELECT perfId FROM perfContent WHERE id = ? ) 
					ORDER BY perfId, perfItem, perfPages, perfAtt`,
					[ id ]
				);

				// console.log(res_content); 

				return {
					statusCode: 20000,
					message: 'successful',
					data: { idList: res_contentList.map(l => l.id) }
				};
			},
		});

		/* Router End */   
	},
};
