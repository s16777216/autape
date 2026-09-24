## ADDED Requirements

### Requirement: User Management Console
系統管理員（Admin）SHALL 具備對系統使用者的管理權限，而一般成員（Member）無此訪問權限。

#### Scenario: Admin accesses member management
- **WHEN** 系統管理員（角色為 `admin`）登入並訪問「系統設定」頁面
- **THEN** 系統 SHALL 渲染「成員管理」分頁，列表中顯示全站所有使用者之名稱、Email、註冊時間與角色。

#### Scenario: Member access is blocked
- **WHEN** 一般成員（角色為 `member`）嘗試直接訪問成員管理 API，或在介面上尋找成員管理入口
- **THEN** 系統後端 SHALL 拒絕 API 請求（回傳 403 Forbidden），且前端介面 SHALL 不對其渲染成員管理分頁。

#### Scenario: Create new account
- **WHEN** 系統管理員在成員管理介面點擊「新增使用者」，填入帳號、Email、密碼並指定角色後送出
- **THEN** 後端驗證通過，自動將密碼雜湊並寫入資料庫，列表即時更新。
