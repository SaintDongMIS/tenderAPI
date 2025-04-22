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
	name: 'tender_methodsV1',
	version: '0.0.0',
	register: async function (server, options) {
		const getZipCode = async function (tenderId) {
			const [[ result_Tender ]] = await server.tendersql.pool.execute(
				`SELECT 
					tenderId, tenderName, zipCode 
				FROM Tenders 
				WHERE tenderId = ?`,
				[ tenderId ] );

			return result_Tender.zipCode;
		}

		const getPCITableName = async function (tenderId, zipCode = 0) {
			let pciTableName = "";
			switch (tenderId) {
				case 81:
					pciTableName = `block_103`;
					break;
				case 91:
					pciTableName = `block_104`;
					break;
				case 100:
					pciTableName = `block_1001`; //排除中山區
					// pciTableName = `block_1001_0`; //包含中山區
					break;
			}
			if (zipCode != 0) {
				pciTableName = pciTableName.replace(/_0$|_00$/g, "");
				pciTableName += `_${zipCode}`;
			}

			return pciTableName;
		}

		const getCaseTableName = async function (tenderId, zipCode = 0) {
			let caseTableName = "";
			switch (tenderId) {
				case 81:
					caseTableName = `distress_103`;
					break;
				case 91:
					caseTableName = `路面缺失標註`;
					break;
				case 100:
					caseTableName = `distress_1001`; //排除中山區
					// caseTableName = `distress_1001_00`; //包含中山區
					break;
			}
			if (zipCode != 0) {
				caseTableName = caseTableName.replace(/_0$|_00$/g, "");
				caseTableName += `_${zipCode}`;
			}

			return caseTableName;
		}

		let inActive = false;
		const freshMView = async function (PGClient, tenderId, enforce=false) {
			const caseTableName = await getCaseTableName(tenderId);

			// 修復幾何格式
			const { rowCount } = await PGClient.query(
				`UPDATE "qgis"."${caseTableName.replace(/_0$|_00$/g, "")}"
				SET "geom" = ST_CurveToLine("geom")
				WHERE ST_GeometryType("geom") = 'ST_MultiSurface'`);

			// NOTE: 暫定
			// - 結尾「_O」為檢視(Views) / 結尾「_00」為具體化檢視(Materialized Views) (30米)
			// - 具體化檢視(Materialized Views) 需手動更新
			const regex = new RegExp(/_00$/, 'g');
			if (!regex.test(caseTableName)) return;

			const { rows: totalArr } = await PGClient.query(
				`SELECT COUNT(*) AS "total" FROM "qgis"."${caseTableName.replace(/_0$/g, '')}"
				UNION ALL
				SELECT COUNT(*) AS "total" FROM "qgis"."${caseTableName}"`);
			
			if(!enforce && totalArr[0].total == totalArr[1].total  && rowCount == 0) return;

			console.log("inActive: ", inActive);
			function delay(s) {
				return new Promise(function (resolve) {
					setTimeout(resolve, s * 1000);
				});
			}
			
			if(inActive) await delay(3);
			else {
				console.log("REFRESH MATERIALIZED VIEW");
				inActive = true;
				await PGClient.query(`REFRESH MATERIALIZED VIEW "qgis"."${caseTableName}"`);
				inActive = false;
			}
		}

		// register method
		server.method('tender.getZipCodeV1', getZipCode);
		server.method('tender.getPCITableV1', getPCITableName);
		server.method('tender.getCaseTableV1', getCaseTableName);
		server.method('tender.freshMViewV1', freshMView);
		// ----------------------------------------------------------------------------------------------------

		/* Router End */
	},
};
