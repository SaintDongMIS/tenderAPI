const Joi = require("joi");
const { Pool } = require("pg");
const { DateTime } = require("luxon");

exports.plugin = {
  //pkg: require('./package.json'),
  name: "inspection",
  version: "1.0.0",
  register: async function (server, options) {
    server.route({
      method: "POST",
      path: "/inspections",
      options: {
        tags: ["api"],
        description: "新增巡查",
        validate: {
          payload: Joi.object({
            driverId: Joi.number().default("0").description("駕駛ID"),
            carId: Joi.number().default("0").description("車輛ID"),
            pathId: Joi.number().default("0").description("路線ID"),
            modeId: Joi.number().default("0").description("模式ID"),
            contractId: Joi.number().default("0").description("標案ID"),
            mail: Joi.string().optional().description("帳號"),
          }),
        },
      },
      handler: async (request, h) => {
        const { driverId, carId, pathId, modeId, contractId, mail } =
          request.payload;

        const result = await request.pg.client.query(
          'INSERT INTO "inspection" ("createdAt", "driverId", "carId", "pathId", "modeId", "contractId", "mail") VALUES($1, $2, $3, $4, $5, $6, $7) RETURNING id',
          [new Date(), driverId, carId, pathId, modeId, contractId, mail]
        );

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
      method: "PUT",
      path: "/inspections/{id}",
      options: {
        tags: ["api"],
        description: "修改巡查",
        validate: {
          payload: Joi.object({
            liveStreamId: Joi.string().default("").description("串流ID"),
          }),
        },
      },
      handler: async (request, h) => {
        const id = request.params.id;
        const { liveStreamId } = request.payload;

        const result = await request.pg.client.query(
          'UPDATE "inspection" SET "liveStreamId" = $2 WHERE "id" = $1 RETURNING id',
          [id, liveStreamId]
        );

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
      path: "/inspections/{id}",
      options: {
        tags: ["api"],
        description: "巡查詳情",
        validate: {
          params: Joi.object({
            id: Joi.number().required().description("巡查ID"),
          }),
        },
      },
      handler: async (request, h) => {
        const id = request.params.id;
        const result = await request.pg.client.query(
          'SELECT * FROM inspection WHERE id = $1 AND "isDeleted" != true',
          [id]
        );

        return result.rows.length == 0
          ? {
              statusCode: 20000,
              message: "notFound",
              data: {},
            }
          : {
              statusCode: 20000,
              message: "successful",
              data: result.rows[0],
            };
      },
    });

    server.route({
      method: "GET",
      path: "/inspections",
      options: {
        tags: ["api"],
        description: "巡查列表",
        validate: {
          query: Joi.object({
            modeId: Joi.number().description("{1: 機巡, 2: 稽查, 3: 車巡}"),
            contractId: Joi.number()
              .default(1)
              .optional()
              .description(
                "{1: 第一分隊, 2: 第二分隊, 3: 第三分隊, 4: 第四分隊, 5: 第五分隊}"
              ),
            carId: Joi.number()
              .default(1)
              .optional()
              .description(
                '{1: { 1: "RDX-6883", 2: "RDQ-6279", 3: "RDX-6881", }, 2: { 1: "ATE-3236", 2: "BFX-7552", }, 3: { 1: "ALV-3038", 2: "APD-3308", 3: "AAA-0000", }, 4: { 1: "ATE-3287", 2: "ATE-3192", }, 5: { 1: "BPG-0891", 2: "BFX-7551",}}'
              ),
            date: Joi.string().description("日期格式為 yyyy-MM-dd"),
            mail: Joi.string()
              .optional()
              .description("若 modeId 為機巡則需要輸入帳號"),
          }),
        },
        response: {
          schema: Joi.object({
            statusCode: Joi.number(),
            message: Joi.string(),
            data: Joi.object({
              list: Joi.array().items(
                Joi.object({
                  id: Joi.number(),
                  driverId: Joi.number(),
                  carId: Joi.number(),
                  pathId: Joi.number(),
                  modeId: Joi.number(),
                  createdAt: Joi.date(),
                  isDeleted: Joi.boolean().optional(),
                  contractId: Joi.number(),
                  liveStreamId: Joi.string().allow(null).allow("").optional(),
                  mail: Joi.string().allow(null).optional(),
                })
              ),
            }),
          }),
          failAction: "log",
        },
      },
      handler: async (request, h) => {
        const { modeId, date, contractId, carId, mail } = request.query;

        let result;
        if (!date || date == "") {
          if (modeId == 1) {
            result = await request.pg.client.query(
              `SELECT * FROM inspection 
            WHERE "isDeleted" != true AND "contractId" = $1 AND "carId" = $2 AND "mail" = $4 AND
            CASE
              WHEN $3 > 0 THEN "modeId" = $3
              WHEN $3 = 0 THEN 1 = 1
              ELSE 1 != 1
            END
            ORDER BY "createdAt" DESC
          `,
              [contractId != null ? contractId : 1, carId, modeId, mail]
            );
          } else {
            result = await request.pg.client.query(
              `SELECT * FROM inspection 
            WHERE "isDeleted" != true AND "contractId" = $1 AND "carId" = $2 AND
            CASE
              WHEN $3 > 0 THEN "modeId" = $3
              WHEN $3 = 0 THEN 1 = 1
              ELSE 1 != 1
            END
            ORDER BY "createdAt" DESC
          `,
              [contractId != null ? contractId : 1, carId, modeId]
            );
          }
        } else {
          const dateStart = DateTime.fromFormat(date, "yyyy-MM-dd").toJSDate();
          const dateEnd = DateTime.fromJSDate(dateStart)
            .plus({ days: 1 })
            .toJSDate();
          if ((contractId == 3 || contractId == 6) && modeId == 1) {
            result = await request.pg.client.query(
              `SELECT * FROM inspection 
              WHERE "isDeleted" != true AND "contractId" = $1 AND "carId" = $2 AND "mail" = $6 AND
              "createdAt" >= $3 AND "createdAt" < $4 AND
              CASE
                WHEN $5 > 0 THEN "modeId" = $5
                WHEN $5 = 0 THEN 1 = 1
                ELSE 1 != 1
              END
              ORDER BY "createdAt" DESC
            `,
              [
                contractId != null ? contractId : 1,
                carId,
                DateTime.fromFormat(date, "yyyy-MM-dd").minus({ days: 3 }).toJSDate(),
                dateEnd,
                modeId,
                mail,
              ]
            );
          } else if ((contractId == 3 || contractId == 6) && modeId !== 1) {
            result = await request.pg.client.query(
              `SELECT * FROM inspection 
                WHERE "isDeleted" != true AND "contractId" = $1 AND "carId" = $2 AND
                "createdAt" >= $3 AND "createdAt" < $4 AND
                CASE
                  WHEN $5 > 0 THEN "modeId" = $5
                  WHEN $5 = 0 THEN 1 = 1
                  ELSE 1 != 1
                END
                ORDER BY "createdAt" DESC
              `,
              [
                contractId != null ? contractId : 1,
                carId,
                DateTime.fromFormat(date, "yyyy-MM-dd").minus({ days: 3 }).toJSDate(),
                dateEnd,
                modeId,
              ]
            );
          } else if (modeId == 1) {
            result = await request.pg.client.query(
              `SELECT * FROM inspection 
              WHERE "isDeleted" != true AND "contractId" = $1 AND "carId" = $2 AND "mail" = $6 AND
              "createdAt" >= $3 AND "createdAt" < $4 AND
              CASE
                WHEN $5 > 0 THEN "modeId" = $5
                WHEN $5 = 0 THEN 1 = 1
                ELSE 1 != 1
              END
              ORDER BY "createdAt" DESC
            `,
              [
                contractId != null ? contractId : 1,
                carId,
                dateStart,
                dateEnd,
                modeId,
                mail,
              ]
            );
          } else {
            result = await request.pg.client.query(
              `SELECT * FROM inspection 
                WHERE "isDeleted" != true AND "contractId" = $1 AND "carId" = $2 AND
                "createdAt" >= $3 AND "createdAt" < $4 AND
                CASE
                  WHEN $5 > 0 THEN "modeId" = $5
                  WHEN $5 = 0 THEN 1 = 1
                  ELSE 1 != 1
                END
                ORDER BY "createdAt" DESC
              `,
              [
                contractId != null ? contractId : 1,
                carId,
                dateStart,
                dateEnd,
                modeId,
              ]
            );
          }
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

    // server.route({
    //   method: "PUT",
    //   path: "/inspections",
    //   options: {
    //     tags: ["api"],
    //   },
    //   handler: async (request, h) => {
    //     const inspectionId = request.params.id;
    //     const result = await request.pg.client.query(
    //       'UPDATE "inspection" SET inspectionId = $1 AND ORDER BY createdAt DESC',
    //       [inspectionId]
    //     );
    //     return result.rows || {};
    //   },
    // });

    server.route({
      method: "DELETE",
      path: "/inspections/{id}",
      options: {
        tags: ["api"],
        description: "刪除巡查",
        validate: {
          params: Joi.object({
            id: Joi.number().required().description("巡查ID"),
            // .description('the id for the todo item'),
          }),
        },
      },
      handler: async (request, h) => {
        const id = request.params.id;
        const result = await request.pg.client.query(
          'UPDATE "inspection" SET "isDeleted" = true WHERE id = $1',
          [id]
        );

        return {
          statusCode: 20000,
          message: "successful",
          data: result.rows.length == 0 ? {} : result.rows[0],
        };
      },
    });
  },
};
