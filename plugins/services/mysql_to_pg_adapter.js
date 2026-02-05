'use strict';

const { Pool } = require('pg');

exports.plugin = {
    name: 'mysql_to_pg_adapter',
    version: '1.0.0',
    register: async function (server, options) {
        
        // 創建 PostgreSQL 連線池
        const pgPool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: 20, // 最大連線數
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000, // 增加連線超時時間到 10 秒
        });
        
        // 為 request 物件添加 MySQL 相容層
        server.ext('onRequest', async (request, h) => {
            // 創建 accsql 相容層 - 使用 account schema
            request.accsql = {
                pool: {
                    // 執行查詢 (MySQL 的 execute 方法)
                    execute: async (sql, params) => {
                        // 將 MySQL 語法轉換為 PostgreSQL 語法
                        const pgSql = convertMySQLToPostgreSQL(sql, params);
                        const pgParams = convertMySQLParams(params);
                        
                        const client = await pgPool.connect();
                        try {
                            // 設定 schema
                            await client.query('SET search_path TO account, public');
                            
                            // 使用 PostgreSQL 連線執行查詢
                            const result = await client.query(pgSql, pgParams);
                            
                            // 將 PostgreSQL 結果轉換為 MySQL 格式
                            return convertPostgreSQLToMySQLResult(result);
                        } catch (error) {
                            console.error('PostgreSQL 查詢錯誤 (account schema):', error);
                            console.error('SQL:', pgSql);
                            console.error('Params:', pgParams);
                            throw error;
                        } finally {
                            client.release();
                        }
                    },
                    
                    // 查詢方法 (MySQL 的 query 方法)
                    query: async (sql, params) => {
                        return request.accsql.pool.execute(sql, params);
                    }
                }
            };
            
            // 創建 tendersql 相容層 - 使用 tenderdb schema
            request.tendersql = {
                pool: {
                    // 執行查詢 (MySQL 的 execute 方法)
                    execute: async (sql, params) => {
                        // 將 MySQL 語法轉換為 PostgreSQL 語法
                        const pgSql = convertMySQLToPostgreSQL(sql, params);
                        const pgParams = convertMySQLParams(params);
                        
                        const client = await pgPool.connect();
                        try {
                            // 設定 schema
                            await client.query('SET search_path TO tenderdb, public');
                            
                            // 使用 PostgreSQL 連線執行查詢
                            const result = await client.query(pgSql, pgParams);
                            
                            // 將 PostgreSQL 結果轉換為 MySQL 格式
                            return convertPostgreSQLToMySQLResult(result);
                        } catch (error) {
                            console.error('PostgreSQL 查詢錯誤 (tenderdb schema):', error);
                            console.error('SQL:', pgSql);
                            console.error('Params:', pgParams);
                            throw error;
                        } finally {
                            client.release();
                        }
                    },
                    
                    // 查詢方法 (MySQL 的 query 方法)
                    query: async (sql, params) => {
                        return request.tendersql.pool.execute(sql, params);
                    }
                }
            };
            
            return h.continue;
        });
        
        // 清理連線池
        server.ext('onPostStop', async () => {
            await pgPool.end();
        });
        
        console.log('MySQL 到 PostgreSQL 轉接層已註冊 (使用 schema: account 和 tenderdb)');
    }
};

