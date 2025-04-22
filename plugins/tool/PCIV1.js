'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const pciCal = require('../../utils/pciCal');

const authStrategy = false; 
//const authStrategy = 'simple';

exports.plugin = {
	//pkg: require('./package.json'),
	name: 'PCItoolV1',
	version: '0.0.0',
	register: async function (server, options) {
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'POST',
			path: '/pciToolV1/reset',
			options: {
				description: '重置PCI',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: { payload: Joi.object({
					tenderId: Joi.number().required().description("Tenders tenderId"),
					timeStart: Joi.string().required().description('起始時間'),
					timeEnd: Joi.string().required().description('結束時間')
				}) }   // POST
			},
			handler: async function (request, h) {
				// param 參數
				const { tenderId, timeStart, timeEnd } = request.payload;  //POST
				let pciTableName = await server.methods.tender.getPCITableV1(tenderId);
				pciTableName = pciTableName.replace(/_0$|_00$/g, "");
				let caseTableName = await server.methods.tender.getCaseTableV1(tenderId);
				caseTableName = caseTableName.replace(/_0$|_00$/g, "");
				if (pciTableName.length == 0 || caseTableName.length == 0) return Boom.notAcceptable("Non-allow Tender");

				// 30米更新Materialized Views
				if (tenderId == 100) await server.methods.tender.freshMViewV1(request.pg.client, tenderId, true);

				// SQL CMD
				await request.pg.client.query(`UPDATE "qgis"."${pciTableName}" SET "PCI_real" = -1`);

				// 計算PCI
				const { rows: res_block } = await request.pg.client.query(
					`SELECT "${pciTableName}"."ogc_fid" AS "block_id", ST_Area("${pciTableName}"."wkb_geometry"::geography) AS "block_area" FROM "qgis"."${pciTableName}" ORDER BY "block_id"`
				);

				//TODO: 大同區特例計算PCI
				let caseTableCol = "";
				let leftJoinFilter = "";
				switch (tenderId) {
					case 81:
						caseTableCol = 
							`SUM( "PCI運算用長度或面積值" ) AS "case_length",
							SUM("PCI運算用長度或面積值") AS "case_area"`;
						leftJoinFilter =
							`( "caseList"."geom" IS NULL AND "caseList"."wkb_geometry" IS NULL AND ST_Intersects ( ST_Transform ( "caseList"."geom_point", 4326 ), "${pciTableName}"."wkb_geometry" ) ) 
							OR ("caseList"."geom" IS NULL AND ST_Intersects(ST_Transform("caseList"."wkb_geometry", 4326), "${pciTableName}"."wkb_geometry"))
							OR ("caseList"."wkb_geometry" IS NULL AND(ST_Intersects("caseList"."geom", "${pciTableName}"."wkb_geometry"))) `;
						break;
					case 91:
					case 100:
						caseTableCol = 
							`SUM ( ROUND( ST_Length ( ST_Intersection ( "${pciTableName}"."wkb_geometry", ST_Transform ( "caseList"."wkb_geometry", 4326 ) ), FALSE )::numeric, 2 ) ) AS "case_length",
							SUM ( ROUND( ST_Area ( ST_Intersection ( "${pciTableName}"."wkb_geometry", "caseList"."geom" )::geography )::numeric, 2 ) ) AS "case_area" `;
						leftJoinFilter = 
							`( "caseList"."geom" IS NULL AND ST_Intersects ( ST_Transform ( "caseList"."wkb_geometry", 4326 ), "${pciTableName}"."wkb_geometry" ) ) 
							OR ( "caseList"."wkb_geometry" IS NULL AND ( ST_Intersects ( "caseList"."geom", "${pciTableName}"."wkb_geometry" ) ) ) `;
						break;
				}
					
				const { rows: res_case } = await request.pg.client.query(
					`SELECT 
						"${pciTableName}"."ogc_fid" AS "block_id",
						"${pciTableName}"."pci_id",
						"caseList"."缺失名稱",
						"caseList"."損壞程度",
						REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REGEXP_REPLACE ( REPLACE ( REPLACE ( REPLACE ( "caseList"."缺失名稱", '龜裂', '1' ), '縱橫裂縫', '2' ), '塊狀裂縫', '3' ), '坑洞|人孔高差|薄層剝離', '4' ), '車轍', '5' ), '補綻及管線回填', '6' ), '推擠', '7' ), '隆起與凹陷', '8' ), '冒油', '9' ), '波浪狀鋪面', '10' ), '車道與路肩分離', '11' ), '滑溜裂縫', '12' ), '骨材剝落', '13' ) AS "PCI_class",
						REPLACE ( REPLACE ( REPLACE ( "caseList"."損壞程度", '輕', '1' ), '中', '2' ), '重', '3' ) AS "case_level",
						COUNT ( "caseList"."autoid" ) AS "case_num",
						${caseTableCol}
					FROM
						"qgis"."${pciTableName}"
						INNER JOIN "qgis"."${caseTableName}" AS "caseList" 
							ON "caseList"."reccontrol" = '1' 
							AND (${leftJoinFilter})
					WHERE
						("caseList"."缺失名稱" IS NOT NULL AND LENGTH("caseList"."缺失名稱") != 0) AND ("caseList"."損壞程度" IS NOT NULL AND LENGTH("caseList"."損壞程度") != 0) 
						AND "caseList"."createdatetime" >= $1 AND "caseList"."createdatetime" < $2 
						AND "${pciTableName}"."道路名稱" !~ '高架|跨越橋'
					GROUP BY
						"pci_id", "block_id", "PCI_class", "case_level",
						"caseList"."缺失名稱", "caseList"."損壞程度"
					ORDER BY "block_id", "PCI_class", "case_level"`,
					[ timeStart, timeEnd ]
				);

				// Step1: 計算折減值(DV)
				let blockDVObj = {}; 
				for (const caseSpec of res_case) {
					if (!blockDVObj.hasOwnProperty(caseSpec.block_id)) blockDVObj[caseSpec.block_id] = [];
					const block_area = res_block.filter(block => block.block_id == caseSpec.block_id)[0].block_area;

					let density = 0;
					if (caseSpec.PCI_class == "4") density = (caseSpec.case_num / block_area) * 100;
					else if (["2", "11"].includes(caseSpec.PCI_class)) density = (caseSpec.case_length / block_area) * 100;
					else density = (caseSpec.case_area / block_area) * 100;

					// console.log(caseSpec.pci_id, caseSpec.PCI_class, caseSpec.case_level);
					const dv = pciCal.calDV(caseSpec.PCI_class, caseSpec.case_level, density);
					// console.log(density, dv);

					if(dv > 0) blockDVObj[caseSpec.block_id].push({ PCI_class: caseSpec.PCI_class, case_level: caseSpec.case_level, density, dv });
					// else {
					// 	console.log(caseSpec);
					// 	// const levelMap = { 1: "L", 2: "M", 3: "H" };
					// 	// console.log(`func${String(caseSpec.PCI_class).padStart(2, '0')}${levelMap[caseSpec.case_level]}`);
					// 	console.log(density, dv);
					// }

					// if (dv > 0 && dv < 2) {
					// 	console.log(caseSpec);
					// 	console.log(density, dv);
					// }
				}
				// console.log(blockDVObj);
				// Object.keys(blockDVObj).forEach(key => blockDVObj[key].sort((a, b) => (b.dv - a.dv)));

				// Step2: 計算PCI
				for(const [ blockId, blockDV ] of Object.entries(blockDVObj)) {
					let pci = Math.round(pciCal.calPCI(blockDV.map(block => block.dv)) * 10) / 10;
					// 去除 > 100 or < 0 不合理情形
					pci = pci > 100 ? 100 : pci < 0 ? 0 : pci;
					// console.log(blockId, pci);

					await request.pg.client.query(
						`UPDATE "qgis"."${pciTableName}" SET "PCI_real" = $1, "updatedAt" = NOW() WHERE "ogc_fid" = $2`,
						[ pci, blockId ]
					);
				}
				
				// return
				return { 
					statusCode: 20000, 
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'PUT',
			path: '/pciToolV1/update',
			options: {
				description: '更新PCI(個別)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: { payload : Joi.object({
					tenderId: Joi.number().required().description("Tenders tenderId"),
					pciValue: Joi.number().allow(-1, 0, 100).required().description("PCI值: 0為重算"),
					blockId: Joi.string().required().description("pci_id"),
					timeStart: Joi.string().required().description('起始時間'),
					timeEnd: Joi.string().required().description('結束時間')
				}) }   // PUT
			},
			handler: async function (request, h) {
				// param 參數
				const { tenderId, blockId, pciValue, timeStart, timeEnd } = request.payload;  //POST
				let pciTableName = await server.methods.tender.getPCITableV1(tenderId);
				pciTableName = pciTableName.replace(/_0$|_00$/g, "");
				let caseTableName = await server.methods.tender.getCaseTableV1(tenderId);
				caseTableName = caseTableName.replace(/_0$|_00$/g, "");
				if (pciTableName.length == 0 || caseTableName.length == 0) return Boom.notAcceptable("Non-allow Tender");

				// 30米更新Materialized Views
				if (tenderId == 100) await server.methods.tender.freshMViewV1(request.pg.client, tenderId, true);

				// SQL CMD
				if (pciValue != 0) await request.pg.client.query(`UPDATE "qgis"."${pciTableName}" SET "PCI_real" = $1, "updatedAt" = NOW() WHERE "pci_id" = $2`, [ pciValue, blockId ]);
				else {
					await request.pg.client.query(`UPDATE "qgis"."${pciTableName}" SET "PCI_real" = -1 WHERE "pci_id" = $1`, [ blockId ]);

					// 計算PCI
					const { rows: res_block } = await request.pg.client.query(
						`SELECT "${pciTableName}"."ogc_fid" AS "block_id", ST_Area("${pciTableName}"."wkb_geometry"::geography) AS "block_area" FROM "qgis"."${pciTableName}" WHERE "pci_id" = $1`,
						[ blockId ]
					);

					//TODO: 大同區特例計算PCI
					let caseTableCol = "";
					let leftJoinFilter = "";
					switch (tenderId) {
						case 81:
							caseTableCol =
								`SUM( "PCI運算用長度或面積值" ) AS "case_length",
							SUM("PCI運算用長度或面積值") AS "case_area"`;
							leftJoinFilter =
								`( "caseList"."geom" IS NULL AND "caseList"."wkb_geometry" IS NULL AND ST_Intersects ( ST_Transform ( "caseList"."geom_point", 4326 ), "${pciTableName}"."wkb_geometry" ) ) 
							OR ("caseList"."geom" IS NULL AND ST_Intersects(ST_Transform("caseList"."wkb_geometry", 4326), "${pciTableName}"."wkb_geometry"))
							OR ("caseList"."wkb_geometry" IS NULL AND(ST_Intersects("caseList"."geom", "${pciTableName}"."wkb_geometry"))) `;
							break;
						case 91:
						case 100:
							caseTableCol =
								`SUM ( ROUND( ST_Length ( ST_Intersection ( "${pciTableName}"."wkb_geometry", ST_Transform ( "caseList"."wkb_geometry", 4326 ) ), FALSE )::numeric, 2 ) ) AS "case_length",
							SUM ( ROUND( ST_Area ( ST_Intersection ( "${pciTableName}"."wkb_geometry", "caseList"."geom" )::geography )::numeric, 2 ) ) AS "case_area" `;
							leftJoinFilter =
								`( "caseList"."geom" IS NULL AND ST_Intersects ( ST_Transform ( "caseList"."wkb_geometry", 4326 ), "${pciTableName}"."wkb_geometry" ) ) 
							OR ( "caseList"."wkb_geometry" IS NULL AND ( ST_Intersects ( "caseList"."geom", "${pciTableName}"."wkb_geometry" ) ) ) `;
							break;
					}

					const { rows: res_case } = await request.pg.client.query(
						`SELECT 
							"${pciTableName}"."ogc_fid" AS "block_id",
							"${pciTableName}"."pci_id",
							"caseList"."缺失名稱",
							"caseList"."損壞程度",
							REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REGEXP_REPLACE ( REPLACE ( REPLACE ( REPLACE ( "caseList"."缺失名稱", '龜裂', '1' ), '縱橫裂縫', '2' ), '塊狀裂縫', '3' ), '坑洞|人孔高差|薄層剝離', '4' ), '車轍', '5' ), '補綻及管線回填', '6' ), '推擠', '7' ), '隆起與凹陷', '8' ), '冒油', '9' ), '波浪狀鋪面', '10' ), '車道與路肩分離', '11' ), '滑溜裂縫', '12' ), '骨材剝落', '13' ) AS "PCI_class",
							REPLACE ( REPLACE ( REPLACE ( "caseList"."損壞程度", '輕', '1' ), '中', '2' ), '重', '3' ) AS "case_level",
							COUNT ( "caseList"."autoid" ) AS "case_num",
							${caseTableCol}
						FROM
							"qgis"."${pciTableName}"
							INNER JOIN "qgis"."${caseTableName}" AS "caseList" 
								ON "caseList"."reccontrol" = '1' 
								AND (${leftJoinFilter})
						WHERE
							("caseList"."缺失名稱" IS NOT NULL AND LENGTH("caseList"."缺失名稱") != 0) AND ("caseList"."損壞程度" IS NOT NULL AND LENGTH("caseList"."損壞程度") != 0) 
							AND "caseList"."createdatetime" >= $1 AND "caseList"."createdatetime" < $2 
							AND "${pciTableName}"."pci_id" = $3
						GROUP BY
							"pci_id", "block_id", "PCI_class", "case_level",
							"caseList"."缺失名稱", "caseList"."損壞程度"
						ORDER BY "block_id", "PCI_class", "case_level"`,
						[ timeStart, timeEnd, blockId ]
					);
					// console.log(res_case);

					// Step1: 計算折減值(DV)
					let blockDVObj = {};
					for (const caseSpec of res_case) {
						if (!blockDVObj.hasOwnProperty(caseSpec.block_id)) blockDVObj[caseSpec.block_id] = [];
						const block_area = res_block.filter(block => block.block_id == caseSpec.block_id)[0].block_area;

						let density = 0;
						if (caseSpec.PCI_class == "4") density = (caseSpec.case_num / block_area) * 100;
						else if (["2", "11"].includes(caseSpec.PCI_class)) density = (caseSpec.case_length / block_area) * 100;
						else density = (caseSpec.case_area / block_area) * 100;

						// console.log(caseSpec.pci_id, caseSpec.PCI_class, caseSpec.case_level);
						const dv = pciCal.calDV(caseSpec.PCI_class, caseSpec.case_level, density);
						// console.log(density, dv);

						if (dv > 0) blockDVObj[caseSpec.block_id].push({ PCI_class: caseSpec.PCI_class, case_level: caseSpec.case_level, density, dv });
					}
					// console.log(blockDVObj);

					// Step2: 計算PCI
					for (const [blockId, blockDV] of Object.entries(blockDVObj)) {
						let pci = Math.round(pciCal.calPCI(blockDV.map(block => block.dv)) * 10) / 10;
						// 去除 > 100 or < 0 不合理情形
						pci = pci > 100 ? 100 : pci < 0 ? 0 : pci;
						// console.log(blockId, pci);

						await request.pg.client.query(
							`UPDATE "qgis"."${pciTableName}" SET "PCI_real" = $1, "updatedAt" = NOW() WHERE "ogc_fid" = $2`,
							[ pci, blockId ]
						);
					}
				}

				// return
				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'PUT',
			path: '/pciToolV1/updateByName',
			options: {
				description: '更新PCI(路名)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					payload: Joi.object({
						tenderId: Joi.number().required().default(100).description("Tenders tenderId"),
						pciValue: Joi.number().allow(-1, 0, 100).required().description("PCI值: 0為重算; 100將-1填100"),
						roadName: Joi.string().required().description("道路名稱"),
						timeStart: Joi.string().required().default("2022-09-01").description('起始時間'),
						timeEnd: Joi.string().required().default("2023-03-01").description('結束時間')
					})
				}   // PUT
			},
			handler: async function (request, h) {
				// param 參數
				const { tenderId, roadName, pciValue, timeStart, timeEnd } = request.payload;  //POST
				let pciTableName = await server.methods.tender.getPCITableV1(tenderId);
				pciTableName = pciTableName.replace(/_0$|_00$/g, "");
				let caseTableName = await server.methods.tender.getCaseTableV1(tenderId);
				caseTableName = caseTableName.replace(/_0$|_00$/g, "");
				if (pciTableName.length == 0 || caseTableName.length == 0) return Boom.notAcceptable("Non-allow Tender");

				// 30米更新Materialized Views
				if (tenderId == 100) await server.methods.tender.freshMViewV1(request.pg.client, tenderId, true);

				// SQL CMD
				if(pciValue == 100) {
					await request.pg.client.query(
						`UPDATE "qgis"."${pciTableName}" SET "PCI_real" = 100, "updatedAt" = NOW() WHERE "道路名稱" = $1 AND "PCI_real" = -1`,
						[ roadName ]);
				} else {
					await request.pg.client.query(
						`UPDATE "qgis"."${pciTableName}" SET "PCI_real" = -1, "updatedAt" = NOW() WHERE "道路名稱" = $1`,
						[ roadName ]);
				}

				if (pciValue == 0) {
					// 計算PCI
					const { rows: res_block } = await request.pg.client.query(
						`SELECT "${pciTableName}"."ogc_fid" AS "block_id", ST_Area("${pciTableName}"."wkb_geometry"::geography) AS "block_area" FROM "qgis"."${pciTableName}" WHERE "道路名稱" = $1`,
						[ roadName ]
					);
					// console.log(res_block);

					//TODO: 大同區特例計算PCI
					let caseTableCol = "";
					let leftJoinFilter = "";
					switch (tenderId) {
						case 81:
							caseTableCol =
								`SUM( "PCI運算用長度或面積值" ) AS "case_length",
							SUM("PCI運算用長度或面積值") AS "case_area"`;
							leftJoinFilter =
								`( "caseList"."geom" IS NULL AND "caseList"."wkb_geometry" IS NULL AND ST_Intersects ( ST_Transform ( "caseList"."geom_point", 4326 ), "${pciTableName}"."wkb_geometry" ) ) 
							OR ("caseList"."geom" IS NULL AND ST_Intersects(ST_Transform("caseList"."wkb_geometry", 4326), "${pciTableName}"."wkb_geometry"))
							OR ("caseList"."wkb_geometry" IS NULL AND(ST_Intersects("caseList"."geom", "${pciTableName}"."wkb_geometry"))) `;
							break;
						case 91:
						case 100:
							caseTableCol =
								`SUM ( ROUND( ST_Length ( ST_Intersection ( "${pciTableName}"."wkb_geometry", ST_Transform ( "caseList"."wkb_geometry", 4326 ) ), FALSE )::numeric, 2 ) ) AS "case_length",
							SUM ( ROUND( ST_Area ( ST_Intersection ( "${pciTableName}"."wkb_geometry", "caseList"."geom" )::geography )::numeric, 2 ) ) AS "case_area" `;
							leftJoinFilter =
								`( "caseList"."geom" IS NULL AND ST_Intersects ( ST_Transform ( "caseList"."wkb_geometry", 4326 ), "${pciTableName}"."wkb_geometry" ) ) 
							OR ( "caseList"."wkb_geometry" IS NULL AND ( ST_Intersects ( "caseList"."geom", "${pciTableName}"."wkb_geometry" ) ) ) `;
							break;
					}

					for (const blockSpec of res_block) {
						const { rows: res_case } = await request.pg.client.query(
							`SELECT 
								"${pciTableName}"."ogc_fid" AS "block_id",
								"caseList"."缺失名稱",
								"caseList"."損壞程度",
								REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REPLACE ( REGEXP_REPLACE ( REPLACE ( REPLACE ( REPLACE ( "caseList"."缺失名稱", '龜裂', '1' ), '縱橫裂縫', '2' ), '塊狀裂縫', '3' ), '坑洞|人孔高差|薄層剝離', '4' ), '車轍', '5' ), '補綻及管線回填', '6' ), '推擠', '7' ), '隆起與凹陷', '8' ), '冒油', '9' ), '波浪狀鋪面', '10' ), '車道與路肩分離', '11' ), '滑溜裂縫', '12' ), '骨材剝落', '13' ) AS "PCI_class",
								REPLACE ( REPLACE ( REPLACE ( "caseList"."損壞程度", '輕', '1' ), '中', '2' ), '重', '3' ) AS "case_level",
								COUNT ( "caseList"."autoid" ) AS "case_num",
								${caseTableCol}
							FROM
								"qgis"."${pciTableName}"
								INNER JOIN "qgis"."${caseTableName}" AS "caseList" 
									ON "caseList"."reccontrol" = '1' 
									AND (${leftJoinFilter})
							WHERE
								("caseList"."缺失名稱" IS NOT NULL AND LENGTH("caseList"."缺失名稱") != 0) AND ("caseList"."損壞程度" IS NOT NULL AND LENGTH("caseList"."損壞程度") != 0) 
								AND "caseList"."createdatetime" >= $1 AND "caseList"."createdatetime" < $2 
								AND "${pciTableName}"."ogc_fid" = $3
							GROUP BY
								"block_id", "PCI_class", "case_level",
								"caseList"."缺失名稱", "caseList"."損壞程度"
							ORDER BY "block_id", "PCI_class", "case_level"`,
							[ timeStart, timeEnd, blockSpec.block_id ]
						);

						// console.log(res_case);

						// Step1: 計算折減值(DV)
						let blockDVObj = {};
						for (const caseSpec of res_case) {
							if (!blockDVObj.hasOwnProperty(caseSpec.block_id)) blockDVObj[caseSpec.block_id] = [];
							const block_area = blockSpec.block_area;

							let density = 0;
							if (caseSpec.PCI_class == "4") density = (caseSpec.case_num / block_area) * 100;
							else if (["2", "11"].includes(caseSpec.PCI_class)) density = (caseSpec.case_length / block_area) * 100;
							else density = (caseSpec.case_area / block_area) * 100;

							// console.log(caseSpec.block_id, caseSpec.PCI_class, caseSpec.case_level);
							const dv = pciCal.calDV(caseSpec.PCI_class, caseSpec.case_level, density);
							// console.log(density, dv);

							if (dv > 0) blockDVObj[caseSpec.block_id].push({ PCI_class: caseSpec.PCI_class, case_level: caseSpec.case_level, density, dv });
						}
						// console.log(blockDVObj);

						// Step2: 計算PCI
						for (const [blockId, blockDV] of Object.entries(blockDVObj)) {
							let pci = Math.round(pciCal.calPCI(blockDV.map(block => block.dv)) * 10) / 10;
							// 去除 > 100 or < 0 不合理情形
							pci = pci > 100 ? 100 : pci < 0 ? 0 : pci;
							// console.log(blockId, pci);

							await request.pg.client.query(
								`UPDATE "qgis"."${pciTableName}" SET "PCI_real" = $1, "updatedAt" = NOW() WHERE "ogc_fid" = $2`,
								[ pci, blockId ]
							);
						}
					}
				}

				// return
				return {
					statusCode: 20000,
					message: 'successful'
				};
			},
		});


		/* Router End */   
	},
};
