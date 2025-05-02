'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');
const { DateTime, Interval } = require("luxon");

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
  name: 'PCI',
  version: '0.0.0',
  register: async function (server, options) {
		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/pci/list',
			options: {
				description: 'PCI總表(年度)',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: { query: Joi.object({
					zipCode: Joi.number().required().description('行政區'), 
					timeStart: Joi.string().required().description('起始時間'),
					timeEnd: Joi.string().required().description('結束時間'),
					pageCurrent: Joi.number().min(1).default(1),
					pageSize: Joi.number().default(50)
				}) }   // GET
			},
			handler: async function (request, h) {
				const { zipCode, timeStart, timeEnd, pageCurrent, pageSize } = request.query;
				// const monthStart = DateTime.fromISO(timeStart);
				// const monthEnd = DateTime.fromISO(timeEnd);
				// const { months: monthDiff } = monthStart.diff(monthEnd, ["months"]).toObject();
				// const monthCount = Math.ceil(Math.abs(monthDiff));
				// const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * (pageSize * monthCount);
				if (![103, 104].includes(zipCode)) {
					return {
						statusCode: 20000,
						message: 'successful',
						data: { list: [], total: 0 }
					};
				}

				const { rows: monthList } = await request.pg.client.query(
					`SELECT
						DATE_PART('year', "PCIList"."datestar"::date) AS year,
						DATE_PART('month', "PCIList"."datestar"::date) AS month
					FROM
						"qgis"."pci_${zipCode}" AS "PCIList"
						LEFT JOIN "qgis"."block_${zipCode}" AS "blockList" ON "blockList"."pci_id" IS NOT NULL AND LENGTH("blockList"."pci_id") != 0 AND "PCIList"."qgis_id" = "blockList"."id"::numeric
					WHERE
						"PCIList"."datestar"::date >= $1 AND "PCIList"."datestar"::date < $2
						AND "blockList"."pci_id" IS NOT NULL
					GROUP BY DATE_PART('month', "PCIList"."datestar"::date), DATE_PART('year', "PCIList"."datestar"::date)`,
					[ timeStart, timeEnd ]);
				
				// console.log(monthList);
				
				const monthCount = monthList.length;
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * (pageSize * monthCount);
				const distMap = { 103: "大同區", 104: "中山區" };

				const { rows: result } = await request.pg.client.query(
					`SELECT
						"blockList"."pci_id" AS id,
						'${distMap[zipCode]}' AS "dist",
						"blockList"."道路名稱" AS "roadName",
						ROUND("blockList"."道路面積"::numeric, 2) AS "roadArea",
						"PCIList"."datestar",
						DATE_PART('year', "PCIList"."datestar"::date) AS "createYear",
						DATE_PART('month', "PCIList"."datestar"::date) AS "createMonth",
						(CASE WHEN "PCIList"."PCI_value" = -1 THEN 100 WHEN "PCIList"."PCI_value" < 0 THEN 0 ELSE "PCIList"."PCI_value" END) AS "PCI_value"
					FROM
						"qgis"."pci_${zipCode}" AS "PCIList"
						LEFT JOIN "qgis"."block_${zipCode}" AS "blockList" ON "blockList"."pci_id" IS NOT NULL AND LENGTH("blockList"."pci_id") != 0 AND "PCIList"."qgis_id" = "blockList"."id"::numeric
					WHERE
						LENGTH("PCIList"."datestar") != 0 AND "PCIList"."datestar"::date >= $1 AND "PCIList"."datestar"::date < $2
						AND "blockList"."pci_id" IS NOT NULL
					ORDER BY "PCIList"."qgis_id" ASC, "PCIList"."datestar"::date ASC
					LIMIT $3 OFFSET $4`,
					[ timeStart, timeEnd, pageSize * monthCount, offset ]);

				// console.log(result);

				const { rows: [{ total }] } = await request.pg.client.query(
					`SELECT
						COUNT("PCIList"."qgis_id") AS total
					FROM
						"qgis"."pci_${zipCode}" AS "PCIList"
						LEFT JOIN "qgis"."block_${zipCode}" AS "blockList" ON "blockList"."pci_id" IS NOT NULL AND LENGTH("blockList"."pci_id") != 0 AND "PCIList"."qgis_id" = "blockList"."id"::numeric
					WHERE
						"PCIList"."datestar"::date >= $1 AND "PCIList"."datestar"::date < $2
						AND "blockList"."pci_id" IS NOT NULL`,
					[ timeStart, timeEnd ]);
				
				// console.log(total);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result, total: total / monthCount }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/pci/share',
			options: {
				description: 'PCI每月份額',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().required().description('行政區'), 
						timeStart: Joi.string().default('').description('起始時間'),
						timeEnd: Joi.string().default('').description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				let { zipCode, timeStart, timeEnd } = request.query;
				if (timeStart.length == 0) timeStart = DateTime.fromISO("2024-01-01").toFormat("yyyy-MM-dd");
				if (timeEnd.length == 0) timeEnd = DateTime.now().toFormat("yyyy-MM-dd");
				// console.log(timeStart, timeEnd);

				if (![103, 104].includes(zipCode)) {
					return {
						statusCode: 20000,
						message: 'successful',
						data: { list: [] }
					};
				}

				const { rows: result } = await request.pg.client.query(
					`SELECT
						datestar,
						COUNT(CASE WHEN PCIList."PCI_value" <= 55 THEN 1 ELSE NULL END)::int AS "PCIUnder55",
						COUNT(CASE WHEN PCIList."PCI_value" > 55 AND PCIList."PCI_value" <= 70 THEN 1 ELSE NULL END)::int AS "PCIUnder70",
						COUNT(CASE WHEN PCIList."PCI_value" > 70 AND PCIList."PCI_value" < 100 THEN 1 ELSE NULL END)::int AS "PCIUnder100",
						COUNT(CASE WHEN PCIList."PCI_value" >= 100 THEN 1 ELSE NULL END)::int AS "PCI100"
					FROM
						"qgis"."pci_${zipCode}" AS PCIList
					WHERE
						PCIList.datestar::date >= $1 AND PCIList.datestar::date < $2
						AND LENGTH(datestar) != 0
					GROUP BY datestar
					ORDER BY datestar`,
					[ timeStart, timeEnd ]);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

    // ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/pci/average',
			options: {
				description: 'PCI平均值',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().required().description('行政區')
					})
				}   // GET
			},
			handler: async function (request, h) {
				const { zipCode } = request.query;
				const start = DateTime.fromISO("2024-01-01");
				const { months: monthDiff } = start.diffNow(["months"]).toObject();

				if (![103, 104].includes(zipCode)) {
					return {
						statusCode: 20000,
						message: 'successful',
						data: { list: [], total: 0 }
					};
				}

				let sqlCMD = "";
				for (let i = 0; i <= Math.floor(Math.abs(monthDiff)); i++) {
					const { year, month } = start.plus({ month: i });
					if (i != 0) sqlCMD += ` UNION `;
					sqlCMD += `SELECT 
						datestar,
						SUM("PCI_value") / COUNT(autoid) AS "PCIAverage"
					FROM 
						"qgis"."pci_${zipCode}" AS PCIList 
					WHERE 
						DATE_PART('year', datestar::date)  = '${year}' AND DATE_PART('month', datestar::date) = '${month}'
						AND "PCI_value" > 0
					GROUP BY datestar`;
				}
				sqlCMD += ` ORDER BY datestar`;
				console.log(sqlCMD);
				const { rows: result } = await request.pg.client.query(sqlCMD);

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/pci/caseReport',
			options: {
				description: '案件數量',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {
					query: Joi.object({
						zipCode: Joi.number().required().description('行政區'),
						timeStart: Joi.string().default('').description('起始時間'),
						timeEnd: Joi.string().default('').description('結束時間')
					})
				}   // GET
			},
			handler: async function (request, h) {
				let { zipCode, timeStart, timeEnd } = request.query;
				if (timeStart.length == 0) {
					timeStart = (zipCode == 104) ? DateTime.fromISO("2024-01-01").toFormat("yyyy-MM-dd") : DateTime.fromISO("2024-01-01").toFormat("yyyy-MM-dd");
				}
				if (timeEnd.length == 0) timeEnd = DateTime.now().toFormat("yyyy-MM-dd");

				const { rows: [{ district }] } = await request.pg.client.query(
					`SELECT "District" AS "district" FROM "public"."unitZip" WHERE "zipCode" = $1 `,
					[ zipCode ]);

				await sql.connect(sqlConfig_1);

				let { recordsets: [ result_case ] } = await sql.query
					`SELECT 
						CAST(YEAR(caseList.CaseDate) AS VARCHAR(4)) + '-' + RIGHT('00' + CAST(MONTH(caseList.CaseDate) AS VARCHAR(2)), 2) AS month,
						SUM(CASE WHEN caseList.CaseType = 6 AND caseList.BType = 15 THEN 1 ELSE 0 END) AS '1999Pothole',
						SUM(CASE WHEN caseList.CaseType = 6 THEN 1 ELSE 0 END) AS '1999Report',
						SUM(CASE WHEN caseList.CaseType = 4 AND caseList.caseno LIKE '%巡%' AND caseList.BType = 15 THEN 1 ELSE 0 END) AS 'bimPothole',
						SUM(CASE WHEN caseList.CaseType = 4 AND caseList.caseno LIKE '%巡%' THEN 1 ELSE 0 END) AS 'bimInspect'
					FROM
						tbl_case AS caseList
						INNER JOIN tbl_block AS blockList ON caseList.bsn = blockList.serialno 
					WHERE
						caseList.SerialNo >= ${snLimit}
						AND caseList.RecControl = '1' 
						AND CaseNo = recaseno
						AND blockList.dteam IN ( '41', '81', '91', '71', '72' )
						AND blockList.TBName = ${district}
						AND CAST ( caseList.CaseDate AS datetime ) >= ${timeStart} AND CAST ( caseList.CaseDate AS datetime ) < ${timeEnd}
					GROUP BY CAST(YEAR(caseList.CaseDate) AS VARCHAR(4)) + '-' + RIGHT('00' + CAST(MONTH(caseList.CaseDate) AS VARCHAR(2)), 2)
					ORDER BY CAST(YEAR(caseList.CaseDate) AS VARCHAR(4)) + '-' + RIGHT('00' + CAST(MONTH(caseList.CaseDate) AS VARCHAR(2)), 2)`;

				let result_PCIAverage = [];
				if(zipCode == 104) {
					const { recordsets } = await sql.query
						`SELECT
							CAST(YEAR(datestar) AS VARCHAR(4)) + '-' + RIGHT('00' + CAST(MONTH(datestar) AS VARCHAR(2)), 2) AS month,
							(SUM(PCI_value) / COUNT(autoid)) AS PCIAverage
						FROM
							QGIS_PCIV
						WHERE dteam = '1' 
						GROUP BY CAST(YEAR(datestar) AS VARCHAR(4)) + '-' + RIGHT('00' + CAST(MONTH(datestar) AS VARCHAR(2)), 2)`;

					sql.close();
					result_PCIAverage = recordsets[0];
				} else if (zipCode == 103) {
					const { rows: result } = await request.pg.client.query(
						`SELECT 
							DATE_PART('year', datestar::date)::VARCHAR || '-' || LPAD(DATE_PART('month', datestar::date)::VARCHAR, 2, '0') AS month,
							SUM("PCI_value") / COUNT(autoid) AS "PCIAverage"
						FROM 
							"qgis"."pci_103" AS PCIList 
						GROUP BY datestar`
					);
					result_PCIAverage = result;
				}

				result_case.forEach(c => {
					const PCIAver = result_PCIAverage.filter(pci => pci.month == c.month);
					if (PCIAver.length > 0) c.PCIAverage = PCIAver[0].PCIAverage;
				});

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result_case }
				};
			},
		});

		// ----------------------------------------------------------------------------------------------------
		server.route({
			method: 'GET',
			path: '/pci/caseList',
			options: {
				description: '派工案件列表',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: { 
					query: Joi.object({
						zipCode: Joi.number().required().description('行政區'),
						caseType: Joi.string().required().description('案件類型'),
						month: Joi.string().required().description('年月'),
						pageCurrent: Joi.number().min(1).default(1),
						pageSize: Joi.number().default(50)
					}) 
				}   // GET
			},
			handler: async function (request, h) {
				const { zipCode, caseType, month, pageCurrent, pageSize } = request.query;
				const timeStart = DateTime.fromISO(month).startOf('month').toFormat("yyyy-MM-dd");
				const timeEnd = DateTime.fromISO(month).plus({ months: 1 }).startOf('month').toFormat("yyyy-MM-dd");
				const offset = (pageCurrent == 1) ? 0 : (pageCurrent - 1) * pageSize;

				const { rows: [{ district }] } = await request.pg.client.query(
					`SELECT "District" AS "district" FROM "public"."unitZip" WHERE "zipCode" = $1 `,
					[ zipCode ]);

				let sqlCMD = "";
				switch(caseType) {
					case "1999Pothole":
						sqlCMD = `AND caseList.CaseType = 6 AND caseList.BType = 15 `;
						break;
					case "1999Report":
						sqlCMD = `AND caseList.CaseType = 6 `;
						break;
					case "bimPothole":
						sqlCMD = `AND caseList.CaseType = 4 AND caseList.caseno LIKE '%巡%' AND caseList.BType = 15 `;
						break;
					case "bimInspect":
						sqlCMD = `AND caseList.CaseType = 4 AND caseList.caseno LIKE '%巡%' `;
						break;
				}

				await sql.connect(sqlConfig_1);

				const sqlCMD_list = `SELECT 
						caseList.CaseNo,
						caseList.CaseName,
						caseList.CaseDate,
						caseList.DeviceType,
						distressType.BTName
					FROM
						tbl_case AS caseList
						INNER JOIN tbl_BType AS distressType ON caseList.BType = distressType.SerialNo
						INNER JOIN tbl_block AS blockList ON caseList.bsn = blockList.serialno
					WHERE
						caseList.SerialNo >= ${snLimit}
						AND caseList.RecControl = '1' 
						AND CaseNo = recaseno
						AND blockList.dteam IN ( '41', '81', '91', '71', '72' )
						AND blockList.TBName = '${district}'
						${sqlCMD}
						AND CAST ( caseList.CaseDate AS datetime ) >= '${timeStart}' AND CAST ( caseList.CaseDate AS datetime ) < '${timeEnd}'
						ORDER BY caseList.CaseNo, caseList.SystemNo
						OFFSET ${offset} ROWS
						FETCH NEXT ${pageSize} ROWS ONLY`;

				const { recordsets: [result] } = await sql.query(sqlCMD_list);

				const sqlCMD_total = `SELECT
						COUNT(*) AS total
					FROM
						tbl_case AS caseList
						INNER JOIN tbl_block AS blockList ON caseList.bsn = blockList.serialno
					WHERE
						caseList.SerialNo >= ${snLimit}
						AND caseList.RecControl = '1' 
						AND CaseNo = recaseno
						AND blockList.dteam IN ( '41', '81', '91', '71', '72' )
						AND blockList.TBName = '${district}'
						${sqlCMD}
						AND CAST(caseList.CaseDate AS datetime) >= '${timeStart}'  AND CAST(caseList.CaseDate AS datetime) < '${timeEnd}'`;
				
				const { recordsets: [[{ total }]] } = await sql.query(sqlCMD_total);

				sql.close();

				return {
					statusCode: 20000,
					message: 'successful',
					data: { list: result, total: total }
				};
			},
		});

		server.route({
      method: 'POST',
      path: '/pci/updatePieChart',
      options: {
        description: 'PCI更新佔比統計(圓餅圖) - 重複資料',
        //auth: { strategy: 'auth', scope: ['roles'] },
        //auth: { strategy: 'bearer', scope: ['roles'] },
        cors: { origin: ['*'], credentials: true },
        tags: ['api'],
				validate: {
					payload: Joi.object({
						dateStart: Joi.string().required().description('起始時間'),
						dateEnd: Joi.string().required().description('結束時間'),
						zipCode: Joi.number().required().description('行政區')
					})
				}
      },
      handler: async function (request, h) {
        const { dateStart, dateEnd, zipCode } = request.payload;

				// 複製上個月的資料
				const startDate = DateTime.fromISO(dateStart).minus({ months: 1 }).endOf('day').toISODate();
				const endDate = DateTime.fromISO(dateEnd).minus({ months: 1 }).endOf('day').toISODate();

				// 103大同區 104中山區
				if (zipCode === 103) {
					const res = await request.pg.client.query(`
						INSERT INTO qgis.pci_103 (dteam, qgis_id, "PCI_value", datestar, dateend) (
							SELECT 
								dteam,
								qgis_id,
								"PCI_value",
								'${dateStart}' AS datestar,
								'${dateEnd}' AS dateend
							FROM qgis.pci_103
							WHERE datestar >= '${startDate}' AND datestar < '${endDate}'
						)
					`);
				} else if (zipCode === 104) {
					const res = await request.pg.client.query(`
						INSERT INTO qgis.pci_104 (dteam, qgis_id, "PCI_value", datestar, dateend) (
							SELECT 
								dteam,
								qgis_id,
								"PCI_value",
								'${dateStart}' AS datestar,
								'${dateEnd}' AS dateend
							FROM qgis.pci_104
							WHERE datestar >= '${startDate}' AND datestar < '${endDate}'
						)
					`);
				}
				
        
        return { 
          statusCode: 20000, 
          message: 'successful'
        };

      },
    });

		// -----------------------------------------------------------------------------------------------------
		server.route({
			method: "GET",
			path: "/pci/score",
			options: {
				tags: ["api"],
				description: "PCI等級分布數據",
				validate: {
					query: Joi.object({
						tenderId: Joi.number().required().description('tenderId')
					}),
				},
			},
			handler: async function (request) {
				const { tenderId } = request.query;

				const [[block]] = await request.tendersql.pool.execute(`
					SELECT tableName FROM Tenders WHERE tenderId = ?`,
					[tenderId]
				);

				// 維護單元數
				const res = await request.pg.client.query(`
					SELECT
						SUM(CASE WHEN "PCI_real" >= 85 AND "PCI_real" <= 100 THEN 1 ELSE 0 END) AS "veryGood(85-100)",
						SUM(CASE WHEN "PCI_real" >= 70 AND "PCI_real" < 85 THEN 1 ELSE 0 END) AS "good(70-85)",
						SUM(CASE WHEN "PCI_real" >= 55 AND "PCI_real" < 70 THEN 1 ELSE 0 END) AS "fair(55-70)",
						SUM(CASE WHEN "PCI_real" >= 40 AND "PCI_real" < 55 THEN 1 ELSE 0 END) AS "poor(40-55)",
						SUM(CASE WHEN "PCI_real" >= 25 AND "PCI_real" < 40 THEN 1 ELSE 0 END) AS "veryPoor(25-40)",
						SUM(CASE WHEN "PCI_real" >= 10 AND "PCI_real" < 25 THEN 1 ELSE 0 END) AS "serious(10-25)",
						SUM(CASE WHEN "PCI_real" >= 0 AND "PCI_real" < 10 THEN 1 ELSE 0 END) AS "failed(0-10)"
					FROM "qgis"."${block.tableName}" AS PCIList
					WHERE "pci_id" IS NOT NULL

					UNION ALL

					SELECT
						ROUND(SUM(CASE WHEN "PCI_real" >= 85 AND "PCI_real" <= 100 THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 2) AS "veryGood(85-100)",
						ROUND(SUM(CASE WHEN "PCI_real" >= 70 AND "PCI_real" < 85 THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 2) AS "good(70-85)",
						ROUND(SUM(CASE WHEN "PCI_real" >= 55 AND "PCI_real" < 70 THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 2) AS "fair(55-70)",
						ROUND(SUM(CASE WHEN "PCI_real" >= 40 AND "PCI_real" < 55 THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 2) AS "poor(40-55)",
						ROUND(SUM(CASE WHEN "PCI_real" >= 25 AND "PCI_real" < 40 THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 2) AS "veryPoor(25-40)",
						ROUND(SUM(CASE WHEN "PCI_real" >= 10 AND "PCI_real" < 25 THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 2) AS "serious(10-25)",
						ROUND(SUM(CASE WHEN "PCI_real" >= 0 AND "PCI_real" < 10 THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100, 2) AS "failed(0-10)"
					FROM "qgis"."${block.tableName}" AS PCIList
					WHERE "pci_id" IS NOT NULL
				`);

				// 路段數
				const res2 = await request.pg.client.query(`
					WITH PCIList AS (
						SELECT
							"道路名稱",
							MAX("PCI_real") AS "PCI_real"
						FROM "qgis"."${block.tableName}"
						WHERE "pci_id" IS NOT NULL
						GROUP BY "道路名稱"
					)

					SELECT
						COALESCE(SUM(1) FILTER (WHERE "PCI_real" >= 85 AND "PCI_real" <= 100), 0) AS "veryGood(85-100)",
						COALESCE(SUM(1) FILTER (WHERE "PCI_real" >= 70 AND "PCI_real" < 85), 0) AS "good(70-85)",
						COALESCE(SUM(1) FILTER (WHERE "PCI_real" >= 55 AND "PCI_real" < 70), 0) AS "fair(55-70)",
						COALESCE(SUM(1) FILTER (WHERE "PCI_real" >= 40 AND "PCI_real" < 55), 0) AS "poor(40-55)",
						COALESCE(SUM(1) FILTER (WHERE "PCI_real" >= 25 AND "PCI_real" < 40), 0) AS "veryPoor(25-40)",
						COALESCE(SUM(1) FILTER (WHERE "PCI_real" >= 10 AND "PCI_real" < 25), 0) AS "serious(10-25)",
						COALESCE(SUM(1) FILTER (WHERE "PCI_real" >= 0 AND "PCI_real" < 10), 0) AS "failed(0-10)"
					FROM PCIList

					UNION ALL

					SELECT
						COALESCE(ROUND(SUM(1) FILTER (WHERE "PCI_real" >= 85 AND "PCI_real" <= 100)::numeric / COUNT(*) * 100, 2), 0) AS "veryGood(85-100)",
						COALESCE(ROUND(SUM(1) FILTER (WHERE "PCI_real" >= 70 AND "PCI_real" < 85)::numeric / COUNT(*) * 100, 2), 0) AS "good(70-85)",
						COALESCE(ROUND(SUM(1) FILTER (WHERE "PCI_real" >= 55 AND "PCI_real" < 70)::numeric / COUNT(*) * 100, 2), 0) AS "fair(55-70)",
						COALESCE(ROUND(SUM(1) FILTER (WHERE "PCI_real" >= 40 AND "PCI_real" < 55)::numeric / COUNT(*) * 100, 2), 0) AS "poor(40-55)",
						COALESCE(ROUND(SUM(1) FILTER (WHERE "PCI_real" >= 25 AND "PCI_real" < 40)::numeric / COUNT(*) * 100, 2), 0) AS "veryPoor(25-40)",
						COALESCE(ROUND(SUM(1) FILTER (WHERE "PCI_real" >= 10 AND "PCI_real" < 25)::numeric / COUNT(*) * 100, 2), 0) AS "serious(10-25)",
						COALESCE(ROUND(SUM(1) FILTER (WHERE "PCI_real" >= 0 AND "PCI_real" < 10)::numeric / COUNT(*) * 100, 2), 0) AS "failed(0-10)"
					FROM PCIList
				`);

				return {
					statusCode: 20000,
					message: 'successful',
					data: {
						list: res.rows, 
						list2: res2.rows
					}
				};
			}
		});

		// -----------------------------------------------------------------------------------------------------
		server.route({
			method: "GET",
			path: "/pci/distressStatistics",
			options: {
				tags: ["api"],
				description: "調查缺失類型統計",
				validate: {
					query: Joi.object({
						surveyId: Joi.number().required().description('TendersSurvey id')
					}),
				},
			},
			handler: async function (request) {
				const { surveyId } = request.query;

				const res = await request.pg.client.query(`
					SELECT
						"distressType" AS "缺失類型",
						SUM(CASE WHEN "distressLevel" = '輕' THEN 1 ELSE 0 END) AS "輕",
						SUM(CASE WHEN "distressLevel" = '中' THEN 1 ELSE 0 END) AS "中",
						SUM(CASE WHEN "distressLevel" = '重' THEN 1 ELSE 0 END) AS "重"
					FROM "qgis"."distress"
					WHERE "surveyId" = $1
					GROUP BY "distressType"
					ORDER BY "distressType"`,
					[surveyId]
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: {
						list: res.rows
					}
				};
			}
		});

		server.route({
			method: "GET",
			path: "/pci/roadAverage",
			options: {
				tags: ["api"],
				description: "各項道路名稱分數",
				validate: {
					query: Joi.object({
						tenderId: Joi.number().required().description('tenderId')
					}),
				},
			},
			handler: async function (request) {
				const { tenderId } = request.query;

				const [[block]] = await request.tendersql.pool.execute(`
					SELECT tableName FROM Tenders WHERE tenderId = ?`,
					[tenderId]
				);

				// 道路平均PCI
				const res = await request.pg.client.query(`
					SELECT "道路名稱", ROUND(AVG("PCI_real"), 2) AS average
					FROM qgis."${block.tableName}"
					GROUP BY "道路名稱"`
				);

				return {
					statusCode: 20000,
					message: 'successful',
					data: {
						list: res.rows
					}
				};
			}
		});

		server.route({
			method: "GET",
			path: "/pci/allAverage",
			options: {
				tags: ["api"],
				description: "各行政區總平均分數",
				validate: {
					query: Joi.object({
						
					}),
				},
			},
			handler: async function (request) {
				// const { block } = request.query;

				// 區域平均PCI
				// 1002 1052 1062 1082 1102 1112 1122 1142 1152 1162 99921 99922
				const res = await request.pg.client.query(`
					SELECT '中正區' AS area, AVG("PCI_real") AS average_pci FROM qgis.block_1002
					UNION ALL
					SELECT '松山區' AS area, AVG("PCI_real") AS average_pci FROM qgis.block_1052
					UNION ALL
					SELECT '大安區' AS area, AVG("PCI_real") AS average_pci FROM qgis.block_1062
					UNION ALL
					SELECT '萬華區' AS area, AVG("PCI_real") AS average_pci FROM qgis.block_1082
					UNION ALL
					SELECT '信義區' AS area, AVG("PCI_real") AS average_pci FROM qgis.block_1102
					UNION ALL
					SELECT '士林區' AS area, AVG("PCI_real") AS average_pci FROM qgis.block_1112
					UNION ALL
					SELECT '北投區' AS area, AVG("PCI_real") AS average_pci FROM qgis.block_1122
					UNION ALL
					SELECT '內湖區' AS area, AVG("PCI_real") AS average_pci FROM qgis.block_1142
					UNION ALL
					SELECT '南港區' AS area, AVG("PCI_real") AS average_pci FROM qgis.block_1152
					UNION ALL
					SELECT '文山區' AS area, AVG("PCI_real") AS average_pci FROM qgis.block_1162
					UNION ALL
					SELECT '橋涵區1' AS area, AVG("PCI_real") AS average_pci FROM qgis.block_99921
					UNION ALL
					SELECT '橋涵區2' AS area, AVG("PCI_real") AS average_pci FROM qgis.block_99922
				`);
				
				return {
					statusCode: 20000,
					message: 'successful',
					data: {
						list: res.rows
					}
				};
			}
		});

		server.route({
			method: "POST",
			path: "/pci/importPieChart",
			options: {
				tags: ["api"],
				description: "PCI更新佔比統計(圓餅圖) - 全新一季",
				validate: {
					payload: Joi.object({
						tenderId: Joi.number().required().description('tender Id'),
						dateStart: Joi.string().required().description('起始時間'),
						dateEnd: Joi.string().required().description('結束時間')
					}),
				},
			},
			handler: async function (request) {
				const { tenderId, dateStart, dateEnd } = request.payload;
				
				// 1. 先匯入缺失 [PCI(匯入)] 鋪面指標 - PCI計算頁面
				// 2. 整體重算 鋪面指標 - PCI計算頁面
				// 3. 空格填滿
				
				// 大同
				if (tenderId == 1031) {
					// 填滿
					const fulfill_1031 = await request.pg.client.query(`
						UPDATE qgis."block_1031" SET "PCI_real" = 100
						WHERE "PCI_real" < 0 AND "道路名稱" IN (
							SELECT "roadName" FROM qgis."caseInspectRoute" WHERE "zipCode" = 103 AND "active" IS TRUE
						)
					`);

					// 匯入新的資料 (圓餅圖檢查)
					const importNewData_1031 = await request.pg.client.query(`
						INSERT INTO qgis."pci_103" ("dteam", "qgis_id", "PCI_value", "datestar", "dateend", "createdatetime")
						(
							SELECT
							1 AS "dteam",
							"id"::numeric AS "qgis_id",
							"PCI_real"::float4 AS "PCI_value",
							'${dateStart}'::text AS "datestar",
							'${dateEnd}'::text AS "dateend",
							NOW() AS "createdatetime"
							FROM qgis."block_1031"
							WHERE "pci_id" IS NOT NULL AND LENGTH("pci_id") != 0
						)
					`);
				}

				// 中山
				if (tenderId == 1041) {
					// 填滿
					const fulfill_1041 = await request.pg.client.query(`
						UPDATE qgis."block_1041" SET "PCI_real" = 100
						WHERE "PCI_real" < 0 AND "道路名稱" IN (
							SELECT "roadName" FROM qgis."caseInspectRoute" WHERE "zipCode" = 104 AND "active" IS TRUE
						)
					`);

					// 匯入新的資料 (圓餅圖檢查)
					const importNewData_1041 = await request.pg.client.query(`
						INSERT INTO qgis."pci_104" ("dteam", "qgis_id", "PCI_value", "datestar", "dateend", "createdatetime")
						(
							SELECT
							1 AS "dteam",
							"id"::numeric AS "qgis_id",
							"PCI_real"::float4 AS "PCI_value",
							'${dateStart}'::text AS "datestar",
							'${dateEnd}'::text AS "dateend",
							NOW() AS "createdatetime"
							FROM qgis."block_1041"
							WHERE "pci_id" IS NOT NULL AND LENGTH("pci_id") != 0
						)
					`);
				}
				
				
				return {
					statusCode: 20000,
					message: 'successful',
				};
			}
		});

    /* Router End */   
  },
};
