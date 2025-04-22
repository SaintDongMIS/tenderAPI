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
	name: 'tender_methods',
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
			// const [[ result_Tender ]] = await server.tendersql.pool.execute(
			// 	`SELECT
			// 		tenderId, tenderName, tableName
			// 	FROM Tenders
			// 	WHERE tenderId = ?`,
			// 	[ tenderId ]);

			// let pciTableName = result_Tender ? result_Tender.tableName : "";
			let pciTableName = "";
			// 各個行政區橋梁
			// 橋梁不包括 11190雨聲街 11191文林路(福德-德行西) 11590研究路二段
			if (tenderId > 10000 && tenderId < 20000 && tenderId != 11190 && tenderId != 11191 && tenderId != 11590) pciTableName = `block_bridge_${tenderId}`; 
			else if (tenderId <= 100) pciTableName = `block_${await getZipCode(tenderId)}`;
			else pciTableName = `block_${tenderId}`;

			if (zipCode != 0) {
				pciTableName = pciTableName.replace(/_0$|_00$/g, "");
				pciTableName += `_${zipCode}`;
			}

			return pciTableName;
		}

		// register method
		server.method('tender.getZipCode', getZipCode);
		server.method('tender.getPCITable', getPCITableName);
		// ----------------------------------------------------------------------------------------------------

		/* Router End */
	},
};
