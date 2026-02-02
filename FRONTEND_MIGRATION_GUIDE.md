# 前端遷移指南 - 逐步遷移到 PostgreSQL API

## 遷移策略：部分修改，逐步遷移

### 核心原則
1. **保持現有功能不變**：所有現有的 MySQL API 繼續正常工作
2. **新功能使用 PostgreSQL**：新開發的功能優先使用 PostgreSQL API
3. **逐步遷移舊功能**：有計劃地將舊功能遷移到 PostgreSQL
4. **雙資料庫過渡期**：系統同時支援兩種資料庫，確保平滑遷移

## 前端 API 對照表

### 1. 使用者管理相關 API

#### MySQL API (保持不變)
```javascript
// 登入
POST /auth/login

// 帳號列表
GET /auth/accountList

// 新增帳號
POST /auth/account

// 修改密碼
POST /auth/password

// 修改備註
POST /auth/notes

// 帳號啟用/停用
POST /auth/active

// 使用者權限
GET /auth/permit
POST /auth/permit

// 帳號歷程
GET /auth/usersData

// 登入歷程
GET /auth/loginData

// 登入紀錄
GET /auth/loginLog

// 登出
POST /auth/logout

// 驗證權限
GET /auth/check
```

#### PostgreSQL API (新功能使用)
```javascript
// 組織列表
GET /pg/guild
POST /pg/guild

// 使用者列表 (分頁、搜尋)
GET /pg/users
GET /pg/users/search

// 新增使用者
POST /pg/users

// 取得單一使用者
GET /pg/users/{userId}

// 更新使用者
PUT /pg/users/{userId}

// 使用者統計資料
GET /pg/users/stats

// 使用者操作紀錄
GET /pg/users/{userId}/action-logs

// 使用者登入紀錄
GET /pg/users/{userId}/login-logs

// 使用者權限
GET /pg/users/{userId}/permissions
PUT /pg/users/{userId}/permissions
```

## 前端遷移實作建議

### 1. 建立 API 服務層

建議在前端建立統一的 API 服務層，方便管理不同資料庫的 API：

```javascript
// apiService.js
class ApiService {
  constructor() {
    this.baseURL = 'http://localhost:3000';
  }

  // MySQL API (舊功能)
  async mysqlLogin(username, password) {
    return this.post('/auth/login', { username, password });
  }

  async mysqlGetAccountList(params) {
    return this.get('/auth/accountList', params);
  }

  // PostgreSQL API (新功能)
  async pgGetUsers(params) {
    return this.get('/pg/users', params);
  }

  async pgCreateUser(userData) {
    return this.post('/pg/users', userData);
  }

  async pgGetUserStats() {
    return this.get('/pg/users/stats');
  }

  // 通用方法
  async get(endpoint, params = {}) {
    const url = new URL(`${this.baseURL}${endpoint}`);
    Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
    
    const response = await fetch(url);
    return response.json();
  }

  async post(endpoint, data) {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return response.json();
  }

  async put(endpoint, data) {
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return response.json();
  }
}

export default new ApiService();
```

### 2. 逐步遷移的實作範例

#### 範例1：使用者列表頁面遷移
```javascript
// UserListPage.js - 遷移前 (使用 MySQL)
import React, { useState, useEffect } from 'react';
import apiService from './apiService';

function UserListPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const response = await apiService.mysqlGetAccountList({
        pageCurrent: 1,
        pageSize: 50
      });
      if (response.statusCode === 20000) {
        setUsers(response.data.list);
      }
    } catch (error) {
      console.error('載入使用者失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>使用者列表 (MySQL)</h1>
      {/* 原有渲染邏輯 */}
    </div>
  );
}
```

```javascript
// UserListPage.js - 遷移後 (使用 PostgreSQL)
import React, { useState, useEffect } from 'react';
import apiService from './apiService';

function UserListPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usePostgreSQL, setUsePostgreSQL] = useState(false); // 切換開關

  useEffect(() => {
    loadUsers();
  }, [usePostgreSQL]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      let response;
      
      if (usePostgreSQL) {
        // 使用 PostgreSQL API
        response = await apiService.pgGetUsers({
          page: 1,
          limit: 50
        });
        if (response.statusCode === 200) {
          setUsers(response.data.list);
        }
      } else {
        // 使用 MySQL API
        response = await apiService.mysqlGetAccountList({
          pageCurrent: 1,
          pageSize: 50
        });
        if (response.statusCode === 20000) {
          setUsers(response.data.list);
        }
      }
    } catch (error) {
      console.error('載入使用者失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1>使用者列表</h1>
      
      {/* 資料庫切換開關 */}
      <div style={{ marginBottom: '20px' }}>
        <label>
          <input
            type="checkbox"
            checked={usePostgreSQL}
            onChange={(e) => setUsePostgreSQL(e.target.checked)}
          />
          使用 PostgreSQL 資料庫
        </label>
        <small style={{ marginLeft: '10px', color: '#666' }}>
          {usePostgreSQL ? '使用新 PostgreSQL API' : '使用舊 MySQL API'}
        </small>
      </div>

      {/* 使用者列表渲染 */}
      {loading ? (
        <div>載入中...</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>使用者名稱</th>
              <th>暱稱</th>
              <th>狀態</th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.UserId || user.UserId}>
                <td>{user.UserId || user.UserId}</td>
                <td>{user.UserName || user.UserName}</td>
                <td>{user.NickName || user.NickName}</td>
                <td>{user.Active === 1 ? '啟用' : '停用'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

#### 範例2：新增使用者功能遷移
```javascript
// AddUserForm.js - 支援雙資料庫
import React, { useState } from 'react';
import apiService from './apiService';

