// 測試 IN (?) 轉換為 = ANY($N) 的邏輯

// 將 MySQL 語法轉換為 PostgreSQL 語法
function convertMySQLToPostgreSQL(sql, params) {
    let pgSql = sql;
    
    // 先處理 IN (?) -> = ANY($N) 的轉換（使用陣列）
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
    inIndex = 0;
    pgSql = pgSql.replace(/__MYSQL_IN_PLACEHOLDER__/g, () => {
        const paramNum = inPositions[inIndex] + 1;
        inIndex++;
        return `= ANY($${paramNum})`; // PostgreSQL 會根據列的類型自動推斷陣列類型
    });
    
    return pgSql;
}

// 轉換 MySQL 參數為 PostgreSQL 參數
function convertMySQLParams(params) {
    if (!params || !Array.isArray(params)) {
        return [];
    }
    
    // 不展平陣列，讓 PostgreSQL 直接處理
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

// 測試用例
console.log('=== 測試 MySQL 轉 PostgreSQL 轉換 ===\n');

// 測試 1: 簡單的 IN (?) 轉換
const sql1 = `SELECT id, type, success, fail, total, note
             FROM _action
             WHERE id IN (?)`;
const params1 = [[0, 0]];

const pgSql1 = convertMySQLToPostgreSQL(sql1, params1);
const pgParams1 = convertMySQLParams(params1);

console.log('測試 1: 簡單 IN (?) 轉換');
console.log('MySQL SQL:', sql1);
console.log('MySQL Params:', params1);
console.log('PostgreSQL SQL:', pgSql1);
console.log('PostgreSQL Params:', pgParams1);
console.log('');

// 測試 2: 多個 ? 的查詢 (非 IN)
const sql2 = `SELECT * FROM users WHERE id = ? AND name = ?`;
const params2 = [123, 'John'];

const pgSql2 = convertMySQLToPostgreSQL(sql2, params2);
const pgParams2 = convertMySQLParams(params2);

console.log('測試 2: 多個 ? 的查詢');
console.log('MySQL SQL:', sql2);
console.log('MySQL Params:', params2);
console.log('PostgreSQL SQL:', pgSql2);
console.log('PostgreSQL Params:', pgParams2);
console.log('');

// 測試 3: 混合 IN (?) 和普通 ?
const sql3 = `SELECT * FROM orders WHERE id IN (?) AND status = ?`;
const params3 = [[1, 2, 3], 'active'];

const pgSql3 = convertMySQLToPostgreSQL(sql3, params3);
const pgParams3 = convertMySQLParams(params3);

console.log('測試 3: 混合 IN (?) 和普通 ?');
console.log('MySQL SQL:', sql3);
console.log('MySQL Params:', params3);
console.log('PostgreSQL SQL:', pgSql3);
console.log('PostgreSQL Params:', pgParams3);
console.log('');

// 驗證是否正確
console.log('=== 驗證結果 ===\n');
const test1Pass = pgSql1.includes('= ANY($1)') && pgParams1.length === 1;
const test2Pass = pgSql2.includes('$1') && pgSql2.includes('$2') && pgParams2.length === 2;
const test3Pass = pgSql3.includes('= ANY($1)') && pgSql3.includes('$2') && pgParams3.length === 2;

console.log('測試 1 (簡單 IN):', test1Pass ? '✓ PASS' : '✗ FAIL');
console.log('測試 2 (多個 ?):', test2Pass ? '✓ PASS' : '✗ FAIL');
console.log('測試 3 (混合):', test3Pass ? '✓ PASS' : '✗ FAIL');
