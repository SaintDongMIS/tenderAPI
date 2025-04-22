const Joi = require("joi");
const { Pool } = require("pg");
const { JobInstance } = require("twilio/lib/rest/bulkexports/v1/export/job");
const fs = require("fs");

exports.plugin = {
  //pkg: require('./package.json'),
  name: "upload",
  version: "1.0.0",
  register: async function (server, options) {
    server.route({
      method: "POST",
      path: "/uploadCasePhoto/{id}",
      options: {
        tags: ["api"],
        validate: {
          payload: Joi.object({
            file: Joi.any()
              .meta({ swaggerType: "file" })
              .description(
                '案件照片, 檔案名稱格式為 \'${yyyyMMdd_HHmmss}_${"坑洞"|"龜裂"|"人孔"|"縱橫裂縫"}  ${地址}_${latWithoutDot}N_${longWithoutDot}E_Co1790_Sp134\''
              ),
          }),
        },
        payload: {
          maxBytes: 1048576 * 100,
          output: "stream",
          parse: true,
          allow: "multipart/form-data",
          multipart: true,
          timeout: 60000,
        },
      },
      handler: async (request, h) => {
        const { file } = request.payload;

        if (request.payload.file) {
          const name = request.payload.file.hapi.filename;
          const path = `${process.env.UPLOAD_PATH}/case/rms${request.params.id}/${name}`;
          const file = fs.createWriteStream(path);

          file.on("error", (err) => console.error(err));

          request.payload.file.pipe(file);

          request.payload.file.on("end", (err) => {
            const ret = {
              filename: request.payload.file.hapi.filename,
              headers: request.payload.file.hapi.headers,
            };
            return JSON.stringify(ret);
          });
        }
        return "ok";
      },
    });
  },
};