function AddUserForm({ usePostgreSQL = false, onSuccess }) {
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    nickname: ''
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      let response;
      
      if (usePostgreSQL) {
        // 使用 PostgreSQL API
        response = await apiService.pgCreateUser({
          UserName: formData.username,
          PassCode: formData.password, // 注意：後端會自動加密
          NickName: formData.nickname,
          Active: 1
        });
      } else {
        // 使用 MySQL API
        response = await apiService.mysqlCreateAccount({
          account: formData.username,
          password: formData.password,
          nickname: formData.nickname
        });
      }

      if (response.statusCode === 200 || response.statusCode === 20000) {
        alert('新增使用者成功！');
        setFormData({ username: '', password: '', nickname: '' });
        if (onSuccess) onSuccess();
      } else {
        alert(`新增失敗: ${response.message}`);
      }
    } catch (error) {
      console.error('新增使用者失敗:', error);
      alert('新增使用者失敗，請檢查網路連線');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label>使用者名稱：</label>
        <input
          type="text"
          value={formData.username}
          onChange={(e) => setFormData({...formData, username: e.target.value})}
          required
        />
      </div>
      <div>
        <label>密碼：</label>
        <input
          type="password"
          value={formData.password}
          onChange={(e) => setFormData({...formData, password: e.target.value})}
          required
        />
      </div>
      <div>
        <label>暱稱：</label>
        <input
          type="text"
          value={formData.nickname}
          onChange={(e) => setFormData({...formData, nickname: e.target.value})}
          required
        />
      </div>
      <button type="submit" disabled={loading}>
        {loading ? '處理中...' : '新增使用者'}
      </button>
      <small style={{ marginLeft: '10px', color: '#666' }}>
        使用 {usePostgreSQL ? 'PostgreSQL' : 'MySQL'} 資料庫
      </small>
    </form>
  );
}
```

## 遷移時間表建議

### 階段一：準備期 (1-2週)
1. **建立 API 服務層**：統一管理 MySQL 和 PostgreSQL API
2. **添加資料庫切換功能**：在開發環境添加切換開關
3. **並行測試**：確保兩種 API 都能正常工作
4. **資料一致性驗證**：確認資料同步正確

### 階段二：新功能開發期 (持續)
1. **所有新功能使用 PostgreSQL API**
2. **建立 PostgreSQL API 使用規範**
3. **培訓開發團隊**：了解 PostgreSQL API 使用方法
4. **建立範例程式碼**：提供最佳實踐範例

### 階段三：舊功能遷移期 (3-6個月)
1. **優先遷移低風險功能**：
   - 使用者管理功能
   - 組織管理功能
   - 報表查詢功能
2. **逐步遷移核心業務功能**：
   - 案件管理
   - 巡查管理
   - 派工管理
3. **最後遷移複雜功能**：
   - 財務相關功能
   - 統計分析功能
   - 歷史資料查詢

### 階段四：完全遷移期 (1-2個月)
1. **關閉 MySQL API**：確認所有功能都已遷移
2. **移除 MySQL 依賴**：清理前端 MySQL API 呼叫
3. **效能優化**：針對 PostgreSQL 進行前端優化
4. **監控和調整**：監控遷移後系統效能

## 注意事項

### 1. 資料格式差異
- **MySQL API**：使用 `statusCode: 20000` 表示成功
- **PostgreSQL API**：使用 `statusCode: 200` 表示成功
- **欄位名稱**：部分欄位名稱可能不同，需注意轉換

### 2. 錯誤處理
- 兩種 API 的錯誤回傳格式可能不同
- 建議統一錯誤處理邏輯
- 添加詳細的錯誤日誌

### 3. 效能考量
- PostgreSQL API 可能會有不同的效能特性
- 建議進行效能測試和比較
- 根據測試結果調整前端實現

### 4. 測試策略
- **單元測試**：測試兩種 API 的服務層
- **整合測試**：測試與後端的整合
- **端到端測試**：測試完整的使用者流程
- **效能測試**：比較兩種 API 的效能

## 工具和資源

### 1. 開發工具
```javascript
// 開發環境切換工具
const config = {
  usePostgreSQL: process.env.REACT_APP_USE_PG === 'true',
  apiBaseURL: process.env.REACT_APP_API_URL || 'http://localhost:3000'
};

// 環境變數設定
// .env.development
REACT_APP_USE_PG=false  // 開發時使用 MySQL
REACT_APP_API_URL=http://localhost:3000

// .env.staging
REACT_APP_USE_PG=true   // 測試環境使用 PostgreSQL
REACT_APP_API_URL=https://staging-api.example.com

// .env.production
REACT_APP_USE_PG=true   // 正式環境使用 PostgreSQL
REACT_APP_API_URL=https://api.example.com
```

### 2. 監控和日誌
```javascript
// 添加 API 呼叫日誌
class LoggingApiService extends ApiService {
  async get(endpoint, params = {}) {
    console.log(`[API] GET ${endpoint}`, {
      params,
      timestamp: new Date().toISOString(),
      database: endpoint.startsWith('/pg/') ? 'PostgreSQL' : 'MySQL'
    });
    
    try {
      const result = await super.get(endpoint, params);
      console.log(`[API] GET ${endpoint} 成功`);
      return result;
    } catch (error) {
      console.error(`[API] GET ${endpoint} 失敗:`, error);
      throw error;
    }
  }
}
```

## 總結

採用「部分修改，逐步遷移」的策略，您可以：
1. **最小化風險**：現有功能繼續正常工作
2. **靈活控制**：可以隨時切換回 MySQL API
3. **逐步實施**：按照自己的節奏進行遷移
4. **團隊適應**：給團隊時間學習和適應新技術

這種方法確保了遷移過程的平穩和安全，同時為未來的系統發展奠定了良好的基礎。