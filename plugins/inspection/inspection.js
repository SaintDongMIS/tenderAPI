'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const { DateTime } = require("luxon");
const { parse } = require('path');
const superagent = require("superagent");

const authStrategy = false; 
//const authStrategy = 'simple';

exports.plugin = {
	//pkg: require('./package.json'),
	name: 'inspectionManger',
	version: '0.0.0',
	register: async function (server, options) {

		// ----------------------------------------------------------------------------------------------------
		// 巡查路線
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/inspection/routePlan',
			options: {
				description: '巡查路線(計畫)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().required().description("行政區"),
						inspectRound: Joi.number().required().description("巡查週期"),
						// isCar: Joi.boolean().default(false).description('是否為各標巡查路線')
					}).error((err) => console.log(err))
				} 
			},
			handler: async function (request, h) {
				const { zipCode, inspectRound } = request.query;

				const tableName = 'caseInspectRoute_car';
				const sqlCMD = (inspectRound == 0) ? "" : ` AND "round" = ${inspectRound}`;

				const { rows: res_blockList } = await request.pg.client.query(
					`SELECT 
						"caseInspectRoute"."blockId" AS "id",
						"caseInspectRoute"."roadName",
						"caseInspectRoute"."zipCode",
						ST_AsGeoJson("block_nco2022"."wkb_geometry") AS "geometry"
					FROM 
						"qgis"."${tableName}" AS "caseInspectRoute"
						LEFT JOIN "qgis"."block_nco2022" ON "block_nco2022"."fcl_id" = "caseInspectRoute"."blockId"
					WHERE "zipCode" = $1 ${sqlCMD} AND "active" IS TRUE
					ORDER BY "id"`,
					[ zipCode ]
				);

				const { rows: res_routeList } = await request.pg.client.query(
					`SELECT 
						ROW_NUMBER() OVER (ORDER BY "caseInspectRoute"."roadName") AS "id",
						"caseInspectRoute"."roadName",
						"caseInspectRoute"."zipCode"
					FROM 
						"qgis"."${tableName}" AS "caseInspectRoute"
					WHERE "zipCode" = $1  ${sqlCMD} AND "active" IS TRUE
					GROUP BY "caseInspectRoute"."roadName", "caseInspectRoute"."zipCode"`,
					[ zipCode ]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { blockList: res_blockList, routeList: res_routeList }
				};
			},
		});

		server.route({
			method: 'POST',
			path: '/inspection/routePlan',
			options: {
				description: '巡查路線上傳(計畫)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						zipCode: Joi.number().required().description("行政區"),
						inspectRound: Joi.number().required().description("巡查週期"),
						blockList: Joi.array().min(1).items(Joi.object({
							blockId: Joi.number().required().description("block_nco2022 fcl_id"),
							roadName: Joi.string().required().description("道路名稱")
						}))
					}).error((err) => console.log(err))
				}
			},
			handler: async function (request, h) {
				const { zipCode, inspectRound, blockList } = request.payload;

				await request.pg.client.query(`UPDATE "qgis"."caseInspectRoute_car" SET "active" = false WHERE "zipCode" = $1 AND "round" = $2`, [ zipCode, inspectRound ]);

				let sqlCMD_list = "";
				for (const blockItem of blockList) {
					sqlCMD_list += `(${zipCode}, ${inspectRound}, ${blockItem.blockId}, '${blockItem.roadName}'),`;
				}
				sqlCMD_list = sqlCMD_list.replace(/,$/, "");
				// console.log(sqlCMD_list);

				await request.pg.client.query(`INSERT INTO "qgis"."caseInspectRoute_car" ( "zipCode", "round", "blockId", "roadName") VALUES ${sqlCMD_list}`);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});
		// ----------------------------------------------------------------------------------------------------
		// 巡查路線
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/inspection/route',
			options: {
				description: '巡查路線',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().required().description("行政區"),
						inspectRound: Joi.number().required().description("巡查週期"),
						isCar: Joi.boolean().default(false).description('是否為各標巡查路線')
					}).error((err) => console.log(err))
				} 
			},
			handler: async function (request, h) {
				const { zipCode, inspectRound, isCar } = request.query;

				const tableName = isCar ? 'caseInspectRoute_car' : 'caseInspectRoute';
				const sqlCMD = (inspectRound == 0) ? "" : ` AND "round" = ${inspectRound}`;

				const { rows: res_blockList } = await request.pg.client.query(
					`SELECT 
						"caseInspectRoute"."blockId" AS "id",
						"caseInspectRoute"."roadName",
						"caseInspectRoute"."zipCode",
						ST_AsGeoJson("block_nco2022"."wkb_geometry") AS "geometry"
					FROM 
						"qgis"."${tableName}" AS "caseInspectRoute"
						LEFT JOIN "qgis"."block_nco2022" ON "block_nco2022"."fcl_id" = "caseInspectRoute"."blockId"
					WHERE "zipCode" = $1 ${sqlCMD} AND "active" IS TRUE
					ORDER BY "id"`,
					[ zipCode ]
				);

				const { rows: res_routeList } = await request.pg.client.query(
					`SELECT 
						ROW_NUMBER() OVER (ORDER BY "caseInspectRoute"."roadName") AS "id",
						"caseInspectRoute"."roadName",
						"caseInspectRoute"."zipCode"
					FROM 
						"qgis"."${tableName}" AS "caseInspectRoute"
					WHERE "zipCode" = $1  ${sqlCMD} AND "active" IS TRUE
					GROUP BY "caseInspectRoute"."roadName", "caseInspectRoute"."zipCode"`,
					[ zipCode ]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { blockList: res_blockList, routeList: res_routeList }
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/inspection/routes',
			options: {
				description: '巡查路線(3, 6標)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().required().description("行政區"),
						// 'inspectRound[]': Joi.array().items(Joi.number()).required().description("巡查週期(週期包含今天的前4天)"),
						isCar: Joi.boolean().default(false).description('是否為各標巡查路線')
					}).error((err) => console.log(err))
				} 
			},
			handler: async function (request, h) {
				const { zipCode, isCar } = request.query;

				const tableName = isCar ? 'caseInspectRoute_car' : 'caseInspectRoute';
				const sqlCMD = ` AND "round" IN (1, 2, 3, 4, 5, 6, 7)`;

				const { rows: res_blockList } = await request.pg.client.query(
					`SELECT 
						"caseInspectRoute"."blockId" AS "id",
						"caseInspectRoute"."roadName",
						"caseInspectRoute"."zipCode",
						ST_AsGeoJson("block_nco2022"."wkb_geometry") AS "geometry"
					FROM 
						"qgis"."${tableName}" AS "caseInspectRoute"
						LEFT JOIN "qgis"."block_nco2022" ON "block_nco2022"."fcl_id" = "caseInspectRoute"."blockId"
					WHERE "zipCode" = $1 ${sqlCMD} AND "active" IS TRUE
					ORDER BY "id"`,
					[ zipCode ]
				);

				const { rows: res_routeList } = await request.pg.client.query(
					`SELECT 
						ROW_NUMBER() OVER (ORDER BY "caseInspectRoute"."roadName") AS "id",
						"caseInspectRoute"."roadName",
						"caseInspectRoute"."zipCode"
					FROM 
						"qgis"."${tableName}" AS "caseInspectRoute"
					WHERE "zipCode" = $1  ${sqlCMD} AND "active" IS TRUE
					GROUP BY "caseInspectRoute"."roadName", "caseInspectRoute"."zipCode"`,
					[ zipCode ]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { blockList: res_blockList, routeList: res_routeList }
				};
			},
		});

		server.route({
			method: 'POST',
			path: '/inspection/route',
			options: {
				description: '巡查路線上傳',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						zipCode: Joi.number().required().description("行政區"),
						inspectRound: Joi.number().required().description("巡查週期"),
						blockList: Joi.array().min(1).items(Joi.object({
							blockId: Joi.number().required().description("block_nco2022 fcl_id"),
							roadName: Joi.string().required().description("道路名稱")
						}))
					}).error((err) => console.log(err))
				}
			},
			handler: async function (request, h) {
				const { zipCode, inspectRound, blockList } = request.payload;

				await request.pg.client.query(`UPDATE "qgis"."caseInspectRoute" SET "active" = false WHERE "zipCode" = $1 AND "round" = $2`, [ zipCode, inspectRound ]);

				let sqlCMD_list = "";
				for (const blockItem of blockList) {
					sqlCMD_list += `(${zipCode}, ${inspectRound}, ${blockItem.blockId}, '${blockItem.roadName}'),`;
				}
				sqlCMD_list = sqlCMD_list.replace(/,$/, "");
				// console.log(sqlCMD_list);

				await request.pg.client.query(`INSERT INTO "qgis"."caseInspectRoute" ( "zipCode", "round", "blockId", "roadName") VALUES ${sqlCMD_list}`);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 巡查歷程
		// ----------------------------------------------------------------------------------------------------
		// 列表
		server.route({
			method: 'GET',
			path: '/inspection/list',
			options: {
				description: '巡查歷程',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().default(0).description('行政區'),
						surveyId: Joi.number().default(0).description("TendersSurvey id"),
						timeStart: Joi.string().allow('').default('').description('收取日'),
						timeEnd: Joi.string().allow('').default('').description('收取日')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { zipCode, surveyId, timeStart, timeEnd } = request.query;
				let sqlCMD = ""
				if (zipCode != 0) sqlCMD += ` AND ZipCode = ${zipCode}`;
				if (timeStart.length != 0 && timeEnd.length != 0) sqlCMD += ` AND DateCollect_At >= '${timeStart}' AND DateCollect_At < '${timeEnd}'`;
				if (surveyId != 0) sqlCMD += ` AND SurveyId = ${surveyId}`;

				const [ res_caseInspection ] = await request.tendersql.pool.execute(
					`SELECT
						caseInspection.*,
						users_1.UserName AS Duty_with_Name,
						users_2.UserName AS DateCompleted_With_Name
					FROM
						caseInspection 
						LEFT JOIN account.users AS users_1 ON users_1.UserId = caseInspection.Duty_with
						LEFT JOIN account.users AS users_2 ON users_2.UserId = caseInspection.DateCompleted_With
					WHERE IsActive = 1 ${sqlCMD}
					ORDER BY InspectId ASC`,
					[ timeStart, timeEnd ]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: res_caseInspection }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 新增
		server.route({
			method: 'POST',
			path: '/inspection/list',
			options: {
				description: '巡查歷程(新增)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						zipCode: Joi.number().required().description('行政區'),
						collectDate: Joi.string().allow('').default('').description('拍攝時間'),
						notes: Joi.string().allow('').default('').description('備註'),
						url: Joi.string().required().description('JSON位址')
					}).error((err) => console.log(err))
				}
			},
			handler: async function (request, h) {
				const { zipCode, collectDate, notes, url } = request.payload;

				const sqlCMD = collectDate.length == 0 ? 'NOW()' : `'${collectDate}'`;

				const [ result ] = await request.tendersql.pool.execute(
					`INSERT INTO caseInspection (ZipCode, DateCollect_At, Notes, url) VALUES (?, ${sqlCMD}, ?, ?)`,
					[ zipCode, notes, url ]);

				return {
					statusCode: 20000,
					message: 'successful',
					result
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 修改
		server.route({
			method: 'PUT',
			path: '/inspection/list/{id}',
			options: {
				description: '巡查歷程(修改)',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					payload: Joi.object({
						state: Joi.number().default(0).description("-2: 刪除; -1: 撤銷; 0: 修改; 1: 標記; 2: 完成"),
						surveyId: Joi.number().default(0).description("TendersSurvey id"),
						notes: Joi.string().allow('').default('').description('備註')
					})
				}
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { id } = request.params;
				const { state, surveyId, notes } = request.payload;

				let result;
				if (notes.length != 0 || surveyId != 0) {
					[ result ] = await request.tendersql.pool.execute(
						`UPDATE caseInspection SET SurveyId = ?, Notes = ? WHERE InspectId = ?`,
						[ surveyId, notes, id ]);
				} 
				
				if (state == -2) {
					[ result ] = await request.tendersql.pool.execute(
						`UPDATE caseInspection SET isActive = 0 WHERE InspectId = ?`,
						[ id ] );
				} else if (state == -1) {
					[ result ] = await request.tendersql.pool.execute(
						`UPDATE caseInspection SET DateCompleted_With = NULL, DateCompleted_At = NULL WHERE InspectId = ?`,
						[ id ] );
				} else if (state == 1) {
					[ result ] = await request.tendersql.pool.execute(
						`UPDATE caseInspection SET Duty_with = ? WHERE InspectId = ?`,
						[ uid, id ]);
				} else if (state == 2) {
					[result] = await request.tendersql.pool.execute(
						`UPDATE caseInspection SET DateCompleted_With = ?, DateCompleted_At = NOW() WHERE InspectId = ?`,
						[ uid, id ]);
				}

				return {
					statusCode: 20000,
					message: 'successful',
					result
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 複製
		server.route({
			method: 'PUT',
			path: '/inspection/list/{id}/copy',
			options: {
				description: '巡查歷程(複製)',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					payload: Joi.object({
						zipCode: Joi.number().required().description('行政區'),
						notes: Joi.string().allow('').default('').description('備註')
					})
				}
			},
			handler: async function (request, h) {
				const { id } = request.params;
				const { zipCode, notes } = request.payload;

				const [result] = await request.tendersql.pool.execute(
					`INSERT INTO caseInspection (ZipCode, DateCollect_At, Notes, url) 
					SELECT ? AS ZipCode, DateCollect_At, ? AS Notes, url FROM caseInspection WHERE InspectId = ?`,
					[ zipCode, notes, id ]);

				return {
					statusCode: 20000,
					message: 'successful',
					result
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 缺失標記
		// ----------------------------------------------------------------------------------------------------
		// 取得geoJSON
		server.route({
			method: 'GET',
			path: '/inspection/panoramaJson',
			options: {
				description: '街景JSON',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						surveyId: Joi.number().default(0).description("TendersSurvey id"),
						inspectId: Joi.number().default(0).description('巡查Id')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { surveyId, inspectId } = request.query;
				const sqlCMD = surveyId != 0 ? ` AND SurveyId = ${surveyId}` : ` AND InspectId = ${inspectId}`;  

				const [ res_inspection ] = await request.tendersql.pool.execute(
					`SELECT * FROM caseInspection WHERE IsActive = 1 ${sqlCMD}`
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { inspection: res_inspection }
				};
			},
		});
		
		server.route({
			method: 'GET',
			path: '/inspection/caseGeoJson',
			options: {
				description: '缺失地理資訊',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						surveyId: Joi.number().default(0).description("TendersSurvey id"),
						caseSurveyId: Joi.number().default(0).description("前次TendersSurvey id"),
						inspectId: Joi.number().default(0).description('巡查Id'),
						caseInspectId: Joi.number().default(0).description('前次巡查Id'),
						trackingId: Joi.number().default(0).description('缺失追蹤Id')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { surveyId, caseSurveyId, inspectId, caseInspectId, trackingId } = request.query;

				let geoJSON = {
					"caseNow": {
						"type": "FeatureCollection",
						"name": "caseGeoJSON",
						"features": []
					},
					"casePrev": {
						"type": "FeatureCollection",
						"name": "caseGeoJSON",
						"features": []
					}
				};

				let sqlCMD = surveyId != 0 ? ` AND SurveyId = ${surveyId}` : ` AND InspectId = ${inspectId}`;
				if (trackingId != 0) sqlCMD += ` AND (caseDetection.id = ${trackingId} OR TrackingId = ${trackingId})`;
				// if (trackingId != 0) {
				// 	sqlCMD += ` AND (caseDetection.id = ${trackingId} OR TrackingId = ${trackingId})`;
				// 	if (caseInspectId != 0) sqlCMD += ` OR (InspectId = ${caseInspectId} AND caseDetection.IsActive = 1 AND id NOT IN (SELECT TrackingId FROM caseDetection WHERE InspectId = ${inspectId} AND IsActive = 1) AND (TrackingId = 0 OR TrackingId NOT IN(SELECT TrackingId FROM caseDetection WHERE InspectId = ${inspectId} AND IsActive = 1)) AND (caseDetection.id = ${trackingId} OR TrackingId = ${trackingId}))`;
				// 	if (caseSurveyId != 0) sqlCMD += ` OR (SurveyId = ${caseSurveyId} AND caseDetection.IsActive = 1 AND id NOT IN (SELECT TrackingId FROM caseDetection LEFT JOIN caseInspection USING(InspectId) WHERE SurveyId = ${surveyId} AND caseDetection.IsActive = 1) AND (TrackingId = 0 OR TrackingId NOT IN (SELECT TrackingId FROM caseDetection LEFT JOIN caseInspection USING(InspectId) WHERE SurveyId = ${surveyId} AND caseDetection.IsActive = 1)) AND (caseDetection.id = ${trackingId} OR TrackingId = ${trackingId}))`; 
				// } else {
				// 	if (caseInspectId != 0) sqlCMD += ` OR (InspectId = ${caseInspectId} AND caseDetection.IsActive = 1 AND id NOT IN (SELECT TrackingId FROM caseDetection WHERE InspectId = ${inspectId} AND IsActive = 1) AND (TrackingId = 0 OR TrackingId NOT IN(SELECT TrackingId FROM caseDetection WHERE InspectId = ${inspectId} AND IsActive = 1)))`;
				// 	if (caseSurveyId != 0) sqlCMD += ` OR (SurveyId = ${caseSurveyId} AND caseDetection.IsActive = 1 AND id NOT IN (SELECT TrackingId FROM caseDetection LEFT JOIN caseInspection USING(InspectId) WHERE SurveyId = ${surveyId} AND caseDetection.IsActive = 1) AND (TrackingId = 0 OR TrackingId NOT IN (SELECT TrackingId FROM caseDetection LEFT JOIN caseInspection USING(InspectId) WHERE SurveyId = ${surveyId} AND caseDetection.IsActive = 1)))`; 
				// }

				const [ res_caseList ] = await request.tendersql.pool.execute(
					`SELECT 
						id,
						InspectId,
						SurveyId,
						TrackingId,
						CompetentId,
						DistressType,
						DistressLevel,
						Place,
						DateReport,
						Direction,
						Lane,
						ImgZoomIn,
						ImgZoomOut,
						MillingLength,
						MillingWidth,
						MillingArea,
						MarkType,
						DateMark_At,
						ST_AsGeoJson(IFNULL(Geom, Wkb_geometry)) AS Geometry,
						ST_ASGeoJSON(ST_Centroid(ST_GeomFromText(ST_AsText(IFNULL(Geom, Wkb_geometry))))) AS CenterPt
					FROM 
						caseDetection 
						LEFT JOIN caseInspection USING(InspectId)
					WHERE 
						caseDetection.IsActive = 1 
						${sqlCMD}
					ORDER BY InspectId ASC`
				);		
				const res_casePrevList = await server.methods.inspection.getPrevCase(caseInspectId, caseSurveyId);
				const caseTrackingIdArr = res_caseList.map(caseSpec => caseSpec.TrackingId);
				const res_casePrevFilter = res_casePrevList.filter(caseSpec => {
					if (trackingId != 0) return !caseTrackingIdArr.includes(caseSpec.id) && (caseSpec.TrackingId == 0 || !caseTrackingIdArr.includes(caseSpec.TrackingId)) && (caseSpec.id == trackingId || caseSpec.TrackingId == trackingId);
					else return !caseTrackingIdArr.includes(caseSpec.id) && (caseSpec.TrackingId == 0 || !caseTrackingIdArr.includes(caseSpec.TrackingId));
				})

				for (const caseSpec of [...res_caseList, ...res_casePrevFilter ]) {
					const [lat, lng] = [ Math.min(...caseSpec.CenterPt.coordinates), Math.max(...caseSpec.CenterPt.coordinates) ];
					const flatLevel = caseSpec.Geometry.type == 'MultiPoint' ? 0 : caseSpec.Geometry.type == 'MultiLineString' ? 1 : 2;
					let feature = {
						"type": "Feature",
						"properties": {
							"Id": caseSpec.id,
							"InspectId": caseSpec.InspectId,
							"TrackingId": caseSpec.TrackingId,
							"CompetentId": caseSpec.CompetentId,
							"DistressType": caseSpec.DistressType,
							"DistressLevel": caseSpec.DistressLevel,
							"Place": caseSpec.Place,
							"DateReport": caseSpec.DateReport,
							"Direction": caseSpec.Direction,
							"Lane": caseSpec.Lane,
							"ImgZoomIn": caseSpec.ImgZoomIn,
							"ImgZoomOut": caseSpec.ImgZoomOut,
							"MillingLength": caseSpec.MillingLength,
							"MillingWidth": caseSpec.MillingWidth,
							"MillingArea": caseSpec.MillingArea,
							"MarkType": caseSpec.MarkType,
							"DateMark_At": caseSpec.DateMark_At,
							"CenterPt": { lat, lng },
							"Coordinates": caseSpec.Geometry.coordinates.flat(flatLevel),
							"isPoint": caseSpec.Geometry.type == 'MultiPoint',
							"isLine": caseSpec.Geometry.type == 'MultiLineString' 
						},
						"geometry": caseSpec.Geometry
					};

					// console.log(feature);
					const key = ((surveyId != 0 && caseSpec.SurveyId == surveyId) || (inspectId != 0 && caseSpec.InspectId == inspectId)) ? 'caseNow' : 'casePrev';
					geoJSON[key].features.push(feature);
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { caseGeoJson: geoJSON }
				};
			},
		});

		// 標記
		server.route({
			method: 'POST',
			path: '/inspection/caseUpload',
			options: {
				description: '缺失標記',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						uploadType: Joi.number().allow(1, 2).required().description('上傳類型: 0:誤判; 1. 新增/追蹤; 2. 完工'),
						inspectId: Joi.number().required().description('巡查id'),
						trackingId: Joi.number().default(0).description('缺失追蹤id'),
						dateReport: Joi.string().required().description("通報日期"),
						competentId: Joi.number().default(0).description('權責單位id'),
						distressType: Joi.number().required().description("缺失類別"),
						distressLevel: Joi.number().required().description("損壞程度"),
						millingLength: Joi.number().default(0).description("預估長度"),
						millingWidth: Joi.number().default(0).description("預估寬度"),
						millingArea: Joi.number().default(0).description("預估面積"),
						place: Joi.string().allow('').default('').description("地址"),
						direction: Joi.number().required().description("路向(0: 無; 1: 順; 2: 逆)"),
						lane: Joi.number().required().description("車道"),
						geoJson: Joi.string().required().description("缺失geoJson"),
						imgZoomIn: Joi.alternatives().try(Joi.any().meta({ swaggerType: "file" }), Joi.array().items(Joi.any().meta({ swaggerType: "file" }))).description("圖片上傳(RAW)"),
						imgZoomOut: Joi.alternatives().try(Joi.any().meta({ swaggerType: "file" }), Joi.array().items(Joi.any().meta({ swaggerType: "file" }))).description("圖片上傳(RAW)"),
						imgZoomIn_unMark: Joi.alternatives().try(Joi.any().meta({ swaggerType: "file" }), Joi.array().items(Joi.any().meta({ swaggerType: "file" }))).description("圖片上傳_無框(RAW)"),
						pt_unMark: Joi.string().required().description("缺失標記點"),
					}).error((err) => console.log(err))
				},
				payload: {
					output: "stream",
					allow: "multipart/form-data",
					multipart: true
				}
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { uploadType, inspectId, trackingId, dateReport, competentId, distressType, distressLevel, millingLength, millingWidth, millingArea, place, direction, lane, geoJson } = request.payload;
				// console.log(uploadType, trackingId, geoJson);

				// 縱橫裂縫 -> LineString
				const geomCol = distressType == 29 ? "Wkb_geometry" : "Geom";

				const [ res ] = await request.tendersql.pool.execute(
					`INSERT INTO caseDetection (InspectId, TrackingId, DateReport, CompetentId, DistressType, DistressLevel, Place, Direction, Lane, ${geomCol}, MillingLength, MillingWidth, MillingArea, Duty_With, DateMark_At, markType)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ST_GeomFromGeoJSON(?, 1, 4326), ?, ?, ?, ?, ${uploadType == 1 ? 'NULL' : 'NOW()'}, ?)`,
					[ inspectId, trackingId, dateReport, competentId, distressType, distressLevel, place, direction, lane, geoJson, millingLength, millingWidth, millingArea, uid, uploadType ]);
				
				// console.log(res);

				for (const imgKey of ['ImgZoomIn', 'ImgZoomOut']) {
					const destFileName = `caseDetection/${res.insertId}_${imgKey}`;

					// 照片上傳至GCP
					try {
						server.methods.setBucket('adm_distress_image');
						await server.methods.getFileList(destFileName).then(async (existFileList) => {
							const file = request.payload[imgKey[0].toLowerCase() + imgKey.slice(1)];
							// console.log(file);
							const { ext } = parse(file.hapi.filename);
							const destFileNameSpec = `${destFileName}_${existFileList.length + 1}${ext}`;

							await server.methods.uploadFile(file._data, destFileNameSpec).then(async (publicUrl) => {
								await request.tendersql.pool.execute(
									`UPDATE caseDetection SET ${imgKey} = ? WHERE id = ?`,
									[decodeURIComponent(publicUrl), res.insertId]);

								// TODO: 坑洞(全)、龜裂(重)
								// if (distressType == 15 || (distressType == 16 && distressLevel == 3)) {
								// 	await request.tendersql.pool.execute(
								// 		`INSERT INTO caseDistress(CaseType, State, Coordinate, CoordinateX, CoordinateY, Place, Postal_vil, Direction, Lane, RoadType, DistressType, DistressLevel, DeviceType, RestoredType, DateCreate, ImgZoomIn, ImgZoomOut, MillingLength, MillingWidth, MillingArea, SurveyId, CaseDetectionId)
								// 		(
								// 			SELECT
								// 				4 AS CaseType,
								// 				0 AS State,
								// 				ST_Centroid(ST_GeomFromText(ST_AsWKT(IFNULL(Geom, Wkb_geometry)))) AS Coordinate,
								// 				ST_X(ST_Centroid(ST_GeomFromText(ST_AsWKT(IFNULL(Geom, Wkb_geometry), 'axis-order=long-lat')))) AS CoordinateX,
								// 				ST_Y(ST_Centroid(ST_GeomFromText(ST_AsWKT(IFNULL(Geom, Wkb_geometry), 'axis-order=long-lat')))) AS CoordinateY,
								// 				Place,
								// 				IFNULL(REGEXP_SUBSTR(Place, '.{2}里'), '') AS Postal_vil,
								// 				Direction,
								// 				Lane,
								// 				1 AS RoadType,
								// 				DistressType,
								// 				DistressLevel,
								// 				1 AS DeviceType,
								// 				1 AS RestoredType,
								// 				DateReport AS DateCreate,
								// 				ImgZoomIn,
								// 				ImgZoomOut,
								// 				MillingLength,
								// 				MillingWidth,
								// 				MillingArea,
								// 				caseInspection.SurveyId,
								// 				id AS CaseDetectionId
								// 			FROM 
								// 				caseDetection
								// 				LEFT JOIN caseInspection USING (InspectId)
								// 			WHERE id = ?
								// 	)`,
								// 	[res.insertId]);
								// }
							}).catch(err => console.log(err));
						}).catch(err => console.log(err));
					} catch(err) { console.log(err); }
				}

				// 上傳無框照片
				const destFileName = `caseDetection_unMark/${res.insertId}_ImageZoomIn_unMark`;
				// 照片上傳至GCP
				try {
					server.methods.setBucket('adm_distress_image');
					await server.methods.getFileList(destFileName).then(async (existFileList) => {
						const file = request.payload.imgZoomIn_unMark;
						// console.log(file);
						const { ext } = parse(file.hapi.filename);
						const destFileNameSpec = `${destFileName}_${existFileList.length + 1}${ext}`;

						await server.methods.uploadFile(file._data, destFileNameSpec).then(async (publicUrl) => {
							// console.log(publicUrl);
							await server.methods.uploadFile(request.payload.pt_unMark, destFileNameSpec.replace(ext, '.json')).then(async (publicUrl) => {
								// console.log(publicUrl);
							}).catch(err => console.log(err));
						}).catch(err => console.log(err));
					}).catch(err => console.log(err));
				} catch (err) { console.log(err); }

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 缺失標記列表
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/inspection/caseList',
			options: {
				description: '缺失標記列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						filter: Joi.number().default(-1).description("是否篩選「0: 誤判; 1: 已刪除; 2: 已完工」"),
						surveyId: Joi.number().default(0).description("TendersSurvey id_合約"),
						inspectId: Joi.number().default(0).description('巡查Id'),
						checkRoadName: Joi.boolean().default(false).description("是否篩選「路名錯誤」"),
						caseId: Joi.number().default(0).description('缺失Id'),
						trackingId: Joi.number().default(0).description('追蹤Id'),
						dutyWith: Joi.string().allow('').default('').description('通報人員'),
						caseType: Joi.string().allow('').default('').description("缺失類型"),
						timeStart: Joi.string().allow('').default('').description("開始時間"),
						timeEnd: Joi.string().allow('').default('').description("結束時間"),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					}).error(err => console.log(err))
				}   // GET
			},
			handler: async function (request, h) {
				const { filter, surveyId, inspectId, checkRoadName, caseId, trackingId, dutyWith, caseType, timeStart, timeEnd, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				if (surveyId == 0 && inspectId == 0 && caseId == 0 && trackingId == 0 && dutyWith.length == 0) 
					return { statusCode: 20000, message: 'successful', data: { list: [], total: 0 } };

				const districtList = {
					100: "中正區",
					103: "大同區",
					104: "中山區",
					105: "松山區",
					106: "大安區",
					108: "萬華區",
					110: "信義區",
					111: "士林區",
					112: "北投區",
					114: "內湖區",
					115: "南港區",
					116: "文山區"
				};

				let sqlCMD = filter == 1 
					? ` caseDetection.IsActive = 0` : [0, 2].includes(filter) 
					? ` caseDetection.IsActive = 1 AND caseDetection.DateMark_At IS NOT NULL AND caseDetection.MarkType = ${filter}` : trackingId != 0
					? ` caseDetection.IsActive = 1` : ` caseDetection.IsActive = 1 AND caseDetection.DateMark_At IS NULL`;
				if (surveyId != 0) sqlCMD += ` AND caseInspection.SurveyId = ${surveyId}`;
				if (inspectId != 0) sqlCMD += ` AND caseDetection.InspectId = ${inspectId}`;

				if (checkRoadName) {
					let zipCode = 0;
					if (surveyId != 0) {
						[[{ zipCode }]] = await request.tendersql.pool.execute(
							`SELECT
								Tenders.ZipCode AS zipCode
							FROM
								TendersSurvey
								LEFT JOIN Tenders USING(tenderId)
							WHERE TendersSurvey.id = ?`,
							[ surveyId ]
						);
					} else if (inspectId != 0) {
						[[{ zipCode }]] = await request.tendersql.pool.execute(
							`SELECT
								Tenders.ZipCode AS zipCode
							FROM
								caseInspection
								LEFT JOIN TendersSurvey ON TendersSurvey.id = caseInspection.SurveyId
								LEFT JOIN Tenders ON Tenders.tenderId = TendersSurvey.tenderId
							WHERE caseInspection.InspectId = ?`,
							[ inspectId ]
						);
					}
					const checkRoadName = districtList[zipCode];
					if(checkRoadName) sqlCMD += ` AND Place NOT LIKE '%${checkRoadName}%'`;
				}

				if (caseId != 0) sqlCMD += ` AND caseDetection.id = ${caseId}`;
				if (trackingId != 0) sqlCMD += ` AND (caseDetection.id = ${trackingId} OR TrackingId = ${trackingId})`;
				if (dutyWith.length != 0) sqlCMD += ` AND users.UserName = '${dutyWith}'`;
				if (caseType.length != 0) {
					const caseTypeFilter = JSON.parse(caseType);
					if (caseTypeFilter.length > 0) {
						for (const typeArr of caseTypeFilter) {
							sqlCMD += ` OR ( DistressType = ${typeArr[0]}`;
							if (typeArr[1] > 0) sqlCMD += ` AND DistressLevel = ${typeArr[1]}`;
							sqlCMD += ` )`;
						}
						sqlCMD = sqlCMD.replace("OR", "AND (");
						sqlCMD += ` )`;
					}
				}

				if (timeStart.length != 0 && timeEnd.length != 0) sqlCMD += ` AND DateReport >= '${timeStart}' AND DateReport < '${timeEnd}'`;
				// sqlCMD = sqlCMD.replace(/^ AND /, " WHERE ");
				
				const [ res_caseList ] = await request.tendersql.pool.execute(
					`SELECT 
						caseDetection.id,
						caseDetection.InspectId,
						caseInspection.SurveyId,
						TrackingId,
						DistressType,
						DistressLevel,
						Place,
						DateReport,
						MarkType,
						DateMark_At AS DateMark,
						Direction,
						Lane,
						ImgZoomIn,
						ImgZoomOut,
						MillingLength,
						MillingWidth,
						MillingArea,
						users.UserName AS Duty_With_Name,
						caseInspection.DateCollect_At AS DateCollect,
						ST_AsGeoJson(IFNULL(Geom, Wkb_geometry)) AS Geometry,
						ST_ASGeoJSON(ST_Centroid(ST_GeomFromText(ST_AsText(IFNULL(Geom, Wkb_geometry))))) AS CenterPt,
						caseDetection.IsActive,
						caseDetection.StatusDesc,
						Duplicate
					FROM 
						caseDetection 
						LEFT JOIN caseInspection USING (InspectId)
						LEFT JOIN account.users ON users.UserId = caseDetection.Duty_With
					WHERE
						${sqlCMD}
					LIMIT ? OFFSET ?`,
					[ String(pageSize), String(offset) ]
				);
				
				res_caseList.forEach(caseSpec => {
					const [lat, lng] = [ Math.min(...caseSpec.CenterPt.coordinates), Math.max(...caseSpec.CenterPt.coordinates) ];
					delete caseSpec.CenterPt;
					caseSpec.lat = lat;
					caseSpec.lng = lng;
				})

				const [[{ total }]] = await request.tendersql.pool.execute(
					`SELECT 
						COUNT(*) AS total 
					FROM 
						caseDetection 
						LEFT JOIN caseInspection USING (InspectId)
						LEFT JOIN account.users ON users.UserId = caseDetection.Duty_With
					WHERE 
						${sqlCMD}`
				);

				const [ res_caseInfo ] = await request.tendersql.pool.execute(
					`SELECT 
						DistressType,
						COUNT(*) AS count
					FROM 
						caseDetection 
						LEFT JOIN caseInspection USING (InspectId)
						LEFT JOIN account.users ON users.UserId = caseDetection.Duty_With
					WHERE
						${sqlCMD}
					GROUP BY DistressType`
				);

				let caseInfo = {};
				res_caseInfo.forEach(caseSpec => caseInfo[caseSpec.DistressType] = caseSpec.count);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: res_caseList, total, caseInfo }
				};
			},
		});

		server.route({
			method: 'PUT',
			path: '/inspection/caseList/{id}',
			options: {
				description: '缺失標記(修改)',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					payload: Joi.object({
						trackingId: Joi.number().default(-1).description('缺失追蹤id'),
						dateReport: Joi.string().allow('').default('').description("通報日期"),
						distressType: Joi.number().default(-1).description("缺失類別"),
						distressLevel: Joi.number().default(-1).description("損壞程度"),
						millingLength: Joi.number().default(-1).description("預估長度"),
						millingWidth: Joi.number().default(-1).description("預估寬度"),
						millingArea: Joi.number().default(-1).description("預估面積"),
						place: Joi.string().allow('').default('').description("地址"),
						direction: Joi.number().default(-1).description("路向(0: 無; 1: 順; 2: 逆)"),
						lane: Joi.number().default(-1).description("車道"),
						isActive: Joi.number().default(1),
						statusDesc: Joi.string().allow('').default('').description("刪除原因")
					}).error(err => console.log(err))
				}  
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { id } = request.params;
				// const { trackingId, dateReport, distressType, distressLevel, millingLength, millingWidth, millingArea, place, direction, lane } = request.payload;

				let distressUpdateArr = [];
				for (const col of ['trackingId', 'dateReport', 'distressType', 'distressLevel', 'millingLength', 'millingWidth', 'millingArea', 'place', 'direction', 'lane', 'isActive', 'statusDesc']) {
					if (['isActive', 'statusDesc'].includes(col) || request.payload[col] > 0 || (typeof request.payload[col] === 'string' && request.payload[col].length != 0)) {
						if (typeof request.payload[col] === 'string') distressUpdateArr.push(`${col[0].toUpperCase() + col.slice(1)} = '${request.payload[col]}'`);
						else distressUpdateArr.push(`${col[0].toUpperCase() + col.slice(1)} = ${request.payload[col]}`);
					}
				}
				const distressUpdateStr = distressUpdateArr.join(", ");

				const [ res ] = await request.tendersql.pool.execute(
					`UPDATE caseDetection SET ${distressUpdateStr}, DateUpdate_At = NOW(), Update_by = ? WHERE id = ?`,
					[ uid, id ]
				);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/inspection/caseImport',
			options: {
				description: '缺失已匯入列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				// validate: {
				// 	query: Joi.object({}).error((err) => console.log(err))
				// }   // GET
			},
			handler: async function (request, h) {
				let caseDetectionIdObj = {};
				const { rows: caseList } = await request.pg.client.query(
					`SELECT 
						"surveyId",
						COALESCE( ARRAY_AGG("caseDetectionId") FILTER (WHERE "caseDetectionId" IS NOT NULL), '{}') AS "caseDetectionIdList"
					FROM "qgis"."distress"
					GROUP BY "surveyId"`
				)

				for (const caseSpec of caseList) {
					if (caseSpec.caseDetectionIdList.length > 0) caseDetectionIdObj[caseSpec.surveyId] = caseSpec.caseDetectionIdList.map(l => Number(l));	
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { caseDetectionIdObj }
				};
			},
		});

		const districtList = {
			100: "中正區",
			103: "大同區",
			104: "中山區",
			105: "松山區",
			106: "大安區",
			108: "萬華區",
			110: "信義區",
			111: "士林區",
			112: "北投區",
			114: "內湖區",
			115: "南港區",
			116: "文山區"
		};

		server.route({
			method: 'POST',
			path: '/inspection/exportCaseDistress',
			options: {
				description: '缺失匯入環巡成果(案件列表)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						CaseDetectionId: Joi.array().items(Joi.number()).required().description("caseDetection id"),
					}).error((err) => console.log(err))
				}
			},
			handler: async function (request, h) {
				const { CaseDetectionId } = request.payload;

				let result = { total: CaseDetectionId.length, success: 0, duplicate: 0, addrFail: 0, surveyFail: 0 };

				// 取得缺失列表
				const [ res_caseList ] = await request.tendersql.pool.query(
					`SELECT 
						ST_AsWKT(ST_Centroid(ST_GeomFromText(ST_AsWKT(IFNULL(Geom, Wkb_geometry), 'axis-order=long-lat')))) AS Coordinate,
						ST_X(ST_Centroid(ST_GeomFromText(ST_AsWKT(IFNULL(Geom, Wkb_geometry), 'axis-order=long-lat')))) AS CoordinateX,
						ST_Y(ST_Centroid(ST_GeomFromText(ST_AsWKT(IFNULL(Geom, Wkb_geometry), 'axis-order=long-lat')))) AS CoordinateY,
						Place,
						IFNULL(REGEXP_SUBSTR(Place, '.{2}里'), '') AS Postal_vil,
						Direction,
						Lane,
						DistressType,
						DistressLevel,
						DateReport AS DateCreate,
						ImgZoomIn,
						ImgZoomOut,
						MillingLength,
						MillingWidth,
						MillingArea,
						id AS CaseDetectionId,
						Duplicate
					FROM caseDetection
					WHERE 
						caseDetection.IsActive = 1 
						AND caseDetection.DateMark_At IS NULL
						AND DistressType NOT IN (58)
						AND id IN (?)`,
						[CaseDetectionId]
				);
				
				
				for (let i = 0; i < res_caseList.length; i++) {
					const [ checkSurveyId ] = await request.tendersql.pool.execute(`
						SELECT d.InspectId, i.SurveyId
						FROM caseInspection AS i
						LEFT JOIN caseDetection AS d ON d.InspectId = i.InspectId
						WHERE d.id = ?`,
						[res_caseList[i].CaseDetectionId]
					);

					if (res_caseList[i].Duplicate == 1) result.duplicate++;
					else if (checkSurveyId[0].SurveyId == 0) result.surveyFail++;
					else {
						const [[{ zipCode }]] = await request.tendersql.pool.execute(
							`SELECT Tenders.zipCode
							FROM 
								TendersSurvey
								LEFT JOIN Tenders USING(tenderId)
							WHERE TendersSurvey.id = ?`,
							[ checkSurveyId[0].SurveyId ]
						);

						if (!res_caseList[i].includes(districtList[zipCode])) result.addrFail++;
						else {
							await request.tendersql.pool.execute(`
								INSERT INTO caseDistress(Coordinate, CoordinateX, CoordinateY, Place, Direction, Lane, DistressType, DistressLevel, DateCreate, ImgZoomIn, ImgZoomOut, MillingLength, MillingWidth, MillingArea, CaseDetectionId, CaseType, State, RoadType, DeviceType, RestoredType, SurveyId)
								VALUES (ST_GeomFromText(?, 4326, 'axis-order=long-lat'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 4, 0, 1, 1, 1, ?)`,
								[res_caseList[i].Coordinate, res_caseList[i].CoordinateX, res_caseList[i].CoordinateY, res_caseList[i].Place, res_caseList[i].Direction, res_caseList[i].Lane, res_caseList[i].DistressType, res_caseList[i].DistressLevel, res_caseList[i].DateCreate, String(res_caseList[i].ImgZoomIn), String(res_caseList[i].ImgZoomOut), res_caseList[i].MillingLength, res_caseList[i].MillingWidth, res_caseList[i].MillingArea, res_caseList[i].CaseDetectionId, checkSurveyId[0].SurveyId]
							);

							await request.tendersql.pool.execute(`
								UPDATE caseDetection SET Duplicate = 1 WHERE id = ?`,
								[res_caseList[i].CaseDetectionId]
							);

							result.success++;
						}
					}	
				}		
				return {
					statusCode: 20000,
					message: 'successful',
					result
				};
			},
		});

		server.route({
			method: 'POST',
			path: '/inspection/allCaseImport',
			options: {
				description: '缺失全部匯入',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						surveyId: Joi.number().required().description("TendersSurvey id"),
						targetType: Joi.number().required().description("匯入位置 - 1: caseDistress; 2: distress"),
						isSub: Joi.boolean().default(false).description("是否部分上傳 (坑洞: 全、龜裂: 重)")
					}).error((err) => console.log(err))
				}
			},
			handler: async function (request, h) {
				const { surveyId, targetType, isSub } = request.payload;

				// Step1: 取得caseInspect InspectId
				const [ res_inspectionList ] = await request.tendersql.pool.execute(
					`SELECT InspectId FROM caseInspection WHERE SurveyId = ?`,
					[ surveyId ]
				)
				if(res_inspectionList.length == 0) return Boom.notAcceptable();

				let result = { total: 0, success: 0, duplicate: 0, addrFail: 0 };

				const [[{ zipCode }]] = await request.tendersql.pool.execute(
					`SELECT Tenders.zipCode
					FROM 
						TendersSurvey
						LEFT JOIN Tenders USING(tenderId)
					WHERE TendersSurvey.id = ?`,
					[ surveyId ]
				);

				if(targetType == 1) {
					// Step2: 取得已匯入caseDistress的Id
					let [[{ caseDetectionIdList }]]= await request.tendersql.pool.execute(
						`SELECT 
							IFNULL(JSON_ARRAYAGG(caseDetectionId), '{}') AS "caseDetectionIdList"
						FROM caseDistress`
					);
					caseDetectionIdList = JSON.parse(caseDetectionIdList).filter(id => id != null);
					// console.log(caseDetectionIdList);

					const sql_CMD = isSub ? ` AND (DistressType = 15 OR (DistressType = 16 AND DistressLevel = 3))` : "";
					// Step3: 取得缺失列表
					const [ res_caseList ] = await request.tendersql.pool.query(
						`SELECT 
							ST_AsWKT(ST_Centroid(ST_GeomFromText(ST_AsWKT(IFNULL(Geom, Wkb_geometry), 'axis-order=long-lat')))) AS Coordinate,
							ST_X(ST_Centroid(ST_GeomFromText(ST_AsWKT(IFNULL(Geom, Wkb_geometry), 'axis-order=long-lat')))) AS CoordinateX,
							ST_Y(ST_Centroid(ST_GeomFromText(ST_AsWKT(IFNULL(Geom, Wkb_geometry), 'axis-order=long-lat')))) AS CoordinateY,
							Place,
							IFNULL(REGEXP_SUBSTR(Place, '.{2}里'), '') AS Postal_vil,
							Direction,
							Lane,
							DistressType,
							DistressLevel,
							DateReport AS DateCreate,
							ImgZoomIn,
							ImgZoomOut,
							MillingLength,
							MillingWidth,
							MillingArea,
							id AS CaseDetectionId
						FROM caseDetection
						WHERE 
							caseDetection.IsActive = 1 
							AND caseDetection.DateMark_At IS NULL
							AND InspectId IN (?)
							AND DistressType NOT IN (58)
							${sql_CMD}`,
						[ res_inspectionList.map(l => l.InspectId) ]
					)
					// console.log(res_caseList);

					// Step4: 寫入caseDistress
					result.total = res_caseList.length;
					for (const caseItem of res_caseList) {
						// console.log(caseItem);
						if (caseDetectionIdList.map(id => (Number(id))).includes(caseItem.CaseDetectionId)) {
							result.duplicate++;
							continue;
						}

						if (!caseItem.Place.includes(districtList[zipCode])) {
							result.addrFail++;
							continue;
						}
						
						await request.tendersql.pool.execute(
							`INSERT INTO caseDistress (CaseType, State, Coordinate, CoordinateX, CoordinateY, Place, Postal_vil, Direction, Lane, RoadType, DistressType, DistressLevel, DeviceType, RestoredType, DateCreate, ImgZoomIn, ImgZoomOut, MillingLength, MillingWidth, MillingArea, SurveyId, CaseDetectionId)
							VALUES (4, 0, ST_GeomFromText(?, 4326, 'axis-order=long-lat'), ?, ?, ?, ?, ?, ?, 1, ?, ?, 1, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
							[caseItem.Coordinate, caseItem.CoordinateX, caseItem.CoordinateY, caseItem.Place, caseItem.Postal_vil, caseItem.Direction, caseItem.Lane, caseItem.DistressType, caseItem.DistressLevel, caseItem.DateCreate, String(caseItem.ImgZoomIn), String(caseItem.ImgZoomOut), caseItem.MillingLength, caseItem.MillingWidth, caseItem.MillingArea, surveyId, caseItem.CaseDetectionId]
						);

						await request.tendersql.pool.execute(
							`UPDATE caseDetection SET Duplicate = 1 WHERE id = ?`,
							[caseItem.CaseDetectionId]
						); 

						result.success++;
					}
				}

				if(targetType == 2) {
					// Step2: 取得已匯入distress的Id
					const { rows: [{ caseDetectionIdList }] } = await request.pg.client.query(
						`SELECT
							COALESCE( ARRAY_AGG("caseDetectionId") FILTER (WHERE "caseDetectionId" IS NOT NULL), '{}') AS "caseDetectionIdList"
						FROM "qgis"."distress"
						WHERE "surveyId" = $1`,
						[ surveyId ]
					);

					// Step3: 取得缺失列表
					const [ res_caseList ] = await request.tendersql.pool.query(
						`SELECT 
							DateCollect_At AS dateCollect, 
							REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( DistressType, '15', '坑洞' ), '29', '縱橫裂縫'), '16', '龜裂'), '32', '車轍'), '18', '隆起與凹陷'), '51', '薄層剝離'), '50', '塊狀裂縫'), '53', "推擠"), '65', '補綻及管線回填'), '54', '冒油'), '55', '波浪狀鋪面'), '56', '車道與路肩分離'), '49', '滑溜裂縫'), '66', '骨材剝落'), '58', '人孔高差') AS distressType, 
							REPLACE ( REPLACE ( REPLACE ( DistressLevel, '1', '輕' ), '2', '中' ), '3', '重' ) AS distressLevel, 
							ST_AsWKT(Geom, 'axis-order=long-lat') AS geom, 
							ST_AsWKT(Wkb_geometry, 'axis-order=long-lat') AS wkb_geometry, 
							id AS caseDetectionId
						FROM  
							caseDetection 
							LEFT JOIN caseInspection USING(InspectId)
						WHERE 
							caseDetection.IsActive = 1 
							AND caseDetection.DateMark_At IS NULL
							AND InspectId IN (?) 
							AND DistressType IN (15, 29, 16, 32, 18, 51, 50, 53, 65, 54, 55, 56, 49, 66, 58)`,
							[ res_inspectionList.map(l => l.InspectId) ]
					)
					// console.log(res_caseList);

					// Step4: 寫入distress
					result.total = res_caseList.length;
					let sqlCMD_list = "";
					for (const caseItem of res_caseList) {
						// console.log(caseItem);
						if (caseDetectionIdList.map(id => (Number(id))).includes(caseItem.caseDetectionId)) {
							result.duplicate++;
							continue;
						}

						if (caseItem.wkb_geometry != null) sqlCMD_list += `(${surveyId}, '${DateTime.fromJSDate(caseItem.dateCollect).toFormat("yyyy-MM-dd hh:mm:ss")}', '${caseItem.distressType}', '${caseItem.distressLevel}', null, ST_GeomFromText('${caseItem.wkb_geometry}', 4326), ${caseItem.caseDetectionId}),`;
						else if (caseItem.geom != null) sqlCMD_list += `(${surveyId}, '${DateTime.fromJSDate(caseItem.dateCollect).toFormat("yyyy-MM-dd hh:mm:ss") }', '${caseItem.distressType}', '${caseItem.distressLevel}', ST_GeomFromText('${caseItem.geom}', 4326), null, ${caseItem.caseDetectionId}),`;
					}

					if (sqlCMD_list.length != 0) {
						sqlCMD_list = sqlCMD_list.replace(/,$/, "");
						// console.log(sqlCMD_list);

						const result_pg = await request.pg.client.query(`INSERT INTO "qgis"."distress" ( "surveyId", "dateCollect", "distressType", "distressLevel", "geom", "wkb_geometry", "caseDetectionId") VALUES ${sqlCMD_list}`);
						// console.log(result_pg);
						result.success = result_pg.rowCount;
					}
				}

				return {
					statusCode: 20000,
					message: 'successful',
					result
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/inspection/caseUploadNco',
			options: {
				description: '缺失上傳至新工處(結果) - 案件編號同步',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						team: Joi.number().required().description('分隊'),
						timeStart: Joi.string().required().description('開始時間(yyyy/MM/dd)'),
						// timeEnd: Joi.string().required().description('結束時間(yyyy/MM/dd)')
					}).error((err) => console.log(err))
				},
			},
			handler: async function (request, h) {
				const { team, timeStart } = request.query;

				let errList = [];
				// 新工處回打caseNo 只有第一分隊能打 且打回來只有當天日期
				const res_caseList = await superagent
					.get(`https://road.nco.taipei/APPservice/bim/getDefectList.ashx?sdt=${timeStart}&edt=${timeStart}&PowerAR=${team}`)
					.timeout(3600 * 3000);

				const [ res_receiveCaseList ] = await request.tendersql.pool.execute(`SELECT CaseNo FROM caseDistress`);
				const receiveCaseList = res_receiveCaseList.map(caseSpec => caseSpec.CaseNo);
				// console.log(receiveCaseList);

				const caseList = JSON.parse(res_caseList.text.replace(/\d+,/g, "")).map(caseSpec => caseSpec.NB).filter(id => !receiveCaseList.includes(Number(id)));
				// console.log(caseList.length);

				for(const caseNB of caseList) {
					const res_caseSpec = await superagent
						.get(`https://road.nco.taipei/APPservice/bim/getDefectInfo.ashx?nb=${caseNB}`)
						.timeout(3600 * 3000);
					const caseSpecJSON = JSON.parse(res_caseSpec.text);
					if (caseSpecJSON.length > 1) errList.push(caseNB);

					const caseSpec = JSON.parse(res_caseSpec.text)[0];
					const dateDeadlineArr = caseSpec.DET_FINISH_DT.split(" ");
					if (dateDeadlineArr[1] == '上午' && dateDeadlineArr[2] == '12:00:00') dateDeadlineArr[2] = '00:00:00';
					const dateDeadline = `${dateDeadlineArr[0]} ${dateDeadlineArr[2]}`;

					const [caseDetectionId, suffix] = caseSpec.DET_SOUR_CODE.replace(/SU\d{3}-/, "").split(/^(\d+)([A-Z]?)$/).slice(1, 3);
					console.log(caseSpec.DEFECT_NUMB, dateDeadline, Number(caseDetectionId), suffix);
					if (caseDetectionId) {
						await request.tendersql.pool.execute(
							`UPDATE caseDistress SET CaseNo = ?, State = 1, DateDeadline = ? WHERE CaseDetectionId = ? AND Suffix = ?`,
							[caseSpec.DEFECT_NUMB, dateDeadline, , Number(caseDetectionId), suffix || ""]
						);
					}
				}

				console.log("errList: ", errList);

				return {
					statusCode: 20000,
					message: 'successful',
					errList
				};
			},
		});

		server.route({
			method: 'POST',
			path: '/inspection/caseUploadNco',
			options: {
				description: '缺失上傳至新工處',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						surveyId: Joi.number().required().description("TendersSurvey id")
					}).error((err) => console.log(err))
				},
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { surveyId } = request.payload;

				const [[{ zipCode }]] = await request.tendersql.pool.execute(
					`SELECT Tenders.zipCode
					FROM 
						TendersSurvey
						LEFT JOIN Tenders USING(tenderId)
					WHERE TendersSurvey.id = ?`,
					[ surveyId ]
				);

				const [ res_caseList ] = await request.tendersql.pool.execute(
					`SELECT 
						SerialNo,
						RoadType,
						CoordinateX,
						CoordinateY,
						DistressType,
						DistressLevel,
						Place,
						Direction,
						Lane,
						DateCreate,
						ImgZoomIn,
						ImgZoomOut,
						MillingLength,
						MillingWidth,
						MillingDepth,
						MillingFormula,
						MillingArea,
						CaseDetectionId,
						Suffix
					FROM 
						caseDistress
					WHERE 
						caseDistress.SurveyId = ?
						AND caseDistress.CaseNo = 0`,
					[ surveyId ]);
				// console.log(res_caseList);

				let result = { total: res_caseList.length, success: 0, duplicate: 0, fail: 0};

				// 紀錄進程
				const [res_action] = await request.tendersql.pool.execute(
					`INSERT INTO _action (surveyId, type, total, dateCreate_By) VALUES (?, 1, ?, ?)`,
					[surveyId, result.total, uid]
				);

				await request.tendersql.pool.execute(
					`UPDATE TendersSurvey SET actionId = ? WHERE id = ?`,
					[res_action.insertId, surveyId]
				);
				
				const DistressTypeMap = {
					15: {
						name: "坑洞",
						nameForNco: "A1"
					},
					29: {
						name: "縱向及橫向裂縫",
						nameForNco: "A2"
					},
					16: {
						name: "龜裂",
						nameForNco: "A3"
					},
					32: {
						name: "車轍",
						nameForNco: "A4"
					},
					18: {
						name: "隆起與凹陷",
						nameForNco: "A5"
					},
					34: {
						name: "人手孔缺失",
						nameForNco: "A15"
					},
					51: {
						name: "薄層剝離",
						nameForNco: "A16"
					},
					21: {
						name: "其他",
						nameForNco: "A14"
					},
					50: {
						name: "塊狀裂縫",
						nameForNco: "A6"
					},
					53: {
						name: "推擠",
						nameForNco: "A7"
					},
					65: {
						name: "補綻及管線回填",
						nameForNco: "A8"
					},
					54: {
						name: "冒油",
						nameForNco: "A9"
					},
					55: {
						name: "波浪狀鋪面",
						nameForNco: "A10"
					},
					56: {
						name: "車道與路肩分離",
						nameForNco: "A11"
					},
					49: {
						name: "滑溜裂縫",
						nameForNco: "A12"
					},
					66: {
						name: "骨材剝落",
						nameForNco: "A13"
					},
					58: {
						name: "人孔高差",
						nameForNco: ""
					}
				};

				async function getBase64Image(imgUrl) {
					return new Promise((resolve, reject) => {
						superagent.get(imgUrl).buffer(true).parse(superagent.parse.image).then(async (res) => {
							resolve(res.body.toString('base64'));
						}).catch(err => reject(err));
					})
				}

				const districtList = {
					100: "中正區",
					103: "大同區",
					104: "中山區",
					105: "松山區",
					106: "大安區",
					108: "萬華區",
					110: "信義區",
					111: "士林區",
					112: "北投區",
					114: "內湖區",
					115: "南港區",
					116: "文山區"
				};

				let firstSuccess = false;

				const executeProcess = new Promise(async (resolve, reject) => {
					for (const caseSpec of res_caseList) {
						// TODO: 暫時將人行道和設施的缺失歸類到「其他」
						let distress = caseSpec.DistressType;
						if (!DistressTypeMap[distress]) {
							distress = 21;
							console.log(`change: ${caseSpec.DistressType} -> ${distress}`);
						}
						const defectBad = DistressTypeMap[distress].nameForNco;
						if (defectBad.length == 0 || !caseSpec.Place.includes(districtList[zipCode])) continue;
						if (String(caseSpec.ImgZoomIn) == 'null') continue;
						console.log(result.success, `SU${zipCode}-${caseSpec.CaseDetectionId}${caseSpec.Suffix}`, caseSpec.Place);
						
						const payload = {
							"token": process.env.NCO_KEY,
							// "isObserve": caseSpec.DistressLevel >= 2 ? "N" : "Y",
							"isObserve": "Y",
							"user": "聖東營造",
							"addr": caseSpec.Place.trim(),
							"roadDirect": caseSpec.Direction == 1 ? 'F' : 'R',
							"roadNum": String(caseSpec.Lane),
							"defect_name": caseSpec.RoadType == 1 ? "A" : "B",
							"defect_bad": defectBad,
							"gis_lon": caseSpec.CoordinateX,
							"gis_lat": caseSpec.CoordinateY,
							// "img_1": await getBase64Image(caseSpec.ImgZoomIn),
							// "img_2": await getBase64Image(caseSpec.ImgZoomOut),
							// "img_1": await getBase64Image(caseSpec.ImgZoomIn.replace("caseDetection", "caseDetection_unMark").replace("ImgZoomIn", "ImageZoomIn_unMark")),
							// "defect_date": DateTime.fromJSDate(caseSpec.DateCreate).toFormat("yyyy/MM/dd"),
							"defect_date": DateTime.now().toFormat("yyyy/MM/dd"),
							"det_sour_code": `SU${zipCode}-${caseSpec.CaseDetectionId}${caseSpec.Suffix}`,
							"det_level": caseSpec.DistressLevel
						};
	
						await getBase64Image(caseSpec.ImgZoomIn.replace("caseDetection", "caseDetection_unMark").replace("ImgZoomIn", "ImageZoomIn_unMark")).then(res => payload.img_1 = res).catch(async (err) => {
							// console.log(err);
							payload.img_1 = await getBase64Image(caseSpec.ImgZoomIn);
							if (String(caseSpec.ImgZoomOut) != 'null') payload.img_2 = await getBase64Image(caseSpec.ImgZoomOut);
						});
						
						
						if (!firstSuccess) {
							firstSuccess = true;
							resolve({
								statusCode: 20000,
								message: 'successful',
								result
							});
						}
						
						
						// console.log(payload);
						
						await superagent
							.post("https://road.nco.taipei/RoadWebApi/api/Road2/AddDefectCase")
							.timeout(3600 * 3000)
							.send(payload)
							.then(async(res) => {
								// 寫入caseDistressLog
								await request.tendersql.pool.execute(
									`INSERT INTO caseDistressLog (DistressId, IsSuccess, Result) VALUES (?, ?, ?)`,
									[caseSpec.SerialNo, res.body.IsSuccess, JSON.stringify(res.body)]);
	
								if (res.body.IsSuccess) {
									result.success++;
	
									// 更新caseDistress
									await request.tendersql.pool.execute(
										`UPDATE caseDistress SET CaseNo = 1, DateUpload = ? WHERE SerialNo = ?`,
										[payload.defect_date, caseSpec.SerialNo]
									);
	
									// 紀錄進程
									await request.tendersql.pool.execute(
										`UPDATE _action SET success = ?, dateUpdate_At = NOW() WHERE id = ?`,
										[result.success, res_action.insertId]
									);
	
								} else {
									result.fail++;
	
									// 紀錄進程
									await request.tendersql.pool.execute(
										`UPDATE _action SET fail = ?, dateUpdate_At = NOW() WHERE id = ?`,
										[result.fail, res_action.insertId]
									);
								}
							}).catch(async(err) => {
								console.log(err);
	
								// 紀錄進程
								await request.tendersql.pool.execute(
									`UPDATE _action SET note = ?, dateUpdate_At = NOW() WHERE id = ?`,
									[err, res_action.insertId]
								);
							})
					}
					
				});
				return executeProcess;
				

				// return {
				// 	statusCode: 20000,
				// 	message: 'successful',
				// 	result
				// };
			},
		});

		server.route({
			method: 'POST',
			path: '/inspection/caseDistressCopy',
			options: {
				description: '合約管理 - 缺失匯入(複製)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						surveyId: Joi.number().required().description('TendersSurvey id'),
						tenderId: Joi.number().required().description('契約'),
						title: Joi.string().required().description('TendersSurvey標題'),
						round: Joi.number().required().description('TendersSurvey round'),
						roundStart: Joi.string().required().description('起始時間'),
						roundEnd: Joi.string().required().description('結束時間')
					}).error((err) => console.log(err))
				},
			},
			handler: async function (request, h) {
				const { surveyId, tenderId, title, round, roundStart, roundEnd } = request.payload;

				// 上個月的相關資料撈出來
				const [ res ] = await request.tendersql.pool.execute(`
					SELECT d.*
					FROM caseDistress AS d
					LEFT JOIN TendersSurvey AS s ON s.id = d.SurveyId
					LEFT JOIN Tenders AS t ON t.tenderId = s.tenderId
					WHERE d.SurveyId = ?`,
					[surveyId]
				);

				// 新增合約TendersSurvey
				const [ newTendersSurvey ] = await request.tendersql.pool.execute(`
					INSERT INTO TendersSurvey (tenderId, title, round, isShadow, roundStart, roundEnd, zipCode, actionId)
					VALUES (?, ?, ?, 0, ?, ?, 0, 0)`,
					[tenderId, title, round, roundStart, roundEnd]
				);

				// 抓最新Survey Id
				const [[ newSurvey ]] = await request.tendersql.pool.execute(`
					SELECT id FROM TendersSurvey ORDER BY id DESC LIMIT 1
				`);

				console.log(newSurvey);

				let result = { total: 0, success: 0 };

				const suffixString = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
				let newSuffix = '';

				// 把資料匯入caseDistress
				const importCaseDistress = res.forEach(async item => {
					const suffixIndex = suffixString.indexOf(item.Suffix);
					// 抓取字母表的下一個英文字母 A -> B
					if (suffixString[suffixIndex] == item.Suffix) {
						newSuffix = suffixString[suffixIndex + 1];
					}

					const [ importDistress ] = await request.tendersql.pool.execute(`
						INSERT INTO caseDistress (
							ApplyId, InformId, CaseSN, CaseNo, CaseSucc, CaseType, BlockSN, State, StateNotes, IsActive, 
							Coordinate, CoordinateX, CoordinateY, Place, Postal_vil, Direction, Lane, RoadType, DistressType, DistressLevel, 
							DeviceType, RestoredType, DateCreate, DateUpload, DatePlan, DateAssign, DateMarking, DateClose, DateDeadline, ImgZoomIn, 
							ImgZoomOut, MillingDepth, MillingLength, MillingWidth, MillingFormula, MillingArea, Aggregate34, Aggregate38, IsPressing, Notes, 
							TaskRealGroup, KitNotes, Content, DateCreate_At, DateUpdate_At, SurveyId, CaseDetectionId, CaseCenterId, Suffix, SurveyIdPre)
						VALUES (
							?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 
							ST_GeomFromText(?, 4326, 'axis-order=long-lat'), ?, ?, ?, ?, ?, ?, ?, ?, ?, 
							?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
							?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
							?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						[item.ApplyId, item.InformId, item.CaseSN, item.CaseSucc, item.CaseType, item.BlockSN, item.State, item.StateNotes, item.IsActive, 
						`POINT (${item.CoordinateX}  ${item.CoordinateY})`, item.CoordinateX, item.CoordinateY, item.Place, item.Postal_vil, item.Direction, item.Lane, item.RoadType, item.DistressType, item.DistressLevel, 
						item.DeviceType, item.RestoredType, item.DateCreate, item.DateUpload, item.DatePlan, item.DateAssign, item.DateMarking, item.DateClose, item.DateDeadline, item.ImgZoomIn,
						item.ImgZoomOut, item.MillingDepth, item.MillingLength, item.MillingWidth, item.MillingFormula, item.MillingArea, item.Aggregate34, item.Aggregate38, item.IsPressing, item.Notes, 
						item.TaskRealGroup, item.KitNotes, item.Content, item.DateCreate_At, item.DateUpdate_At, newSurvey.id, item.CaseDetectionId, item.CaseCenterId, newSuffix || 'A', item.SurveyIdPre]
					);
					result.success++;
				});

				result.total = res.length;

				return {
					statusCode: 20000,
					message: 'successful',
					result
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 缺失追蹤列表
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/inspection/caseTrackingList',
			options: {
				description: '缺失追蹤列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						filter: Joi.boolean().default(false).description("是否篩選「已刪除」"),
						surveyId: Joi.number().required().description("TendersSurvey id"),
						caseType: Joi.string().default('[]').description("缺失類型"),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					}).error(err => console.log(err))
				}   // GET
			},
			handler: async function (request, h) {
				const { filter, surveyId, caseType, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				let sqlCMD = ` WHERE caseDistress.SurveyId = ${surveyId}`;
				sqlCMD += filter ? ` AND IFNULL(caseDistressPI.PIState, 0) & 16` : ` AND NOT IFNULL(caseDistressPI.PIState, 0) & 16`;
				const caseTypeFilter = JSON.parse(caseType);
				if (caseTypeFilter.length != 0) {
					if (caseTypeFilter.length > 0) {
						for (const typeArr of caseTypeFilter) {
							sqlCMD += ` OR ( caseDistress.DistressType = ${typeArr[0]}`;
							if (!typeArr[1].includes(0)) sqlCMD += ` AND caseDistress.DistressLevel IN (${typeArr[1].join(",")})`;
							sqlCMD += ` )`;
						}
						sqlCMD = sqlCMD.replace("OR", "AND (");
						sqlCMD += ` )`;
					}
				} else sqlCMD += ` AND (caseDistress.DistressType = 15 OR (caseDistress.DistressType = 16 AND caseDistress.DistressLevel = 3))`;
				// console.log(sqlCMD);

				const [res_caseList] = await request.tendersql.pool.query(
					`SELECT 
						caseDetection.id,
						caseDistress.SerialNo,
						caseDistress.CaseDetectionId,
						caseDistress.SurveyId,
						caseDetection.TrackingId,
						caseDistress.DistressType,
						caseDistress.DistressLevel,
						caseDistress.Place,
						caseDistress.Postal_vil,
						caseDistress.Direction,
						caseDistress.Lane,
						caseDistress.RoadType,
						caseDistress.RestoredType,
						caseDistress.DeviceType,
						caseDistress.DateCreate,
						caseDistress.ImgZoomIn,
						caseDistress.ImgZoomOut,
						caseDistress.MillingLength,
						caseDistress.MillingWidth,
						caseDistress.MillingDepth,
						caseDistress.MillingFormula,
						caseDistress.MillingArea,
						ST_AsGeoJson(IFNULL(Geom, Wkb_geometry)) AS Geometry,
						ST_ASGeoJson(Coordinate) AS CenterPt,
						IFNULL(caseDistressPI.PIState, 0) AS PIState,
						IFNULL(caseDistressPI.PIStateNotes, '{}') AS PIStateNotes,
						(SELECT username FROM account.users WHERE UserId IN (caseDistressPI_prev.OperatorId, caseDistressFlow.Uid)) AS PIUsername,
						IFNULL(caseDistressPI_prev.CreatedAt, caseDistressFlow.Create_At) AS PICreateAt,
						IFNULL(caseDistressPI.PCIValue, 0) AS PCIValue,
						IFNULL(caseDistressFlow.FlowState, 0) AS FlowState,
						IFNULL(caseDistressFlow.FlowDesc, '') AS FlowDesc,
						caseDistressFlow.Create_At AS FlowCreateAt
					FROM 
						caseDistress
						LEFT JOIN caseDetection ON caseDetection.id = caseDistress.CaseDetectionId
						LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active IS TRUE
						LEFT JOIN (
							SELECT * FROM caseDistressPI WHERE id IN (SELECT MIN(id) FROM caseDistressPI WHERE PIState & 1 OR PIState & 16 GROUP BY caseSID)
						) AS caseDistressPI_prev ON caseDistressPI_prev.caseSID = caseDistress.SerialNo
						LEFT JOIN (
							SELECT * FROM caseDistressFlow WHERE id IN (SELECT MAX(id) FROM caseDistressFlow GROUP BY DistressId)
						) AS caseDistressFlow ON caseDistressFlow.DistressId = caseDistress.SerialNo
					${sqlCMD}
					LIMIT ? OFFSET ?`,
					[ pageSize, offset ]
				);

				res_caseList.forEach(caseSpec => {
					const [lat, lng] = [Math.min(...caseSpec.CenterPt.coordinates), Math.max(...caseSpec.CenterPt.coordinates)];
					// delete caseSpec.CenterPt;
					caseSpec.lat = lat;
					caseSpec.lng = lng;
				})

				const [[{ total }]] = await request.tendersql.pool.execute(
					`SELECT 
						COUNT(*) AS total 
					FROM 
						caseDistress
						LEFT JOIN caseDetection ON caseDetection.id = caseDistress.CaseDetectionId
						LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active = 1
					${sqlCMD}`
				);

				const [res_caseInfo] = await request.tendersql.pool.execute(
					`SELECT 
						caseDistress.DistressType,
						COUNT(*) AS count
					FROM 
						caseDistress
						LEFT JOIN caseDetection ON caseDetection.id = caseDistress.CaseDetectionId
						LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active = 1
					${sqlCMD}
					GROUP BY DistressType`
				);

				let caseInfo = {};
				res_caseInfo.forEach(caseSpec => caseInfo[caseSpec.DistressType] = caseSpec.count);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: res_caseList, total, caseInfo }
				};
			},
		});

		server.route({
			method: 'POST',
			path: '/inspection/caseTrackingList/{id}',
			options: {
				description: '缺失追蹤列表(個別)_修改',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required().description("tbl_case SerialNo"),
					}),
					payload: Joi.object({
						DetectionId: Joi.number().required().description("caseDetection Id"),
						RoadType: Joi.number().required().description("道路種類"),
						RestoredType: Joi.number().default(0).description("維護類型"),
						DeviceType: Joi.number().required().description("設施類型"),
						Place: Joi.string().required().description("地址"),
						Postal_vil: Joi.string().required().description("里別"),
						Lane: Joi.number().required().description("車道"),
						Direction: Joi.number().required().description("路向(0: 無; 1: 順; 2: 逆)"),
						DateCreate: Joi.string().required().description("通報日期"),
						DistressType: Joi.number().required().description("損壞類型"),
						DistressLevel: Joi.number().required().description("損壞程度"),
						MillingLength: Joi.number().default(0).description("預估長度"),
						MillingWidth: Joi.number().default(0).description("預估寬度"),
						MillingDepth: Joi.number().default(0).description("預估深度"),
						MillingFormula: Joi.string().default('0').description("預估複雜算式"),
						MillingArea: Joi.number().default(0).description("預估面積")
					}).error((err) => console.log(err))
				}
			},
			handler: async function (request, h) {
				const { id } = request.params;
				let payload = request.payload;

				// Step1: 更新caseDistress
				let distressUpdateArr = ["RoadType", "RestoredType", "DeviceType", "Place", "Postal_vil", "Lane", "Direction", "DateCreate", "DistressType", "DistressLevel", "MillingLength", "MillingWidth", "MillingDepth", "MillingFormula", "MillingArea"];
				const distressUpdateStr = distressUpdateArr.map(col => {
					let key = col;
					return (payload[col] instanceof String || (typeof payload[col]).toLowerCase() == 'string') && payload[col].indexOf('"') != 0
						? `${key} = '${payload[col]}'` : `${key} = ${payload[col]}`;
				}).join(",");
				// console.log(distressUpdateStr);

				await request.tendersql.pool.execute(
					`UPDATE caseDistress SET ${distressUpdateStr} WHERE SerialNo = ?`,
					[ id ]
				);

				// Step2: 更新caseDetection
				let detectionUpdateArr = ["Place", "Lane", "Direction", "DistressType", "DistressLevel", "MillingLength", "MillingWidth", "MillingArea"];
				const detectionUpdateStr = detectionUpdateArr.map(col => {
					let key = col;
					return (payload[col] instanceof String || (typeof payload[col]).toLowerCase() == 'string') && payload[col].indexOf('"') != 0
						? `${key} = '${payload[col]}'` : `${key} = ${payload[col]}`;
				}).join(",");
				// console.log(detectionUpdateStr);

				await request.tendersql.pool.execute(
					`UPDATE caseDetection SET ${detectionUpdateStr} WHERE id = ?`,
					[ payload.DetectionId ]
				);

				// Step3: 更新 distress
				const typeMap = {
					DistressTypeMap: {
						15: "坑洞",
						29: "縱橫裂縫",
						16: "龜裂",
						32: "車轍",
						18: "隆起與凹陷",
						51: "薄層剝離",
						50: "塊狀裂縫",
						53: "推擠",
						65: "補綻及管線回填",
						54: "冒油",
						55: "波浪狀鋪面",
						56: "車道與路肩分離",
						49: "滑溜裂縫",
						66: "骨材剝落",
						58: "人孔高差"
					},
					DistressLevelMap: {
						1: "輕",
						2: "中",
						3: "重"
					}
				}

				let distressPGUpdateArr = [ "DistressType", "DistressLevel" ];
				const distressPGUpdateStr = distressPGUpdateArr.map(col => {
					const key = col[0].toLowerCase() + col.slice(1);
					const val = typeMap[`${col}Map`][payload[col]];
					return (val instanceof String || (typeof val).toLowerCase() == 'string') && val.indexOf('"') != 0
						? `"${key}" = '${val}'` : `"${key}" = ${val}`;
				}).join(",");
				// console.log(distressPGUpdateStr);

				await request.pg.client.query(
					`UPDATE "qgis"."distress" SET ${distressPGUpdateStr} WHERE "caseDetectionId" = $1`,
					[ payload.DetectionId ]
				);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 提交結果(caseDistress)
		server.route({
			method: 'PUT',
			path: '/inspection/caseTrackingList/flow/{id}',
			options: {
				description: '缺失追蹤列表(提交結果)',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					payload: Joi.object({
						flowState: Joi.number().required().description("狀態(1: 主任判定, 2: 分工判核(監造), 4: 分工判核(分隊), 8: 施工前會勘 )"),
						flowDesc: Joi.string().default('{}').description("狀態說明")
					})
				}
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { id } = request.params;
				const { flowState, flowDesc } = request.payload;

				await request.tendersql.pool.execute(
					`INSERT INTO caseDistressFlowV2 (DistressId, FlowState, FlowDesc, Create_By, Create_At) VALUES (?, ?, ?, ?, NOW())
						ON DUPLICATE KEY UPDATE FlowState = ?, FlowDesc = ?, Update_By = ?, Update_At = NOW()`,
					[id, flowState, flowDesc, uid, flowState, flowDesc, uid]
				);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/inspection/caseTrackingStatic',
			options: {
				description: '案件回報分析',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						surveyId: Joi.number().required().description("TendersSurvey id")
					}).error(err => console.log(err))
				}   // GET
			},
			handler: async function (request, h) {
				const { surveyId } = request.query;

				const [[ res_static ]] = await request.tendersql.pool.execute(
					`SELECT 
						COUNT(*) AS total,
						SUM(CASE WHEN DATEDIFF(NOW(), caseDistress.DateCreate_At) <= 7 THEN 1 ELSE 0 END) AS addCount,
						SUM(CASE WHEN NOT (IFNULL(caseDistressPI.PIState, 0) & 1) AND IFNULL(caseDistressFlow.FlowState, 0) = 0 THEN 1 ELSE 0 END) AS unReportCount,
						SUM(CASE WHEN (IFNULL(caseDistressPI.PIState, 0) & 1 AND IFNULL(caseDistressFlow.FlowState, 0) = 0) OR IFNULL(caseDistressFlow.FlowState, 0) = 1 THEN 1 ELSE 0 END) AS workCount,
						SUM(CASE WHEN IFNULL(caseDistressFlow.FlowState, 0) = 2 THEN 1 ELSE 0 END) AS finCount,
						SUM(CASE WHEN IFNULL(caseDistressFlow.FlowState, 0) IN (3, 4) THEN 1 ELSE 0 END) AS rejectCount
					FROM 
						caseDistress
						LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active IS TRUE
						LEFT JOIN (
							SELECT * FROM caseDistressFlow WHERE id IN (SELECT MAX(id) FROM caseDistressFlow GROUP BY DistressId)
						) AS caseDistressFlow ON caseDistressFlow.DistressId = caseDistress.SerialNo
					WHERE 
						caseDistress.SurveyId = ?
						AND (caseDistress.DistressType = 15 OR (caseDistress.DistressType = 16 AND caseDistress.DistressLevel = 3))`,
					[surveyId]
				);

				const [res_list] = await request.tendersql.pool.execute(
					`SELECT 
						caseDistress.CaseNo,
						caseDistress.CaseDetectionId,
						caseDistress.DistressType,
						caseDistress.DistressLevel,
						IFNULL(users.UserName, '') AS FlowUName,
						IFNULL(caseDistressFlow.FlowState, 0) AS FlowState,
						IFNULL(caseDistressFlow.FlowDesc, '') AS FlowDesc
					FROM 
						caseDistress
						LEFT JOIN (
							SELECT * FROM caseDistressFlow WHERE id IN (SELECT MAX(id) FROM caseDistressFlow GROUP BY DistressId)
						) AS caseDistressFlow ON caseDistressFlow.DistressId = caseDistress.SerialNo
						LEFT JOIN account.users ON users.UserId = caseDistressFlow.Uid
					WHERE 
						caseDistress.SurveyId = ?
						AND (caseDistress.DistressType = 15 OR (caseDistress.DistressType = 16 AND caseDistress.DistressLevel = 3))
						AND IFNULL(caseDistressFlow.FlowState, 0) IN (3, 4)`,
					[surveyId]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: res_list, static: res_static }
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/inspection/caseTrackingStaticTime',
			options: {
				description: '案件回報分析 - 時間',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						startDate: Joi.string().description('開始時間'),
						endDate: Joi.string().description('結束時間'),
						surveyId: Joi.number().required().description("TendersSurvey id")
					}).error(err => console.log(err))
				}   // GET
			},
			handler: async function (request, h) {
				const { startDate, endDate, surveyId } = request.query;

				const [[ res_static ]] = await request.tendersql.pool.execute(
					`SELECT 
						COUNT(*) AS total,
						SUM(CASE WHEN DATEDIFF(NOW(), caseDistress.DateCreate_At) <= 7 THEN 1 ELSE 0 END) AS addCount,
						SUM(CASE WHEN NOT (IFNULL(caseDistressPI.PIState, 0) & 1) AND IFNULL(caseDistressFlow.FlowState, 0) = 0 THEN 1 ELSE 0 END) AS unReportCount,
						SUM(CASE WHEN (IFNULL(caseDistressPI.PIState, 0) & 1 AND IFNULL(caseDistressFlow.FlowState, 0) = 0) OR IFNULL(caseDistressFlow.FlowState, 0) = 1 THEN 1 ELSE 0 END) AS workCount,
						SUM(CASE WHEN IFNULL(caseDistressFlow.FlowState, 0) = 2 THEN 1 ELSE 0 END) AS finCount,
						SUM(CASE WHEN IFNULL(caseDistressFlow.FlowState, 0) IN (3, 4) THEN 1 ELSE 0 END) AS rejectCount
					FROM 
						caseDistress
						LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active IS TRUE
						LEFT JOIN (
							SELECT * FROM caseDistressFlow WHERE id IN (SELECT MAX(id) FROM caseDistressFlow GROUP BY DistressId)
						) AS caseDistressFlow ON caseDistressFlow.DistressId = caseDistress.SerialNo
					WHERE 
						caseDistress.SurveyId = ?
						AND caseDistress.DateCreate_At >= ? AND caseDistress.DateCreate_At < ?
						AND (caseDistress.DistressType = 15 OR (caseDistress.DistressType = 16 AND caseDistress.DistressLevel = 3))`,
					[surveyId, startDate, endDate]
				);


				return {
					statusCode: 20000,
					message: 'successful',
					data: { static: res_static }
				};
			},
		});
	},
};
