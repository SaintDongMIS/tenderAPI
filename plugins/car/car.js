'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const { parse } = require('path');
const { DateTime } = require("luxon");

const authStrategy = false;
//const authStrategy = 'simple';

const sql = require('mssql');

const sqlConfig_1 = {
	user: 'center',
	password: 'center',
	database: 'tp_center',
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
	name: 'carInspect',
	version: '0.0.0',
	register: async function (server, options) {

		// ----------------------------------------------------------------------------------------------------
		// 巡視案件
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/car/insCases',
			options: {
				description: '巡視案件',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						contractId: Joi.number().default(99).description("標案ID"),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { contractId, timeStart, timeEnd } = request.query;

				// NOTE: contractId 與 gteam 的對應
				const contractMap = { 1: 1, 2: 2, 3: 5, 4: 4, 5: 3, 6: 6 };
				const caseTypeMap = { 15: '坑洞', 16: '龜裂', 34: '人手孔破損', 29: '縱向與橫向裂縫' };

				const [ res_TendersGroup ] = await request.tendersql.pool.execute(
					`SELECT 
							TendersSurvey.id AS surveyId
						FROM 
							TendersSurvey
							LEFT JOIN Tenders USING(tenderId)
							LEFT JOIN TendersGroup ON TendersGroup.groupId = Tenders.groupId
						WHERE 
							TendersSurvey.title = '道路巡視'
							${contractId == 99 ? '' : ` AND TendersGroup.contractId = '${contractId}'`}`
				);

				let result = [];
				// NOTE: 三、六標額外讀取
				if([ 3, 6 ].includes(contractId)) {
					[ result ] = await request.tendersql.pool.query(
						`SELECT 
							SerialNo AS serialno,
							CoordinateY AS xx,
							CoordinateX AS yy,
							Place AS casename, 
							Direction, 
							Lane, 
							DistressType, 
							DistressLevel AS broketype,
							DateCreate AS reportTime, 
							MillingLength AS elength,
							MillingWidth AS blength,
							MillingArea,
							'2' AS reccontrol,
							ImgZoomIn AS imgfile
						FROM caseDistress
						WHERE SurveyId IN (?) AND DateCreate >= ? AND DateCreate < ? AND CaseCenterId = -1`,
						[ res_TendersGroup.map(survey => survey.surveyId), timeStart, timeEnd ]
					);
					
					result.forEach(caseSpec => {
						caseSpec.caseType = caseTypeMap[caseSpec.DistressType];
					})


				} else {
					let [[{ caseCenterIdList }]] = await request.tendersql.pool.execute(
						`SELECT IFNULL(JSON_ARRAYAGG(dataceterId), '[]') AS "caseCenterIdList" FROM caseCenterStatus`
					);
					caseCenterIdList = JSON.parse(caseCenterIdList).filter(id => id != null);

					await sql.connect(sqlConfig_1);
					const sqlCMD =
						`SELECT serialno, yy, xx, casename, [損壞類別] AS caseType, [查報日期時間] AS reportTime, btype, broketype, elength, blength, imgfile, reccontrol
						FROM datacenter
						WHERE 
							reccontrol != '8' 
							AND [查報日期時間] >= '${timeStart}' AND [查報日期時間] < '${timeEnd}'
						${contractId == 99 ? '' : ` AND gteam = '${contractMap[contractId]}'`}
						${caseCenterIdList.length == 0 ? '' : ` AND serialno NOT IN ( ${caseCenterIdList.join(',')} )`}`

					const { recordsets } = await sql.query(sqlCMD);
					result = recordsets[0];
					sql.close();

					let res_caseDistress = [];
					if (result.length > 0) {
						[res_caseDistress] = await request.tendersql.pool.query(
							`SELECT 
								CoordinateX, CoordinateY, Place, Direction, Lane, DistressType, DistressLevel, DateCreate, MillingLength, MillingWidth, MillingArea, CaseCenterId, ImgZoomIn
							FROM caseDistress
							WHERE CaseCenterId IN (?)`,
							[ result.map(caseSpec => caseSpec.serialno) ]
						);
					}

					result.forEach(caseSpec => {
						const caseFilter = res_caseDistress.filter(caseDSpec => caseDSpec.CaseCenterId == caseSpec.serialno);
						if (caseFilter.length > 0) {
							caseSpec.xx = caseFilter[0].CoordinateY;
							caseSpec.yy = caseFilter[0].CoordinateX;
							caseSpec.casename = caseFilter[0].Place;
							caseSpec.caseType = caseTypeMap[caseFilter[0].DistressType];
							caseSpec.broketype = caseFilter[0].DistressLevel;
							caseSpec.elength = caseFilter[0].MillingLength;
							caseSpec.blength = caseFilter[0].MillingWidth;
							caseSpec.reccontrol = '2';
							caseSpec.imgfile = caseFilter[0].ImgZoomIn;
						}
					})
				}

				// 1999
				const [ res_1999 ] = await request.tendersql.pool.execute(`
					SELECT 
						id AS serialno,
						CaseNo,
						'1999' AS type,
						WGS84_x AS xx,
						WGS84_y AS yy, 
						LocationReport AS casename, 
						DamageDesc AS caseType, 
						DamageCondition,
						'' AS imgfile
					FROM caseListLog
					WHERE 
						ContractId = ? 
						AND DateReport >= ?
						AND DateReport < ?`,
					[ contractId, timeStart, timeEnd ]
				);

				// 坑洞(臨補)
				const [ res_hole ] = await request.tendersql.pool.query(
					`SELECT 
						SerialNo AS serialno,
						CaseNo,
						'坑洞(臨補)' AS type,
						CoordinateY AS xx,
						CoordinateX AS yy,
						Place AS casename, 
						Direction, 
						Lane, 
						DistressType, 
						DistressLevel AS broketype,
						DateCreate AS reportTime, 
						MillingLength AS elength,
						MillingWidth AS blength,
						MillingArea,
						'2' AS reccontrol,
						ImgZoomIn AS imgfile
					FROM caseDistress
					WHERE 
						DistressType = 15
						AND SurveyId IN (?) 
						AND DateCreate >= ? AND DateCreate < ? 
						AND CaseCenterId = 0`,
					[ res_TendersGroup.map(survey => survey.surveyId), timeStart, timeEnd ]
				);

				res_hole.forEach(caseSpec => {
					caseSpec.caseType = caseTypeMap[caseSpec.DistressType];
				})

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: [ ...result, ...res_1999, ...res_hole ] }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 巡視分案
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/car/insCases',
			options: {
				description: '巡視分案',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						contractId: Joi.number().required().description("標案ID"),
						zipCode: Joi.number().required().description('郵遞區號'),
						caseId: Joi.number().required().description('缺失Id'),
						reportTime: Joi.string().required().description("通報日期"),
						distressType: Joi.number().required().description('缺失類型'),
						distressLevel: Joi.number().required().description('缺失程度'),
						millingLength: Joi.number().default(0).description("預估長度"),
						millingWidth: Joi.number().default(0).description("預估寬度"),
						millingArea: Joi.number().default(0).description("預估面積"),
						place: Joi.string().allow('').default('').description("地址"),
						position: Joi.object({
							lng: Joi.number().required().description('經度'),
							lat: Joi.number().required().description('緯度')
						}),
						direction: Joi.number().required().description("路向(0: 無; 1: 順; 2: 逆)"),
						lane: Joi.number().required().description('車道'),
						imgUrl: Joi.string().allow('').default('').description("照片網址")
					}).error(err => console.log(err))
				}
			},
			handler: async function (request, h) {
				const { contractId, zipCode, caseId, reportTime, distressType, distressLevel, millingLength, millingWidth, millingArea, place, position, direction, lane, imgUrl } = request.payload;

				let [ res_TendersGroup ] = await request.tendersql.pool.execute(
					`SELECT 
						TendersSurvey.id AS surveyId
					FROM 
						TendersSurvey
						LEFT JOIN Tenders USING(tenderId)
						LEFT JOIN TendersGroup ON TendersGroup.groupId = Tenders.groupId
					WHERE TendersGroup.contractId = ? AND TendersSurvey.title = '道路巡視'`,
					[ contractId ]
				);
				if(res_TendersGroup.length == 0) return Boom.notAcceptable('SurveyId not Found!');
				else if(res_TendersGroup.length > 1) res_TendersGroup = res_TendersGroup.filter(group => group.zipCode == zipCode);

				const [ res_distress ] = await request.tendersql.pool.execute(
					`INSERT INTO caseDistress(Coordinate, CoordinateX, CoordinateY, Place, Direction, Lane, DistressType, DistressLevel, DateCreate, MillingLength, MillingWidth, MillingArea, CaseCenterId, CaseType, State, RoadType, DeviceType, RestoredType, SurveyId)
					VALUES (ST_GeomFromText(?, 4326, 'axis-order=long-lat'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 4, 0, 1, 1, 1, ?)`,
					[`POINT (${position.lng}  ${position.lat})`, position.lng, position.lat, place, direction, lane, distressType, distressLevel, reportTime, millingLength, millingWidth, millingArea, caseId, res_TendersGroup[0].surveyId]
				);

				const destFileName = `tbl_case_image/${res_distress.insertId}_ImgZoomIn`;
				await server.methods.getFileList(destFileName).then(async (existFileList) => {
					const imgUrlObj = new URL(imgUrl);
					const pathname = imgUrlObj.pathname;
					const url = imgUrlObj.href;
					const { ext } = parse(pathname);
					const destFileNameSpec = `${destFileName}_${existFileList.length + 1}${ext}`;

					await server.methods.uploadFileUrl(url, destFileNameSpec).then(async (publicUrl) => {
						await request.tendersql.pool.execute(
							`UPDATE caseDistress SET ImgZoomIn = ? WHERE SerialNo = ?`,
							[decodeURIComponent(publicUrl), res_distress.insertId]
						);
					}).catch(err => console.log(err));
				}).catch(err => console.log(err));

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 巡視案件刪除
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'delete',
			path: '/car/insCases',
			options: {
				description: '巡視案件刪除',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						caseId: Joi.number().required().description('缺失Id'),
						status: Joi.number().default(0).description('狀態 (0: 刪除)')
					}).error(err => console.log(err))
				}
			},
			handler: async function (request, h) {
				// const { clearOperatorID } = request.auth.artifacts;
				const { caseId, status } = request.payload;

				await request.tendersql.pool.execute(
					`INSERT INTO caseCenterStatus (dataceterId, status) VALUES (?, ?)
					ON DUPLICATE KEY UPDATE status = ?`,
					[ caseId, status, status]
				);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 巡視判核
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/car/caseList',
			options: {
				description: '巡視判核列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						groupId: Joi.number().default(0).description("TendersGroup groupId"),
						timeStart: Joi.string().allow('').default('').description('起始時間'),
						timeEnd: Joi.string().allow('').default('').description('結束時間'),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					}).error(err => console.log(err))
				}   // GET
			},
			handler: async function (request, h) {
				const { groupId, timeStart, timeEnd, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				const sqlCMD_timeCondi = (timeStart.length != 0 && timeEnd.length != 0) ? ` AND caseDistress.DateCreate >= '${timeStart}' AND caseDistress.DateCreate < '${timeEnd}' ` : '';
				const sqlCMD_filter = ` AND caseDistress.SurveyId IN (SELECT TendersSurvey.id FROM TendersSurvey LEFT JOIN Tenders USING(tenderId) WHERE TendersSurvey.title = '道路巡視' AND groupId = ${groupId}) `;
				// console.log(sqlCMD);

				const [res_caseList] = await request.tendersql.pool.query(
					`SELECT 
						caseDistress.SerialNo,
						caseDistress.CaseDetectionId,
						caseDistress.SurveyId,
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
						ST_ASGeoJson(Coordinate) AS CenterPt,
						IFNULL(caseDistressFlowV2.FlowState, 0) AS FlowState,
						IFNULL(caseDistressFlowV2.FlowDesc, '') AS FlowDesc,
						caseDistressFlowV2.Create_At AS FlowCreateAt
					FROM 
						caseDistress
						LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active IS TRUE
						LEFT JOIN (
							SELECT * FROM caseDistressPI WHERE id IN (SELECT MIN(id) FROM caseDistressPI WHERE PIState & 1 OR PIState & 16 GROUP BY caseSID)
						) AS caseDistressPI_prev ON caseDistressPI_prev.caseSID = caseDistress.SerialNo
						LEFT JOIN caseDistressFlowV2 ON caseDistressFlowV2.DistressId = caseDistress.SerialNo
					WHERE
						caseDistress.IsActive = 1
						${sqlCMD_filter}
						${sqlCMD_timeCondi}
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
						LEFT JOIN caseDistressPI ON caseDistressPI.caseSID = caseDistress.SerialNo AND caseDistressPI.Active = 1
					WHERE
						caseDistress.IsActive = 1
						${sqlCMD_filter}
						${sqlCMD_timeCondi}`
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: res_caseList, total }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 提交結果(caseDistress)
		server.route({
			method: 'PUT',
			path: '/car/caseList/flow/{id}',
			options: {
				description: '巡視判核(主任審核)',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					payload: Joi.object({
						flowState: Joi.number().required().description("狀態(1: 主任判定派工, 16: 不須派工 )"),
						flowDesc: Joi.string().default('{}').description("狀態說明")
					})
				}
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { id } = request.params;
				const { flowState, flowDesc } = request.payload;

				if (flowState == 1) {
					await request.tendersql.pool.execute(
						`INSERT INTO caseDistressFlowV2 (DistressId, FlowState, FlowDesc, Create_By, Create_At) VALUES (?, 1, ?, ?, NOW())
							ON DUPLICATE KEY UPDATE FlowState = 1, FlowDesc = ?, Update_By = ?, Update_At = NOW()`,
						[id, flowDesc, uid, flowDesc, uid]
					);
				} else {
					await request.tendersql.pool.execute(
						`INSERT INTO caseDistressFlowV2 (DistressId, FlowState, FlowDesc, Create_By, Create_At) VALUES (?, 16, ?, ?, NOW())
							ON DUPLICATE KEY UPDATE FlowState = 16, FlowDesc = ?, Update_By = ?, Update_At = NOW()`,
						[id, flowDesc, uid, flowDesc, uid]
					);
				}
				

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 案件歷程
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/car/caseLog',
			options: {
				description: '1999案件列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						ContractId: Joi.number().required().description('標案ID'),
						timeStart: Joi.string().description('起始時間'),
						timeEnd: Joi.string().description('結束時間'),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					})
				}
			},
			handler: async function (request, h) {
				const { ContractId, timeStart, timeEnd, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;
				const sqlCMD = (timeStart && timeStart.length != 0) ? `AND DateReport >= '${timeStart}' AND DateReport < '${timeEnd}'` : '';

				const [ res ] = await request.tendersql.pool.execute(`
					SELECT id, CaseNo, DateReport, ContractId, ZipCode, ReportUser, ReceiveUser, LocationReport, 
						EstimatedDate, SourceNo, DamageDesc, DamageCondition, AreaFix, TemporaryFix, SourceReport, 
						CaseCondition, WGS84_x, WGS84_y
					FROM caseListLog
					WHERE ContractId = ? ${sqlCMD}
					ORDER BY DateReport DESC
					LIMIT ? OFFSET ?`,
					[ContractId, String(pageSize), String(offset)]
				);

				const [[{ total }]] = await request.tendersql.pool.execute(`
					SELECT COUNT(*) as total
					FROM caseListLog
					WHERE ContractId = ? ${sqlCMD}`,
					[ContractId]
				)

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: res, total }
				};
			},
		});

		server.route({
			method: 'GET',
			path: '/car/caseLogAll',
			options: {
				description: '1999 - 顯示全部(六個標)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						timeStart: Joi.string().description('起始時間'),
						timeEnd: Joi.string().description('結束時間'),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					})
				}
			},
			handler: async function (request, h) {
				const { timeStart, timeEnd, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;
				const sqlCMD = (timeStart && timeStart.length != 0) ? `AND DateReport >= '${timeStart}' AND DateReport < '${timeEnd}'` : '';

				const [ res ] = await request.tendersql.pool.execute(`
					SELECT id, CaseNo, DateReport, ContractId, ZipCode, ReportUser, ReceiveUser, LocationReport, 
						EstimatedDate, SourceNo, DamageDesc, DamageCondition, AreaFix, TemporaryFix, SourceReport, 
						CaseCondition, WGS84_x, WGS84_y
					FROM caseListLog
					WHERE ContractId IN (1, 2, 3, 4, 5, 6) ${sqlCMD}
					ORDER BY DateReport DESC
					LIMIT ? OFFSET ?`,
					[String(pageSize), String(offset)]
				);

				const [[{ total }]] = await request.tendersql.pool.execute(`
					SELECT COUNT(*) as total
					FROM caseListLog
					WHERE ContractId IN (1, 2, 3, 4, 5, 6) ${sqlCMD}`
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: res, total }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 上傳案件
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/car/importCase',
			options: {
				description: '上傳案件',
				// auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						contractId: Joi.number().required().description("標案ID"),
						zipCode: Joi.number().required().description('郵遞區號'),
						reportTime: Joi.string().required().description("通報日期"),
						distressType: Joi.number().required().description('缺失類型'),
						distressLevel: Joi.number().required().description('缺失程度'),
						millingLength: Joi.number().default(0).description("預估長度"),
						millingWidth: Joi.number().default(0).description("預估寬度"),
						millingArea: Joi.number().default(0).description("預估面積"),
						place: Joi.string().allow('').default('').description("地址"),
						position: Joi.object({
							lng: Joi.number().required().description('經度'),
							lat: Joi.number().required().description('緯度')
						}),
						direction: Joi.number().required().description("路向(0: 無; 1: 順; 2: 逆)"),
						lane: Joi.number().required().description('車道'),
						imgUrl: Joi.string().allow('').default('').description("照片網址")
					}).error(err => console.log(err))
				}
			},
			handler: async function (request, h) {
				const { contractId, zipCode, reportTime, distressType, distressLevel, millingLength, millingWidth, millingArea, place, position, direction, lane, imgUrl } = request.payload;

				let [ res_TendersGroup ] = await request.tendersql.pool.execute(
					`SELECT 
						TendersSurvey.id AS surveyId
					FROM 
						TendersSurvey
						LEFT JOIN Tenders USING(tenderId)
						LEFT JOIN TendersGroup ON TendersGroup.groupId = Tenders.groupId
					WHERE TendersGroup.contractId = ? AND TendersSurvey.title = '道路巡視'`,
					[ contractId ]
				);
				if (res_TendersGroup.length == 0) return Boom.notAcceptable('SurveyId not Found!');
				else if (res_TendersGroup.length > 1) res_TendersGroup = res_TendersGroup.filter(group => group.zipCode == zipCode);

				const [res_distress] = await request.tendersql.pool.execute(
					`INSERT INTO caseDistress(Coordinate, CoordinateX, CoordinateY, Place, Direction, Lane, DistressType, DistressLevel, DateCreate, MillingLength, MillingWidth, MillingArea, CaseCenterId, CaseType, State, RoadType, DeviceType, RestoredType, SurveyId)
					VALUES (ST_GeomFromText(?, 4326, 'axis-order=long-lat'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, -1, 4, 0, 1, 1, 1, ?)`,
					[`POINT (${position.lng}  ${position.lat})`, position.lng, position.lat, place, direction, lane, distressType, distressLevel, reportTime, millingLength, millingWidth, millingArea, res_TendersGroup[0].surveyId]
				);

				const destFileName = `tbl_case_image/${res_distress.insertId}_ImgZoomIn`;
				await server.methods.getFileList(destFileName).then(async (existFileList) => {
					const imgUrlObj = new URL(imgUrl);
					const pathname = imgUrlObj.pathname;
					const url = imgUrlObj.href;
					const { ext } = parse(pathname);
					const destFileNameSpec = `${destFileName}_${existFileList.length + 1}${ext}`;

					await server.methods.uploadFileUrl(url, destFileNameSpec).then(async (publicUrl) => {
						await request.tendersql.pool.execute(
							`UPDATE caseDistress SET ImgZoomIn = ? WHERE SerialNo = ?`,
							[decodeURIComponent(publicUrl), res_distress.insertId]
						);
					}).catch(err => console.log(err));
				}).catch(err => console.log(err));

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 1999
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/car/caseLog',
			options: {
				description: '1999 - 匯入csv',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						CaseNo: Joi.number().required().description('案件編號'),
						DateReport: Joi.string().required().description('查報日期'),
						ContractId: Joi.number().required().description('標案ID'),
						ZipCode: Joi.number().required().description('區號'),
						ReportUser: Joi.string().required().description('登錄人員'),
						ReceiveUser: Joi.string().required().description('收件人員'),
						LocationReport: Joi.string().required().description('查報地點'),
						EstimatedDate: Joi.string().required().description('預計完工日期'),
						SourceNo: Joi.number().required().description('來源編號'),
						DamageDesc: Joi.string().required().description('損壞情形'),
						DamageCondition: Joi.string().required().description('損壞狀況'),
						AreaFix: Joi.number().required().description('修補面積'),
						TemporaryFix: Joi.number().required().description('臨時修複'),
						SourceReport: Joi.string().required().description('查報來源'),
						CaseCondition: Joi.string().required().description('案件狀態'),
						WGS84_x: Joi.number().required().description('X座標'),
						WGS84_y: Joi.number().required().description('Y座標')
					}).error(err => console.log(err))
				}
			},
			handler: async function (request, h) {
				const { CaseNo, DateReport, ContractId, ZipCode, ReportUser, ReceiveUser, LocationReport, EstimatedDate, SourceNo, 
								DamageDesc, DamageCondition, AreaFix, TemporaryFix, SourceReport, CaseCondition, WGS84_x, WGS84_y } = request.payload;

				const [ checkCaseNo ] = await request.tendersql.pool.execute(`
					SELECT CaseNo FROM caseListLog WHERE CaseNo = ${CaseNo}`	
				);
				
				const importSuccess = []; // 紀錄匯入成功的案件編號

				if (checkCaseNo.length == 0) {
					await request.tendersql.pool.execute(`
						INSERT INTO caseListLog (CaseNo, DateReport, ContractId, ZipCode, ReportUser, ReceiveUser, LocationReport, EstimatedDate, SourceNo, 
							DamageDesc, DamageCondition, AreaFix, TemporaryFix, SourceReport, CaseCondition, WGS84_x, WGS84_y)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						[CaseNo, DateReport, ContractId, ZipCode, ReportUser, ReceiveUser, LocationReport, EstimatedDate, SourceNo, 
							DamageDesc, DamageCondition, AreaFix, TemporaryFix, SourceReport, CaseCondition, WGS84_x, WGS84_y]
					);
					importSuccess.push(CaseNo);
				}
				
				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: checkCaseNo, importSuccess }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 坑洞缺失
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/car/pothole',
			options: {
				description: '坑洞缺失',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						contractId: Joi.number().required().description("標案ID"),
						insType: Joi.number().required().description("巡視類型: 1-臨補; 2-車巡"),
						timeStart: Joi.string().description('起始時間'),
						timeEnd: Joi.string().description('結束時間'),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { contractId, insType, timeStart, timeEnd, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				const caseTypeMap = { 15: '坑洞' };
				
				let result = [];
				let total = 0;

				// 坑洞(臨補)
				if (insType == 1) {
					const [ res_TendersGroup ] = await request.tendersql.pool.query(
						`SELECT 
							TendersSurvey.id AS surveyId
						FROM 
							TendersSurvey
							LEFT JOIN Tenders USING(tenderId)
							LEFT JOIN TendersGroup ON TendersGroup.groupId = Tenders.groupId
						WHERE 
							TendersSurvey.title = '道路巡視'
							${contractId == 99 ? '' : ` AND TendersGroup.contractId = '${contractId}'`}`
					);

					[ result ] = await request.tendersql.pool.query(
						`SELECT 
							SerialNo AS serialno,
							CaseNo,
							'坑洞(臨補)' AS type,
							CoordinateY AS xx,
							CoordinateX AS yy,
							Place AS casename, 
							DistressType, 
							DistressLevel AS broketype,
							DateCreate AS reportTime, 
							MillingLength AS elength,
							MillingWidth AS blength,
							MillingArea,
							'2' AS reccontrol,
							ImgZoomIn AS imgfile,
							r.Image AS ImageRestored
						FROM caseDistress AS d
						LEFT JOIN caseDistressFlowRestored AS r ON r.DistressId = d.SerialNo
						WHERE 
							DistressType = 15 
							AND SurveyId IN (?) 
							AND DateCreate >= ? AND DateCreate < ? 
							AND CaseCenterId = 0
						ORDER BY DateCreate DESC
						LIMIT ? OFFSET ?`,
						[ res_TendersGroup.map(survey => survey.surveyId), timeStart, timeEnd, pageSize, offset ]
					);
					

					[[{ total }]] = await request.tendersql.pool.query(
						`SELECT
							COUNT(*) AS total
						FROM caseDistress AS d
						LEFT JOIN caseDistressFlowRestored AS r ON r.DistressId = d.SerialNo
						WHERE 
							DistressType = 15
							AND SurveyId IN (?) 
							AND DateCreate >= ? AND DateCreate < ? 
							AND CaseCenterId = 0`,
						[ res_TendersGroup.map(survey => survey.surveyId), timeStart, timeEnd ]
					);

					result.forEach(caseSpec => {
						caseSpec.caseType = caseTypeMap[caseSpec.DistressType];
					});
				} else if (insType == 2) {
					// NOTE: contractId 與 gteam 的對應
					const contractMap = { 1: 1, 2: 2, 3: 5, 4: 4, 5: 3, 6: 6 };

					let [[{ caseCenterIdList }]] = await request.tendersql.pool.execute(
						`SELECT IFNULL(JSON_ARRAYAGG(dataceterId), '[]') AS "caseCenterIdList" FROM caseCenterStatus`
					);
					caseCenterIdList = JSON.parse(caseCenterIdList).filter(id => id != null);

					await sql.connect(sqlConfig_1);
					const sqlCMD =
						`SELECT serialno, yy, xx, casename, [損壞類別] AS caseType, [查報日期時間] AS reportTime, btype, broketype, elength, blength, imgfile, reccontrol
						FROM datacenter
						WHERE 
							reccontrol != '8' 
							AND [查報日期時間] >= '${timeStart}' AND [查報日期時間] < '${timeEnd}' AND [損壞類別] = '坑洞'
							${contractId == 99 ? '' : ` AND gteam = '${contractMap[contractId]}'`}
							${caseCenterIdList.length == 0 ? '' : ` AND serialno NOT IN ( ${caseCenterIdList.join(',')} )`}
						ORDER BY [查報日期時間] DESC
						OFFSET ${offset} ROWS
						FETCH NEXT ${pageSize} ROWS ONLY`;

					const { recordsets: res_list } = await sql.query(sqlCMD);;
					result = res_list[0];

					const { recordsets: res_total } = await sql.query(
						`SELECT COUNT(*) as total
							FROM datacenter
							WHERE 
								reccontrol != '8' 
								AND [查報日期時間] >= '${timeStart}' AND [查報日期時間] < '${timeEnd}' AND [損壞類別] = '坑洞'
								${contractId == 99 ? '' : ` AND gteam = '${contractMap[contractId]}'`}
								${caseCenterIdList.length == 0 ? '' : ` AND serialno NOT IN ( ${caseCenterIdList.join(',')} )`}`);
					total = res_total[0][0].total;
					sql.close();

					let res_caseDistress = [];
					if (result.length > 0) {
						[res_caseDistress] = await request.tendersql.pool.query(
							`SELECT 
								Serialno, CaseNo, CoordinateX, CoordinateY, Place, Direction, Lane, DistressType, DistressLevel, DateCreate, MillingLength, MillingWidth, MillingArea, CaseCenterId, ImgZoomIn,
								r.Image
							FROM caseDistress AS d
							LEFT JOIN caseDistressFlowRestored AS r ON r.DistressId = d.caseDistress
							WHERE CaseCenterId IN (?) AND DistressType = 15`,
							[ result.map(caseSpec => caseSpec.serialno) ]
						);
					}

					result.forEach(caseSpec => {
						const caseFilter = res_caseDistress.filter(caseDSpec => caseDSpec.CaseCenterId == caseSpec.serialno);
						
						if (caseFilter.length > 0) {
							caseSpec.xx = caseFilter[0].CoordinateY;
							caseSpec.yy = caseFilter[0].CoordinateX;
							caseSpec.CaseNo = caseFilter[0].CaseNo;
							caseSpec.casename = caseFilter[0].Place;
							caseSpec.caseType = caseTypeMap[caseFilter[0].DistressType];
							caseSpec.broketype = caseFilter[0].DistresLevel; // 缺失程度
							caseSpec.elength = caseFilter[0].MillingLength; // 預估長
							caseSpec.blength = caseFilter[0].MillingWidth; // 預估寬
							caseSpec.createtime = caseFilter[0].DateCreate;  // 創建時間
							caseSpec.reccontrol = '2';
							caseSpec.imgfile = caseFilter[0].ImgZoomIn;
							caseSpec.imageRestored = caseFilter[0].Image;
						}
					});
				}
				
				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result, total }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 坑洞缺失(磐碩3, 6標)
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/car/pothole36',
			options: {
				description: '坑洞缺失(磐碩3, 6標)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						contractId: Joi.number().required().description("標案ID"),
						timeStart: Joi.string().description('起始時間'),
						timeEnd: Joi.string().description('結束時間'),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { contractId, timeStart, timeEnd, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				let res;
				let total;

				if (contractId == 3) {
					[ res ] = await request.tendersql.pool.query(`
						SELECT 
							SerialNo AS serialno,
							CaseNo,
							CoordinateY AS xx,
							CoordinateX AS yy,
							Place AS casename, 
							DistressLevel,
							DateCreate, 
							ImgZoomIn,
							ImgZoomOut
						FROM caseDistress AS d
						LEFT JOIN caseDistressFlowRestored AS r ON r.DistressId = d.SerialNo
						WHERE 
							DistressType = 15 
							AND SurveyId = 94 
							AND DateCreate >= ? AND DateCreate < ?
						ORDER BY DateCreate DESC
						LIMIT ? OFFSET ?`,
						[timeStart, timeEnd, pageSize, offset]
					);

					[[{ total }]] = await request.tendersql.pool.query(`
						SELECT COUNT(*) AS total
						FROM caseDistress AS d
						LEFT JOIN caseDistressFlowRestored AS r ON r.DistressId = d.SerialNo
						WHERE 
							DistressType = 15 
							AND SurveyId = 94
							AND DateCreate >= ? AND DateCreate < ?`,
						[timeStart, timeEnd]
					);
				} else {
					[ res ] = await request.tendersql.pool.query(`
						SELECT 
							SerialNo AS serialno,
							CaseNo,
							CoordinateY AS xx,
							CoordinateX AS yy,
							Place AS casename, 
							DistressLevel,
							DateCreate, 
							ImgZoomIn,
							ImgZoomOut
						FROM caseDistress AS d
						LEFT JOIN caseDistressFlowRestored AS r ON r.DistressId = d.SerialNo
						WHERE 
							DistressType = 15 
							AND SurveyId = 95
							AND DateCreate >= ? AND DateCreate < ?
						ORDER BY DateCreate DESC
						LIMIT ? OFFSET ?`,
						[timeStart, timeEnd, pageSize, offset]
					);

					[[{ total }]] = await request.tendersql.pool.query(`
						SELECT COUNT(*) AS total
						FROM caseDistress AS d
						LEFT JOIN caseDistressFlowRestored AS r ON r.DistressId = d.SerialNo
						WHERE 
							DistressType = 15 
							AND SurveyId = 95
							AND DateCreate >= ? AND DateCreate < ?`,
						[timeStart, timeEnd]
					);
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: res, total }
				};
			},
		});

		server.route({
			method: 'POST',
			path: '/car/pothole',
			options: {
				description: '匯入坑洞缺失(磐碩3, 6標)',
				// auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						token: Joi.string().allow('').description('授權之token'),
						isObserve: Joi.string().allow('').max(1).description('觀察案件否'),
						user: Joi.string().allow('').description('XX營造'),
						addr: Joi.string().required().description('查報地址'),
						roadDirect: Joi.string().min(1).max(2).required().description('車道方向'),
						roadNum: Joi.number().min(1).max(5).required().description('第幾車道'),
						defect_name: Joi.string().max(1).required().description('損壞項目'),
						defect_bad: Joi.string().max(2).required().description('損壞情形'),
						det_level: Joi.number().required().description('損壞情形'),
						memo: Joi.string().allow('').description('損壞說明'),
						gis_lon: Joi.number().required().description('經度'),
						gis_lat: Joi.number().required().description('緯度'),
						img_1: Joi.string().required().description('上傳圖片 base64'),
						img_2: Joi.string().allow('').description('上傳圖片 base64'),
						img_3: Joi.string().allow('').description('上傳圖片 base64'),
						defect_date: Joi.string().required().description('查報日期'),
						det_sour_code: Joi.string().required().description('來源編號'),
					}).error(err => console.log(err))
				},
				payload: {
					maxBytes: 3 * 1024 * 1024
				},
			},
			handler: async function (request, h) {
				const { addr, roadDirect, roadNum, defect_name, defect_bad, gis_lon, gis_lat, img_1, img_2, defect_date, det_sour_code, det_level } = request.payload;

				// AC路面(A1=坑洞15、A2=縱向及橫向裂縫29、A3=龜裂16、A4=車轍32、A5=隆起與凹陷18、A6=塊狀裂縫50、A7=推擠53、A8=補綻及管線回填65、
				// A9=冒油54、A10=波浪狀鋪面55、A11=車道與路肩分離56、A12=滑溜裂縫49、A13=骨材剝落66、A14=其他21、A15=人手孔缺失34、A16=薄層剝離51)

				// 人行道及相關設施(B1=坑洞15、B2=鋪面破損201、B3=孔蓋周邊破損205、B4=樹穴緣石234、B5=溝蓋路邊緣石223、
				// B6=其他238、B7=鋪面鬆動202、B8=樹木竄根203、B9=私設斜坡道214、B10=側溝蓋破損218、B11=雜草70)

				const distressTypeMap = {
					// 15: { A1: 'A1', B1: 'B1' },
					29: 'A2',
					16: 'A3',
					32: 'A4',
					18: 'A5',
					50: 'A6',
					53: 'A7',
					65: 'A8',
					54: 'A9',
					55: 'A10',
					56: 'A11',
					49: 'A12',
					66: 'A13',
					21: 'A14',
					34: 'A15',
					51: 'A16',
					201: 'B2',
					205: 'B3',
					234: 'B4',
					223: 'B5',
					238: 'B6',
					202: 'B7',
					203: 'B8',
					214: 'B9',
					218: 'B10',
					70: 'B11'
				};

				let distressType = 0;
				let deviceType = 0;
				for (const [key, value] of Object.entries(distressTypeMap)) {
					// 盤碩只讓它顯示坑洞
					if (defect_bad == 'A1' || defect_bad == 'B1') {
						distressType = 15;
					} else if (value == defect_bad){
						distressType = key;
					}

					if (defect_bad == 'B11') {
						deviceType = 7;
					} else if (defect_bad == 'B1') {
						deviceType = 1;
					} else if (defect_bad.charAt(0) == 'B') {
						deviceType = 2;
					} else {
						deviceType = 1;
					}
				}
				
				
				const direction = roadDirect == "F" ? 1 : 2; // 車道方向
				const reportTime = DateTime.fromFormat(defect_date, "yyyy/MM/dd HH:mm:ss").minus({ hours: 8 }).toFormat("yyyy-MM-dd HH:mm:ss"); // 查報日期(磐碩打進來時區+8, 資料庫存進時區+0)
				const restoredType = defect_name == "A" ? 1 : 2; // 1AC(鋪面) 2HR(熱再生)
				
				const zipCodeMap = {
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

				// 判斷行政區
				let zipCode = 0;
				for (const [key, value] of Object.entries(zipCodeMap)) {
					if (value === addr.substring(0, 3)) {
						zipCode = key;
					}
				}
				
				// 過濾磐碩的案件編號 轉化成我們可以存的caseNo
				const part = det_sour_code.split('-');
				const newCaseNo = parseInt(part[1]);

				const [[ check ]] = await request.tendersql.pool.query(
					`SELECT COUNT(*) AS total FROM caseDistress WHERE CaseNo = ?`,
					[newCaseNo]
				);

				if ((zipCode == 100 || zipCode == 108 || zipCode == 106 || zipCode == 116) && distressType == 15 && check.total == 0) {
					// 3標SurveyId = 94, 6標SurveyId = 95
					let res_distress;
					if (zipCode == 100 || zipCode == 108) {
						// 3標 中正 萬華
						[res_distress] = await request.tendersql.pool.execute(
							`INSERT INTO caseDistress(CaseNo, Coordinate, CoordinateX, CoordinateY, Place, Direction, Lane, DistressType, DistressLevel, DateCreate, CaseCenterId, CaseType, State, RoadType, DeviceType, RestoredType, SurveyId)
							VALUES (?, ST_GeomFromText(?, 4326, 'axis-order=long-lat'), ?, ?, ?, ?, ?, ?, ?, ?, -1, 4, 0, 1, ?, ?, 94)`,
							[newCaseNo ,`POINT (${gis_lon}  ${gis_lat})`, gis_lon, gis_lat, addr, direction, roadNum, distressType, det_level, reportTime, deviceType, restoredType]
						);
					} else {
						// 6標 大安 文山
						[res_distress] = await request.tendersql.pool.execute(
							`INSERT INTO caseDistress(CaseNo, Coordinate, CoordinateX, CoordinateY, Place, Direction, Lane, DistressType, DistressLevel, DateCreate, CaseCenterId, CaseType, State, RoadType, DeviceType, RestoredType, SurveyId)
							VALUES (?, ST_GeomFromText(?, 4326, 'axis-order=long-lat'), ?, ?, ?, ?, ?, ?, ?, ?, -1, 4, 0, 1, ?, ?, 95)`,
							[newCaseNo ,`POINT (${gis_lon}  ${gis_lat})`, gis_lon, gis_lat, addr, direction, roadNum, distressType, det_level, reportTime, deviceType, restoredType]
						);
					}
	
					// 他們圖片上傳是base64
					const regex = /^data:.+\/(.+);base64,(.*)$/;

					const uploadImage = async (imgBase64, destFileName, columnName) => {
						// 解析 base64 資料
						const matches = imgBase64.match(regex);
						if (!matches) {
							throw new Error('Invalid base64 image format');
						}
						const ext = matches[1]; // 獲取圖片的擴展名
						const base64Data = matches[2]; // 獲取 base64 編碼的圖像數據

						// 將 base64 編碼的圖像數據轉換為 Buffer
						const buffer = Buffer.from(base64Data, 'base64');

						// 獲取目標文件名列表
						const existFileList = await server.methods.getFileList(destFileName);
						
						// 創建一個新的文件名，避免重複
						const destFileNameSpec = `${destFileName}_${existFileList.length + 1}.${ext}`;

						// 上傳文件並獲取公開的 URL
						const publicUrl = await server.methods.uploadFile(buffer, destFileNameSpec);
						
						// 更新資料庫中的相應字段
						await request.tendersql.pool.execute(
							`UPDATE caseDistress SET ${columnName} = ? WHERE SerialNo = ?`,
							[decodeURIComponent(publicUrl), res_distress.insertId]
						);
					};

					// 圖片上傳示例
					const destFileNameIn = `tbl_case_image/${res_distress.insertId}_ImgZoomIn`;
					await uploadImage(img_1, destFileNameIn, 'ImgZoomIn');

					if (img_2) {
						const destFileNameOut = `tbl_case_image/${res_distress.insertId}_ImgZoomOut`;
						await uploadImage(img_2, destFileNameOut, 'ImgZoomOut');
					}

				} else if (check.total > 0) {
					return Boom.notAcceptable('duplicate data');
				} else {
					return Boom.notAcceptable('fail');
				}
				
				
				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		server.route({
			method: 'PUT',
			path: '/car/pothole/{id}',
			options: {
				description: '坑洞缺失 (提交新工案號)',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					payload: Joi.object({
						caseNo: Joi.number().required().description("新工案號")
					})
				}
			},
			handler: async function (request, h) {
				const { id } = request.params;
				const { caseNo } = request.payload;

				await request.tendersql.pool.execute(
					`UPDATE caseDistress SET CaseNo = ? WHERE SerialNo = ?`,
					[ caseNo, id ]);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});
		/* Router End */
	},
};
