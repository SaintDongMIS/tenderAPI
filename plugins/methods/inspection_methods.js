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
	name: 'inspection_methods',
	version: '0.0.0',
	register: async function (server, options) {
		const getPrevCase = async function (caseInspectId, caseSurveyId) {
			const sqlCMD = caseSurveyId != 0 ? ` AND SurveyId = ${caseSurveyId}` : ` AND InspectId = ${caseInspectId}`;

			const [res_caseList] = await server.tendersql.pool.execute(
				`SELECT 
						id,
						InspectId,
						SurveyId,
						TrackingId,
						CompetentId,
						DistressType,
						DistressLevel,
						Place,
						DateReport,
						Direction,
						Lane,
						ImgZoomIn,
						ImgZoomOut,
						MillingLength,
						MillingWidth,
						MillingArea,
						MarkType,
						DateMark_At,
						ST_AsGeoJson(IFNULL(Geom, Wkb_geometry)) AS Geometry,
						ST_ASGeoJSON(ST_Centroid(ST_GeomFromText(ST_AsText(IFNULL(Geom, Wkb_geometry))))) AS CenterPt
					FROM 
						caseDetection 
						LEFT JOIN caseInspection USING(InspectId)
					WHERE 
						caseDetection.IsActive = 1 
						${sqlCMD}
					ORDER BY InspectId ASC`
			);

			return res_caseList;
		}

		// register method
		server.method('inspection.getPrevCase', getPrevCase, {
			cache: {
				expiresIn: 60 * 60 * 1000,
				generateTimeout: 60 * 1000
			}
		});
		// ----------------------------------------------------------------------------------------------------

		/* Router End */
	},
};
