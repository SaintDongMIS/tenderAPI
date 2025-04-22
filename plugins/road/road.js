'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const { DateTime, Interval } = require("luxon");

const authStrategy = false; 
//const authStrategy = 'simple';

exports.plugin = {
	//pkg: require('./package.json'),
	name: 'road',
	version: '0.0.0',
	register: async function (server, options) {
		// ----------------------------------------------------------------------------------------------------
		// 道路單元
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/road/unit',
			options: {
				description: '道路單元',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						distList: Joi.string().default("").description("行政區(zip) List"),
						roadName: Joi.string().default("").description("道路名稱"),
						'width[]': Joi.array().items(Joi.number()).length(2).default([0, 0]).description("計畫路寬"),
						'widthReal[]': Joi.array().items(Joi.number()).length(2).default([0, 0]).description("實際路寬"),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { distList, roadName, 'width[]': width, 'widthReal[]': widthReal, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				let sqlCMD = distList.length == 0 ? "" : ` AND "zip" IN (${distList})`;
				// if (roadName.length != 0) sqlCMD += ` AND ( "roadName" LIKE '%${roadName}%' OR "crossName" LIKE '%${roadName}%' OR "roadStart" LIKE '%${roadName}%' OR "roadEnd" LIKE '%${roadName}%')`;
				if (roadName.length != 0) sqlCMD += ` AND "roadName" ~ '${roadName.replace(/,/g, "|")}'`;

				if (width[1] == 0) sqlCMD += ` AND "width" >= ${width[0]}`;
				else sqlCMD += ` AND "width" >= ${width[0]} AND "width" <= ${width[1]}`;

				if (widthReal[1] == 0) sqlCMD += ` AND "widthReal" >= ${widthReal[0]}`;
				else sqlCMD += ` AND "widthReal" >= ${widthReal[0]} AND "widthReal" <= ${widthReal[1]}`;

				sqlCMD = sqlCMD.replace("AND", "WHERE");
				// console.log(sqlCMD);

				try {
					const { rows: list } = await request.pg.client.query(
						`SELECT 
							"unitRoad".*,
							COALESCE("laneUnitAgg"."unitNum"::integer, 0) AS "unitLaneNum",
							COALESCE("blockUnitAgg"."unitNum"::integer, 0) AS "unitBlockNum"
						FROM 
							"unitRoad" 
							LEFT JOIN (SELECT COUNT("id") AS "unitNum", "RoadId" FROM "unitLane" WHERE "active" = TRUE GROUP BY "RoadId" ) AS "laneUnitAgg" USING("RoadId")
							LEFT JOIN (SELECT COUNT("id") AS "unitNum", "RoadId" FROM "unitRoadBlock" WHERE "active" = TRUE GROUP BY "RoadId" ) AS "blockUnitAgg" USING("RoadId")
						${sqlCMD}
						ORDER BY "unitRoad"."RoadId"
						OFFSET $1 ROWS
						FETCH NEXT $2 ROWS ONLY`,
						[ offset, pageSize ]
					);

					const { rows: [{ total }] } = await request.pg.client.query(
						`SELECT COUNT(*) AS total FROM "unitRoad" 
						${sqlCMD}`);

					return {
						statusCode: 20000,
						message: 'successful',
						data: { list: list, total: Number(total) }
					};
				} catch (error) {
					console.log(error);
					return Boom.notAcceptable(error.sqlMessage);
				}
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/road/unitGeo',
			options: {
				description: '道路單元地理資訊',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						roadId: Joi.string().required().description("unitRoad Id"), 
						splitType: Joi.number().allow(1,2).default(2).description("區塊切分類型 - 1: 單元; 2: 車道")
					}).error(err => console.log(err))
				}   // GET
			},
			handler: async function (request, h) {
				const { roadId, splitType } = request.query;
				
				try {
					const { rows: [ res_geo ] } = await request.pg.client.query(
						`SELECT 
							"RoadId",
							"roadName",
							"lane",
							ST_AsGeoJSON("wkb_geometry") AS "geoJSON",
							ROUND(ST_Area("wkb_geometry"::geography)::numeric, 2) AS "area",
							ST_AsGeoJSON(ST_Boundary("wkb_geometry")) AS "boundary"
						FROM "unitRoad" WHERE "RoadId" = $1`,
						[ roadId ]
					);

					if (res_geo == undefined) return { statusCode: 20000, message: 'successful', data: { result: { geo: {}, unitList: {} } }};

					if (splitType == 1) {
						const { rows: res_unit } = await request.pg.client.query(
							`SELECT
								"roadCode",
								"roadName",
								ST_AsGeoJSON ( "wkb_geometry" ) AS "geoJSON",
								ST_Area ("wkb_geometry"::geography ) AS "area" 
							FROM
								"unitRoadBlock" 
							WHERE
								"roadName" = $1
								AND "active" = TRUE
							ORDER BY "roadCode" ASC`,
							[ res_geo.roadName ]
						);

						let lastCode = 0;
						if( res_unit.length > 0) {
							const unitRoadFilter = res_unit.filter(unit => Number(unit.roadCode));
							const unitLastCode = (unitRoadFilter.length != 0) ? unitRoadFilter[unitRoadFilter.length - 1].roadCode : '0';
							lastCode = (unitLastCode != null && Number(unitLastCode) && unitLastCode.length > 4) ? unitLastCode.slice(-4, -1) : 0;
						}

						return {
							statusCode: 20000,
							message: 'successful',
							data: { result: { geo: res_geo, unitList: res_unit, lastCode: Number(lastCode) } }
						};
					} else if (splitType == 2) {
						const { rows: res_unit } = await request.pg.client.query(
							`SELECT
								"laneCode",
								"roadName",
								ST_AsGeoJSON ( "wkb_geometry" ) AS "geoJSON",
								ST_Area ( "wkb_geometry"::geography ) AS "area" 
							FROM
								"unitLane" 
							WHERE
								"roadName" = $1
								AND "active" = TRUE
							ORDER BY "laneCode" ASC`,
							[ res_geo.roadName ]
						);

						return {
							statusCode: 20000,
							message: 'successful',
							data: { result: { geo: res_geo, unitList: res_unit } }
						};
					}
				} catch (error) {
					console.log(error);
					return Boom.notAcceptable(error.sqlMessage);
				}
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/road/unitLane',
			options: {
				description: '新增車道單元',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						unitList: Joi.array().min(1).items(Joi.object({
							roadId: Joi.number().required().description("unitRoad Id"),
							laneId: Joi.number().required().description("車道Id"),
							laneCode: Joi.string().required().description("車道編號"),
							roadName: Joi.string().required().description("道路名稱"),
							lane: Joi.number().required().description("車道數量"),
							area: Joi.number().required().description("區塊面積"),
							length: Joi.number().required().description("區塊長度"),
							geometry: Joi.string().required().description("地理資訊")
						}))
					}).error(err => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { unitList } = request.payload;

				try {
					// Step1: 先將之前的欄位disable
					await request.pg.client.query(
						`UPDATE "public"."unitLane" SET "active" = FALSE, "updatedAt" = NOW() WHERE "RoadId" = $1`,
						[ unitList[0].roadId ]
					);

					// Step2: 新增
					for (const unit of unitList) {
						// console.log(unit);
						await request.pg.client.query(
							`INSERT INTO "public"."unitLane" ("RoadId", "laneId", "laneCode", "roadName", "lane", "area", "length", "wkb_geometry", "operatorId") VALUES ($1, $2, $3, $4, $5, $6, $7, ST_GeomFromGeoJSON($8), $9)`,
							[ unit.roadId, unit.laneId, unit.laneCode, unit.roadName, unit.lane, unit.area, unit.length, unit.geometry, 0 ]
						);
					}

					return {
						statusCode: 20000,
						message: 'successful'
					};
				} catch (error) {
					console.log(error);
					return Boom.notAcceptable(error.sqlMessage);
				}
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/road/unitLane',
			options: {
				description: '車道單元',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						distList: Joi.string().default("").description("行政區(zip) List"),
						roadName: Joi.string().default("").description("道路名稱"),
						'width[]': Joi.array().items(Joi.number()).length(2).default([0, 0]).description("計畫路寬"),
						'widthReal[]': Joi.array().items(Joi.number()).length(2).default([0, 0]).description("實際路寬"),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { distList, roadName, 'width[]': width, 'widthReal[]': widthReal, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				let sqlCMD = distList.length == 0 ? "" : ` AND "unitRoad"."zip" IN (${distList})`;
				// if (roadName.length != 0) sqlCMD += ` AND ( "roadName" LIKE '%${roadName}%' OR "crossName" LIKE '%${roadName}%' OR "roadStart" LIKE '%${roadName}%' OR "roadEnd" LIKE '%${roadName}%')`;
				if (roadName.length != 0) sqlCMD += ` AND "unitRoad"."roadName" ~ '${roadName.replace(/,/g, "|")}'`;

				if (width[1] == 0) sqlCMD += ` AND "unitRoad"."width" >= ${width[0]}`;
				else sqlCMD += ` AND "unitRoad"."width" >= ${width[0]} AND "unitRoad"."width" <= ${width[1]}`;

				if (widthReal[1] == 0) sqlCMD += ` AND "unitRoad"."widthReal" >= ${widthReal[0]}`;
				else sqlCMD += ` AND "unitRoad"."widthReal" >= ${widthReal[0]} AND "unitRoad"."widthReal" <= ${widthReal[1]}`;

				// sqlCMD = sqlCMD.replace("AND", "WHERE");
				// console.log(sqlCMD);

				try {
					const { rows: list } = await request.pg.client.query(
						`SELECT 
							"unitLane"."id",
							"unitLane"."laneId",
							"unitLane"."laneCode",
							"unitRoad"."RoadId",
							"unitRoad"."zip",
							"unitRoad"."roadName",
							"unitRoad"."crossName",
							"unitRoad"."roadStart",
							"unitRoad"."roadEnd",
							"unitRoad"."width",
							"unitRoad"."widthReal",
							"unitLane"."lane",
							"unitLane"."length",
							"unitLane"."area",
							COALESCE("roadUnitAgg"."unitNum"::integer, 0) AS "unitNum" 
						FROM 
							"unitLane" 
							LEFT JOIN (SELECT COUNT("id") AS "unitNum", "laneCode" FROM "unitLaneBlock" WHERE "active" = TRUE GROUP BY "laneCode") AS "roadUnitAgg" USING("laneCode")
							LEFT JOIN "unitRoad" USING("RoadId")
						WHERE
							"active" = TRUE
							${sqlCMD}
						ORDER BY "unitLane"."id"
						OFFSET $1 ROWS
						FETCH NEXT $2 ROWS ONLY`,
						[offset, pageSize]
					);

					const { rows: [{ total }] } = await request.pg.client.query(
						`SELECT 
							COUNT(*) AS total 
						FROM 
							"unitLane" 
							LEFT JOIN "unitRoad" USING("RoadId")
						WHERE 
							"active" = TRUE
							${sqlCMD}`);

					return {
						statusCode: 20000,
						message: 'successful',
						data: { list: list, total: Number(total) }
					};
				} catch (error) {
					console.log(error);
					return Boom.notAcceptable(error.sqlMessage);
				}
			},
		});
		
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/road/unitLaneGeo',
			options: {
				description: '車道單元地理資訊',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						laneCode: Joi.string().required().description("unitLane laneCode")
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { laneCode } = request.query;

				try {
					const { rows: [ res_geo ] } = await request.pg.client.query(
						`SELECT 
							"id",
							"RoadId",
							"laneId",
							"laneCode",
							"roadName",
							"lane",
							ST_AsGeoJSON("wkb_geometry") AS "geoJSON",
							ROUND(ST_Area("wkb_geometry"::geography)::numeric, 2) AS "area",
							ST_AsGeoJSON(ST_Boundary("wkb_geometry")) AS "boundary"
						FROM "unitLane" WHERE "laneCode" = $1`,
						[ laneCode ]
					);

					if (res_geo == undefined) return { statusCode: 20000, message: 'successful', data: { result: { geo: {}, unitList: {}, lastCode: 0 } } };

					const { rows: res_unit } = await request.pg.client.query(
						`SELECT
							"roadCode",
							"roadName",
							ST_AsGeoJSON ( "wkb_geometry" ) AS "geoJSON",
							ST_Area ("wkb_geometry"::geography ) AS "area" 
						FROM
							"unitLaneBlock" 
						WHERE
							"roadName" = $1
							AND "active" = TRUE
						ORDER BY "roadCode" ASC`,
						[ res_geo.roadName ]
					);

					let lastCode = 0;
					if (res_unit.length > 0) {
						const unitRoadFilter = res_unit.filter(unit => Number(unit.roadCode));
						const unitLastCode = unitRoadFilter[unitRoadFilter.length - 1].roadCode;
						lastCode = (unitLastCode != null && Number(unitLastCode) && unitLastCode.length > 4) ? unitLastCode.slice(-4, -1) : 0;
					}

					return {
						statusCode: 20000,
						message: 'successful',
						data: { result: { geo: res_geo, unitList: res_unit, lastCode: Number(lastCode) } }
					};
				} catch (error) {
					console.log(error);
					return Boom.notAcceptable(error.sqlMessage);
				}
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/road/unitLaneBlock',
			options: {
				description: '新增車道維護單元',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						unitList: Joi.array().min(1).items(Joi.object({
							roadId: Joi.number().required().description("unitRoad Id"),
							laneCode: Joi.number().required().description("unitLane laneCode"),
							roadCode: Joi.string().required().description("道路編號"),
							roadName: Joi.string().required().description("道路名稱"),
							lane: Joi.number().required().description("車道數量"),
							area: Joi.number().required().description("區塊面積"),
							length: Joi.number().required().description("區塊長度"),
							geometry: Joi.string().required().description("地理資訊")
						}))
					}).error(err => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { unitList } = request.payload;

				try {
					// Step1: 先將之前的欄位disable
					await request.pg.client.query(
						`UPDATE "public"."unitLaneBlock" SET "active" = FALSE, "updatedAt" = NOW() WHERE "laneCode" = $1`,
						[ unitList[0].laneCode ]
					);

					// Step2: 新增
					for (const unit of unitList) {
						// console.log(unit);
						await request.pg.client.query(
							`INSERT INTO "public"."unitLaneBlock" ("RoadId", "laneCode", "roadCode", "roadName", "lane", "area", "length", "wkb_geometry", "operatorId") VALUES ($1, $2, $3, $4, $5, $6, $7, ST_GeomFromGeoJSON($8), $9)`,
							[ unit.roadId, unit.laneCode, unit.roadCode, unit.roadName, unit.lane, unit.area, unit.length, unit.geometry, 0 ]
						);
					}

					return {
						statusCode: 20000,
						message: 'successful'
					};
				} catch (error) {
					console.log(error);
					return Boom.notAcceptable(error.sqlMessage);
				}
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/road/unitRoadBlock',
			options: {
				description: '新增維護單元',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						unitList: Joi.array().min(1).items(Joi.object({
							roadId: Joi.number().required().description("unitRoad Id"),
							roadCode: Joi.string().required().description("道路編號"),
							roadName: Joi.string().required().description("道路名稱"),
							lane: Joi.number().required().description("車道數量"),
							area: Joi.number().required().description("區塊面積"),
							length: Joi.number().required().description("區塊長度"),
							geometry: Joi.string().required().description("地理資訊")
						}))
					})
				}   // POST
			},
			handler: async function (request, h) {
				const { unitList } = request.payload;

				try {
					// Step1: 先將之前的欄位disable
					await request.pg.client.query(
						`UPDATE "public"."unitRoadBlock" SET "active" = FALSE, "updatedAt" = NOW() WHERE "RoadId" = $1`,
						[ unitList[0].roadId ]
					);

					// Step2: 新增
					for (const unit of unitList) {
						// console.log(unit);
						await request.pg.client.query(
							`INSERT INTO "public"."unitRoadBlock" ("RoadId", "roadCode", "roadName", "lane", "area", "length", "wkb_geometry", "operatorId") VALUES ($1, $2, $3, $4, $5, $6, ST_GeomFromGeoJSON($7), $8)`,
							[ unit.roadId, unit.roadCode, unit.roadName, unit.lane, unit.area, unit.length, unit.geometry, 0 ]
						);
					}

					return {
						statusCode: 20000,
						message: 'successful'
					};
				} catch (error) {
					console.log(error);
					return Boom.notAcceptable(error.sqlMessage);
				}
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/road/unitBlock',
			options: {
				description: '維護單元',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						splitType: Joi.number().allow(1, 2).default(2).description("區塊切分類型 - 1: 單元; 2: 車道"),
						distList: Joi.string().default("").description("行政區(zip) List"),
						roadName: Joi.string().default("").description("道路名稱"),
						'width[]': Joi.array().items(Joi.number()).length(2).default([0, 0]).description("計畫路寬"),
						'widthReal[]': Joi.array().items(Joi.number()).length(2).default([0, 0]).description("實際路寬"),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { splitType, distList, roadName, 'width[]': width, 'widthReal[]': widthReal, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				let sqlCMD = distList.length == 0 ? "" : ` AND "unitRoad"."zip" IN (${distList})`;
				// if (roadName.length != 0) sqlCMD += ` AND ( "roadName" LIKE '%${roadName}%' OR "crossName" LIKE '%${roadName}%' OR "roadStart" LIKE '%${roadName}%' OR "roadEnd" LIKE '%${roadName}%')`;
				if (roadName.length != 0) sqlCMD += ` AND "unitRoad"."roadName" ~ '${roadName.replace(/,/g, "|")}'`;

				if (width[1] == 0) sqlCMD += ` AND "unitRoad"."width" >= ${width[0]}`;
				else sqlCMD += ` AND "unitRoad"."width" >= ${width[0]} AND "unitRoad"."width" <= ${width[1]}`;

				if (widthReal[1] == 0) sqlCMD += ` AND "unitRoad"."widthReal" >= ${widthReal[0]}`;
				else sqlCMD += ` AND "unitRoad"."widthReal" >= ${widthReal[0]} AND "unitRoad"."widthReal" <= ${widthReal[1]}`;

				// sqlCMD = sqlCMD.replace("AND", "WHERE");

				try {
					if (splitType == 1) {
						const { rows: list } = await request.pg.client.query(
							`SELECT 
								"unitRoadBlock"."id",
								"unitRoadBlock"."roadCode",
								"unitRoad"."RoadId",
								"unitRoad"."zip",
								"unitRoad"."roadName",
								"unitRoad"."crossName",
								"unitRoad"."roadStart",
								"unitRoad"."roadEnd",
								"unitRoad"."width",
								"unitRoad"."widthReal",
								"unitRoadBlock"."lane",
								"unitRoadBlock"."length",
								"unitRoadBlock"."area",
								ST_AsGeoJSON("unitRoadBlock"."wkb_geometry") AS "wkb_geometry"
							FROM 
								"unitRoadBlock"
								LEFT JOIN "unitRoad" USING("RoadId") 
							WHERE
								"active" = TRUE
								${sqlCMD}
							ORDER BY "unitRoad"."RoadId", "unitRoadBlock"."roadCode"
							OFFSET $1 ROWS
							FETCH NEXT $2 ROWS ONLY`,
							[ offset, pageSize ]
						);

						if (list.length == 0) return { statusCode: 20000, message: 'successful', data: { list: [], total: 0 } }
						
						const { rows: [{ total }] } = await request.pg.client.query(
							`SELECT 
								COUNT(*) AS total 
							FROM 
								"unitRoadBlock"
								LEFT JOIN "unitRoad" USING("RoadId") 
							WHERE 
								"active" = TRUE 
							${sqlCMD}`);

						return {
							statusCode: 20000,
							message: 'successful',
							data: { list: list, total: Number(total) }
						};
					} else if(splitType == 2) {
						const { rows: list } = await request.pg.client.query(
							`SELECT 
								"unitLaneBlock"."id",
								"unitLaneBlock"."roadCode",
								"unitLaneBlock"."laneCode",
								"unitRoad"."RoadId",
								"unitRoad"."zip",
								"unitRoad"."roadName",
								"unitLane"."laneId",
								"unitRoad"."crossName",
								"unitRoad"."roadStart",
								"unitRoad"."roadEnd",
								"unitRoad"."width",
								"unitRoad"."widthReal",
								"unitLaneBlock"."lane",
								"unitLaneBlock"."length",
								"unitLaneBlock"."area",
								ST_AsGeoJSON("unitLaneBlock"."wkb_geometry") AS "wkb_geometry"
							FROM 
								"unitLaneBlock"
								LEFT JOIN "unitRoad" USING("RoadId") 
								LEFT JOIN "unitLane" USING("laneCode")
							WHERE
								"unitLaneBlock"."active" = TRUE
								${sqlCMD}
							ORDER BY "unitRoad"."RoadId", "unitLaneBlock"."roadCode"
							OFFSET $1 ROWS
							FETCH NEXT $2 ROWS ONLY`,
								[ offset, pageSize ]
							);

						if (list.length == 0) return { statusCode: 20000, message: 'successful', data: { list: [], total: 0 } }

						const { rows: [{ total }] } = await request.pg.client.query(
							`SELECT 
							COUNT(*) AS total 
						FROM 
							"unitLaneBlock"
							LEFT JOIN "unitRoad" USING("RoadId") 
						WHERE 
							"active" = TRUE 
						${sqlCMD}`);

						return {
							statusCode: 20000,
							message: 'successful',
							data: { list: list, total: Number(total) }
						};
					}
				} catch (error) {
					console.log(error);
					return Boom.notAcceptable(error.sqlMessage);
				}
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'PUT',
			path: '/road/unitBlock/{id}',
			options: {
				description: '修改維護單元',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					payload: Joi.object({
						splitType: Joi.number().allow(1, 2).default(2).description("區塊切分類型 - 1: 單元; 2: 車道"),
						active: Joi.boolean().default(false).description("true: 啟用; false: 刪除")
					})
				}
			},
			handler: async function (request, h) {
				const { id } = request.params;
				const { splitType, active } = request.payload;

				const tableName = (splitType == 1) ? "unitRoadBlock" : "unitLaneBlock";

				try {
					await request.pg.client.query(
						`UPDATE "${tableName}" SET "active" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
						[ active, id ]
					);

					return {
						statusCode: 20000,
						message: 'successful'
					};
				} catch (error) {
					console.log(error);
					return Boom.notAcceptable(error.sqlMessage);
				}
			},
		});
		/* Router End */   
	},
};
