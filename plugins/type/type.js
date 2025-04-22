'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const { DateTime, Interval } = require("luxon");

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
	name: 'type',
	version: '0.0.0',
	register: async function (server, options) {
		// ----------------------------------------------------------------------------------------------------
		// action
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/type/action',
			options: {
				description: '進程',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						'idList[]': Joi.alternatives().try(Joi.number(), Joi.array().items(Joi.number())).default([]).description("id"),
					})
				}   // GET
			},
			handler: async function (request, h) {
				let { 'idList[]': idList } = request.query;
				if (!Array.isArray(idList)) idList = [idList];

				const [ result ] = await request.tendersql.pool.query(
					`SELECT id, type, success, fail, total, note
					FROM _action
					WHERE id IN (?)`,
					[idList]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 區域
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/type/unitZip',
			options: {
				description: '區域Map',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				// validate: {
				// 	query: Joi.object({})
				// }   // GET
			},
			handler: async function (request, h) {
				const { rows: result } = await request.pg.client.query(
					`SELECT 
						"id", 
						"zipCode", 
						"District" AS "district",
						ST_AsGeoJSON(ST_Envelope("wkb_geometry")) AS "boundary"
					FROM "public"."unitZip" 
					ORDER BY "id" ASC`
				);

				// console.log(result);

				let districtMap = {};
				for (const zipSpec of result) districtMap[zipSpec.zipCode] = { district: zipSpec.district, boundary: zipSpec.boundary };

				return {
					statusCode: 20000,
					message: 'successful',
					data: { districtMap }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/type/unitZipGeo',
			options: {
				description: '區域地理資訊',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				// validate: {
				// 	query: Joi.object({})
				// }   // GET
			},
			handler: async function (request, h) {
				const { rows: result } = await request.pg.client.query(
					`SELECT 
						"id", 
						"zipCode", 
						"District" AS "district",
						ST_AsGeoJSON("wkb_geometry") AS "wkb_geometry"
					FROM "public"."unitZip" 
					ORDER BY "id" ASC`
				);

				// console.log(result);

				let geoJSON = {
					"type": "FeatureCollection",
					"name": "zipJSON",
					"features": []
				};

				for (const distSpec of result) {
					let feature = {
						"type": "Feature",
						"properties": {
							"zipCode": distSpec.zipCode,
							"district": distSpec.district
						},
						"geometry": JSON.parse(distSpec.wkb_geometry)
					};

					// console.log(feature);
					geoJSON.features.push(feature);
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { geoJSON: JSON.stringify(geoJSON) }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 維護單元(PCI區塊)
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/type/blockGeo',
			options: {
				description: 'PCI區塊地理資訊',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						tenderId: Joi.number().required().description("Tenders tenderId"),
						zipCode: Joi.number().default(0).description('行政區'), 
						'blockType[]': Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).default([]).description("1: 我們的; 2: 新工處的")
					}).error(err => console.log(err))
				}   // GET
			},
			handler: async function (request, h) {
				const { tenderId, zipCode } = request.query;
				let { 'blockType[]': blockType } = request.query;
				if (!Array.isArray(blockType)) blockType = [ blockType ];
				
				const pciTableName = await server.methods.tender.getPCITable(tenderId, zipCode);
				const zipCodeTender = await server.methods.tender.getZipCode(tenderId);
				if (pciTableName.length == 0) return Boom.notAcceptable("Non-allow Tender");

				// console.time("1");
				let geoJSON = {};
				// console.log(type);

				if (blockType.includes('1')) {
					geoJSON["block_bell"] = {
						"type": "FeatureCollection",
						"name": "blockJSON",
						"features": []
					};

					const { rows: result } = await request.pg.client.query(
						`SELECT
							"id" AS "blockId",
							"pci_id" AS "pciId",
							"道路名稱" AS "roadName",
							"PCI_real",
							ROUND(ST_Area ("wkb_geometry" :: geography)::numeric, 2) AS "area",
							"updatedAt" AS "updateTime",
							ST_AsGeoJSON("wkb_geometry") AS "wkb_geometry"
						FROM qgis."${pciTableName}"
						WHERE "pci_id" IS NOT NULL
						ORDER BY "pci_id" ASC`
					);

					// console.log(result);

					for (const blockSpec of result) {
						let feature = {
							"type": "Feature",
							"properties": {
								"blockId": blockSpec.blockId,
								"pciId": blockSpec.pciId,
								"roadName": blockSpec.roadName,
								"area": blockSpec.area,
								// "PCIValue": blockSpec.PCI_real,
								"PCIValue": -1,
								"updateTime": blockSpec.updateTime
							},
							"geometry": JSON.parse(blockSpec.wkb_geometry)
						};

						// console.log(feature);
						geoJSON["block_bell"].features.push(feature);
					}
				};
				
				if (blockType.includes('2')) {
					geoJSON["block_nco"] = {
						"type": "FeatureCollection",
						"name": "blockJSON",
						"features": []
					};

					const { rows: result } = await request.pg.client.query(
						`SELECT
							"block_nco2022mapping"."fcl_id",
							"block_nco2022mapping"."fcl_road",
							ST_AsGeoJSON("block_nco2022"."wkb_geometry") AS "wkb_geometry"
						FROM 
							qgis."block_nco2022mapping"
							LEFT JOIN qgis."block_nco2022" USING ("fcl_id")
						WHERE "block_nco2022mapping"."zip_code" = $1
						ORDER BY "fcl_id" ASC`,
						[ zipCodeTender ]
					);

					// console.log(result);

					for (const blockSpec of result) {
						let feature = {
							"type": "Feature",
							"properties": {
								"blockId": blockSpec.fcl_id,
								"roadName": blockSpec.fcl_road
							},
							"geometry": JSON.parse(blockSpec.wkb_geometry)
						};

						// console.log(feature);
						geoJSON["block_nco"].features.push(feature);
					}
				}

				// console.timeEnd("1");
				return {
					statusCode: 20000,
					message: 'successful',
					data: { geoJSON: JSON.stringify(geoJSON) }
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/type/blockNcoGeo',
			options: {
				description: '新工處區塊',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().default(0).description('行政區'),
						'width[]': Joi.array().items(Joi.number()).length(2).default([0, 0]).description("計畫路寬"),
						'widthReal[]': Joi.array().items(Joi.number()).length(2).default([0, 0]).description("實際路寬"),
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { zipCode, 'width[]': width, 'widthReal[]': widthReal } = request.query;
				let sqlCMD = (zipCode == 0) ? "" : ` AND zip_code = ${zipCode}`;

				if (width[1] == 0) sqlCMD += ` AND "width" >= ${width[0]}`;
				else sqlCMD += ` AND "width" >= ${width[0]} AND "width" <= ${width[1]}`;

				if (widthReal[1] == 0) sqlCMD += ` AND "width_real" >= ${widthReal[0]}`;
				else sqlCMD += ` AND "width_real" >= ${widthReal[0]} AND "width_real" <= ${widthReal[1]}`;

				sqlCMD = sqlCMD.replace("AND", "WHERE");

				const { rows: result } = await request.pg.client.query(
					`SELECT 
						"fcl_id", 
						"fcl_road", 
						"fcl_sta_ro", 
						"fcl_end_ro", 
						"width", 
						"width_real", 
						"zip_code", 
						ST_AsGeoJSON("wkb_geometry") AS "wkb_geometry"
					FROM "qgis"."block_nco2022" 
					${sqlCMD}`
				);

				let geoJSON = {
					"type": "FeatureCollection",
					"name": "blockJSON",
					"features": []
				};

				for (const blockSpec of result) {
					let feature = {
						"type": "Feature",
						"properties": {
							"id": blockSpec.fcl_id,
							"roadName": blockSpec.fcl_road,
							"roadStart": blockSpec.fcl_sta_ro,
							"roadEnd": blockSpec.fcl_end_ro,
							"width": blockSpec.width,
							"widthReal": blockSpec.width_real,
							"zipCode": blockSpec.zip_code
						},
						"geometry": JSON.parse(blockSpec.wkb_geometry)
					};

					// console.log(feature);
					geoJSON.features.push(feature);
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { geoJSON: JSON.stringify(geoJSON) }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 廠商
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/type/guild',
			options: {
				description: '施工廠商',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				// validate: { query: Joi.object({}) }   // GET
			},
			handler: async function (request, h) {
				// const {  } = request.query;

				const [ result_guild ] = await request.accsql.pool.execute( `SELECT GuildCode, Name FROM guilds WHERE GuildCode > 3000`);

				let guildMap = {};
				for (const guild of result_guild) guildMap[guild.GuildCode] = guild.Name;

				return {
					statusCode: 20000,
					message: 'successful',
					data: { guildMap }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 合約
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/type/tenderGroup',
			options: {
				description: '契約Map',
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				// validate: { query: Joi.object({}) }   // GET
			},
			handler: async function (request, h) {
				// const {  } = request.query;
				const [result_TenderGroup] = await request.tendersql.pool.execute(`SELECT groupId, groupName FROM TendersGroup`);

				let tenderGroup = {};
				for (const group of result_TenderGroup) tenderGroup[group.groupId] = { groupName: group.groupName };

				return {
					statusCode: 20000,
					message: 'successful',
					data: { tenderGroup }
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/type/tenderMap',
			options: {
				description: '合約Map',
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				// validate: { query: Joi.object({}) }   // GET
			},
			handler: async function (request, h) {
				// const {  } = request.query;

				// NOTE: 使用tbl_Dteam
				// const [result_Tender] = await request.tendersql.pool.execute(`SELECT Dteam AS tenderId, TeamName AS tenderName FROM tbl_Dteam WHERE RecControl = '1'`);
				const [result_Tender] = await request.tendersql.pool.execute(`SELECT tenderId, tenderName, groupId, zipCode FROM Tenders`);

				let tenderMap = {};
				for (const tender of result_Tender) tenderMap[tender.tenderId] = { tenderName: tender.tenderName, groupId: tender.groupId, zipCode: tender.zipCode };

				return {
					statusCode: 20000,
					message: 'successful',
					data: { tenderMap }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/type/tenderRound',
			options: {
				description: '合約區間',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						tenderId: Joi.string().default('').description("Tenders tenderId"),
						isMap: Joi.boolean().default(false).description("是否為地圖頁面，是否需分區域"),
						excludeShadow: Joi.boolean().default(false).description('是否排除複製')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { tenderId, isMap, excludeShadow } = request.query;

				let sql_CMD = "";
				if(!isMap) sql_CMD += ` AND TendersSurvey.zipCode = 0`;
				if (excludeShadow) sql_CMD += ` AND isShadow IS FALSE`;
				if (tenderId.length != 0) sql_CMD += ` AND tenderId = ${tenderId}`;
				else {
					const [ res_permission ] = await request.tendersql.pool.execute(
						`SELECT TenderId, SurveyId FROM TendersSurveyPermission WHERE UserId = ?`,
						[ uid ]
					);
					// console.log(res_permission);
					if (res_permission.length == 0) return { statusCode: 20000, message: 'successful', data: { list: [] } };

					const surveyIdList = res_permission.map(survey => survey.SurveyId).filter(surveyId => surveyId != 0);
					const tenderIdList = res_permission.map(survey => survey.SurveyId == 0 ? survey.TenderId : 0).filter(tenderId => tenderId != 0);

					if (surveyIdList.length != 0 && tenderIdList.length != 0) sql_CMD += ` AND (id IN (${surveyIdList.join(",")}) OR tenderId IN (${tenderIdList.join(",")}))`;
					else if (surveyIdList.length != 0) sql_CMD += ` AND id IN (${surveyIdList.join(",") })`;
					else if (tenderIdList.length != 0) sql_CMD += ` AND tenderId IN (${tenderIdList.join(",")})`;
				}	
				sql_CMD = sql_CMD.replace("AND", "WHERE");
				// console.log(sql_CMD);

				const [ result ] = await request.tendersql.pool.query(
					`SELECT
						TendersSurvey.id,
						TendersSurvey.tenderId,
						TendersSurvey.title,
						TendersSurvey.round,
						Tenders.tenderName,
						TendersSurvey.roundStart,
						TendersSurvey.roundEnd,
						TendersSurvey.archiveTime,
						TendersSurvey.zipCode AS zipCodeSpec,
						Tenders.zipCode,
						TendersSurvey.orthoPath,
						TendersSurvey.actionId
					FROM
						TendersSurvey
						LEFT JOIN Tenders USING ( tenderId )
					${sql_CMD}`);

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
			path: '/type/tenderRound/',
			options: {
				description: '合約區間(新增)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						tenderId: Joi.number().required().description("Tenders tenderId"),
						round: Joi.number().required().description("TendersSurvey round"),
						title: Joi.string().allow('').default('').description('標題'),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間')
					})
				}   // PUT
			},
			handler: async function (request, h) {
				const { tenderId, round, title, timeStart, timeEnd } = request.payload;
				const [ result ] = await request.tendersql.pool.execute(
					`SELECT * FROM TendersSurvey WHERE tenderId = ? AND round = ?`,
					[ tenderId, round ]
				);
				if(result.length > 0) return Boom.notAcceptable("Round Duplicate!");

				await request.tendersql.pool.execute(
					`INSERT INTO TendersSurvey (tenderId, title, round, roundStart, roundEnd) 
					VALUE (?, ?, ?, ?, ?)`,
					[ tenderId, title, round, timeStart, timeEnd ] );

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'PUT',
			path: '/type/tenderRound/{id}',
			options: {
				description: '合約區間(修改)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required().description("TendersSurvey id"),
					}),
					payload: Joi.object({
						title: Joi.string().allow('').default('').description('標題'),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間'),
						isArchive: Joi.boolean().default(false).description('是否封存')
					})
				}   // PUT
			},
			handler: async function (request, h) {
				const { id } = request.params;
				const { title, timeStart, timeEnd } = request.payload;

				await request.tendersql.pool.execute(
					`UPDATE TendersSurvey SET title = ?, roundStart = ?, roundEnd = ? WHERE id = ?`, 
					[ title, timeStart, timeEnd, id ]);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'PUT',
			path: '/type/tenderRound/archive/{id}',
			options: {
				description: '合約區間(封存)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required().description("TendersSurvey id"),
					}),
					payload: Joi.object({
						tenderId: Joi.number().required().description("Tenders tenderId"),
						isArchive: Joi.boolean().default(true).description('是否封存')
					})
				}   // PUT
			},
			handler: async function (request, h) {
				const { id } = request.params;
				const { tenderId, isArchive } = request.payload;

				let pciTableName = await server.methods.tender.getPCITable(tenderId);
				pciTableName = pciTableName.replace(/_0$|_00$/g, "");
				if (pciTableName.length == 0) return Boom.notAcceptable("Non-allow Tender");

				if (isArchive) {
					await request.pg.client.query(
						`INSERT INTO "qgis"."pci" ("surveyId", "blockId", "pciValue")
							(
								SELECT 
									${id} AS "surveyId",
									"id" AS "blockId",
									"PCI_real" AS "pciValue"
								FROM "qgis"."${pciTableName}"
							)`
					)

					await request.tendersql.pool.execute(
						`UPDATE TendersSurvey SET archiveTime = NOW() WHERE id = ?`,
						[ id ]);
				} else {
					await request.pg.client.query(
						`UPDATE "qgis"."pci" SET "active" = false WHERE "surveyId" = $1`,
						[ surveyId ]
					)

					await request.tendersql.pool.execute(
						`UPDATE TendersSurvey SET archiveTime = NULL WHERE id = ?`,
						[ id ] );
				}

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 缺失
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/type/caseTypeMap',
			options: {
				description: '缺失類型Map(rm100)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				// validate: { query: Joi.object({}) }   // GET
			},
			handler: async function (request, h) {
				// const {  } = request.query;

				await sql.connect(sqlConfig_1);

				const { recordsets: [result_DeviceType] } = await sql.query`SELECT SerialNo, DName FROM tbl_DeviceType WHERE RecControl = '1'`;
				const { recordsets: [result_BType] } = await sql.query`SELECT SerialNo, BTName FROM tbl_BType WHERE RecControl = '1'`;

				// console.log(result_DeviceType);
				// console.log(result_BType);

				let DeviceTypeMap = {};
				for (const type of result_DeviceType) DeviceTypeMap[type.SerialNo] = type.DName;

				let BTypeMap = {};
				for (const type of result_BType) BTypeMap[type.SerialNo] = type.BTName;

				sql.close();

				return {
					statusCode: 20000,
					message: 'successful',
					data: { DeviceTypeMap, BTypeMap }
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/type/distressTypeMap',
			options: {
				description: '缺失類型Map(mysql)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				// validate: { query: Joi.object({}) }   // GET
			},
			handler: async function (request, h) {

				const [result_distressType] = await request.tendersql.pool.execute(
					`SELECT SerialNo, DistressName, DeviceType FROM tbl_DistressType WHERE Active = 1`);

				let distressTypeMap = {};
				for (const type of result_distressType) {
					if (distressTypeMap[type.DeviceType] == undefined) distressTypeMap[type.DeviceType] = {};
					distressTypeMap[type.DeviceType][type.SerialNo] = type.DistressName;
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { 
						distressTypeMap
					}
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/type/competentTypeMap',
			options: {
				description: '權責單位Map',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				// validate: { query: Joi.object({}) }   // GET
			},
			handler: async function (request, h) {

				const [result_competentType] = await request.tendersql.pool.execute(
					`SELECT id, unitName FROM caseCompetent WHERE isActive = 1`);

				let competentTypeMap = {};
				for (const type of result_competentType) {
					competentTypeMap[type.id] = type.unitName;
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: {
						competentTypeMap
					}
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 派工
		// ----------------------------------------------------------------------------------------------------
		// TODO: rm100的type
		server.route({
			method: 'GET',
			path: '/typeV0/kitItemMap',
			options: {
				description: '套組ItemMap',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: { query: Joi.object({
					tenderId: Joi.string().required().description("Tenders tenderId"),
					itemId: Joi.string().required().description("估驗詳細表 項次")
				}).error(err => console.log(err)) }   // GET
			},
			handler: async function (request, h) {
				const { tenderId, itemId } = request.query;

				await sql.connect(sqlConfig_1);

				const { recordsets: [ result ] } = await sql.query(
					`SELECT DISTINCT
						項次 AS itemId,
						工程項目 AS itemName,
						單位 AS unit,
						單價 AS uPrice
					FROM
						估驗詳細表 
					WHERE
						項次= '${itemId}'
						AND dteam = '${tenderId}'`);

				sql.close();

				return {
					statusCode: 20000,
					message: 'successful',
					data: { item: result[0] }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/type/kitItemMap',
			options: {
				description: '套組ItemMap',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						groupId: Joi.string().required().description("TendersGroup Id"),
						UnitSN: Joi.string().required().description("TaskUnit SerialNo")
					}).error(err => console.log(err))
				}   // GET
			},
			handler: async function (request, h) {
				const { groupId, UnitSN } = request.query;

				const [ result ] = await request.tendersql.pool.execute(
					`SELECT
						SerialNo AS UnitSN,
						TaskName,
						TaskUnit,
						TaskPrice,
						DTeam
					FROM
						TaskUnit
					WHERE
						SerialNo = '${UnitSN}'
						AND DTeam = '${groupId}'`);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { item: result[0] }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/type/scType2ItemMap',
			options: {
				description: '標線Map',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				// validate: {
				// 	query: Joi.object({
				// 	})
				// }   // GET
			},
			handler: async function (request, h) {
				// const { } = request.query;

				const [ result_SCType2 ] = await request.tendersql.pool.execute(`SELECT * FROM tbl_SCType2`);

				let SCType2Map = {};
				for (const SCType2Spec of result_SCType2) SCType2Map[SCType2Spec.SerialNo] = { name: SCType2Spec.SCType2, formula: SCType2Spec.Formula };

				return {
					statusCode: 20000,
					message: 'successful',
					data: { SCType2Map }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/type/restoredImgMap',
			options: {
				description: '完工登錄照片Map',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				// validate: {
				// 	query: Joi.object({
				// 	})
				// }   // GET
			},
			handler: async function (request, h) {
				// const { } = request.query;

				const [ res_restoredImg ] = await request.tendersql.pool.execute(`SELECT Id, DeviceType, ImgName, EngName FROM caseRestoredImg WHERE IsActive = 1`);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { restoredImgMap: res_restoredImg }
				};
			},
		});
		/* Router End */   
	},
};
