const Joi = require("joi");
const { DateTime } = require("luxon");
const fs = require("fs");
const superagent = require("superagent");
const { toDDMText } = require("../../utils/geo");
const BearerToken = require("hapi-auth-bearer-token");
const Boom = require("@hapi/boom");

exports.plugin = {
  //pkg: require('./package.json'),
  name: "carGpsTrack",
  version: "1.0.0",
  register: async function (server, options) {
    server.route({
      method: "GET",
      path: "/inspections/{id}/carGpsTracks",
      options: {
        tags: ["api"],
        description: "巡查軌跡列表",
        validate: {
          params: Joi.object({
            id: Joi.number().required().description("巡查ID")
          }),
          query: Joi.object({
            lastId: Joi.number().default(0).description("carGpsTrack id")
          })
        },
      },
      handler: async (request, h) => {
        const inspectionId = request.params.id;
        const { lastId } = request.query;

        // const result = await request.pg.client.query(
        //   'SELECT * FROM "carGpsTrack" WHERE "inspectionId" = $1 AND id > $2 ORDER BY "createdAt" DESC',
        //   [ inspectionId, lastId ]
        // );

        const result = await request.pg.client.query(
          `WITH data AS (
            SELECT *, ROW_NUMBER() OVER (ORDER BY "createdAt" DESC) AS rowNumber
            FROM "carGpsTrack"
            WHERE "inspectionId" = $1 AND id > $2
          )
          SELECT * FROM data WHERE rowNumber % 10 = 1`,
          [ inspectionId, lastId ]
        );

        return {
          statusCode: 20000,
          message: "successful",
          data: {
            list: result.rows || [],
          },
        };
      },
    });

    server.route({
      method: "POST",
      path: "/inspections/{id}/carGpsTracks",
      options: {
        tags: ["api"],
        description: "新增巡查軌跡",
        validate: {
          params: Joi.object({
            id: Joi.number().required().description("巡查ID"),
            // .description('the id for the todo item'),
          }),
          payload: Joi.object({
            createdAt: Joi.date().description(
              "建立時間, 格式為 yyyy-MM-dd HH:mm:ss"
            ),
            lat: Joi.number().default("0").description("經度"),
            long: Joi.number().default("0").description("緯度"),
            mail: Joi.string().description("機巡時為必要, 為帳號"),
            GPSflag: Joi.number().description(
              "機巡時為必要, 判斷哪幾個點為一條線的依據, 通常為 timestamp, App暫停或中斷時會用到"
            ),
          }),
        },
      },
      handler: async (request, h) => {
        const inspectionId = request.params.id;
        const { createdAt, lat, long, mail, GPSflag } = request.payload;

        if (lat == 0 && long == 0) {
          return {
            statusCode: 20000,
            message: "successful",
            data: {
              id: 0,
            },
          };
        }

        // const createdAtJSDate = DateTime.fromJSDate(createdAt).toJSDate();
        const result = await request.pg.client.query(
          'INSERT INTO "carGpsTrack" ("createdAt", "lat", "long", "inspectionId") VALUES($1, $2, $3, $4) RETURNING id',
          [createdAt, lat, long, inspectionId]
        );

        const inspectionResult = await request.pg.client.query(
          'SELECT * from "inspection" WHERE "id" = $1',
          [inspectionId]
        );

        if (inspectionResult.rows.length > 0) {
          const inspection = inspectionResult.rows[0];

          if (inspection.modeId == 3 || inspection.modeId == 4) {
            const dateTimeTxt =
              DateTime.fromJSDate(createdAt).toFormat("yyyyMMdd_HHmmss");
            const latTxt = toDDMText(lat);
            const longTxt = toDDMText(long);
            const filename = `${dateTimeTxt}_${latTxt}N_${longTxt}E_Co0_Sp2.txt`;
            const path = `${process.env.UPLOAD_PATH}/gps/car${inspection.contractId}_${inspection.carId}/${filename}`;
            const file = fs.createWriteStream(path);
            file.on("error", (err) => console.error(err));
          } else {
            await superagent
              .post("http://json3.bim-group.com/gpsapi.asp")
              .send(`mail=${mail}`)
              // json iis server 是 lon, lat 顛倒放
              .send(`lon=${lat}`)
              .send(`lat=${long}`)
              .send(`GPSflag=${GPSflag}`)
              .send(
                `createDate=${DateTime.fromJSDate(createdAt).toFormat(
                  "yyyy-MM-dd"
                )}`
              )
              .send(
                `createTime=${DateTime.fromJSDate(createdAt).toFormat(
                  "HH:mm:ss"
                )}`
              );
          }
        }

        return {
          statusCode: 20000,
          message: "successful",
          data: {
            id: result.rows.length == 0 ? 0 : result.rows[0].id,
          },
        };
      },
    });

    server.route({
      method: "GET",
      path: "/inspections/carGpsTracksGov",
      options: {
        tags: ["api"],
        description: "巡查軌跡列表(日陞)",
        validate: {
          query: Joi.object({
            id: Joi.number().valid(1, 2, 3, 4, 5, 6).required().description("巡查ID(1~6標)"),
            searchDate: Joi.string().required().description('查詢GPS日期 格式為 yyyy-MM-dd')
          })
        },
      },
      handler: async (request, h) => {
        const { id, searchDate } = request.query;

        const xFF = request.headers['x-forwarded-for'];
				const ip = xFF ? xFF.split(',')[0] : request.info.remoteAddress;
        console.log(ip);

        let result = { rows: [] };
        if (ip == '125.228.36.126' || ip == '211.72.231.157') {
          result = await request.pg.client.query(
            `WITH data AS (
              SELECT *, ROW_NUMBER() OVER (ORDER BY "carGpsTrack"."createdAt" DESC) AS rowNumber
              FROM "carGpsTrack"
              LEFT JOIN "inspection" ON "inspection"."id" = "carGpsTrack"."inspectionId"
              WHERE "inspection"."contractId" = $1 AND "carGpsTrack"."createdAt" >= $2 AND "carGpsTrack"."createdAt" < $3
            )
            SELECT * FROM data WHERE rowNumber % 10 = 1`,
            [ id, searchDate, DateTime.fromISO(searchDate).plus({ days: 1 }).toISODate() ]
          );
        } else {
          return Boom.notAcceptable('invalid IP address');
        }
        

        return {
          statusCode: 20000,
          message: "successful",
          data: {
            list: result.rows || [],
          },
        };
      },
    });

    server.route({
      method: "POST",
      path: "/inspections/carGpsTracksGov",
      options: {
        tags: ["api"],
        description: "新增巡查軌跡 - (3, 6標)",
        validate: {
          payload: Joi.object({
            dtime: Joi.date().default('').allow('').description("建立時間, 格式為 yyyy-MM-dd HH:mm:ss"),
            lat: Joi.number().default("0").description("經度"),
            lon: Joi.number().default("0").description("緯度"),
            car_no: Joi.string().required().description('車號'),
            unit: Joi.number().required().description('分隊')
          }),
        },
      },
      handler: async (request, h) => {
        const { dtime, lat, lon, car_no, unit } = request.payload;
        
        if (lat == 0 && lon == 0) {
          return {
            statusCode: 20000,
            message: "successful",
            data: {
              id: 0,
            },
          };
        }

        const carIdMap = {
					3: {
						1: "BUX-0597", // 中正
						2: "RCX-7562", // 萬華
					},
					6: {
						1: "RCX-7561", // 大安
						2: "RCX-7560", // 文山
					}
				};

        // 根據車巡ID 和車號 取得車號的key
        const obj = carIdMap[unit];
        let carIdKey = 0; // 車號ID
        for (const key in obj) {
          if (obj[key] == car_no) {
            carIdKey = key;
          }
        }

        const today = DateTime.now().toISODate();

        let inspectionId = 0;
        // 抓出當天日期 及契約ID
        const checkInspection = await request.pg.client.query(
          `SELECT "contractId", "id"
          FROM "inspection" 
          WHERE "createdAt"::date = $1::date AND "contractId" = $2 AND "carId" = $3`,
          [today, unit, carIdKey]
        );

        // 確認資料庫有沒有3, 6標的資料
        if (checkInspection.rows.length > 0) {
          inspectionId = checkInspection.rows[0].id;
          // console.log('有資料, 不需匯入, inspectionId:', inspectionId);
        } else {
          const res = await request.pg.client.query(
            `INSERT INTO "inspection" ("driverId", "carId", "pathId", "modeId", "createdAt", "isDeleted", "contractId", "liveStreamId")
            VALUES ($1, $2, $3, $4, NOW(), $5, $6, NULL) RETURNING id`,
            [1, carIdKey, 1, 3, false, unit]
          );
          inspectionId = res.rows[0].id;
          // console.log('沒資料, 可以匯入, inspectionId:', inspectionId);
        }

        let result = '';
        if (!DateTime.fromJSDate(dtime).isValid) {
          result = await request.pg.client.query(
            'INSERT INTO "carGpsTrack" ("lat", "long", "inspectionId", "createdAt") VALUES($1, $2, $3, NOW()) RETURNING id',
            [lat, lon, inspectionId]
          );
          // console.log('無效dtime, 時間帶入now()');
        } else {
          result = await request.pg.client.query(
            'INSERT INTO "carGpsTrack" ("lat", "long", "inspectionId", "createdAt") VALUES($1, $2, $3, $4) RETURNING id',
            [lat, lon, inspectionId, dtime]
          );
          // console.log('有效dtime, 時間帶入dtime');
        }
        

        return {
          statusCode: 20000,
          message: "successful",
          data: {
            id: result.rows.length == 0 ? 0 : result.rows[0].id,
          },
        };
      },
    });
  },
};
