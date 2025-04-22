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
	name: 'roadCase',
	version: '0.0.0',
	register: async function (server, options) {

		// ----------------------------------------------------------------------------------------------------
		// 缺失
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/road/caseType',
			options: {
				description: '缺失類型',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				// validate: {
				// 	query: Joi.object({})
				// }   // GET
			},
			handler: async function (request, h) {
				const { rows: list } = await request.pg.client.query(
					`SELECT "缺失名稱" AS "caseName" FROM qgis."路面缺失標註" WHERE "reccontrol" = '1' GROUP BY "缺失名稱"`
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: list.map(l => (l.caseName)) }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 缺失上傳
		server.route({
			method: 'POST',
			path: '/road/caseUpload',
			options: {
				description: '缺失上傳',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						surveyId: Joi.number().required().description("TendersSurvey id"),
						dateCollect: Joi.string().required().description('缺失收集時間'),
						caseList: Joi.array().min(1).items(Joi.object({
							caseName: Joi.string().required().description("缺失名稱"),
							caseLevel: Joi.string().required().description("損壞程度"),
							geoJson: Joi.object({
								type: Joi.string().required().description("幾何格式"),
								coordinates: Joi.array().required().description("位置資訊")
							}).required().description("缺失地理資訊"),
						}))
					}).error((err) => console.log(err))
				}   // POST
			},
			handler: async function (request, h) {
				const { surveyId, dateCollect, caseList } = request.payload;

				let sqlCMD_list = "";
				for (const caseItem of caseList) {
					// console.log(caseItem);
					if (caseItem.geoJson.type == 'MultiLineString') sqlCMD_list += `(${surveyId}, '${dateCollect}', '${caseItem.caseName}', '${caseItem.caseLevel}', null, ST_GeomFromGeoJSON('${JSON.stringify(caseItem.geoJson)}')),`;
					else sqlCMD_list += `(${surveyId}, '${dateCollect}', '${caseItem.caseName}', '${caseItem.caseLevel}', ST_GeomFromGeoJSON('${JSON.stringify(caseItem.geoJson)}'), null),`;
				}
				sqlCMD_list = sqlCMD_list.replace(/,$/, "");
				// console.log(sqlCMD_list);

				await request.pg.client.query(`INSERT INTO "qgis"."distress" ("surveyId", "dateCollect", "distressType", "distressLevel", "geom", "wkb_geometry") VALUES ${sqlCMD_list}`);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});
		
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/road/caseList',
			options: {
				description: '缺失列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						filter: Joi.boolean().default(false).description("是否篩選「已刪除」"),
						surveyId: Joi.number().required().description("TendersSurvey id"),
						caseId: Joi.number().default(0).description("缺失編號"),
						caseType: Joi.string().default("").description("缺失類型"),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					}).error(err => console.log(err))
				}   // GET
			},
			handler: async function (request, h) {
				const { filter, surveyId, caseId, caseType, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;
				const levelMap = { 1: "輕", 2: "中", 3: "重" };

				const caseTableCol =
					`ROUND(ST_Length ("wkb_geometry" :: geography)::numeric, 2) AS "length",
					ROUND(ST_Area ("geom" :: geography)::numeric, 2) AS "area",
					COALESCE(ST_AsGeoJSON("geom"), ST_AsGeoJSON("wkb_geometry")) AS "wkb_geometry"`;

				let sqlCMD = ` AND "active" = ${!filter}`;
				if (caseId != 0) sqlCMD += ` AND "id" = ${caseId}`;

				const caseTypeFilter = JSON.parse(caseType).filter(type => (type.checked));
				// console.log(caseTypeFilter);
				if (caseTypeFilter.length > 0) {
					for (const type of caseTypeFilter) {
						sqlCMD += ` OR ( "distressType" = '${ type.name }'`;
						if (type.level > 0) sqlCMD += ` AND "distressLevel" = '${levelMap[type.level]}'`;
						sqlCMD += ` )`;
					}
					sqlCMD = sqlCMD.replace("OR", "AND (");
					sqlCMD += ` )`;
				}
				// console.log(sqlCMD);

				const { rows: list } = await request.pg.client.query(
					`SELECT
						"id" AS "caseId",
						"distressType",
						"distressLevel",
						${caseTableCol},
						"active",
						(CASE WHEN "wkb_geometry" IS NULL AND "geom" IS NULL THEN TRUE ELSE FALSE END) AS "isPoint",
						(CASE WHEN "wkb_geometry" IS NOT NULL THEN TRUE ELSE FALSE END) AS "isLine"
					FROM "qgis"."distress"
					WHERE 
						"surveyId" = $1
						${sqlCMD}
					ORDER BY  "distressType" ASC, "distressLevel" ASC, "id" ASC
					OFFSET $2 ROWS
					FETCH NEXT $3 ROWS ONLY`,
					[ surveyId, offset, pageSize ]
				);

				const { rows: [{ total }] } = await request.pg.client.query(
					`SELECT COUNT(*) AS total FROM "qgis"."distress" WHERE "surveyId" = $1 ${sqlCMD}`,
					[ surveyId ]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: list, total: Number(total) }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'PUT',
			path: '/road/caseList/{id}',
			options: {
				description: '修改缺失',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					params: Joi.object({
						id: Joi.number().required()
					}),
					payload: Joi.object({
						isActive: Joi.boolean().default(false).description("啟用狀態")
					})
				}
			},
			handler: async function (request, h) {
				const { id } = request.params;
				const { isActive } = request.payload;

				await request.pg.client.query(
					`UPDATE "qgis"."distress" SET active = $1 WHERE "id" = $2`,
					[ isActive, id ]
				);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/road/caseGeo',
			options: {
				description: '缺失地理資訊',
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

				let caseTableCol = 
					`id,
					ROUND(ST_Length ("wkb_geometry" :: geography)::numeric, 2) AS "length",
					ROUND(ST_Area ("geom" :: geography)::numeric, 2) AS "area",
					COALESCE(ST_AsGeoJSON("geom"), ST_AsGeoJSON("wkb_geometry")) AS "wkb_geometry"`;

				const { rows: result } = await request.pg.client.query(
					`SELECT
						"id" AS "caseId",
						"orginalID",
						"distressType",
						"distressLevel",
						${caseTableCol},
						(CASE WHEN "wkb_geometry" IS NULL AND "geom" IS NULL THEN TRUE ELSE FALSE END) AS "isPoint",
						(CASE WHEN "wkb_geometry" IS NOT NULL THEN TRUE ELSE FALSE END) AS "isLine"
					FROM qgis."distress"
					WHERE 
						"surveyId" = $1 AND "active" = true
					ORDER BY "area" ASC`,
					[ surveyId ]
				);

				// console.log(result);

				let geoJSON = {
					"type": "FeatureCollection",
					"name": "caseJSON",
					"features": []
				};

				for(const caseSpec of result) {
					let feature = {
						"type": "Feature",
						"properties": {
							"id": caseSpec.id,
							"orginalID": caseSpec.orginalID,
							"caseId": caseSpec.caseId,
							"caseName": String(caseSpec.distressType),
							"caseLevel": caseSpec.distressLevel,
							"length": caseSpec.length,
							"area": caseSpec.area,
							"isPoint": caseSpec.isPoint,
							"isLine": caseSpec.isLine
						},
						"geometry": JSON.parse(caseSpec.wkb_geometry)
					};

					// console.log(feature);
					geoJSON.features.push(feature);
				}

				const { rows: res_summary } = await request.pg.client.query(
					`SELECT
						"id",
						"orginalID",
						"distressType" AS "caseName",
						"distressLevel" AS "caseLevel",
						CAST ( COUNT ( "id" ) AS INTEGER ) AS "total" 
					FROM
						qgis."distress"
					WHERE 
						"surveyId" = $1 
						AND "active" IS TRUE
					GROUP BY
						"distressType", "distressLevel", "id", "orginalID"
					ORDER BY
						"distressType", "total" DESC`,
					[ surveyId ]
				);

				const summary = res_summary.reduce((acc, cur) => {
					if (acc.length == 0 || cur.caseName != acc[acc.length - 1].caseName) acc.push({ caseName: cur.caseName, total: cur.total, level: [{ caseLevel: cur.caseLevel, total: cur.total }] });
					else {
						acc[acc.length-1].total += cur.total;
						acc[acc.length-1].level.push({ caseLevel: cur.caseLevel, total: cur.total });
					}
					
					return acc;
				}, []); 

				// console.log(summary);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { geoJSON: JSON.stringify(geoJSON), summary }
				};
			},
		});

		server.route({
			method: 'POST',
			path: '/road/caseGeoCopyToBridge',
			options: {
				description: '缺失地理資訊 - 複製到橋梁',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						distressID: Joi.number().required().description("缺失編號ID")
					})
				}
			},
			handler: async function (request, h) {
				const { distressID } = request.payload;

				// 對應surveyID(正式服)
				// 98北投區 129北投區橋梁
				// 99士林區 128士林區橋梁
				// 100中山區 125中山區橋梁
				// 101大同區 124大同區橋梁
				// 102松山區 126松山區橋梁
				// 103信義區 127信義區橋梁
				// 104內湖區 130內湖區橋梁
				// 105南港區 131南港區橋梁
				const surveyIdMap = {
					98: 129,
					99: 128,
					100: 125,
					101: 124,
					102: 126,
					103: 127,
					104: 130,
					105: 131
				};
				
				// 檢查ditress橋樑數量
				const { rows: count } = await request.pg.client.query(`
					SELECT COUNT(*) AS total FROM qgis."distress" WHERE "orginalID" = $1`,
					[distressID]
				);
				
				// 檢查distress橋樑有沒有相同資料(數量大於0)
				if (count[0].total > 0) {
					return {
						statusCode: 400,
						message: '橋梁有相關重複資料 不可匯入'
					}
				} else {
					const { rows: result } = await request.pg.client.query(
						`SELECT
							"surveyId",
							"distressType",
							"distressLevel",
							"geom",
							"wkb_geometry",
							"dateCreate",
							"dateCollect",
							"active",
							"caseDetectionId"
						FROM
							qgis."distress"
						WHERE
							"id" = $1`,
						[distressID]
					);

					const surveyId = result[0].surveyId;

					// 如果surveyId包含 (北投 士林 中山 大同 松山 信義 內湖 南港) 則可以複製
					if (surveyId in surveyIdMap) {
						await request.pg.client.query(
							`INSERT INTO qgis."distress" (
								"surveyId",
								"distressType",
								"distressLevel",
								"geom",
								"wkb_geometry",
								"dateCreate",
								"dateCollect",
								"active",
								"caseDetectionId",
								"orginalID")
							VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
							[surveyIdMap[surveyId], 
							result[0].distressType, 
							result[0].distressLevel, 
							result[0].geom, 
							result[0].wkb_geometry, 
							result[0].dateCreate, 
							result[0].dateCollect, 
							result[0].active, 
							result[0].caseDetectionId, 
							distressID]
						);
					}
				}

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 路況查詢
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/road/status',
			options: {
				description: '道況查詢',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						filter: Joi.boolean().default(false).description("是否排除「路口」"),
						groupType: Joi.number().allow(1, 2).required().description('區塊類型: 1-街廓; 2-路段'),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間'),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { filter, groupType, timeStart, timeEnd, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				const sqlCMD_where = filter ? ` AND split_part("block_nco2022mapping"."nfcl_code", '-', 3) != '路口'` : "";

				let list = [];
				let total = 0;
				if (groupType == 1) {
					const { rows: res_list } = await request.pg.client.query(
						`SELECT
							"pci_nco2022mapping"."fcl_id",
							"block_nco2022mapping"."zip_code",
							"block_nco2022mapping"."fcl_road",
							split_part("block_nco2022mapping"."nfcl_code", '-', 3) AS "road_direction",
							"block_nco2022mapping"."fcl_roadx",
							"block_nco2022mapping"."fcl_sta_ro",
							"block_nco2022mapping"."fcl_end_ro",
							round(AVG("pci_nco2022mapping"."PCI_value")::numeric, 2)::FLOAT AS "PCI_value",
							ST_AsGeoJSON("block_nco2022"."wkb_geometry") AS "wkb_geometry"
						FROM
							qgis."pci_nco2022mapping"
							LEFT JOIN qgis."block_nco2022" USING ("fcl_id")
							LEFT JOIN qgis."block_nco2022mapping" USING ("fcl_id")
						WHERE 
							"pci_nco2022mapping"."date_star" >= $1 AND "pci_nco2022mapping"."date_end" < $2 
							${sqlCMD_where}
						GROUP BY "pci_nco2022mapping"."fcl_id", split_part("block_nco2022mapping"."nfcl_code", '-', 3), "block_nco2022mapping"."zip_code", "block_nco2022mapping"."fcl_road", "block_nco2022mapping"."fcl_roadx", "block_nco2022mapping"."fcl_sta_ro", "block_nco2022mapping"."fcl_end_ro", "block_nco2022"."wkb_geometry"
						ORDER BY "PCI_value" ASC
						OFFSET $3 ROWS
						FETCH NEXT $4 ROWS ONLY`,
						[timeStart, timeEnd, offset, pageSize]
					);

					const { rows: [res_total] } = await request.pg.client.query(
						`SELECT COUNT(*) AS total
						FROM (
							SELECT "pci_nco2022mapping"."fcl_id" 
							FROM 
								qgis."pci_nco2022mapping"
								LEFT JOIN qgis."block_nco2022mapping" USING ("fcl_id")
							WHERE 
								"pci_nco2022mapping"."date_star" >= $1 AND "pci_nco2022mapping"."date_end" < $2
								${sqlCMD_where}
							GROUP BY "pci_nco2022mapping"."fcl_id"
						) AS "pci_nco2022mapping"`,
						[timeStart, timeEnd]
					);

					list = res_list;
					total = res_total.total;
				}

				if (groupType == 2) {
					// NOTE: 新工處切塊為基準
					// 地理資訊: ST_AsGeoJSON(ST_Multi(ST_Union(ST_MakeValid("block_nco2022"."wkb_geometry")))) AS "wkb_geometry"
					const { rows: res_list } = await request.pg.client.query(
						`SELECT
							"block_nco2022mapping"."zip_code",
							"block_nco2022mapping"."fcl_road", 
							split_part("block_nco2022mapping"."nfcl_code", '-', 3) AS "road_direction",
							round(AVG("pci_nco2022mapping"."PCI_value")::numeric, 2)::FLOAT AS "PCI_value"
						FROM
							qgis."pci_nco2022mapping"
							LEFT JOIN qgis."block_nco2022" USING ("fcl_id")
							LEFT JOIN qgis."block_nco2022mapping" USING ("fcl_id")
						WHERE 
							"pci_nco2022mapping"."date_star" >= $1 AND "pci_nco2022mapping"."date_end" < $2
							${sqlCMD_where}
						GROUP BY "block_nco2022mapping"."fcl_road", split_part("block_nco2022mapping"."nfcl_code", '-', 3), "block_nco2022mapping"."zip_code"
						ORDER BY "PCI_value" ASC
						OFFSET $3 ROWS
						FETCH NEXT $4 ROWS ONLY`,
						[timeStart, timeEnd, offset, pageSize]
					);

					const { rows: [res_total] } = await request.pg.client.query(
						`SELECT COUNT(*) AS total
						FROM (
							SELECT "block_nco2022mapping"."fcl_road"
							FROM 
								qgis."pci_nco2022mapping"
								LEFT JOIN qgis."block_nco2022mapping" USING ("fcl_id")
							WHERE 
								"pci_nco2022mapping"."date_star" >= $1 AND "pci_nco2022mapping"."date_end" < $2
								${sqlCMD_where}
							GROUP BY "block_nco2022mapping"."fcl_road", split_part("block_nco2022mapping"."nfcl_code", '-', 3)
						) AS "pci_nco2022mapping"`,
						[timeStart, timeEnd]
					);

					// NOTE: 我們切塊為基準
					// const { rows: res_list } = await request.pg.client.query(
					// 	`SELECT
					// 		"block_nco2022mapping"."zip_code",
					// 		"block_104"."道路名稱" AS "fcl_road",
					// 		"block_104"."pci_id_group",
					// 		round(AVG("pci_104"."PCI_value")::numeric, 2)::FLOAT AS "PCI_value",
					// 		ST_AsGeoJSON(ST_UNION("block_104"."wkb_geometry")) AS "wkb_geometry"
					// 	FROM 
					// 		qgis."block_nco2022mapping"
					// 		LEFT JOIN qgis."block_104" ON "block_104"."id" = "block_nco2022mapping"."block_id"
					// 		LEFT JOIN (
					// 			SELECT * 
					// 			FROM qgis."pci_104" 
					// 			WHERE TO_DATE("datestar", 'YYYY/MM/DD') >= $1 AND TO_DATE("datestar", 'YYYY/MM/DD') < $2	
					// 		) AS "pci_104" ON "block_104"."id" = "pci_104" ."qgis_id"
					// 	GROUP BY "block_104"."pci_id_group", "block_nco2022mapping"."zip_code", "block_104"."道路名稱", "block_104"."wkb_geometry"
					// 	ORDER BY "PCI_value" ASC
					// 	OFFSET $3 ROWS
					// 	FETCH NEXT $4 ROWS ONLY`,
					// 	[ timeStart, timeEnd, offset, pageSize ]
					// );

					// const { rows: [ res_total ] } = await request.pg.client.query(
					// 	`SELECT COUNT(*) AS total
					// 	FROM (
					// 		SELECT "block_104"."pci_id_group" 
					// 		FROM 
					// 			qgis."block_nco2022mapping"
					// 			LEFT JOIN qgis."block_104" ON "block_104"."id" = "block_nco2022mapping"."block_id"
					// 		GROUP BY "block_104"."pci_id_group"
					// 	) AS "pci_104mapping"`
					// );

					list = res_list;
					total = res_total.total;
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: list, total: Number(total) }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		// 查核地圖
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/road/blockPCI',
			options: {
				description: '區塊PCI數值',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						tenderId: Joi.number().required().description("Tenders tenderId"),
						zipCode: Joi.number().default(0).description('行政區'),
						// timeStart: Joi.string().required().description('起始時間'),
						// timeEnd: Joi.string().required().description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { tenderId, zipCode } = request.query;
				const pciTableName = await server.methods.tender.getPCITable(tenderId, zipCode);
				if (pciTableName.length == 0) return Boom.notAcceptable("Non-allow Tender");

				const { rows: result } = await request.pg.client.query(
					`SELECT
						"id" AS "blockId",
						"pci_id" AS "pciId",
						"道路名稱" AS "roadName",
						"PCI_real",
						ROUND(ST_Area ("wkb_geometry" :: geography)::numeric, 2) AS "area",
						"updatedAt" AS "updateTime"
					FROM qgis."${pciTableName}"
					WHERE "pci_id" IS NOT NULL
					ORDER BY "pci_id" ASC`
				);

				const { rows: res_summary } = await request.pg.client.query(
					`SELECT
						SUM(CASE WHEN "PCI_real" >= 85 AND "PCI_real" <= 100 THEN 1 ELSE 0 END) AS "veryGood",
						SUM(CASE WHEN "PCI_real" >= 70 AND "PCI_real" < 85 THEN 1 ELSE 0 END) AS "good",
						SUM(CASE WHEN "PCI_real" >= 55 AND "PCI_real" < 70 THEN 1 ELSE 0 END) AS "fair",
						SUM(CASE WHEN "PCI_real" >= 40 AND "PCI_real" < 55 THEN 1 ELSE 0 END) AS "poor",
						SUM(CASE WHEN "PCI_real" >= 25 AND "PCI_real" < 40 THEN 1 ELSE 0 END) AS "veryPoor",
						SUM(CASE WHEN "PCI_real" >= 10 AND "PCI_real" < 25 THEN 1 ELSE 0 END) AS "serious",
						SUM(CASE WHEN "PCI_real" >= 0 AND "PCI_real" < 10 THEN 1 ELSE 0 END) AS "failed"
					FROM
						qgis."${pciTableName}"
					WHERE "pci_id" IS NOT NULL`
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result, summary: res_summary }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/road/blockPCI/archive',
			options: {
				description: '區塊PCI數值(封存)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						tenderId: Joi.number().required().description("Tenders tenderId"),
						surveyId: Joi.number().required().description("TendersSurvey id"),
						zipCode: Joi.number().default(0).description('行政區')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { tenderId, surveyId, zipCode } = request.query;
				const pciTableName = await server.methods.tender.getPCITable(tenderId, zipCode);
				if (pciTableName.length == 0) return Boom.notAcceptable("Non-allow Tender");

				const { rows: result } = await request.pg.client.query(
					`SELECT
						"blockList"."id" AS "blockId",
						"blockList"."pci_id" AS "pciId",
						"blockList"."道路名稱" AS "roadName",
						"pci"."pciValue" AS "PCI_real",
						ROUND(ST_Area ("blockList"."wkb_geometry" :: geography)::numeric, 2) AS "area",
						"pci"."dateCreate" AS "updateTime"
					FROM 
						qgis."pci"
						LEFT JOIN "qgis"."${pciTableName}" AS "blockList" ON "blockList"."id" = "pci"."blockId"
					WHERE 
						"pci"."surveyId" = $1
						AND "blockList"."pci_id" IS NOT NULL
					ORDER BY "pci_id" ASC`, 
					[ surveyId ]
				);

				const { rows: res_summary } = await request.pg.client.query(
					`SELECT
						SUM(CASE WHEN "pciValue" >= 85 AND "pciValue" <= 100 THEN 1 ELSE 0 END) AS "veryGood",
						SUM(CASE WHEN "pciValue" >= 70 AND "pciValue" < 85 THEN 1 ELSE 0 END) AS "good",
						SUM(CASE WHEN "pciValue" >= 55 AND "pciValue" < 70 THEN 1 ELSE 0 END) AS "fair",
						SUM(CASE WHEN "pciValue" >= 40 AND "pciValue" < 55 THEN 1 ELSE 0 END) AS "poor",
						SUM(CASE WHEN "pciValue" >= 25 AND "pciValue" < 40 THEN 1 ELSE 0 END) AS "veryPoor",
						SUM(CASE WHEN "pciValue" >= 10 AND "pciValue" < 25 THEN 1 ELSE 0 END) AS "serious",
						SUM(CASE WHEN "pciValue" >= 0 AND "pciValue" < 10 THEN 1 ELSE 0 END) AS "failed"
					FROM
						qgis."pci"
					WHERE 
						"pci"."surveyId" = $1`,
					[ surveyId ]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result, summary: res_summary }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/road/blockCaseList',
			options: {
				description: 'PCI區塊內的缺失列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						tenderId: Joi.number().required().description("Tenders tenderId"),
						surveyId: Joi.number().required().description("TendersSurvey id"),
						blockId: Joi.string().required().description("pci_id")
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { tenderId, surveyId, blockId } = request.query;
				const pciTableName = await server.methods.tender.getPCITable(tenderId);
				if (pciTableName.length == 0) return Boom.notAcceptable("Non-allow Tender");

				const caseTableCol =
					`ROUND( ST_Length ( ST_Intersection ( "${pciTableName}"."wkb_geometry", ST_Transform ( "caseList"."wkb_geometry", 4326 ) ), FALSE )::numeric, 2 ) AS "caseLength",
					ROUND( ST_Area ( ST_Intersection ( "${pciTableName}"."wkb_geometry", "caseList"."geom" )::geography )::numeric, 2 ) AS "caseArea" `;
				const leftJoinFilter =
					`( "caseList"."geom" IS NULL AND ST_Intersects ( ST_Transform ( "caseList"."wkb_geometry", 4326 ), "${pciTableName}"."wkb_geometry" ) ) 
					OR ( "caseList"."wkb_geometry" IS NULL AND ( ST_Intersects ( "caseList"."geom", "${pciTableName}"."wkb_geometry" ) ) ) `;

				const { rows: res_case } = await request.pg.client.query(
					`SELECT 
						"caseList"."id" AS "caseId",
						"caseList"."distressType",
						"caseList"."distressLevel",
						${caseTableCol}
					FROM
						(SELECT * FROM "qgis"."${pciTableName}" WHERE "pci_id" = $1) AS "${pciTableName}"
						INNER JOIN "qgis"."distress" AS "caseList" 
							ON "caseList"."active" IS TRUE 
							AND (${leftJoinFilter})
					WHERE
						("caseList"."distressType" IS NOT NULL AND LENGTH("caseList"."distressType") != 0) AND ("caseList"."distressLevel" IS NOT NULL AND LENGTH("caseList"."distressLevel") != 0) 
						AND "surveyId" = $2
					ORDER BY "distressType", "distressLevel"`,
					[ blockId, surveyId ]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: res_case }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/road/areaAndPCI',
			options: {
				description: '查核地圖 - 個別道路資料(面積, PCI分數)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						tenderId: Joi.number().required().description("Tenders tenderId"),
						roadName: Joi.string().description('道路名稱')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { tenderId, roadName } = request.query;
				const pciTableName = await server.methods.tender.getPCITable(tenderId);
				if (pciTableName.length == 0) return Boom.notAcceptable("Non-allow Tender");

				const { rows: res } = await request.pg.client.query(`
					SELECT
						"pci_id",
						"道路面積" AS "roadArea",
						"PCI_real"
					FROM
						"qgis"."${pciTableName}"
					WHERE
						"道路名稱" = $1`,
					[roadName]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: res }
				};
			},
		});

		/* Router End */   
	},
};
