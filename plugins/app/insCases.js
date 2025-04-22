const Joi = require("joi");
const { Pool } = require("pg");
const { DateTime } = require("luxon");
const superagent = require("superagent");
const FormData = require("form-data");
const iconv = require("iconv-lite");
const urlencode = require("urlencode");

exports.plugin = {
  //pkg: require('./package.json'),
  name: "insCase",
  version: "1.0.0",
  register: async function (server, options) {
    server.route({
      method: "POST",
      path: "/insCases",
      options: {
        tags: ["api"],
        description: "新增案件 (使用 FormData)",
        payload: {
          maxBytes: 1000 * 1000 * 1000 * 10,
          output: "stream",
          parse: true,
          allow: "multipart/form-data",
          multipart: true,
          timeout: 60000,
        },
        validate: {
          failAction: "log",
          payload: Joi.object({
            caseType: Joi.string()
              .required()
              .messages({
                "string.required": `caseType 為必須欄位`,
              })
              .description("案件類型"),
            mail: Joi.string()
              .required()
              .messages({
                "string.required": `mail 為必須欄位`,
              })
              .description("帳號"),
            address: Joi.string()
              .required()
              .messages({
                "string.required": `address 為必須欄位`,
              })
              .description("地址"),
            remark_text: Joi.string().description("備註"),
            lat: Joi.string()
              .required()
              .messages({
                "string.required": `lat 為必須欄位`,
              })
              .description("經度"),
            lon: Joi.string()
              .required()
              .messages({
                "string.required": `lon 為必須欄位`,
              })
              .description("緯度"),
            ch: Joi.string()
              .required()
              .messages({
                "string.required": `ch 為必須欄位`,
              })
              .description("缺失嚴重程度"),
            case_l: Joi.string()
              .required()
              .messages({
                "string.required": `case_l 為必須欄位`,
              })
              .description("長"),
            case_w: Joi.string()
              .required()
              .messages({
                "string.required": `case_w 為必須欄位`,
              })
              .description("寬"),
            photo1: Joi.any().description("第1張照片"),
            photo2: Joi.any().description("第2張照片"),
            photo3: Joi.any().description("第3張照片"),
            photo4: Joi.any().description("第4張照片"),
            photo5: Joi.any().description("第5張照片"),
            photo6: Joi.any().description("第6張照片"),
            photo7: Joi.any().description("第7張照片"),
            photo8: Joi.any().description("第8張照片"),
            photo9: Joi.any().description("第9張照片"),
            photo10: Joi.any().description("第10張照片"),
            photo11: Joi.any().description("第11張照片"),
            photo12: Joi.any().description("第12張照片"),
            photo13: Joi.any().description("第13張照片"),
            photo14: Joi.any().description("第14張照片"),
            photo15: Joi.any().description("第15張照片"),
            photo16: Joi.any().description("第16張照片"),
            photo17: Joi.any().description("第17張照片"),
            photo18: Joi.any().description("第18張照片"),
            NW: Joi.number().description("是否允許照片翻轉"),
          }),
        },
      },
      handler: async (request, h) => {
        const payload = ({
          caseType,
          mail,
          address,
          remark_text,
          lat,
          lon,
          ch,
          case_l,
          case_w,
          photo1,
          photo2,
          photo3,
          photo4,
          photo5,
          photo6,
          photo7,
          photo8,
          photo9,
          photo10,
          photo11,
          photo12,
          photo13,
          photo14,
          photo15,
          photo16,
          photo17,
          photo18,
          NW,
        } = request.payload);

        const formData = new FormData({
          maxDataSize: Infinity,
        });

        try {
          const preRequest = superagent
            .post("http://json3.bim-group.com/PostAPI.asp")
            .set("content-type", `multipart/form-data;charset=big5`);

          let next = preRequest;

          for (let key in payload) {
            const rawValue = payload[key];

            if (key.indexOf("photo") > -1 && rawValue.hapi) {
              next = next.attach(key, rawValue, {
                contentType: rawValue.hapi.headers["content-type"],
                filename: rawValue.hapi.filename || "",
              });

              formData.append(key, rawValue, {
                contentType: rawValue.hapi.headers["content-type"],
                filename: rawValue.hapi.filename || "",
                knownLength: rawValue._data.length,
              });
            } else {
              const value =
                ["address", "ch", "remark_text"].indexOf(key) > -1
                  ? iconv.encode(rawValue, "big5")
                  : rawValue;

              next = next.field(key, value);

              formData.append(key, value, {
                knownLength: Buffer.byteLength(value),
              });
            }
          }

          // const length = estimateContentLength(payload);
          const result = await new Promise((resolve, reject) => {
            formData.getLength(async (error, length) => {
              if (error) {
                reject(error);
              }
              try {
                const resp = await next.set("content-length", length);
                resolve(resp.text);
              } catch (innerError) {
                reject(innerError);
              }
            });
          });

          if (result == "true") {
            return {
              statusCode: 20000,
              message: "successful",
              data: {
                success: true,
              },
            };
          } else {
            return {
              statusCode: 20000,
              message: result,
              data: {
                success: false,
              },
            };
          }
        } catch (error) {
          console.log(error);
          return {
            statusCode: 20000,
            message: error,
            data: {
              success: false,
            },
          };
        }
      },
    });

    server.route({
      method: "GET",
      path: "/insCases/{id}",
      options: {
        tags: ["api"],
        description: "案件詳情",
        validate: {
          params: Joi.object({
            id: Joi.number().required().description("案件ID"),
          }),
        },
      },
      handler: async (request, h) => {
        const id = request.params.id;
        const bimResult = await superagent
          .post("http://json3.bim-group.com/CaseAPI.asp")
          .type("form")
          .send({
            caseId: id,
          });

        const item = JSON.parse(bimResult.text);
        return {
          statusCode: 20000,
          message: "successful",
          data: {
            ...item,
            createDateTime: DateTime.fromFormat(
              item.createDateTime.replace("上午", "AM").replace("下午", "PM"),
              "yyyy/M/d a hh:mm:ss"
            ).toJSDate(),
          },
        };
      },
    });

    server.route({
      method: "GET",
      path: "/insCases",
      options: {
        tags: ["api"],
        description: "案件列表",
        validate: {
          query: Joi.object({
            inspectionId: Joi.number().required().description("巡查ID"),
            date: Joi.date().description("日期, 格式為 yyyy-MM-dd"),
            type: Joi.number().default(0).description("案件缺失類型"),
            page: Joi.number().default(1).description("案件ID"),
            address: Joi.string().default("").description("地址"),
            mail: Joi.string().required().description("帳號"),
          }),
        },
      },
      handler: async (request, h) => {
        const { inspectionId, page, address, type, date, mail } = request.query;

        const result = await request.pg.client.query(
          'SELECT * FROM inspection WHERE id = $1 AND "isDeleted" != true',
          [inspectionId]
        );

        if (result.rows.length == 0) {
          return {
            statusCode: 20000,
            message: "successful",
            data: {
              list: [],
            },
          };
        } else {
          const inspection = result.rows[0];

          const preRequest = superagent
            .post("http://json3.bim-group.com/CasesAPI.asp")
            .send(`page=${page}`)
            .send(`mail=${mail}`)
            .send(`address=${urlencode(address, "big5")}`)
            .send(`type=${type}`);

          if (!date && date != "") {
            preRequest.send(
              `date=${DateTime.fromJSDate(inspection.createdAt).toFormat(
                "yyyy-MM-dd"
              )}`
            );
          } else {
            preRequest.send(
              `date=${DateTime.fromJSDate(date).toFormat("yyyy-MM-dd")}`
            );
          }

          const bimResult = await preRequest;

          let [totalTxt, ...listTxts] = bimResult.text.split(",");
          let list = JSON.parse(listTxts.join(","));

          return {
            statusCode: 20000,
            message: "successful",
            data: {
              list: list.map((item) => {
                return {
                  ...item,
                  inspectionId: inspectionId,
                  createDateTime: DateTime.fromFormat(
                    item.createDateTime
                      .replace("上午", "AM")
                      .replace("下午", "PM"),
                    "yyyy/M/d a hh:mm:ss"
                  ).toJSDate(),
                };
              }),
              total: parseInt(totalTxt),
            },
          };
        }
      },
    });

    // server.route({
    //   method: "PUT",
    //   path: "/insCases",
    //   options: {
    //     tags: ["api"],
    //   },
    //   handler: async (request, h) => {
    //     const insCaseId = request.params.id;
    //     const result = await request.pg.client.query(
    //       'UPDATE "insCase" SET insCaseId = $1 AND ORDER BY createdAt DESC',
    //       [insCaseId]
    //     );
    //     return result.rows || {};
    //   },
    // });

    // server.route({
    //   method: "DELETE",
    //   path: "/insCases/{id}",
    //   options: {
    //     tags: ["api"],
    //     validate: {
    //       params: Joi.object({
    //         id: Joi.number().required(),
    //         // .description('the id for the todo item'),
    //       }),
    //     },
    //   },
    //   handler: async (request, h) => {
    //     const id = request.params.id;
    //     const result = await request.pg.client.query(
    //       'UPDATE "insCase" SET "isDeleted" = true WHERE id = $1',
    //       [id]
    //     );

    //     return {
    //       statusCode: 20000,
    //       message: "successful",
    //       data: result.rows.length == 0 ? {} : result.rows[0],
    //     };
    //   },
    // });
  },
};
