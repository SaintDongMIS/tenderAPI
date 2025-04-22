'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');
const Wreck = require('@hapi/wreck');

const authStrategy = false; 
//const authStrategy = 'simple';

exports.plugin = {
	//pkg: require('./package.json'),
	name: 'sewerageSys',
	version: '0.0.0',
	register: async function (server, options) {
		server.route({
			method: 'GET',
			path: '/sewerageSys/holeGeoJson',
			options: {
				description: '孔蓋地理資訊',
				//auth: { strategy: 'auth', scope: ['roles'] },
				//auth: { strategy: 'bearer', scope: ['roles'] },
				cors: { origin: ['*'], credentials: true },
				tags: ['api'],
				validate: {}   // GET
			},
			handler: async function (request, h) {
				// const { } = request.query;

				let geoJSON = {
					"type": "FeatureCollection",
					"name": "caseGeoJSON",
					"features": []
				};

				const { rows: res_holeList } = await request.pg.client.query(
					`SELECT 
						id,
						strid,
						zip,
						location,
						address,
						pattern,
						frame,
						ST_ASGeoJson(ST_MakePoint(lng, lat)) AS geometry,
						"imgUrl"
					FROM qgis.hole
					WHERE strid IS NOT NULL AND LENGTH(strid) > 0`
				);

				for (const holeSpec of res_holeList) {
					const feature = {
						"type": "Feature",
						"properties": {
							"id": holeSpec.id,
							"strId": holeSpec.strid,
							"zip": holeSpec.zip,	
							"location": holeSpec.location,
							"address": holeSpec.address,
							"pattern": holeSpec.pattern,
							"frame": holeSpec.frame,
							"imgUrl": holeSpec.imgUrl,
						},
						"geometry": JSON.parse(holeSpec.geometry)
					};

					geoJSON.features.push(feature);
				}

				return {
					statusCode: 20000,
					message: 'successful',
					data: { geoJSON: JSON.stringify(geoJSON) }
				};
			},
		});
	},
};
