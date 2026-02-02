'use strict';

// Require
const Joi = require('joi');
const Boom = require('@hapi/boom');

const authStrategy = false; 
//const authStrategy = 'simple';

exports.plugin = {
  name: 'accounts_pg',
  version: '1.0.0',
  register: async function (server, options) {

    // Validate with Joi 
    const sCreate = Joi.object({
      codec : Joi.number().required().description('組織編碼'),
      name : Joi.string().required().description('組織名稱'),
      hierarchy : Joi.number().required().description('組織層數'),
      note : Joi.string().description('說明')
    });

    // ----------------------------------------------------------------------------------------------------
    server.route({
      method: 'POST',
      path: '/pg/guild',
      options: {
        description: '建立組織 (PostgreSQL版本)',
        cors: { origin: ['*'], credentials: true },
        tags: ['api', 'postgres'],
        validate: { payload: sCreate }
      },
      handler: async function (request, h) {
        // param 參數
        const { codec, name, hierarchy, note } = request.payload;
        console.log('建立組織 (PostgreSQL):', codec, name, hierarchy, note);
    
        try {
          // SQL CMD - 使用PostgreSQL語法
          const res = await request.pg.client.query( 
            `INSERT INTO guilds (
              "GuildCode", 
              "Name", 
              "hierarchy", 
              "Note"
            ) 
            VALUES ($1, $2, $3, $4) 
            RETURNING *`, 
            [codec, name, hierarchy, note]
          );
      
          console.log('插入結果:', res.rows[0]);
          return { 
            statusCode: 20000, 
            message: 'successful', 
            data: {res: res.rows[0]} 
          };
        } catch (error) {
          console.error('建立組織錯誤:', error);
          return Boom.badRequest('建立組織失敗: ' + error.message);
        }
      },
    });

    // ----------------------------------------------------------------------------------------------------
    server.route({
      method: 'GET',
      path: '/pg/guild',
      options: {
        description: '列出組織 (PostgreSQL版本)',
        cors: { origin: ['*'], credentials: true },
        tags: ['api', 'postgres']
      },
      handler: async function (request, h) {
        try {
          // SQL CMD - 使用PostgreSQL語法
          const res = await request.pg.client.query(`SELECT * FROM guilds ORDER BY "GuildCode"`);
          
          // return
          return { 
            statusCode: 20000, 
            message: 'successful', 
            data: {list: res.rows, total: res.rowCount} 
          };
        } catch (error) {
          console.error('查詢組織錯誤:', error);
          return Boom.badRequest('查詢組織失敗: ' + error.message);
        }
      },
    });

    // ----------------------------------------------------------------------------------------------------
    // 使用者相關API - PostgreSQL版本
    
    // 取得使用者列表
    server.route({
      method: 'GET',
      path: '/pg/users',
      options: {
        description: '取得使用者列表 (PostgreSQL版本)',
        cors: { origin: ['*'], credentials: true },
        tags: ['api', 'postgres', 'users'],
        validate: {
          query: Joi.object({
            page: Joi.number().integer().min(1).default(1).description('頁碼'),
            limit: Joi.number().integer().min(1).max(100).default(20).description('每頁筆數'),
            search: Joi.string().allow('').description('搜尋關鍵字')
          })
        }
      },
      handler: async function (request, h) {
        const { page, limit, search } = request.query;
        const offset = (page - 1) * limit;
        
        try {
          let query = `SELECT * FROM users WHERE "Active" = 1`;
          let params = [];
          
          if (search) {
            query += ` AND ("UserName" ILIKE $1 OR "NickName" ILIKE $1)`;
            params.push(`%${search}%`);
          }
          
          query += ` ORDER BY "UserId" LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
          params.push(limit, offset);
          
          const res = await request.pg.client.query(query, params);
          
          // 取得總數
          let countQuery = `SELECT COUNT(*) as total FROM users WHERE "Active" = 1`;
          let countParams = [];
          
          if (search) {
            countQuery += ` AND ("UserName" ILIKE $1 OR "NickName" ILIKE $1)`;
            countParams.push(`%${search}%`);
          }
          
          const countRes = await request.pg.client.query(countQuery, countParams);
          const total = parseInt(countRes.rows[0].total);
          
          return { 
            statusCode: 20000, 
            message: 'successful', 
            data: {
              list: res.rows, 
              total: total,
              page: page,
              limit: limit,
              pages: Math.ceil(total / limit)
            } 
          };
        } catch (error) {
          console.error('查詢使用者錯誤:', error);
          return Boom.badRequest('查詢使用者失敗: ' + error.message);
        }
      },
    });

    // 取得單一使用者
    server.route({
      method: 'GET',
      path: '/pg/users/{userId}',
      options: {
        description: '取得單一使用者 (PostgreSQL版本)',
        cors: { origin: ['*'], credentials: true },
        tags: ['api', 'postgres', 'users'],
        validate: {
          params: Joi.object({
            userId: Joi.number().integer().required().description('使用者ID')
          })
        }
      },
      handler: async function (request, h) {
        const { userId } = request.params;
        
        try {
          const res = await request.pg.client.query(
            `SELECT * FROM users WHERE "UserId" = $1 AND "Active" = 1`,
            [userId]
          );
          
          if (res.rowCount === 0) {
            return Boom.notFound('使用者不存在');
          }
          
          return { 
            statusCode: 20000, 
            message: 'successful', 
            data: {user: res.rows[0]} 
          };
        } catch (error) {
          console.error('查詢使用者錯誤:', error);
          return Boom.badRequest('查詢使用者失敗: ' + error.message);
        }
      },
    });

    // 新增使用者
    server.route({
      method: 'POST',
      path: '/pg/users',
      options: {
        description: '新增使用者 (PostgreSQL版本)',
        cors: { origin: ['*'], credentials: true },
        tags: ['api', 'postgres', 'users'],
        validate: {
          payload: Joi.object({
            UserName: Joi.string().required().description('使用者名稱'),
            PassCode: Joi.string().required().description('密碼'),
            NickName: Joi.string().required().description('暱稱'),
            Create_By: Joi.number().integer().required().description('建立者ID')
          })
        }
      },
      handler: async function (request, h) {
        const { UserName, PassCode, NickName, Create_By } = request.payload;
        
        try {
          // 檢查使用者名稱是否已存在
          const checkRes = await request.pg.client.query(
            `SELECT "UserId" FROM users WHERE "UserName" = $1`,
            [UserName]
          );
          
          if (checkRes.rowCount > 0) {
            return Boom.conflict('使用者名稱已存在');
          }
          
          // 新增使用者
          const res = await request.pg.client.query(
            `INSERT INTO users ("UserName", "PassCode", "NickName", "Create_By", "Create_At", "Active")
             VALUES ($1, $2, $3, $4, NOW(), 1)
             RETURNING *`,
            [UserName, PassCode, NickName, Create_By]
          );
          
          return { 
            statusCode: 20000, 
            message: 'successful', 
            data: {user: res.rows[0]} 
          };
        } catch (error) {
          console.error('新增使用者錯誤:', error);
          return Boom.badRequest('新增使用者失敗: ' + error.message);
        }
      },
    });

    // 更新使用者
    server.route({
      method: 'PUT',
      path: '/pg/users/{userId}',
      options: {
        description: '更新使用者 (PostgreSQL版本)',
        cors: { origin: ['*'], credentials: true },
        tags: ['api', 'postgres', 'users'],
        validate: {
          params: Joi.object({
            userId: Joi.number().integer().required().description('使用者ID')
          }),
          payload: Joi.object({
            NickName: Joi.string().description('暱稱'),
            PassCode: Joi.string().description('密碼'),
            Active: Joi.number().integer().valid(0, 1).description('啟用狀態'),
            Notes: Joi.string().allow('').description('備註')
          }).min(1)
        }
      },
      handler: async function (request, h) {
        const { userId } = request.params;
        const updates = request.payload;
        
        try {
          // 檢查使用者是否存在
          const checkRes = await request.pg.client.query(
            `SELECT "UserId" FROM users WHERE "UserId" = $1`,
            [userId]
          );
          
          if (checkRes.rowCount === 0) {
            return Boom.notFound('使用者不存在');
          }
          
          // 建立更新語句
          const setClauses = [];
          const values = [];
          let paramIndex = 1;
          
          if (updates.NickName !== undefined) {
            setClauses.push(`"NickName" = $${paramIndex}`);
            values.push(updates.NickName);
            paramIndex++;
          }
          
          if (updates.PassCode !== undefined) {
            setClauses.push(`"PassCode" = $${paramIndex}`);
            values.push(updates.PassCode);
            paramIndex++;
          }
          
          if (updates.Active !== undefined) {
            setClauses.push(`"Active" = $${paramIndex}`);
            values.push(updates.Active);
            paramIndex++;
          }
          
          if (updates.Notes !== undefined) {
            setClauses.push(`"Notes" = $${paramIndex}`);
            values.push(updates.Notes);
            paramIndex++;
          }
          
          setClauses.push(`"Update_At" = NOW()`);
          
          values.push(userId);
          
          const query = `
            UPDATE users 
            SET ${setClauses.join(', ')}
            WHERE "UserId" = $${paramIndex}
            RETURNING *
          `;
          
          const res = await request.pg.client.query(query, values);
          
          return { 
            statusCode: 20000, 
            message: 'successful', 
            data: {user: res.rows[0]} 
          };
        } catch (error) {
          console.error('更新使用者錯誤:', error);
          return Boom.badRequest('更新使用者失敗: ' + error.message);
        }
      },
    });

    // 取得使用者權限
    server.route({
      method: 'GET',
      path: '/pg/users/{userId}/permissions',
      options: {
        description: '取得使用者權限 (PostgreSQL版本)',
        cors: { origin: ['*'], credentials: true },
        tags: ['api', 'postgres', 'users', 'permissions'],
        validate: {
          params: Joi.object({
            userId: Joi.number().integer().required().description('使用者ID')
          })
        }
      },
      handler: async function (request, h) {
        const { userId } = request.params;
        
        try {
          const res = await request.pg.client.query(
            `SELECT * FROM users_permission WHERE "UserId" = $1 AND "GuildId" = 0 AND "Value" > 0`,
            [userId]
          );
          
          return { 
            statusCode: 20000, 
            message: 'successful', 
            data: {permissions: res.rows} 
          };
        } catch (error) {
          console.error('查詢使用者權限錯誤:', error);
          return Boom.badRequest('查詢使用者權限失敗: ' + error.message);
        }
      },
    });

    // 更新使用者權限
    server.route({
      method: 'PUT',
      path: '/pg/users/{userId}/permissions',
      options: {
        description: '更新使用者權限 (PostgreSQL版本)',
        cors: { origin: ['*'], credentials: true },
        tags: ['api', 'postgres', 'users', 'permissions'],
        validate: {
          params: Joi.object({
            userId: Joi.number().integer().required().description('使用者ID')
          }),
          payload: Joi.object({
            permissions: Joi.array().items(
              Joi.object({
                AuthKey: Joi.string().required().description('權限鍵值'),
                Value: Joi.number().integer().min(0).max(1).required().description('權限值')
              })
            ).required().description('權限列表')
          })
        }
      },
      handler: async function (request, h) {
        const { userId } = request.params;
        const { permissions } = request.payload;
        
        try {
          // 開始交易
          await request.pg.client.query('BEGIN');
          
          // 先將所有權限設為0
          await request.pg.client.query(
            `UPDATE users_permission SET "Value" = 0 WHERE "UserId" = $1 AND "GuildId" = 0`,
            [userId]
          );
          
          // 更新或新增權限
          for (const perm of permissions) {
            const { AuthKey, Value } = perm;
            
            // 檢查是否已存在
            const checkRes = await request.pg.client.query(
              `SELECT "UserId" FROM users_permission WHERE "UserId" = $1 AND "AuthKey" = $2 AND "GuildId" = 0`,
              [userId, AuthKey]
            );
            
            if (checkRes.rowCount > 0) {
              // 更新現有權限
              await request.pg.client.query(
                `UPDATE users_permission SET "Value" = $1 WHERE "UserId" = $2 AND "AuthKey" = $3 AND "GuildId" = 0`,
                [Value, userId, AuthKey]
              );
            } else {
              // 新增權限
              await request.pg.client.query(
                `INSERT INTO users_permission ("UserId", "AuthKey", "Value", "GuildId")
                 VALUES ($1, $2, $3, 0)`,
                [userId, AuthKey, Value]
              );
            }
          }
          
          // 提交交易
          await request.pg.client.query('COMMIT');
          
          // 取得更新後的權限
          const finalRes = await request.pg.client.query(
            `SELECT * FROM users_permission WHERE "UserId" = $1 AND "GuildId" = 0`,
            [userId]
          );
          
          return { 
            statusCode: 20000, 
            message: 'successful', 
            data: {permissions: finalRes.rows} 
          };
        } catch (error) {
          // 回滾交易
          await request.pg.client.query('ROLLBACK');
          console.error('更新使用者權限錯誤:', error);
          return Boom.badRequest('更新使用者權限失敗: ' + error.message);
        }
      },
    });

    // 取得使用者登入紀錄
    server.route({
      method: 'GET',
      path: '/pg/users/{userId}/login-logs',
      options: {
        description: '取得使用者登入紀錄 (PostgreSQL版本)',
        cors: { origin: ['*'], credentials: true },
        tags: ['api', 'postgres', 'users', 'logs'],
        validate: {
          params: Joi.object({
            userId: Joi.number().integer().required().description('使用者ID')
          }),
          query: Joi.object({
            limit: Joi.number().integer().min(1).max(100).default(10).description('筆數限制')
          })
        }
      },
      handler: async function (request, h) {
        const { userId } = request.params;
        const { limit } = request.query;
        
        try {
          const res = await request.pg.client.query(
            `SELECT * FROM users_loginLog 
             WHERE "UserId" = $1 
             ORDER BY "LoginTime" DESC 
             LIMIT $2`,
            [userId, limit]
          );
          
          return { 
            statusCode: 20000, 
            message: 'successful', 
            data: {logs: res.rows} 
          };
        } catch (error) {
          console.error('查詢登入紀錄錯誤:', error);
          return Boom.badRequest('查詢登入紀錄失敗: ' + error.message);
        }
      },
    });

    // 取得使用者操作紀錄
    server.route({
      method: 'GET',
      path: '/pg/users/{userId}/action-logs',
      options: {
        description: '取得使用者操作紀錄 (PostgreSQL版本)',
        cors: { origin: ['*'], credentials: true },
        tags: ['api', 'postgres', 'users', 'logs'],
        validate: {
          params: Joi.object({
            userId: Joi.number().integer().required().description('使用者ID')
          }),
          query: Joi.object({
            page: Joi.number().integer().min(1).default(1).description('頁碼'),
            limit: Joi.number().integer().min(1).max(100).default(20).description('每頁筆數')
          })
        }
      },
      handler: async function (request, h) {
        const { userId } = request.params;
        const { page, limit } = request.query;
        const offset = (page - 1) * limit;
        
        try {
          const res = await request.pg.client.query(
            `SELECT * FROM users_log 
             WHERE "UserId" = $1 
             ORDER BY "Create_At" DESC 
             LIMIT $2 OFFSET $3`,
            [userId, limit, offset]
          );
          
          // 取得總數
          const countRes = await request.pg.client.query(
            `SELECT COUNT(*) as total FROM users_log WHERE "UserId" = $1`,
            [userId]
          );
          
          const total = parseInt(countRes.rows[0].total);
          
          return { 
            statusCode: 20000, 
            message: 'successful', 
            data: {
              logs: res.rows,
              total: total,
              page: page,
              limit: limit,
              pages: Math.ceil(total / limit)
            } 
          };
        } catch (error) {
          console.error('查詢操作紀錄錯誤:', error);
          return Boom.badRequest('查詢操作紀錄失敗: ' + error.message);
        }
      },
    });

    // 取得所有使用者統計
    server.route({
      method: 'GET',
      path: '/pg/users/stats',
      options: {
        description: '取得使用者統計資料 (PostgreSQL版本)',
        cors: { origin: ['*'], credentials: true },
        tags: ['api', 'postgres', 'users', 'stats']
      },
      handler: async function (request, h) {
        try {
          // 取得總使用者數
          const totalRes = await request.pg.client.query(
            `SELECT COUNT(*) as total FROM users WHERE "Active" = 1`
          );
          
          // 取得今日登入數
          const todayLoginRes = await request.pg.client.query(
            `SELECT COUNT(DISTINCT "UserId") as today_logins 
             FROM "users_loginLog" 
             WHERE DATE("LoginTime") = CURRENT_DATE`
          );
          
          // 取得本月新增使用者數
          const monthNewRes = await request.pg.client.query(
            `SELECT COUNT(*) as month_new 
             FROM users 
             WHERE "Active" = 1 
             AND EXTRACT(MONTH FROM "Create_At") = EXTRACT(MONTH FROM CURRENT_DATE)
             AND EXTRACT(YEAR FROM "Create_At") = EXTRACT(YEAR FROM CURRENT_DATE)`
          );
          
          return { 
            statusCode: 20000, 
            message: 'successful', 
            data: {
              total_users: parseInt(totalRes.rows[0].total),
              today_logins: parseInt(todayLoginRes.rows[0].today_logins),
              month_new_users: parseInt(monthNewRes.rows[0].month_new)
            } 
          };
        } catch (error) {
          console.error('查詢使用者統計錯誤:', error);
          return Boom.badRequest('查詢使用者統計失敗: ' + error.message);
        }
      },
    });

    // 搜尋使用者
    server.route({
      method: 'GET',
      path: '/pg/users/search',
      options: {
        description: '搜尋使用者 (PostgreSQL版本)',
        cors: { origin: ['*'], credentials: true },
        tags: ['api', 'postgres', 'users'],
        validate: {
          query: Joi.object({
            keyword: Joi.string().required().description('搜尋關鍵字'),
            limit: Joi.number().integer().min(1).max(50).default(10).description('筆數限制')
          })
        }
      },
      handler: async function (request, h) {
        const { keyword, limit } = request.query;
        
        try {
          const res = await request.pg.client.query(
            `SELECT "UserId", "UserName", "NickName" 
             FROM users 
             WHERE "Active" = 1 
             AND ("UserName" ILIKE $1 OR "NickName" ILIKE $1)
             ORDER BY "UserId"
             LIMIT $2`,
            [`%${keyword}%`, limit]
          );
          
          return { 
            statusCode: 20000, 
            message: 'successful', 
            data: {users: res.rows} 
          };
        } catch (error) {
          console.error('搜尋使用者錯誤:', error);
          return Boom.badRequest('搜尋使用者失敗: ' + error.message);
        }
      },
    });

    console.log('PostgreSQL使用者帳號API已註冊');
  }
};
