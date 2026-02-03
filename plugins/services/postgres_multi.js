'use strict';

const HapiPostgresConnection = require('hapi-postgres-connection');

exports.plugin = {
    name: 'postgres_multi',
    version: '1.0.0',
    register: async function (server, options) {
        
        // 註冊第一個 PostgreSQL 連線 - 用於 account schema
        await server.register({
            plugin: HapiPostgresConnection,
            options: {
                connectionString: process.env.DATABASE_URL,
                decorate: 'pg_account',
                schema: 'account'  // 設定預設 schema
            }
        });

        // 註冊第二個 PostgreSQL 連線 - 用於 tenderdb schema
        await server.register({
            plugin: HapiPostgresConnection,
            options: {
                connectionString: process.env.DATABASE_URL,
                decorate: 'pg_tender',
                schema: 'tenderdb'  // 設定預設 schema
            }
        });

        console.log('PostgreSQL 多連線插件已註冊 - account 和 tenderdb schema');
    }
};