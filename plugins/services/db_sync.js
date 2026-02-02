'use strict';

const HapiCron = require('hapi-cron');
const { DateTime } = require('luxon');
const Joi = require('joi');

/**
 * 資料庫同步服務
 * 將MySQL資料庫中的account和tenderdb資料同步到PostgreSQL資料庫
 */
exports.plugin = {
    name: 'db_sync',
    version: '1.0.0',
    register: async function (server, options) {
        
        // 同步函數 - 同步單個資料表
        async function syncTable(mysqlPool, pgClient, tableName, primaryKey = 'id', batchSize = 1000) {
            try {
                console.log(`開始同步資料表: ${tableName}`);
                
                // 1. 從MySQL取得資料 - 先檢查是否有id欄位
                let orderByClause = '';
                try {
                    // 嘗試使用primaryKey排序
                    const [checkResult] = await mysqlPool.execute(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [primaryKey]);
                    if (checkResult.length > 0) {
                        orderByClause = `ORDER BY ${primaryKey}`;
                    }
                } catch (e) {
                    // 如果檢查失敗，不使用ORDER BY
                    console.log(`無法檢查主鍵 ${primaryKey}，將不使用ORDER BY`);
                }
                
                const [mysqlRows] = await mysqlPool.execute(`SELECT * FROM ${tableName} ${orderByClause}`);
                console.log(`MySQL ${tableName} 資料筆數: ${mysqlRows.length}`);
                
                if (mysqlRows.length === 0) {
                    console.log(`資料表 ${tableName} 無資料，跳過同步`);
                    return { success: true, synced: 0 };
                }
                
                // 2. 檢查PostgreSQL中是否已存在該資料表
                const tableExists = await pgClient.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = $1
                    )
                `, [tableName]);
                
                if (!tableExists.rows[0].exists) {
                    console.log(`PostgreSQL 中不存在資料表 ${tableName}，需要建立`);
                    
                    // 從第一筆資料推測欄位結構
                    const sampleRow = mysqlRows[0];
                    const columns = Object.keys(sampleRow);
                    
                    // 建立資料表SQL - 使用更寬鬆的資料類型
                    const columnDefs = columns.map(col => {
                        const value = sampleRow[col];
                        let type = 'TEXT';
                        
                        if (typeof value === 'number') {
                            // 檢查是否為大數值
                            if (Math.abs(value) > 2147483647) {
                                type = 'BIGINT';
                            } else if (Number.isInteger(value)) {
                                type = 'INTEGER';
                            } else {
                                type = 'DOUBLE PRECISION';
                            }
                        } else if (value instanceof Date) {
                            type = 'TIMESTAMP';
                        } else if (typeof value === 'boolean') {
                            type = 'BOOLEAN';
                        }
                        
                        return `"${col}" ${type}`;
                    }).join(', ');
                    
                    const createTableSQL = `CREATE TABLE IF NOT EXISTS "public"."${tableName}" (${columnDefs})`;
                    await pgClient.query(createTableSQL);
                    console.log(`已建立資料表: ${tableName}`);
                }
                
                // 3. 批次同步資料 - 使用簡單的INSERT，如果重複則跳過
                let syncedCount = 0;
                let errorCount = 0;
                
                for (let i = 0; i < mysqlRows.length; i += batchSize) {
                    const batch = mysqlRows.slice(i, i + batchSize);
                    
                    // 建立INSERT SQL
                    const columns = Object.keys(batch[0]);
                    const columnNames = columns.map(col => `"${col}"`).join(', ');
                    const placeholders = batch.map((_, rowIndex) => 
                        `(${columns.map((_, colIndex) => `$${rowIndex * columns.length + colIndex + 1}`).join(', ')})`
                    ).join(', ');
                    
                    const values = batch.flatMap(row => 
                        columns.map(col => {
                            const value = row[col];
                            // 處理特殊值
                            if (value === null || value === undefined) {
                                return null;
                            }
                            // 處理大數值
                            if (typeof value === 'number' && Math.abs(value) > 2147483647) {
                                return value.toString(); // 轉為字串避免溢位
                            }
                            return value;
                        })
                    );
                    
                    // 使用簡單的INSERT，如果重複則跳過
                    const insertSQL = `
                        INSERT INTO "public"."${tableName}" (${columnNames})
                        VALUES ${placeholders}
                        ON CONFLICT DO NOTHING
                    `;
                    
                    try {
                        await pgClient.query(insertSQL, values);
                        syncedCount += batch.length;
                        console.log(`已同步 ${tableName}: ${syncedCount}/${mysqlRows.length} 筆資料`);
                    } catch (insertError) {
                        // 如果批次插入失敗，嘗試逐筆插入
                        console.log(`批次插入失敗，嘗試逐筆插入...`);
                        
                        for (const row of batch) {
                            try {
                                const singleValues = columns.map(col => {
                                    const value = row[col];
                                    if (value === null || value === undefined) return null;
                                    if (typeof value === 'number' && Math.abs(value) > 2147483647) {
                                        return value.toString();
                                    }
                                    return value;
                                });
                                
                                const singleInsertSQL = `
                                    INSERT INTO "public"."${tableName}" (${columnNames})
                                    VALUES (${columns.map((_, idx) => `$${idx + 1}`).join(', ')})
                                    ON CONFLICT DO NOTHING
                                `;
                                
                                await pgClient.query(singleInsertSQL, singleValues);
                                syncedCount++;
                            } catch (singleError) {
                                errorCount++;
                                console.error(`單筆插入失敗 (${errorCount} 筆失敗):`, singleError.message);
                            }
                        }
                    }
                }
                
                console.log(`完成同步資料表: ${tableName}, 成功: ${syncedCount}, 失敗: ${errorCount}`);
                return { 
                    success: errorCount === 0, 
                    synced: syncedCount,
                    failed: errorCount,
                    total: mysqlRows.length
                };
                
            } catch (error) {
                console.error(`同步資料表 ${tableName} 時發生錯誤:`, error);
                return { success: false, error: error.message };
            }
        }
        
        // 同步函數 - 同步整個資料庫
        async function syncDatabase(mysqlPool, pgClient, databaseName) {
            try {
                console.log(`開始同步資料庫: ${databaseName}`);
                
                // 1. 取得MySQL中的所有資料表
                const [tables] = await mysqlPool.execute(`
                    SELECT TABLE_NAME as table_name 
                    FROM INFORMATION_SCHEMA.TABLES 
                    WHERE TABLE_SCHEMA = ?
                    ORDER BY TABLE_NAME
                `, [databaseName]);
                
                console.log(`資料庫 ${databaseName} 中共有 ${tables.length} 個資料表`);
                
                const results = [];
                for (const table of tables) {
                    const tableName = table.table_name;
                    
                    // 跳過系統表或特定不需要同步的表
                    if (tableName.startsWith('sys_') || tableName.startsWith('temp_')) {
                        console.log(`跳過系統表: ${tableName}`);
                        continue;
                    }
                    
                    // 取得主鍵
                    const [primaryKeys] = await mysqlPool.execute(`
                        SELECT COLUMN_NAME as column_name
                        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                        WHERE TABLE_SCHEMA = ? 
                        AND TABLE_NAME = ? 
                        AND CONSTRAINT_NAME = 'PRIMARY'
                    `, [databaseName, tableName]);
                    
                    const primaryKey = primaryKeys.length > 0 ? primaryKeys[0].column_name : 'id';
                    
                    // 同步資料表
                    const result = await syncTable(mysqlPool, pgClient, tableName, primaryKey);
                    results.push({
                        table: tableName,
                        ...result
                    });
                }
                
                const successful = results.filter(r => r.success).length;
                const failed = results.filter(r => !r.success).length;
                
                console.log(`完成同步資料庫: ${databaseName}, 成功: ${successful}, 失敗: ${failed}`);
                
                return {
                    database: databaseName,
                    totalTables: tables.length,
                    successful,
                    failed,
                    results
                };
                
            } catch (error) {
                console.error(`同步資料庫 ${databaseName} 時發生錯誤:`, error);
                return { success: false, error: error.message };
            }
        }
        
        // 主要同步函數 - 需要request物件來訪問MySQL和PostgreSQL連接
        async function syncAllDatabases(request) {
            console.log('開始同步所有資料庫...');
            const startTime = Date.now();
            
            try {
                const results = [];
                
                // 同步 account 資料庫
                console.log('同步 account 資料庫...');
                const accountResult = await syncDatabase(
                    request.accsql.pool,
                    request.pg.client,
                    'account'
                );
                results.push(accountResult);
                
                // 同步 tenderdb 資料庫
                console.log('同步 tenderdb 資料庫...');
                const tenderResult = await syncDatabase(
                    request.tendersql.pool,
                    request.pg.client,
                    'tenderdb'
                );
                results.push(tenderResult);
                
                const endTime = Date.now();
                const duration = (endTime - startTime) / 1000;
                
                console.log(`所有資料庫同步完成，總耗時: ${duration} 秒`);
                
                return {
                    success: true,
                    duration: `${duration} 秒`,
                    timestamp: new Date().toISOString(),
                    results
                };
                
            } catch (error) {
                console.error('同步所有資料庫時發生錯誤:', error);
                return {
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                };
            }
        }
        
        // 建立一個API端點供排程任務調用
        server.route({
            method: 'POST',
            path: '/api/db/sync/cron',
            options: {
                description: '排程任務調用的資料庫同步端點',
                tags: ['api', 'database', 'sync', 'internal'],
                auth: false,
                notes: '此端點供排程任務使用，不建議直接調用'
            },
            handler: async function (request, h) {
                console.log('執行排程資料庫同步任務...');
                const result = await syncAllDatabases(request);
                console.log('排程同步任務完成:', result);
                
                return {
                    statusCode: 200,
                    message: '排程同步任務執行完成',
                    data: result
                };
            }
        });
        
        // 排程任務設定
        const syncJob = {
            name: 'db_sync_daily',
            time: '0 2 * * *',           // 每天凌晨2點執行
            timezone: 'Asia/Taipei',     // UTC+8
            request: {
                method: 'POST',
                url: '/api/db/sync/cron'
            },
            onComplete: (res) => {
                console.log('排程同步任務執行完成，回應:', res);
            }
        };
        
        // 註冊排程任務
        await server.register({
            plugin: HapiCron,
            options: {
                jobs: [syncJob]
            }
        });
        
        // API 路由 - 手動觸發同步
        server.route({
            method: 'POST',
            path: '/api/db/sync',
            options: {
                description: '手動觸發資料庫同步',
                tags: ['api', 'database', 'sync'],
                auth: false, // 根據需求設定權限
                notes: '同步MySQL的account和tenderdb資料庫到PostgreSQL',
                plugins: {
                    'hapi-swagger': {
                        responses: {
                            '200': {
                                description: '同步成功',
                                schema: Joi.object({
                                    statusCode: Joi.number().example(200),
                                    message: Joi.string().example('資料庫同步成功'),
                                    data: Joi.object()
                                })
                            },
                            '500': {
                                description: '同步失敗',
                                schema: Joi.object({
                                    statusCode: Joi.number().example(500),
                                    message: Joi.string().example('資料庫同步失敗'),
                                    error: Joi.string()
                                })
                            }
                        }
                    }
                }
            },
            handler: async function (request, h) {
                try {
                    const result = await syncAllDatabases(request);
                    
                    if (result.success) {
                        return {
                            statusCode: 200,
                            message: '資料庫同步成功',
                            data: result
                        };
                    } else {
                        return h.response({
                            statusCode: 500,
                            message: '資料庫同步失敗',
                            error: result.error
                        }).code(500);
                    }
                } catch (error) {
                    return h.response({
                        statusCode: 500,
                        message: '同步過程中發生錯誤',
                        error: error.message
                    }).code(500);
                }
            }
        });
        
        // API 路由 - 同步狀態查詢
        server.route({
            method: 'GET',
            path: '/api/db/sync/status',
            options: {
                description: '查詢資料庫同步狀態',
                tags: ['api', 'database', 'sync'],
                auth: false,
                plugins: {
                    'hapi-swagger': {
                        responses: {
                            '200': {
                                description: '狀態查詢成功',
                                schema: Joi.object({
                                    statusCode: Joi.number().example(200),
                                    message: Joi.string().example('資料庫同步服務運行中'),
                                    data: Joi.object()
                                })
                            }
                        }
                    }
                }
            },
            handler: async function (request, h) {
                return {
                    statusCode: 200,
                    message: '資料庫同步服務運行中',
                    data: {
                        service: 'db_sync',
                        version: '1.0.0',
                        scheduled_job: syncJob,
                        endpoints: [
                            { method: 'POST', path: '/api/db/sync', description: '手動觸發同步' },
                            { method: 'GET', path: '/api/db/sync/status', description: '查詢同步狀態' },
                            { method: 'POST', path: '/api/db/sync/table', description: '同步單一資料表' }
                        ]
                    }
                };
            }
        });
        
        // API 路由 - 同步單一資料表
        server.route({
            method: 'POST',
            path: '/api/db/sync/table',
            options: {
                description: '同步單一資料表',
                tags: ['api', 'database', 'sync'],
                auth: false,
                validate: {
                    payload: Joi.object({
                        database: Joi.string().valid('account', 'tenderdb').required().description('資料庫名稱: account 或 tenderdb'),
                        table: Joi.string().required().description('資料表名稱'),
                        primaryKey: Joi.string().default('id').description('主鍵欄位名稱'),
                        batchSize: Joi.number().integer().min(1).max(10000).default(1000).description('批次大小')
                    })
                },
                plugins: {
                    'hapi-swagger': {
                        responses: {
                            '200': {
                                description: '資料表同步成功',
                                schema: Joi.object({
                                    statusCode: Joi.number().example(200),
                                    message: Joi.string().example('資料表 users 同步成功'),
                                    data: Joi.object()
                                })
                            },
                            '400': {
                                description: '請求參數錯誤',
                                schema: Joi.object({
                                    statusCode: Joi.number().example(400),
                                    message: Joi.string().example('不支援的資料庫'),
                                    error: Joi.string()
                                })
                            },
                            '500': {
                                description: '同步失敗',
                                schema: Joi.object({
                                    statusCode: Joi.number().example(500),
                                    message: Joi.string().example('資料表同步失敗'),
                                    error: Joi.string()
                                })
                            }
                        }
                    }
                }
            },
            handler: async function (request, h) {
                const { database, table, primaryKey, batchSize } = request.payload;
                
                try {
                    let mysqlPool;
                    if (database === 'account') {
                        mysqlPool = request.accsql.pool;
                    } else if (database === 'tenderdb') {
                        mysqlPool = request.tendersql.pool;
                    } else {
                        return h.response({
                            statusCode: 400,
                            message: '不支援的資料庫',
                            error: `資料庫 ${database} 不支援`
                        }).code(400);
                    }
                    
                    const result = await syncTable(
                        mysqlPool,
                        request.pg.client,
                        table,
                        primaryKey,
                        batchSize
                    );
                    
                    if (result.success) {
                        return {
                            statusCode: 200,
                            message: `資料表 ${table} 同步成功`,
                            data: result
                        };
                    } else {
                        return h.response({
                            statusCode: 500,
                            message: `資料表 ${table} 同步失敗`,
                            error: result.error
                        }).code(500);
                    }
                } catch (error) {
                    return h.response({
                        statusCode: 500,
                        message: '同步過程中發生錯誤',
                        error: error.message
                    }).code(500);
                }
            }
        });
        
        console.log('資料庫同步服務已註冊');
    }
};