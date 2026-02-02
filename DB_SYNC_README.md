# 資料庫同步服務使用說明

## 概述
此服務用於將MySQL資料庫中的`account`和`tenderdb`資料同步到PostgreSQL資料庫中，以便資料整合。

## 功能特性

### 1. 自動同步
- 每天凌晨2點自動執行同步任務
- 支援增量同步（使用UPSERT操作）
- 自動建立PostgreSQL中不存在的資料表

### 2. 手動同步API
- 提供RESTful API手動觸發同步
- 支援同步單一資料表
- 提供同步狀態查詢

### 3. 智慧同步
- 自動偵測資料表結構
- 批次處理大量資料（預設每批1000筆）
- 錯誤處理與重試機制

## API端點

### 1. 手動觸發完整同步
```
POST /api/db/sync
```

**回應範例：**
```json
{
  "statusCode": 200,
  "message": "資料庫同步成功",
  "data": {
    "success": true,
    "duration": "5.234秒",
    "timestamp": "2026-02-02T03:30:00.000Z",
    "results": [
      {
        "database": "account",
        "totalTables": 10,
        "successful": 10,
        "failed": 0,
        "results": [...]
      },
      {
        "database": "tenderdb",
        "totalTables": 15,
        "successful": 15,
        "failed": 0,
        "results": [...]
      }
    ]
  }
}
```

### 2. 查詢同步狀態
```
GET /api/db/sync/status
```

**回應範例：**
```json
{
  "statusCode": 200,
  "message": "資料庫同步服務運行中",
  "data": {
    "service": "db_sync",
    "version": "1.0.0",
    "scheduled_job": {
      "name": "db_sync_daily",
      "time": "0 2 * * *",
      "timezone": "Asia/Taipei"
    },
    "endpoints": [
      {
        "method": "POST",
        "path": "/api/db/sync",
        "description": "手動觸發同步"
      },
      {
        "method": "GET",
        "path": "/api/db/sync/status",
        "description": "查詢同步狀態"
      }
    ]
  }
}
```

### 3. 同步單一資料表
```
POST /api/db/sync/table
```

**請求範例：**
```json
{
  "database": "account",  // 或 "tenderdb"
  "table": "users",
  "primaryKey": "id",     // 可選，預設為 "id"
  "batchSize": 1000       // 可選，預設為 1000
}
```

**回應範例：**
```json
{
  "statusCode": 200,
  "message": "資料表 users 同步成功",
  "data": {
    "success": true,
    "synced": 1500
  }
}
```

## 排程設定

同步任務預設在每天凌晨2點（台灣時間）執行。如需修改排程時間，請編輯 `plugins/services/db_sync.js` 中的 `syncJob.time` 設定。

**Cron表達式範例：**
- `0 2 * * *` - 每天凌晨2點
- `0 */6 * * *` - 每6小時
- `0 0 * * 0` - 每週日午夜

## 環境變數

服務使用現有的環境變數：
- `MYSQL_ACC_URL` - MySQL account資料庫連接字串
- `MYSQL_TENDER_URL` - MySQL tenderdb資料庫連接字串  
- `DATABASE_URL` - PostgreSQL資料庫連接字串

## 部署步驟

### 1. 確認依賴項
確保以下套件已安裝：
```bash
npm install hapi-cron luxon joi
```

### 2. 啟動服務
服務已整合到主應用程式中，啟動方式與原本相同：

**開發環境：**
```bash
npm start
```

**生產環境：**
```bash
npm run prd
```

### 3. 驗證服務
啟動後，可透過以下方式驗證服務是否正常運行：

1. 檢查日誌中是否有「資料庫同步服務已註冊」訊息
2. 訪問 `GET /api/db/sync/status` 確認服務狀態
3. 使用 `POST /api/db/sync` 手動觸發測試同步

## 故障排除

### 常見問題

1. **同步失敗：資料表不存在**
   - 檢查MySQL資料庫連接是否正常
   - 確認資料表名稱正確

2. **同步速度過慢**
   - 調整 `batchSize` 參數
   - 檢查網路連線品質

3. **記憶體不足**
   - 減少 `batchSize` 值
   - 分批同步大型資料表

### 日誌檢查
同步過程的詳細日誌會輸出到控制台，包含：
- 開始/結束時間
- 同步的資料表數量
- 每張資料表的同步筆數
- 錯誤訊息（如有）

## 安全注意事項

1. **API權限**：目前API設為公開訪問，生產環境建議添加認證機制
2. **資料安全**：同步過程會傳輸資料庫內容，確保網路傳輸安全
3. **備份建議**：首次同步前建議備份PostgreSQL資料庫

## 擴展功能

如需擴展功能，可修改 `plugins/services/db_sync.js`：

1. **自定義同步規則**：修改 `syncDatabase` 函數中的資料表過濾邏輯
2. **添加通知機制**：同步完成後發送郵件或訊息通知
3. **性能優化**：添加索引、優化查詢等

## 支援與聯絡

如有問題，請檢查日誌輸出或聯絡系統管理員。