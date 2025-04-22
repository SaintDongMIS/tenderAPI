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
	name: 'roadCaseV1',
	version: '0.0.0',
	register: async function (server, options) {

		// ----------------------------------------------------------------------------------------------------
		// 缺失
		// ----------------------------------------------------------------------------------------------------
		// 缺失上傳
		server.route({
			method: 'POST',
			path: '/roadV1/caseUpload',
			options: {
				description: '缺失上傳',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						tenderId: Joi.number().required().description("Tenders tenderId"),
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
				const { tenderId, caseList } = request.payload;
				let caseTableName = await server.methods.tender.getCaseTableV1(tenderId);
				caseTableName = caseTableName.replace(/_0$|_00$/g, "");
				if (caseTableName.length == 0) return Boom.notAcceptable("Non-allow Tender");

				const { rows: [{ maxId }] } = await request.pg.client.query(`SELECT MAX("autoid") AS "maxId" FROM "qgis"."${caseTableName}"`);

				let sqlCMD_list = "";
				for (const[ index, caseItem ] of caseList.entries()) {
					// console.log(caseItem);
					const id = Number(maxId) + index + 1;
					if (caseItem.geoJson.type == 'MultiLineString') sqlCMD_list += `(${id}, ${id}, '${caseItem.caseName}', '${caseItem.caseLevel}', null, ST_GeomFromGeoJSON('${JSON.stringify(caseItem.geoJson)}'), NOW(), '1'),`;
					else sqlCMD_list += `(${id}, ${id}, '${caseItem.caseName}', '${caseItem.caseLevel}', ST_GeomFromGeoJSON('${JSON.stringify(caseItem.geoJson)}'), null, NOW(), '1'),`;
				}
				sqlCMD_list = sqlCMD_list.replace(/,$/, "");
				// console.log(sqlCMD_list);

				await request.pg.client.query(`INSERT INTO "qgis"."${caseTableName}" ( "autoid", "成效式契約缺失autoid", "缺失名稱", "損壞程度", "geom", "wkb_geometry", "createdatetime", "reccontrol") VALUES ${sqlCMD_list}`);

				// 30米更新Materialized Views
				if (tenderId == 100) await server.methods.tender.freshMViewV1(request.pg.client, tenderId, true);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});
		
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/roadV1/caseList',
			options: {
				description: '缺失列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						filter: Joi.boolean().default(false).description("是否篩選「已刪除」"),
						tenderId: Joi.number().required().description("Tenders tenderId"),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間'),
						caseId: Joi.number().default(0).description("缺失編號"),
						roadName: Joi.string().default("").description("道路名稱"),
						caseType: Joi.string().default("").description("缺失類型"),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					}).error(err => console.log(err))
				}   // GET
			},
			handler: async function (request, h) {
				const { filter, tenderId, timeStart, timeEnd, caseId, caseType, roadName, pageCurrent, pageSize } = request.query;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;
				const levelMap = { 1: "輕", 2: "中", 3: "重" };
				const caseTableName = await server.methods.tender.getCaseTableV1(tenderId);
				if (caseTableName.length == 0) return Boom.notAcceptable("Non-allow Tender");

				// 30米更新Materialized Views
				if (tenderId == 100) await server.methods.tender.freshMViewV1(request.pg.client, tenderId);

				let caseTableCol = "";
				switch (tenderId) {
					case 81:
						caseTableCol =
							`(CASE WHEN "缺失名稱" = '縱橫裂縫' THEN "PCI運算用長度或面積值" ELSE 0 END) AS "length",
							(CASE WHEN "缺失名稱" != '縱橫裂縫' THEN "PCI運算用長度或面積值" ELSE 0 END) AS "area",
							(CASE WHEN "wkb_geometry" IS NULL AND "geom" IS NULL THEN ST_AsGeoJSON("geom_point") ELSE COALESCE(ST_AsGeoJSON("geom"), ST_AsGeoJSON("wkb_geometry")) END) AS "wkb_geometry"`;
						break;
					case 91:
					case 100:
						caseTableCol =
							`ROUND(ST_Length ("wkb_geometry" :: geography)::numeric, 2) AS "length",
							ROUND(ST_Area ("geom" :: geography)::numeric, 2) AS "area",
							COALESCE(ST_AsGeoJSON("geom"), ST_AsGeoJSON("wkb_geometry")) AS "wkb_geometry"`;
						break;
				}

				let sqlCMD = filter ? ` AND "reccontrol" = '8'` : ` AND "reccontrol" = '1'`;
				if (roadName.length != 0) sqlCMD += `AND "道路名稱" ~ '${roadName}'`;
				if (caseId != 0) sqlCMD += `AND "成效式契約缺失autoid" = ${caseId}`;

				const caseTypeFilter = JSON.parse(caseType).filter(type => (type.checked));
				// console.log(caseTypeFilter);
				if (caseTypeFilter.length > 0) {
					for (const type of caseTypeFilter) {
						sqlCMD += ` OR ( "缺失名稱" = '${ type.name }'`;
						if (type.level > 0) sqlCMD += ` AND "損壞程度" = '${levelMap[type.level]}'`;
						sqlCMD += ` )`;
					}
					sqlCMD = sqlCMD.replace("OR", "AND (");
					sqlCMD += ` )`;
				}
				// console.log(sqlCMD);

				const { rows: list } = await request.pg.client.query(
					`SELECT
						autoid AS "id",
						"成效式契約缺失autoid" AS "caseId",
						"道路名稱" AS "roadName",
						"缺失名稱" AS "caseName",
						"損壞程度" AS "caseLevel",
						"洞深公分" AS "depth",
						${caseTableCol},
						"reccontrol",
						(CASE WHEN "wkb_geometry" IS NULL AND "geom" IS NULL THEN TRUE ELSE FALSE END) AS "isPoint",
						(CASE WHEN "wkb_geometry" IS NOT NULL THEN TRUE ELSE FALSE END) AS "isLine"
					FROM qgis."${caseTableName}"
					WHERE "createdatetime" >= $1 AND "createdatetime" < $2
					${sqlCMD}
					ORDER BY  "缺失名稱" ASC, "損壞程度" ASC, "成效式契約缺失autoid" ASC
					OFFSET $3 ROWS
					FETCH NEXT $4 ROWS ONLY`,
					[ timeStart, timeEnd, offset, pageSize ]
				);

				const { rows: [{ total }] } = await request.pg.client.query(
					`SELECT COUNT(*) AS total FROM qgis."${caseTableName}" WHERE "createdatetime" >= $1 AND "createdatetime" < $2 ${sqlCMD}`,
					[ timeStart, timeEnd ]
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
			path: '/roadV1/caseList/{id}',
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
						tenderId: Joi.number().default("").description("Tenders tenderId"),
						type: Joi.number().default(8).description("1: 啟用; 8: 刪除")
					})
				}
			},
			handler: async function (request, h) {
				const { id } = request.params;
				const { tenderId, type } = request.payload;
				let caseTableName = await server.methods.tender.getCaseTableV1(tenderId);
				caseTableName = caseTableName.replace(/_0$|_00$/g, "");
				if (caseTableName.length == 0) return Boom.notAcceptable("Non-allow Tender");

				await request.pg.client.query(
					`UPDATE "qgis"."${caseTableName}" SET "reccontrol" = $1 WHERE "成效式契約缺失autoid" = $2`,
					[ type, id ]
				);

				// 30米更新Materialized Views
				if (tenderId == 100) await server.methods.tender.freshMViewV1(request.pg.client, tenderId, true);

				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/roadV1/caseGeo',
			options: {
				description: '缺失地理資訊',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						tenderId: Joi.number().required().description("Tenders tenderId"),
						zipCode: Joi.number().default(0).description('行政區'), 
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { tenderId, zipCode, timeStart, timeEnd } = request.query;
				const caseTableName = await server.methods.tender.getCaseTableV1(tenderId, zipCode);
				if (caseTableName.length == 0) return Boom.notAcceptable("Non-allow Tender");
				
				// 30米更新Materialized Views
				if (tenderId == 100) await server.methods.tender.freshMViewV1(request.pg.client, tenderId);

				let caseTableCol = "";
				switch (tenderId) {
					case 81:
						caseTableCol =
							`(CASE WHEN "缺失名稱" = '縱橫裂縫' THEN "PCI運算用長度或面積值" ELSE 0 END) AS "length",
							(CASE WHEN "缺失名稱" != '縱橫裂縫' THEN "PCI運算用長度或面積值" ELSE 0 END) AS "area",
							(CASE WHEN "wkb_geometry" IS NULL AND "geom" IS NULL THEN ST_AsGeoJSON("geom_point") ELSE COALESCE(ST_AsGeoJSON("geom"), ST_AsGeoJSON("wkb_geometry")) END) AS "wkb_geometry"`;
						break;
					case 91:
					case 100:
						caseTableCol =
							`ROUND(ST_Length ("wkb_geometry" :: geography)::numeric, 2) AS "length",
							ROUND(ST_Area ("geom" :: geography)::numeric, 2) AS "area",
							COALESCE(ST_AsGeoJSON("geom"), ST_AsGeoJSON("wkb_geometry")) AS "wkb_geometry"`;
						break;
				}

				const { rows: result } = await request.pg.client.query(
					`SELECT
						autoid AS "id",
						"成效式契約缺失autoid" AS "caseId",
						"道路名稱" AS "roadName",
						"缺失名稱" AS "caseName",
						"損壞程度" AS "caseLevel",
						"洞深公分" AS "depth",
						${caseTableCol},
						(CASE WHEN "wkb_geometry" IS NULL AND "geom" IS NULL THEN TRUE ELSE FALSE END) AS "isPoint",
						(CASE WHEN "wkb_geometry" IS NOT NULL THEN TRUE ELSE FALSE END) AS "isLine"
					FROM qgis."${caseTableName}"
					WHERE 
						"createdatetime" >= $1 AND "createdatetime" < $2
						AND "reccontrol" = '1'
					ORDER BY "area" ASC`,
					[ timeStart, timeEnd ]
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
							"caseId": caseSpec.caseId,
							"roadName": caseSpec.roadName,
							"caseName": String(caseSpec.caseName),
							"caseLevel": caseSpec.caseLevel,
							"depth": caseSpec.depth,
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
						"缺失名稱" AS "caseName",
						"損壞程度" AS "caseLevel",
						CAST ( COUNT ( "autoid" ) AS INTEGER ) AS "total" 
					FROM
						qgis."${caseTableName}"
					WHERE 
						"createdatetime" >= $1 AND "createdatetime" < $2
						AND "reccontrol" = '1'
					GROUP BY
						"缺失名稱", "損壞程度"
					ORDER BY
						"缺失名稱", "total" DESC`,
					[ timeStart, timeEnd ]
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


		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/roadV1/blockCaseList',
			options: {
				description: 'PCI區塊內的缺失列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						tenderId: Joi.number().required().description("Tenders tenderId"),
						blockId: Joi.string().required().description("pci_id"),
						timeStart: Joi.string().required().description('起始時間'),
						timeEnd: Joi.string().required().description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { tenderId, blockId, timeStart, timeEnd } = request.query;
				const pciTableName = await server.methods.tender.getPCITableV1(tenderId);
				const caseTableName = await server.methods.tender.getCaseTableV1(tenderId);
				if (pciTableName.length == 0 || caseTableName.length == 0) return Boom.notAcceptable("Non-allow Tender");

				// 30米更新Materialized Views
				if (tenderId == 100) await server.methods.tender.freshMViewV1(request.pg.client, tenderId);

				let caseTableCol = "";
				let leftJoinFilter = "";
				switch (tenderId) {
					case 81:
						caseTableCol =
							`(CASE WHEN "缺失名稱" = '縱橫裂縫' THEN "PCI運算用長度或面積值" ELSE 0 END) AS "caseLength",
							(CASE WHEN "缺失名稱" != '縱橫裂縫' THEN "PCI運算用長度或面積值" ELSE 0 END) AS "caseArea"`;
						leftJoinFilter =
							`( "caseList"."geom" IS NULL AND "caseList"."wkb_geometry" IS NULL AND ST_Intersects ( ST_Transform ( "caseList"."geom_point", 4326 ), "${pciTableName}"."wkb_geometry" ) ) 
							OR ("caseList"."geom" IS NULL AND ST_Intersects(ST_Transform("caseList"."wkb_geometry", 4326), "${pciTableName}"."wkb_geometry"))
							OR ("caseList"."wkb_geometry" IS NULL AND(ST_Intersects("caseList"."geom", "${pciTableName}"."wkb_geometry"))) `;
						break;
					case 91:
					case 100:
						caseTableCol =
							`ROUND( ST_Length ( ST_Intersection ( "${pciTableName}"."wkb_geometry", ST_Transform ( "caseList"."wkb_geometry", 4326 ) ), FALSE )::numeric, 2 ) AS "caseLength",
							ROUND( ST_Area ( ST_Intersection ( "${pciTableName}"."wkb_geometry", "caseList"."geom" )::geography )::numeric, 2 ) AS "caseArea" `;
						leftJoinFilter =
							`( "caseList"."geom" IS NULL AND ST_Intersects ( ST_Transform ( "caseList"."wkb_geometry", 4326 ), "${pciTableName}"."wkb_geometry" ) ) 
							OR ( "caseList"."wkb_geometry" IS NULL AND ( ST_Intersects ( "caseList"."geom", "${pciTableName}"."wkb_geometry" ) ) ) `;
						break;
				}

				const { rows: res_case } = await request.pg.client.query(
					`SELECT 
						"caseList"."成效式契約缺失autoid" AS "caseId",
						"caseList"."缺失名稱" AS "caseName",
						"caseList"."損壞程度" AS "caseLevel",
						${caseTableCol}
					FROM
						(SELECT * FROM "qgis"."${pciTableName}" WHERE "pci_id" = $1) AS "${pciTableName}"
						INNER JOIN "qgis"."${caseTableName}" AS "caseList" 
							ON "caseList"."reccontrol" = '1' 
							AND (${leftJoinFilter})
					WHERE
						("caseList"."缺失名稱" IS NOT NULL AND LENGTH("caseList"."缺失名稱") != 0) AND ("caseList"."損壞程度" IS NOT NULL AND LENGTH("caseList"."損壞程度") != 0) 
						AND "caseList"."createdatetime" >= $2 AND "caseList"."createdatetime" < $3
					ORDER BY "caseName", "caseLevel"`,
					[ blockId, timeStart, timeEnd ]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: res_case }
				};
			},
		});

		/* Router End */   
	},
};
