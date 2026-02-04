const { Pool } = require('pg');

async function fixPostgresTables() {
    console.log('開始修復 PostgreSQL 資料表結構...');
    
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
        
        // 1. 修復 account schema 中的 users_loginLog 表
        console.log('\n1. 修復 account.users_loginLog 表...');
        
        // 檢查表是否存在
        const tableExists = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'account' 
                AND table_name = 'users_loginLog'
            )
        `);
        
        if (tableExists.rows[0].exists) {
            console.log('   account.users_loginLog 表存在');
            
            // 檢查 id 欄位是否為 SERIAL
            const columnInfo = await client.query(`
                SELECT column_name, data_type, column_default, is_nullable
                FROM information_schema.columns 
                WHERE table_schema = 'account' 
                AND table_name = 'users_loginLog'
                AND column_name = 'id'
            `);
            
            if (columnInfo.rows.length > 0) {
                const column = columnInfo.rows[0];
                console.log(`   id 欄位資訊: data_type=${column.data_type}, column_default=${column.column_default}, is_nullable=${column.is_nullable}`);
                
                // 如果 id 欄位不是 SERIAL/BIGSERIAL，則修復它
                if (!column.column_default || !column.column_default.includes('nextval')) {
                    console.log('   需要將 id 欄位轉換為 SERIAL');
                    
                    // 先檢查是否已經有主鍵約束
                    const hasPrimaryKey = await client.query(`
                        SELECT conname
                        FROM pg_constraint 
                        WHERE conrelid = 'account."users_loginLog"'::regclass 
                        AND contype = 'p'
                    `);
                    
                    if (hasPrimaryKey.rows.length > 0) {
                        console.log(`   表已有主鍵約束: ${hasPrimaryKey.rows[0].conname}`);
                        // 如果已經有主鍵，我們只需要修復序列
                    } else {
                        console.log('   表沒有主鍵約束');
                    }
                    
                    // 創建序列（如果不存在）
                    await client.query(`
                        CREATE SEQUENCE IF NOT EXISTS account.users_loginLog_id_seq
                    `);
                    console.log('   已創建序列');
                    
                    // 將 id 欄位設置為使用序列
                    await client.query(`
                        ALTER TABLE account."users_loginLog" 
                        ALTER COLUMN id SET DEFAULT nextval('account.users_loginLog_id_seq')
                    `);
                    console.log('   已設置 id 欄位預設值為序列');
                    
                    // 如果沒有主鍵，則設置主鍵
                    if (hasPrimaryKey.rows.length === 0) {
                        await client.query(`
                            ALTER TABLE account."users_loginLog" 
                            ADD PRIMARY KEY (id)
                        `);
                        console.log('   已設置主鍵');
                    }
                    
                    // 設置序列的當前值
                    await client.query(`
                        SELECT setval('account.users_loginLog_id_seq', COALESCE((SELECT MAX(id) FROM account."users_loginLog"), 0) + 1)
                    `);
                    console.log('   已設置序列當前值');
                } else {
                    console.log('   id 欄位已經是 SERIAL/BIGSERIAL，無需修復');
                }
            } else {
                console.log('   警告: users_loginLog 表中沒有 id 欄位');
            }
        } else {
            console.log('   account.users_loginLog 表不存在，跳過修復');
        }
        
        // 2. 修復其他可能有類似問題的表
        console.log('\n2. 檢查其他可能有類似問題的表...');
        
        const tablesToCheck = [
            'users',
            'users_log',
            'users_actionLog',
            'guild',
            'permit'
        ];
        
        for (const tableName of tablesToCheck) {
            console.log(`\n   檢查 account.${tableName} 表...`);
            
            const tableExists = await client.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'account' 
                    AND table_name = $1
                )
            `, [tableName]);
            
            if (tableExists.rows[0].exists) {
                // 檢查是否有 id 欄位
                const hasIdColumn = await client.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_schema = 'account' 
                        AND table_name = $1
                        AND column_name = 'id'
                    )
                `, [tableName]);
                
                if (hasIdColumn.rows[0].exists) {
                    // 檢查 id 欄位是否為 SERIAL
                    const columnInfo = await client.query(`
                        SELECT column_name, data_type, column_default, is_nullable
                        FROM information_schema.columns 
                        WHERE table_schema = 'account' 
                        AND table_name = $1
                        AND column_name = 'id'
                    `, [tableName]);
                    
                    if (columnInfo.rows.length > 0) {
                        const column = columnInfo.rows[0];
                        if (!column.column_default || !column.column_default.includes('nextval')) {
                            console.log(`     警告: ${tableName}.id 欄位不是 SERIAL，可能需要修復`);
                        } else {
                            console.log(`     ${tableName}.id 欄位已經是 SERIAL`);
                        }
                    }
                }
            }
        }
        
        console.log('\n3. 修復完成！');
        
    } catch (error) {
        console.error('修復過程中發生錯誤:', error);
    } finally {
        client.release();
        await pool.end();
        console.log('已關閉資料庫連線');
    }
}

// 執行修復
fixPostgresTables().catch(console.error);