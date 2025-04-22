const Joi = require("joi");
const Wreck = require("@hapi/wreck");
const superagent = require("superagent");

exports.plugin = {
  //pkg: require('./package.json'),
  name: "bimProxy",
  version: "1.0.0",
  register: async function (server, options) {
    server.route({
      method: "POST",
      path: "/bimProxy/LoginAPI",
      options: {
        tags: ["api"],
        description: "登入",
        validate: {
          payload: Joi.object({
            mail: Joi.string().default("").description("帳號"),
            password: Joi.string().default("").description("密碼"),
          }),
        },
      },
      handler: async function (request) {
        const { mail, password } = request.payload;
        const resp = await superagent
          .post("http://json3.bim-group.com/LoginAPI.asp")
          .send(`mail=${mail}`)
          .send(`password=${password}`);

        return resp.text;
      },
    });

    server.route({
      method: "GET",
      path: "/bimProxy/{apiPath}",
      options: {
        tags: ["api"],
        description: "未使用",
      },
      handler: {
        proxy: {
          uri: "http://json3.bim-group.com/{apiPath}.asp",
        },
      },
    });

    server.route({
      method: "POST",
      path: "/bimProxy/{apiPath}",
      options: {
        tags: ["api"],
        description: "未使用",
        payload: {
          // maxBytes: 1048576 * 100,
          // output: "stream",
          // parse: false,
          // allow: "multipart/form-data",
          // multipart: true,
          // timeout: 60000,
        },
      },
      handler: {
        proxy: {
          uri: "http://json3.bim-group.com/{apiPath}.asp",
          onRequest: function (req) {
            // console.log(req);
            // req.setHeader("Transfer-Encoding", "");
            // const response = ;
            // req.response.setHeader(
            //   "Access-Control-Allow-Headers",
            //   "Authorization, Accept, Accept-Language, Content-Language, Content-Type, Access-Control-Allow-Headers, Access-Control-Allow-Origin, Access-Control-Allow-Methods, Access-Control-Allow-Credentials, Cache-Control, x-token"
            // );
            // req.response.setHeader("Access-Control-Allow-Origin", "*");
            // req.response.setHeader(
            //   "Access-Control-Allow-Methods",
            //   "GET, POST, PATCH, PUT, DELETE, OPTIONS"
            // );
            // req.response.setHeader("Access-Control-Allow-Credentials", true);
            return req;
          },
          onResponse: async function (err, res, req, h, settings, ttl) {
            // console.log("receiving the response from the upstream.");
            const payload = await Wreck.read(res);

            // console.log("some payload manipulation if you want to.");
            const response = h.response(payload);
            response.headers = res.headers;
            response.headers["Content-Type"] = "text/html; charset=big5";
            response.headers["Transfer-Encoding"] = "";

            // cors
            // response.header(
            //   "Access-Control-Allow-Headers",
            //   "Authorization, Accept, Accept-Language, Content-Language, Content-Type, Access-Control-Allow-Headers, Access-Control-Allow-Origin, Access-Control-Allow-Methods, Access-Control-Allow-Credentials, Cache-Control, x-token"
            // );
            // response.header("Access-Control-Allow-Origin", "*");
            // response.header(
            //   "Access-Control-Allow-Methods",
            //   "GET, POST, PATCH, PUT, DELETE, OPTIONS"
            // );
            // response.header("Access-Control-Allow-Credentials", true);
            return response;
          },
        },
      },
    });
  },
};
