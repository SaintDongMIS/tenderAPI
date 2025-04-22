'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const { DateTime } = require("luxon");
const superagent = require("superagent");

const authStrategy = false; 
//const authStrategy = 'simple';

exports.plugin = {
	//pkg: require('./package.json'),
	name: 'tgosTool',
	version: '0.0.0',
	register: async function (server, options) {

		// Validate with Joi 
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: "GET",
			path: "/tgosTool/pointQueryAddr",
			options: {
				tags: ["api"],
				description: "坐標回傳門牌",
				validate: {
					query: Joi.object({
						lat: Joi.number().required().description("緯度"),
						lng: Joi.number().required().description("經度"),
						range: Joi.number().default(50).description("範圍")
					}),
				}
			},
			handler: async function (request) {
				const { lat, lng, range } = request.query;

				const postData = {
					'oAPPId': process.env.TGOS_APPID,
					'oAPIKey': process.env.TGOS_APPKEY,
					'oPX': lng,
					'oPY': lat,
					'oBuffer': range,
					'oSRS': 'EPSG:4326',
					'oResultDataType': 'JSON',
					'oIsShowCodeBase': false
				};
				const formBody = Object.keys(postData).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(postData[key])).join('&');

				const res = await superagent
					.post("https://addr.tgos.tw/addrws/v40/GeoQueryAddr.asmx/PointQueryAddr?")
					.timeout(3600 * 3000)
					.send(formBody);

				return {
					statusCode: 20000,
					message: 'successful',
					data: res.text
				};
			}
		});

		// -----------------------------------------------------------------------------------------------------
		server.route({
			method: "GET",
			path: "/rm100/caseDistress",
			options: {
				tags: ["api"],
				description: "caseDistress匯出",
				validate: {
					query: Joi.object({
						filterMode: Joi.string().allow('Default', 'Distress').default('Default').description("篩選類型(Default主任標記 / Distress缺失篩選"),
						// timeMode: Joi.string().allow('UploadTime', 'CreateTime').default('UploadTime').description("時間篩選類型(UploadTime上傳新工時間 / CreateTime成案時間)"),
						zipCode: Joi.number().default(0).description("行政區"),
						distressType: Joi.number().default(0).description("缺失類型"),
						distressLevel: Joi.number().default(0).description("缺失程度"),
						idStart: Joi.number().required().description("開始id"),
						idEnd: Joi.number().default(0).description("結束id"),
						limit: Joi.number().default(100).max(200)
					}),
				},
				cache: {
					expiresIn: 60 * 60 * 1000,
					privacy: 'private'
				}
			},
			handler: async function (request) {
				const { filterMode, zipCode, distressType, distressLevel, idStart, idEnd, limit } = request.query;
				console.log("/rm100/caseDistress:", filterMode, zipCode, distressType, distressLevel, idStart, idEnd, limit);

				let sqlCMD = ` AND caseDetectionId >= ${idStart}`;
				if (idEnd != 0) sqlCMD += ` AND caseDetectionId <= ${idEnd}`;
				if (zipCode != 0) sqlCMD += ` AND Tenders.ZipCode <= ${zipCode}`;

				switch (filterMode) {
					case 'Default': 
						sqlCMD += ` AND IFNULL(PIState, 0) & 1`;
						break;
					case 'Distress':
						if (distressType != 0) sqlCMD += ` AND DistressType = ${distressType}`;
						if (distressLevel != 0) sqlCMD += ` AND DistressLevel = ${distressLevel}`;
						break;
				}

				// switch (timeMode) {
				// 	case 'CreateTime':
				// 		if (timeStart.length != 0) sqlCMD = ` AND DateCreate >= '${timeStart}'`;
				// 		if (timeEnd.length != 0) sqlCMD += ` AND DateCreate < '${timeEnd}'`;
				// 		break;
				// 	case 'UploadTime':
				// 		if (timeStart.length != 0) sqlCMD = ` AND DateUpload >= '${timeStart}'`;
				// 		if (timeEnd.length != 0) sqlCMD += ` AND DateUpload < '${timeEnd}'`;
				// 		break;
				// }
				// if (sqlCMD.length == 0) return Boom.notAcceptable("Not-allow");

				const [ res_caseList ] = await request.tendersql.pool.execute(
					`SELECT 
						caseDetectionId,
						CaseNo,
						Tenders.ZipCode,
						DistressType,
						DistressLevel,
						Place,
						DateCreate,
						DateUpload,
						Direction,
						Lane,
						ImgZoomIn,
						ImgZoomOut,
						MillingLength,
						MillingWidth,
						MillingDepth,
						MillingArea,
						CoordinateX, 
						CoordinateY
					FROM 
						caseDistress 
						LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active = 1
						LEFT JOIN TendersSurvey ON TendersSurvey.id = caseDistress.SurveyId
						LEFT JOIN Tenders USING(TenderId)
					WHERE 
						IsActive = 1
						${sqlCMD}
					LIMIT ?`, 
					[ String(limit) ]
				);

				const [[{ total }]] = await request.tendersql.pool.execute(
					`SELECT 
						COUNT(*) AS total 
					FROM 
						caseDistress 
						LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active = 1
						LEFT JOIN TendersSurvey ON TendersSurvey.id = caseDistress.SurveyId
						LEFT JOIN Tenders USING(TenderId)
					WHERE 
						IsActive = 1 
						${sqlCMD}`
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: {
						list: res_caseList,
						listLen: res_caseList.length,
						total,
						lastId: res_caseList[res_caseList.length - 1] ? res_caseList[res_caseList.length - 1].id : 0
					}
				};
			}
		});

		// ----------------------------------------------------------------------------------------------------
		// 提交結果(caseDistress)
		server.route({
			method: 'PUT',
			path: '/rm100/caseDistress/{id}',
			options: {
				description: 'caseDistress (提交結果)',
				// auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required().description('CaseDetectionId')
					}),
					payload: Joi.object({
						flowState: Joi.number().allow(0, 1).default(0).description("狀態(1: 派工中, 2: 完工)"),
						flowDesc: Joi.string().allow('').default('').description("狀態說明")
					})
				}
			},
			handler: async function (request, h) {
				const { id } = request.params;
				const { flowState, flowDesc } = request.payload;

				const [[res]] = await request.tendersql.pool.execute(
					`SELECT 
						caseDistress.SerialNo,
						caseDistressFlow.Image
					FROM 
						caseDistressFlow
						RIGHT JOIN caseDistress ON caseDistress.SerialNo = caseDistressFlow.DistressId
					WHERE CaseDetectionId = ?
					ORDER BY id DESC
					LIMIT 1`,
					[id]);

				if (res == undefined) return Boom.notAcceptable('Case Not Found');

				const image = res.Image != undefined ? res.Image : '[]';
				await request.tendersql.pool.execute(
					`INSERT INTO caseDistressFlow (DistressId, FlowState, FlowDesc, Image, Uid)
					VALUES ( ?, ?, ?, ?, 0)`,
					[res.SerialNo, flowState, flowDesc, image]);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// -----------------------------------------------------------------------------------------------------
		server.route({
			method: "GET",
			path: "/tool/correctGeom",
			options: {
				tags: ["api"],
				description: "修正地理資訊",
				// validate: {
				// 	query: Joi.object({}),
				// },
			},
			handler: async function (request) {
				// const {  } = request.query;

				await request.pg.client.query(`
					UPDATE "unitRoad"
					SET "wkb_geometry" = ST_CurveToLine("wkb_geometry")
					WHERE ST_GeometryType("wkb_geometry") = 'ST_MultiSurface';`
				);

				await request.pg.client.query(`			
					UPDATE "unitRoadBlock"
					SET "wkb_geometry" = ST_CurveToLine("wkb_geometry")
					WHERE ST_GeometryType("wkb_geometry") = 'ST_MultiSurface'`
				);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			}
		});

		// -----------------------------------------------------------------------------------------------------
		server.route({
			method: "PUT",
			path: "/tool/correctGeoJson",
			options: {
				tags: ["api"],
				description: "修正地理資訊格式",
				validate: {
					payload: Joi.object({
						tenderId: Joi.number().required().description('tenderId')
					}),
				},
			},
			handler: async function (request) {
				const { tenderId } = request.payload;

				const [[block]] = await request.tendersql.pool.execute(`
					SELECT tableName FROM Tenders WHERE tenderId = ?`,
					[tenderId]
				);

				const res = await request.pg.client.query(`
					UPDATE "qgis"."${block.tableName}"
					SET "wkb_geometry" = ST_CurveToLine("wkb_geometry")
					WHERE ST_GeometryType("wkb_geometry") = 'ST_MultiSurface';
				`);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			}
		});

		/* Router End */   
	},
};
