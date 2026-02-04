const { Pool } = require('pg');

async function fixLoginLogSequence() {
    console.log('開始修復 users_loginLog 序列...');
    
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
        
        // 1. 檢查 users_loginLog 表是否存在（嘗試不同的大小寫組合）
        console.log('\n1. 檢查 users_loginLog 表...');
        
        let tableName = null;
        let sequenceName = null;
        
        // 嘗試大寫 L 版本
        try {
            const tableExists = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'account' 
                    AND table_name = 'users_loginLog'
                )
            `);
            
            if (tableExists.rows[0].exists) {
                tableName = 'users_loginLog';
                console.log(`   找到表: account.users_loginLog (大寫 L)`);
            }
        } catch (error) {
            console.log(`   檢查 users_loginLog 失敗: ${error.message}`);
        }
        
        // 如果沒找到，嘗試小寫 l 版本
        if (!tableName) {
            try {
                const tableExists = await client.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'account' 
                        AND table_name = 'users_loginlog'
                    )
                `);
                
                if (tableExists.rows[0].exists) {
                    tableName = 'users_loginlog';
                    console.log(`   找到表: account.users_loginlog (小寫 l)`);
                }
            } catch (error) {
                console.log(`   檢查 users_loginlog 失敗: ${error.message}`);
            }
        }
        
        if (!tableName) {
            console.log('   警告: 找不到 users_loginLog 表');
            return;
        }
        
        // 2. 檢查序列
        console.log(`\n2. 檢查 ${tableName} 的序列...`);
        
        // 嘗試獲取序列名稱
        try {
            const sequenceResult = await client.query(`
                SELECT pg_get_serial_sequence('account.${tableName}', 'id') as sequence_name
            `);
            
            sequenceName = sequenceResult.rows[0].sequence_name;
            if (sequenceName) {
                console.log(`   找到序列: ${sequenceName}`);
            } else {
                console.log(`   找不到序列，嘗試常見的序列名稱...`);
                
                // 嘗試常見的序列名稱
                const commonSequences = [
                    `account.${tableName}_id_seq`,
                    `account.${tableName.toLowerCase()}_id_seq`,
                    `account.users_loginlog_id_seq`,
                    `account.users_loginLog_id_seq`
                ];
                
                for (const seqName of commonSequences) {
                    try {
                        const checkSeq = await client.query(`
                            SELECT EXISTS (
                                SELECT FROM pg_class 
                                WHERE relkind = 'S' 
                                AND relname = '${seqName.split('.')[1]}'
                            )
                        `);
                        
                        if (checkSeq.rows[0].exists) {
                            sequenceName = seqName;
                            console.log(`   找到序列: ${seqName}`);
                            break;
                        }
                    } catch (e) {
                        // 忽略錯誤，繼續嘗試下一個
                    }
                }
            }
        } catch (error) {
            console.log(`   檢查序列時發生錯誤: ${error.message}`);
        }
        
        // 3. 獲取最大 ID
        console.log(`\n3. 獲取 ${tableName} 的最大 ID...`);
        
        let maxId = 0;
        try {
            const maxIdResult = await client.query(`
                SELECT COALESCE(MAX("id"), 0) as max_id
                FROM "account"."${tableName}"
            `);
            
            maxId = parseInt(maxIdResult.rows[0].max_id) || 0;
            console.log(`   最大 ID: ${maxId}`);
        } catch (error) {
            console.log(`   獲取最大 ID 時發生錯誤: ${error.message}`);
            
            // 嘗試不使用引號
            try {
                const maxIdResult = await client.query(`
                    SELECT COALESCE(MAX(id), 0) as max_id
                    FROM account.${tableName}
                `);
                
                maxId = parseInt(maxIdResult.rows[0].max_id) || 0;
                console.log(`   最大 ID (無引號): ${maxId}`);
            } catch (error2) {
                console.log(`   再次嘗試也失敗: ${error2.message}`);
            }
        }
        
        // 4. 修復序列
        console.log(`\n4. 修復序列...`);
        
        if (maxId > 0) {
            // 嘗試創建序列
            console.log(`   嘗試創建序列...`);
            
            const seqName = `account.${tableName}_id_seq`;
            
            try {
                // 創建序列
                await client.query(`
                    CREATE SEQUENCE IF NOT EXISTS ${seqName}
                `);
                console.log(`   已創建序列: ${seqName}`);
                
                // 設置序列
                await client.query(`
                    SELECT setval('${seqName}', ${maxId}, true)
                `);
                console.log(`   已設置序列為 ${maxId}`);
                
                // 將序列設置為 id 欄位的預設值
                await client.query(`
                    ALTER TABLE "account"."${tableName}" 
                    ALTER COLUMN id SET DEFAULT nextval('${seqName}')
                `);
                console.log(`   已設置 id 欄位預設值為序列`);
                
                console.log(`   序列修復完成！`);
            } catch (createError) {
                console.log(`   創建序列時發生錯誤: ${createError.message}`);
                
                // 如果序列已存在，嘗試直接設置
                if (createError.message.includes('already exists')) {
                    try {
                        await client.query(`
                            SELECT setval('${seqName}', ${maxId}, true)
                        `);
                        console.log(`   序列已存在，已設置為 ${maxId}`);
                    } catch (setvalError) {
                        console.log(`   設置序列值時發生錯誤: ${setvalError.message}`);
                    }
                }
            }
        } else {
            console.log(`   最大 ID 為 0，跳過修復`);
        }
        
        console.log('\n5. 修復完成！');
        
    } catch (error) {
        console.error('修復過程中發生錯誤:', error);
    } finally {
        client.release();
        await pool.end();
        console.log('已關閉資料庫連線');
    }
}

// 執行修復
fixLoginLogSequence().catch(console.error);