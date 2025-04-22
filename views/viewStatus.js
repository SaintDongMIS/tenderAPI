"use strict";

// Require

const vision = require("@hapi/vision");
const handlebars = require("handlebars");
const Joi = require("joi");
const Pack = require("../package.json");

const authStrategy = false;
//const authStrategy = 'simple';

let temp = "";

exports.plugin = {
  //pkg: require('./package.json'),
  name: "vstatus",
  version: "1.0.0",
  register: async function (server, options) {
    await server.register({
      plugin: vision,
      options: {
        engines: { html: handlebars },
        relativeTo: __dirname,
        path: "./templates",
        //isCached: false 每次都重新進行編譯，建議使用在開發站
      },
    });

    // ----------------------------------------------------------------------------------------------------
    server.route({
      method: "GET",
      path: "/",
      options: {
        description: "view - system status",
        cors: { origin: ["*"], credentials: true },
        tags: ["api"],
      },
      handler: {
        view: {
          template: "indexDashboard",
          context: {
            title: "Successful!!",
            message: "Service is running",
            ver: Pack.version,
          },
        },
      },
    });

    server.route({
      method: "GET",
      path: "/temp",
      options: {
        description: "view - system status",
        cors: { origin: ["*"], credentials: true },
        tags: ["api"],
      },
      handler: function () {
        return { url: temp };
      },
    });

    server.route({
      method: "POST",
      path: "/temp",
      options: {
        description: "view - system status",
        cors: { origin: ["*"], credentials: true },
        tags: ["api"],
        validate: {
          payload: Joi.object({
            url: Joi.string().default("0"),
          }),
        },
      },
      handler: function (request) {
        temp = request.payload.url;
        return {
          url: temp,
        };
      },
    });
    /* Router End */
  },
};
