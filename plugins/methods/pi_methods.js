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
  name: 'pi_methods',
  version: '0.0.0',
  register: async function (server, options) {
    const insertPICaseMapping = async function (PGClient, caseList, zipCode) {

			if (![103, 104].includes(zipCode)) return;
			// console.time(caseList[0].CaseDate);
			console.log("start: ", caseList[0].CaseDate);
			const timeStart = DateTime.fromFormat(caseList[0].CaseDate, "yyyy/MM/dd").minus({ months: 1 }).startOf('month').toFormat("yyyy-MM-dd");
			const timeEnd = DateTime.fromFormat(caseList[0].CaseDate, "yyyy/MM/dd").startOf('month').toFormat("yyyy-MM-dd");
			// console.log(timeStart, timeEnd);

			for (const [ index, caseItem ] of caseList.entries()) {
				caseItem.geoJSON = { type: "Point", coordinates: [caseItem.lng, caseItem.lat] };
				
				const { rows: [result_pci] } = await PGClient.query(
					`SELECT 
						"blockList"."id",
						"blockList"."pci_id",
						"blockList"."道路名稱",
						(CASE WHEN "PCIList"."PCI_value" = -1 THEN 0 ELSE "PCIList"."PCI_value" END) AS "PCI_value",
						"PCIList"."datestar",
						"PCIList"."dateend"
					FROM 
						qgis."block_${zipCode}" AS "blockList"
						LEFT JOIN (
							SELECT * FROM qgis."pci_${zipCode}" WHERE TO_DATE("datestar", 'YYYY/MM/DD') >= $1 AND TO_DATE("datestar", 'YYYY/MM/DD') < $2
						) AS "PCIList" ON "PCIList"."qgis_id" = "blockList"."id"
					WHERE 
						st_intersects("blockList"."wkb_geometry", ST_GeomFromGeoJSON($3)) IS TRUE`,
					[ timeStart, timeEnd, JSON.stringify(caseItem.geoJSON) ]
				);

				// console.log(result_pci);
				if (result_pci != undefined && result_pci.PCI_value != null) {
					await PGClient.query(`UPDATE "PICaseList" SET "PCIId" = $1 , "PCIValue" = $2 WHERE "CaseSN" = $3`, 
					[ result_pci.pci_id, result_pci.PCI_value, caseItem.CaseSN ] );
				}

				// console.log(`process: ${index+1}/${caseList.length}`);
			}

			console.log("finish: ", caseList[0].CaseDate);
			// console.timeEnd(caseList[0].CaseDate);
    }

    // register method
		server.method('insert.PICaseMap', insertPICaseMapping);
    // ----------------------------------------------------------------------------------------------------

    /* Router End */   
  },
};
