const { Pool } = require('pg');

async function fixSequences() {
    console.log('開始修復 PostgreSQL 序列...');
    
    // 使用環境變數中的 DATABASE_URL
    const connectionString = process.env.DATABASE_URL || 'postgres://postgres:S@mLee0915@111.235.249.185:5432/tenderdb';
    
    const pool = new Pool({
        connectionString: connectionString,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
    });
    
    const client = await pool.connect();
    
    try {
        console.log('已連接到 PostgreSQL 資料庫');
        
        // 修復 account schema 中的序列
        console.log('\n1. 修復 account schema 中的序列...');
        
        // 獲取所有有序列的表
        const tablesWithSequences = await client.query(`
            SELECT 
                schemaname as schema_name,
                tablename as table_name,
                column_name,
                pg_get_serial_sequence(schemaname || '.' || tablename, column_name) as sequence_name
            FROM pg_tables t
            JOIN information_schema.columns c 
                ON t.schemaname = c.table_schema 
                AND t.tablename = c.table_name
            WHERE t.schemaname = 'account'
                AND c.column_default LIKE 'nextval%'
        `);
        
        console.log(`找到 ${tablesWithSequences.rows.length} 個有序列的表`);
        
        for (const row of tablesWithSequences.rows) {
            const { schema_name, table_name, column_name, sequence_name } = row;
            
            if (!sequence_name) continue;
            
            console.log(`\n   處理表: ${schema_name}.${table_name}`);
            console.log(`   欄位: ${column_name}`);
            console.log(`   序列: ${sequence_name}`);
            
            // 獲取表中的最大 id
            const maxIdResult = await client.query(`
                SELECT COALESCE(MAX("${column_name}"), 0) as max_id
                FROM "${schema_name}"."${table_name}"
            `);
            
            const maxId = parseInt(maxIdResult.rows[0].max_id) || 0;
            console.log(`   最大 ID: ${maxId}`);
            
            // 設置序列的當前值
            if (maxId > 0) {
                await client.query(`
                    SELECT setval('${sequence_name}', ${maxId}, true)
                `);
                console.log(`   已設置序列 ${sequence_name} 為 ${maxId}`);
            } else {
                console.log(`   表中無資料，跳過序列設置`);
            }
        }
        
        // 修復 tenderdb schema 中的序列
        console.log('\n2. 修復 tenderdb schema 中的序列...');
        
        const tenderTablesWithSequences = await client.query(`
            SELECT 
                schemaname as schema_name,
                tablename as table_name,
                column_name,
                pg_get_serial_sequence(schemaname || '.' || tablename, column_name) as sequence_name
            FROM pg_tables t
            JOIN information_schema.columns c 
                ON t.schemaname = c.table_schema 
                AND t.tablename = c.table_name
            WHERE t.schemaname = 'tenderdb'
                AND c.column_default LIKE 'nextval%'
        `);
        
        console.log(`找到 ${tenderTablesWithSequences.rows.length} 個有序列的表`);
        
        for (const row of tenderTablesWithSequences.rows) {
            const { schema_name, table_name, column_name, sequence_name } = row;
            
            if (!sequence_name) continue;
            
            console.log(`\n   處理表: ${schema_name}.${table_name}`);
            console.log(`   欄位: ${column_name}`);
            console.log(`   序列: ${sequence_name}`);
            
            // 獲取表中的最大 id
            const maxIdResult = await client.query(`
                SELECT COALESCE(MAX("${column_name}"), 0) as max_id
                FROM "${schema_name}"."${table_name}"
            `);
            
            const maxId = parseInt(maxIdResult.rows[0].max_id) || 0;
            console.log(`   最大 ID: ${maxId}`);
            
            // 設置序列的當前值
            if (maxId > 0) {
                await client.query(`
                    SELECT setval('${sequence_name}', ${maxId}, true)
                `);
                console.log(`   已設置序列 ${sequence_name} 為 ${maxId}`);
            } else {
                console.log(`   表中無資料，跳過序列設置`);
            }
        }
        
        console.log('\n3. 特別修復 users_loginLog 序列...');
        
        // 特別處理 users_loginLog 表 - 嘗試不同的大小寫組合
        try {
            const loginLogMaxId = await client.query(`
                SELECT COALESCE(MAX("id"), 0) as max_id
                FROM "account"."users_loginLog"
            `);
            
            const loginLogMax = parseInt(loginLogMaxId.rows[0].max_id) || 0;
            console.log(`   users_loginLog 最大 ID: ${loginLogMax}`);
            
            if (loginLogMax > 0) {
                await client.query(`
                    SELECT setval('account.users_loginLog_id_seq', ${loginLogMax}, true)
                `);
                console.log(`   已設置 users_loginLog 序列為 ${loginLogMax}`);
            }
        } catch (error) {
            console.log(`   嘗試 users_loginLog 失敗: ${error.message}`);
            
            // 嘗試小寫版本
            try {
                const loginLogMaxId = await client.query(`
                    SELECT COALESCE(MAX("id"), 0) as max_id
                    FROM "account"."users_loginlog"
                `);
                
                const loginLogMax = parseInt(loginLogMaxId.rows[0].max_id) || 0;
                console.log(`   users_loginlog (小寫) 最大 ID: ${loginLogMax}`);
                
                if (loginLogMax > 0) {
                    await client.query(`
                        SELECT setval('account.users_loginlog_id_seq', ${loginLogMax}, true)
                    `);
                    console.log(`   已設置 users_loginlog 序列為 ${loginLogMax}`);
                }
            } catch (error2) {
                console.log(`   嘗試 users_loginlog 也失敗: ${error2.message}`);
            }
        }
        
        console.log('\n4. 修復完成！');
        
    } catch (error) {
        console.error('修復過程中發生錯誤:', error);
    } finally {
        client.release();
        await pool.end();
        console.log('已關閉資料庫連線');
    }
}

// 執行修復
fixSequences().catch(console.error);