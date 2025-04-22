'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const { parse } = require('path');

const authStrategy = false; 
//const authStrategy = 'simple';

exports.plugin = {
	//pkg: require('./package.json'),
	name: 'app',
	version: '0.0.0',
	register: async function (server, options) {
		// ----------------------------------------------------------------------------------------------------
		// 巡查回報列表
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/app/inspectFlowList',
			options: {
				description: '巡查回報列表',
				//auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						filter: Joi.boolean().default(false).description("是否篩選「已完工」"),
						surveyId: Joi.number().required().description("TendersSurvey id"),
						caseId: Joi.number().default(0).description("caseDetection Id"),
						roadName: Joi.string().allow('').default('').description("道路名稱"),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					}).error(err => console.log(err))
				}   // GET
			},
			handler: async function (request, h) {
				const { filter, surveyId, roadName, caseId, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;
				let sqlCMD_join = '';

				if(roadName.length != 0) {
					const { rows: res_blockList } = await request.pg.client.query(
						`SELECT 
							"caseInspectRoute"."blockId" AS "id",
							"caseInspectRoute"."roadName",
							"caseInspectRoute"."zipCode",
							ST_AsText("block_nco2022"."wkb_geometry") AS "geometry"
						FROM 
							"qgis"."caseInspectRoute"
							LEFT JOIN "qgis"."block_nco2022" ON "block_nco2022"."fcl_id" = "caseInspectRoute"."blockId"
						WHERE "roadName" LIKE '%${roadName}%' AND "active" IS TRUE
						ORDER BY "id"`
					);

					sqlCMD_join = " INNER JOIN (VALUES";
					for (const block of res_blockList) sqlCMD_join += ` ROW(${block.id}, ST_GeomFromText('${block.geometry}', 4326, 'axis-order=long-lat')),`;
					sqlCMD_join = sqlCMD_join.replace(/,$/g, "");
					sqlCMD_join += " ) AS blockList (id, geometry) ON ST_Intersects(blockList.geometry, IFNULL(Geom, Wkb_geometry))";
				}

				let sqlCMD_where = ` WHERE caseDistress.SurveyId = ${surveyId} AND caseDistress.DistressLevel >= 2`;
				sqlCMD_where += filter ? ` AND IFNULL(caseDistressFlow.FlowState, 0) = 2` : ` AND IFNULL(caseDistressFlow.FlowState, 0) = 0`;
				if (caseId != 0) sqlCMD_where += ` AND caseDetection.id = ${caseId}`;

				const [ res_caseList ] = await request.tendersql.pool.execute(
					`SELECT 
						caseDetection.id,
						caseDistress.SerialNo,
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
						IFNULL(caseDistressFlow.FlowState, 0) AS FlowState,
						IFNULL(caseDistressFlow.Image, '[]') AS Image
					FROM 
						caseDistress
						LEFT JOIN caseDetection ON caseDetection.id = caseDistress.CaseDetectionId
						LEFT JOIN (
							SELECT * FROM caseDistressFlow WHERE id IN (SELECT MAX(id) FROM caseDistressFlow GROUP BY DistressId)
						) AS caseDistressFlow ON caseDistressFlow.DistressId = caseDistress.SerialNo
						${sqlCMD_join}
					${sqlCMD_where}
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
						LEFT JOIN (
							SELECT * FROM caseDistressFlow WHERE id IN (SELECT MAX(id) FROM caseDistressFlow GROUP BY DistressId)
						) AS caseDistressFlow ON caseDistressFlow.DistressId = caseDistress.SerialNo
						${sqlCMD_join}
					${sqlCMD_where}`
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
			path: '/app/inspectFlowList/{id}',
			options: {
				description: '巡查回報列表 (提交結果)',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					payload: Joi.object({
						flowState: Joi.number().allow(0, 2).default(0).description("狀態(1: 派工中, 2: 完工, 3: 不需施作, 4: 改判 )"),
						flowDesc: Joi.string().allow('').default('').description("狀態說明")
					})
				}
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				const { id } = request.params;
				const { flowState, flowDesc } = request.payload;

				const [[ res ]] = await request.tendersql.pool.execute(
					`SELECT Image FROM caseDistressFlow
					WHERE DistressId = ?
					ORDER BY id DESC
					LIMIT 1`,
					[id]);

				const image = res != undefined ? res.Image : '[]';

				await request.tendersql.pool.execute(
					`INSERT INTO caseDistressFlow (DistressId, FlowState, FlowDesc, Image, Uid)
					VALUES ( ?, ?, ?, ?, ?)`,
					[ id, flowState, flowDesc, image, uid ]);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 上傳照片(caseDistress)
		server.route({
			method: 'POST',
			path: '/app/trackingImgUpload',
			options: {
				description: '提交追蹤照片',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						serialNo: Joi.number().required().description("caseDistress SerialNo"),
						fileAddList: Joi.alternatives().try(Joi.any().meta({ swaggerType: "file" }), Joi.array().items(Joi.any().meta({ swaggerType: "file" }))).default([]).description("圖片上傳列表(RAW)"),
						fileRemoveList: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).default([]).description("圖片刪除列表(url)"),
					}).error(err => console.log(err))
				},  // POST
				payload: {
					output: "stream",
					allow: "multipart/form-data",
					multipart: true
				}
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				// param 參數
				const { serialNo } = request.payload;
				let { fileAddList, fileRemoveList } = request.payload;
				if (!Array.isArray(fileAddList)) fileAddList = [fileAddList];
				if (!Array.isArray(fileRemoveList)) fileRemoveList = [fileRemoveList];

				// 移除圖片
				for (const url of fileRemoveList) {
					await request.tendersql.pool.execute(
						`UPDATE caseDistressFlow
						SET Image = JSON_REMOVE(Image, JSON_UNQUOTE(JSON_SEARCH(Image, 'all', ?))), Update_At = NOW()
						WHERE DistressId = ?
						ORDER BY id DESC
						LIMIT 1`,
						[ url, serialNo ]
					);

					// 紀錄被刪除圖片
					await request.tendersql.pool.execute(
						`INSERT INTO removeImgUrl (ImgUrl, OperatorId) VALUES (?, ?)`,
						[ url, uid ]
					);
				}

				// 照片上傳至GCP
				const destFileName = `caseDetection_trackingImg/${serialNo}_trackingImg_`;

				server.methods.setBucket('adm_distress_image');
				try {
					await server.methods.getFileList(destFileName).then(async (existFileList) => {
						for (const [index, file] of fileAddList.entries()) {
							// const fileExtension = file.hapi.filename.split(".").slice(-1);
							const { ext } = parse(file.hapi.filename);
							const destFileNameSpec = `${destFileName}${existFileList.length + index + 1}${ext}`;

							await server.methods.uploadFile(file._data, destFileNameSpec).then(async (publicUrl) => {
								// Update
								const [res] = await request.tendersql.pool.execute(
									`UPDATE caseDistressFlow SET Image = JSON_ARRAY_APPEND(COALESCE(Image, '[]'), '$', ?), Update_At = NOW() 
									WHERE DistressId = ?
									ORDER BY id DESC
									LIMIT 1`,
									[decodeURIComponent(publicUrl), serialNo]
								);

								if (res.affectedRows == 0) {
									// Insert into
									await request.tendersql.pool.execute(
										`INSERT INTO caseDistressFlow (DistressId, Image, Uid)
										VALUES ( ?, JSON_ARRAY_APPEND('[]', '$', ?), ?)`,
										[serialNo, decodeURIComponent(publicUrl), uid]);
								}
							}).catch(err => {
								console.log(err);
								const errString = typeof err == "String" ? err : "Upload fail!";
								return Boom.notAcceptable(errString);
							});
						}
					}).catch(err => console.log(err));	
				} catch (err) { console.log(err) }

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 坑洞回報列表
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/app/inspectFlowPotholeList',
			options: {
				description: '坑洞回報列表',
				//auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						filter: Joi.boolean().default(false).description("是否篩選「已完工」"),
						contractId: Joi.number().default(99).description("標案ID"),
						caseId: Joi.number().default(0).description("caseDetection Id"),
						place: Joi.string().allow('').default('').description("地址"),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50),
						timeStart: Joi.string().description('起始時間'),
						timeEnd: Joi.string().description('結束時間'),
					}).error(err => console.log(err))
				}   // GET
			},
			handler: async function (request, h) {
				const { filter, contractId, place, caseId, pageCurrent, pageSize, timeStart, timeEnd } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;
				let sqlCMD_join = '';

				const [ res_TendersGroup ] = await request.tendersql.pool.execute(
					`SELECT 
							TendersSurvey.id AS surveyId
						FROM 
							TendersSurvey
							LEFT JOIN Tenders USING(tenderId)
							LEFT JOIN TendersGroup ON TendersGroup.groupId = Tenders.groupId
						WHERE TendersGroup.contractId = ? AND TendersSurvey.title = '道路巡視'`,
					[contractId]
				);
				
				let sqlCMD_where = "";
				sqlCMD_where += filter ? ` AND IFNULL(caseDistressFlowRestored.FlowState, 0) = 2` : ` AND IFNULL(caseDistressFlowRestored.FlowState, 0) = 0`;
				if (caseId != 0) sqlCMD_where += ` AND caseDistress.SerialNo = ${caseId}`;
				if (place && place.length != 0) sqlCMD_where += ` AND caseDistress.Place LIKE '%${place}%'`;

				const [ res_caseList ] = await request.tendersql.pool.query(
					`SELECT 
						caseDistress.SerialNo AS id,
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
						ST_ASGeoJson(caseDistress.Coordinate) AS CenterPt,
						IFNULL(caseDistressFlowRestored.FlowState, 0) AS FlowState,
						IFNULL(caseDistressFlowRestored.Image, '') AS RestoredImage
					FROM 
						caseDistress
						LEFT JOIN (
							SELECT * FROM caseDistressFlowRestored WHERE id IN (SELECT MAX(id) FROM caseDistressFlowRestored GROUP BY DistressId)
						) AS caseDistressFlowRestored ON caseDistressFlowRestored.DistressId = caseDistress.SerialNo
						${sqlCMD_join}
					WHERE 
						DistressType = 15 
						AND CaseCenterId = 0
						AND caseDistress.SurveyId IN (?)
						AND DateCreate >= ? AND DateCreate < ?
						${sqlCMD_where}
					LIMIT ? OFFSET ?`,
					[ res_TendersGroup.map(survey => survey.surveyId), timeStart, timeEnd, pageSize, offset ]
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
						LEFT JOIN (
							SELECT * FROM caseDistressFlowRestored WHERE id IN (SELECT MAX(id) FROM caseDistressFlowRestored GROUP BY DistressId)
						) AS caseDistressFlowRestored ON caseDistressFlowRestored.DistressId = caseDistress.SerialNo
						${sqlCMD_join}
					WHERE
						DistressType = 15 
						AND CaseCenterId = 0
						${sqlCMD_where}`
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: res_caseList, total }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 建立案件(坑洞)
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/app/importCase',
			options: {
				description: '建立案件(坑洞)',
				// auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						contractId: Joi.number().required().description("標案ID"),
						zipCode: Joi.number().default(0).description('郵遞區號'),
						// reportTime: Joi.string().required().description("通報日期"),
						// distressType: Joi.number().required().description('缺失類型'),
						distressLevel: Joi.number().required().description('缺失程度'),
						millingLength: Joi.number().default(0).description("預估長度"),
						millingWidth: Joi.number().default(0).description("預估寬度"),
						millingArea: Joi.number().default(0).description("預估面積"),
						place: Joi.string().allow('').default('').description("地址"),
						position: Joi.string().required().description("位置"),
						direction: Joi.number().required().description("路向(0: 無; 1: 順; 2: 逆)"),
						lane: Joi.number().required().description('車道'),
						img: Joi.any().meta({ swaggerType: "file" })
					}).error(err => console.log(err))
				},
				payload: {
					output: "stream",
					allow: "multipart/form-data",
					multipart: true
				}
			},
			handler: async function (request, h) {
				const { contractId, zipCode, distressLevel, millingLength, millingWidth, millingArea, place, direction, lane, img } = request.payload;
				const position = JSON.parse(request.payload.position);

				let [res_TendersGroup] = await request.tendersql.pool.execute(
					`SELECT 
						TendersSurvey.id AS surveyId
					FROM 
						TendersSurvey
						LEFT JOIN Tenders USING(tenderId)
						LEFT JOIN TendersGroup ON TendersGroup.groupId = Tenders.groupId
					WHERE 
						TendersGroup.contractId = ? AND TendersSurvey.title = '道路巡視'
						${ contractId == 1 ? ` AND  Tenders.ZipCode = ${zipCode}` : '' }`,
					[ contractId ]
				);
				if (res_TendersGroup.length == 0) return Boom.notAcceptable('SurveyId not Found!');
				else if (res_TendersGroup.length > 1) res_TendersGroup = res_TendersGroup.filter(group => group.zipCode == zipCode);

				const [res_distress] = await request.tendersql.pool.execute(
					`INSERT INTO caseDistress(Coordinate, CoordinateX, CoordinateY, Place, Direction, Lane, DistressType, DistressLevel, DateCreate, MillingLength, MillingWidth, MillingArea, CaseCenterId, CaseType, State, RoadType, DeviceType, RestoredType, SurveyId)
					VALUES (ST_GeomFromText(?, 4326, 'axis-order=long-lat'), ?, ?, ?, ?, ?, 15, ?, NOW(), ?, ?, ?, 0, 4, 0, 1, 1, 1, ?)`,
					[`POINT (${position.lng}  ${position.lat})`, position.lng, position.lat, place, direction, lane, distressLevel, millingLength, millingWidth, millingArea, res_TendersGroup[0].surveyId]
				);

				// 照片上傳至GCP
				const destFileName = `tbl_case_image/${res_distress.insertId}_ImgZoomIn`;
				server.methods.setBucket('adm_distress_image');
				try {
					await server.methods.getFileList(destFileName).then(async (existFileList) => {
						const { ext } = parse(img.hapi.filename);
						const destFileNameSpec = `${destFileName}_${existFileList.length + 1}${ext}`;

						await server.methods.uploadFile(img._data, destFileNameSpec).then(async (publicUrl) => {
							await request.tendersql.pool.execute(
								`UPDATE caseDistress SET ImgZoomIn = ? WHERE SerialNo = ?`,
								[decodeURIComponent(publicUrl), res_distress.insertId]
							);
						}).catch(err => console.log(err));
					}).catch(err => console.log(err));
				} catch (err) { console.log(err) }

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 上傳臨補照片(caseDistress)
		server.route({
			method: 'POST',
			path: '/app/restoredImgUpload',
			options: {
				description: '提交臨補照片',
				auth: { strategy: 'bearer', scope: ['base'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						serialNo: Joi.number().required().description("caseDistress SerialNo"),
						flowState: Joi.number().default(2).description("狀態(2: 完工)"),
						img: Joi.any().meta({ swaggerType: "file" })
					}).error(err => console.log(err))
				},  // POST
				payload: {
					output: "stream",
					allow: "multipart/form-data",
					multipart: true
				}
			},
			handler: async function (request, h) {
				const { uid } = request.auth.artifacts;
				// param 參數
				const { serialNo, flowState, img } = request.payload;

				// 照片上傳至GCP
				const destFileName = `caseDistress_restoredImg/${serialNo}_restoredImg_`;
				server.methods.setBucket('adm_distress_image');

				try {
					await server.methods.getFileList(destFileName).then(async (existFileList) => {
							// const fileExtension = file.hapi.filename.split(".").slice(-1);
							const { ext } = parse(img.hapi.filename);
							const destFileNameSpec = `${destFileName}${existFileList.length + 1}${ext}`;

							await server.methods.uploadFile(img._data, destFileNameSpec).then(async (publicUrl) => {
								// Update
								const [res] = await request.tendersql.pool.execute(
									`UPDATE caseDistressFlowRestored SET FlowState = ?, Image = ?, Update_At = NOW()
									WHERE DistressId = ?`,
									[flowState, decodeURIComponent(publicUrl), serialNo]
								);

								if (res.affectedRows == 0) {
									// Insert into
									await request.tendersql.pool.execute(
										`INSERT INTO caseDistressFlowRestored (DistressId, FlowState, Image, Uid)
										VALUES ( ?, ?, ?, ?)`,
										[serialNo, flowState, decodeURIComponent(publicUrl), uid]);
								}
							}).catch(err => {
								console.log(err);
								const errString = typeof err == "String" ? err : "Upload fail!";
								return Boom.notAcceptable(errString);
							});
					}).catch(err => console.log(err));	
				} catch (err) { console.log(err) }

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});
		/* Router End */   
	},
};