// 將 MySQL 語法轉換為 PostgreSQL 語法
function convertMySQLToPostgreSQL(sql, params) {
    let pgSql = sql;
    
    // 先處理 IN (?) -> = ANY($1) 的轉換（使用陣列）
    // 這樣可以解決 MySQL 中一個 ? 代表多個值的問題
    // 使用正則表達式找出所有 IN (?) 並記錄位置
    let inIndex = 0;
    const inPositions = [];
    pgSql = pgSql.replace(/IN\s*\(\s*\?\s*\)/gi, () => {
        inPositions.push(inIndex);
        inIndex++;
        return '__MYSQL_IN_PLACEHOLDER__';
    });
    
    // 轉換參數佔位符: ? -> $1, $2, ...
    let paramIndex = 1;
    pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);
    
    // 將 MySQL IN 佔位符轉換為 PostgreSQL ANY 語法
    // 並附加類型轉換確保 PostgreSQL 正確解析
    inIndex = 0;
    pgSql = pgSql.replace(/__MYSQL_IN_PLACEHOLDER__/g, () => {
        const paramNum = inPositions[inIndex] + 1;
        inIndex++;
        return `= ANY($${paramNum})`; // PostgreSQL 會根據列的類型自動推斷陣列類型
    });
    
    // 轉換反引號為雙引號，但確保不會創建空引號
    // 先處理反引號包圍的識別符
    pgSql = pgSql.replace(/`([^`]+)`/g, '"$1"');
    
    // 轉換 LIMIT 語法 (如果有的話)
    pgSql = pgSql.replace(/LIMIT\s+(\d+)\s*,\s*(\d+)/gi, 'LIMIT $2 OFFSET $1');
    
    // 轉換 NOW() 函數 (PostgreSQL 也支援 NOW())
    // pgSql = pgSql.replace(/NOW\(\)/gi, 'NOW()');
    
    // 轉換 JSON 函數
    // JSON_ARRAY_APPEND(column, '$', value) -> jsonb_set(COALESCE(column, '[]'::jsonb), '{0}', to_jsonb(value), true)
    pgSql = pgSql.replace(/JSON_ARRAY_APPEND\(([^,]+),\s*'\$',\s*([^)]+)\)/gi, 'jsonb_set(COALESCE($1, \'[]\'::jsonb), \'{0}\', to_jsonb($2), true)');
    
    // JSON_ARRAY() -> '[]'::jsonb
    pgSql = pgSql.replace(/JSON_ARRAY\(\)/gi, "'[]'::jsonb");
    
    // JSON_OBJECT() -> '{}'::jsonb
    pgSql = pgSql.replace(/JSON_OBJECT\(\)/gi, "'{}'::jsonb");
    
    // 轉換 IFNULL 為 COALESCE
    pgSql = pgSql.replace(/IFNULL\(/gi, 'COALESCE(');
    
    // 轉換 DATEDIFF 為 PostgreSQL 的 date_part
    pgSql = pgSql.replace(/DATEDIFF\(NOW\(\),\s*([^)]+)\)/gi, "date_part('day', NOW() - $1)");
    
    // 轉換 REGEXP_SUBSTR 為 PostgreSQL 的 substring
    pgSql = pgSql.replace(/REGEXP_SUBSTR\(([^,]+),\s*'([^']+)'\)/gi, "substring($1 from '$2')");
    
    // 轉換 ST_GeomFromText 函數 - MySQL 有三個參數，PostgreSQL 只有兩個
    // 從 ST_GeomFromText(text, srid, 'axis-order=long-lat') 轉換為 ST_GeomFromText(text, srid)
    pgSql = pgSql.replace(/ST_GeomFromText\(([^,]+),\s*([^,]+),\s*'[^']+'\)/gi, "ST_GeomFromText($1, $2)");
    
    // 為識別符添加雙引號以保持大小寫 (PostgreSQL 大小寫敏感)
    // 匹配表名和欄位名，但不匹配關鍵字、函數名、字串和數字
    pgSql = addQuotesToIdentifiers(pgSql);
    
    // 處理類型轉換問題：text = integer
    // 當 text 欄位與 integer 欄位比較時，需要將 text 轉換為 integer
    // 使用更靈活的匹配，包括換行和空格
    pgSql = pgSql.replace(/"Create_By"\s*=\s*"UserId"/gsi, '"Create_By"::integer = "UserId"');
    pgSql = pgSql.replace(/"FromUid"\s*=\s*"UserId"/gsi, '"FromUid"::integer = "UserId"');
    
    // 處理其他可能的類型轉換問題
    pgSql = pgSql.replace(/"users"\."Create_By"\s*=\s*"users1"\."UserId"/gsi, '"users"."Create_By"::integer = "users1"."UserId"');
    pgSql = pgSql.replace(/"users_log"\."FromUid"\s*=\s*"users2"\."UserId"/gsi, '"users_log"."FromUid"::integer = "users2"."UserId"');
    
    // 轉換 NOT (bitwise operation) -> (bitwise operation = 0)
    // 處理 NOT (expression & number)
    // 例如: NOT (COALESCE("PIState", 0) & 16) -> ((COALESCE("PIState", 0) & 16) = 0)
    // PostgreSQL 中 NOT 需要布林值，而 & 運算結果是整數
    pgSql = pgSql.replace(/NOT\s*\(\s*(.+?)\s*&\s*(\d+)\s*\)/gi, '(($1 & $2) = 0)');

    // 處理 bitwise AND 作為布林值的狀況 (針對 OR/AND 連接的情況)
    // 例如: ("PIState" & 32) OR ... -> (("PIState" & 32) > 0) OR ...
    // 針對簡單的情況 (括號內沒有其他括號)
    // 匹配: (col & val) OR/AND
    pgSql = pgSql.replace(/(\(\s*[^()]+\s*&\s*\d+\s*\))(\s*)(OR|AND)/gi, '(($1) > 0)$2$3');
    // 匹配: OR/AND (col & val)
    pgSql = pgSql.replace(/(OR|AND)(\s*)(\(\s*[^()]+\s*&\s*\d+\s*\))/gi, '$1$2(($3) > 0)');

    // 注意：特定欄位名稱大小寫問題現在在 addQuotesToIdentifiers 函數中處理
    
    return pgSql;
}

// 為識別符添加雙引號以保持大小寫
function addQuotesToIdentifiers(sql) {
    // 簡單的方法：為所有識別符添加雙引號，但排除 SQL 關鍵字和函數
    // 識別符模式：字母或底線開頭，包含字母、數字、底線
    const identifierPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
    
    // SQL 關鍵字列表（不完整但涵蓋常見的）
    const keywords = new Set([
        'select', 'from', 'where', 'and', 'or', 'insert', 'into', 'update', 'set',
        'delete', 'values', 'order', 'by', 'group', 'having', 'limit', 'offset',
        'join', 'left', 'right', 'inner', 'outer', 'on', 'as', 'is', 'null',
        'not', 'in', 'between', 'like', 'exists', 'case', 'when', 'then', 'else',
        'end', 'distinct', 'count', 'sum', 'avg', 'min', 'max', 'coalesce',
        'now', 'date_part', 'substring', 'jsonb_set', 'to_jsonb', 'true', 'false',
        'begin', 'commit', 'rollback', 'transaction', 'create', 'drop', 'alter',
        'table', 'index', 'view', 'schema', 'database', 'grant', 'revoke', 'user',
        'now', 'current_timestamp', 'current_date', 'current_time', 'desc', 'asc',
        'using', 'any'  // 添加 USING 關鍵字和 ANY 操作符
    ]);
    
    // 函數名列表
    const functions = new Set([
        'count', 'sum', 'avg', 'min', 'max', 'coalesce', 'now', 'date_part',
        'substring', 'jsonb_set', 'to_jsonb', 'st_asgeojson', 'st_geomfromtext',
        'st_centroid', 'st_makevalid', 'st_union', 'st_intersects', 'st_x', 'st_y',
        'st_astext', 'st_asgeojson', 'st_geomfromtext', 'st_makevalid', 'st_union',
        'st_intersects', 'st_area', 'st_length', 'st_perimeter', 'st_centroid',
        'st_buffer', 'st_distance', 'st_within', 'st_contains', 'st_intersects',
        'st_overlaps', 'st_touches', 'st_crosses', 'st_disjoint', 'st_equals',
        'st_dwithin', 'st_transform', 'st_setsrid', 'st_srid'
    ]);
    
    // 先處理已經在引號中的識別符
    let result = sql;
    
    // 找到所有已經在引號中的識別符，並暫時替換為佔位符
    const quotedIdentifiers = [];
    result = result.replace(/"([^"]+)"/g, (match, identifier) => {
        quotedIdentifiers.push(identifier);
        return `__QUOTED_${quotedIdentifiers.length - 1}__`;
    });
    
    // 現在處理剩下的識別符
    result = result.replace(identifierPattern, (match, identifier) => {
        const lowerIdentifier = identifier.toLowerCase();
        
        // 跳過關鍵字
        if (keywords.has(lowerIdentifier)) {
            return match;
        }
        
        // 跳過函數名（後面有括號的）
        const nextChar = result.charAt(result.indexOf(match, result.lastIndexOf(match)) + match.length);
        if (nextChar === '(' && functions.has(lowerIdentifier)) {
            return match;
        }
        
        // 跳過數字
        if (/^\d+$/.test(identifier)) {
            return match;
        }
        
        // 跳過參數佔位符 ($1, $2, ...)
        if (match.startsWith('$') && /^\$[0-9]+$/.test(match)) {
            return match;
        }
        
        // 添加雙引號
        return `"${identifier}"`;
    });
    
    // 恢復已經在引號中的識別符
    quotedIdentifiers.forEach((identifier, index) => {
        result = result.replace(`__QUOTED_${index}__`, `"${identifier}"`);
    });
    
    // 清理可能的雙重引號
    result = result.replace(/""/g, '"');
    
    // 在恢復引號後處理特定欄位名稱大小寫問題
    // 使用一個函數來處理所有大小寫轉換，確保順序正確
    result = fixColumnCaseSensitivity(result);
    
    // 處理 TendersSurveyPermission 表的欄位 - 必須在其他轉換之前
    result = result.replace(/"TendersSurveyPermission"\s*\.\s*"tenderId"/gi, '"TendersSurveyPermission"."TenderId"');
    result = result.replace(/"TendersSurveyPermission"\s*\.\s*"TenderId"/gi, '"TendersSurveyPermission"."TenderId"');
    result = result.replace(/"TendersSurveyPermission"\s*\.\s*"surveyId"/gi, '"TendersSurveyPermission"."SurveyId"');
    result = result.replace(/"TendersSurveyPermission"\s*\.\s*"SurveyId"/gi, '"TendersSurveyPermission"."SurveyId"');
    result = result.replace(/"TendersSurveyPermission"\s*\.\s*"userId"/gi, '"TendersSurveyPermission"."UserId"');
    result = result.replace(/"TendersSurveyPermission"\s*\.\s*"UserId"/gi, '"TendersSurveyPermission"."UserId"');
    
    // 處理沒有表名前綴的欄位（在 FROM "TendersSurveyPermission" 之後）
    // 這是一個更複雜的轉換，需要上下文感知
    
    // 轉換 surveyId 和 userId 為 PascalCase (TendersSurveyPermission 等表使用)
    result = result.replace(/"surveyId"/gi, '"SurveyId"');
    result = result.replace(/"userId"/gi, '"UserId"');
    
    // 處理其他欄位
    result = result.replace(/"groupId"/gi, '"groupId"');
    result = result.replace(/"tenderName"/gi, '"tenderName"');
    // 注意：不要在這裡處理 ZipCode，因為 fixColumnCaseSensitivity 已經處理了
    result = result.replace(/"GroupId"/gi, '"groupId"');
    result = result.replace(/"TenderName"/gi, '"tenderName"');

    // 處理 tenderId / TenderId 的上下文相關轉換
    const hasTendersSurveyPermission = result.includes('"TendersSurveyPermission"');
    const hasTenders = result.includes('"Tenders"');
    
    if (hasTendersSurveyPermission && !hasTenders) {
        // TendersSurveyPermission 使用 TenderId
        result = result.replace(/"tenderId"/gi, '"TenderId"');
    } else {
        // 預設行為：Tenders 表使用 tenderId
        result = result.replace(/"TenderId"/gi, '"tenderId"');
    }
    
    // 處理 Tenders 表的欄位
    result = result.replace(/"Tenders"\s*\.\s*"TenderId"/gi, '"Tenders"."tenderId"');
    result = result.replace(/"Tenders"\s*\.\s*"tenderId"/gi, '"Tenders"."tenderId"');
    
    return result;
}

// 轉換 MySQL 參數為 PostgreSQL 參數
function convertMySQLParams(params) {
    if (!params || !Array.isArray(params)) {
        return [];
    }
    
    // 檢查是否包含 = ANY 語法（處理數組參數）
    // 如果包含，則不展平陣列，讓 PostgreSQL 直接處理
    const pgParams = params.map(param => {
        // 處理特殊類型轉換
        if (param === undefined || param === null) {
            return null;
        }
        // 保持陣列參數不展平，讓 PostgreSQL 的 = ANY() 直接處理
        return param;
    });
    
    return pgParams;
}

// 修復欄位名稱大小寫敏感性
function fixColumnCaseSensitivity(sql) {
    let result = sql;
    
    // 第一步：確保 Tenders 表的 ZipCode 是大寫
    result = result.replace(/"Tenders"\s*\.\s*"zipCode"/gi, '"Tenders"."ZipCode"');
    result = result.replace(/"Tenders"\s*\.\s*"ZipCode"/gi, '"Tenders"."ZipCode"');
    
    // 第二步：處理 TendersSurvey 表的 ZipCode 也是大寫（因為 PostgreSQL 欄位已改為大寫）
    result = result.replace(/"TendersSurvey"\s*\.\s*"[Zz]ip[Cc]ode"/gi, '"TendersSurvey"."ZipCode"');
    
    // 第三步：處理 INSERT INTO TendersSurvey 中的 zipCode -> ZipCode
    result = result.replace(/INSERT\s+INTO\s+"TendersSurvey"\s*\([^)]*"[Zz]ip[Cc]ode"[^)]*\)/gi, (match) => {
        return match.replace(/"[Zz]ip[Cc]ode"/gi, '"ZipCode"');
    });
    
    // 第四步：處理任何仍然存在的 ZipCode/zipCode（使用大小寫不敏感的匹配）
    // 同時匹配大寫和小寫版本
    const zipCodeRegex = /"[Zz]ip[Cc]ode"/g;
    let lastIndex = 0;
    let newResult = '';
    
    while (true) {
        const match = zipCodeRegex.exec(result);
        if (!match) break;
        
        // 獲取匹配前的內容
        const beforeMatch = result.substring(lastIndex, match.index);
        newResult += beforeMatch;
        
        // 檢查前面是否有明確的表名前綴
        const context = result.substring(Math.max(0, match.index - 100), match.index);
        
        // 如果前面有 "Tenders". 或 "TendersSurvey".，都使用大寫 ZipCode
        if (context.includes('"Tenders"') || context.includes('"TendersSurvey"')) {
            newResult += '"ZipCode"';  // Tenders 和 TendersSurvey 表都使用大寫
        } else {
            // 預設行為：其他表使用大寫
            newResult += '"ZipCode"';
        }
        
        lastIndex = match.index + match[0].length;
    }
    
    // 添加剩餘的內容
    newResult += result.substring(lastIndex);
    
    return newResult;
}

// 將 PostgreSQL 結果轉換為 MySQL 格式
function convertPostgreSQLToMySQLResult(pgResult) {
    // MySQL 的 execute 方法返回 [rows, fields] 格式
    // 我們需要模擬這個格式
    return [pgResult.rows, []];
}
