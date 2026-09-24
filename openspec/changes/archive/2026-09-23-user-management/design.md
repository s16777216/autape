## Context

系統需要從原先「完全公開」的 prototype 狀態演進為具備基本安全與管理機制的企業級多租戶平台。我們將設計一套基於 JWT 與 HTTP-Only Cookie 的身分認證方案，配合 React Context 與保護路由，提供輕量級且安全的存取控制。

## Goals / Non-Goals

**Goals:**
* 後端支援使用者帳密驗證，採用 `bcryptjs` 進行密碼雜湊，保證資料庫內的安全存儲。
* 認證 Token（JWT）必須儲存於 `HTTP-Only Cookie`，防範 XSS 令牌盜取風險。
* 實作全域路由保護機制，非登入使用者無法取得測試案例、執行與專案資料。
* 提供系統管理員專用介面，可管理（建立、更新角色、重設密碼與刪除）平台內所有使用者。
* 整合當前頁面 Sidebar 腳部元件，以動態顯示當前登入使用者的真實姓名與頭像，並支援登出。

**Non-Goals:**
* 不實作第三方社群登入（如 Google/GitHub OAuth）。
* 不提供實體圖片大頭照上傳服務（頭像採用 Email 對應的 Gravatar 或是首字母生成頭像）。

## Decisions

### 1. 安全認證機制 (JWT via HTTP-Only Cookie)
* **決策**：登入成功後，後端將 JWT Token 寫入 `access_token` Cookie，屬性設為 `httpOnly: true, secure: true, sameSite: "lax", maxAge: 24h`。
* **理由**：相較於儲存於 `localStorage`，`httpOnly` Cookie 可由瀏覽器自動攜帶發送，且 JavaScript 無法讀取，能徹底阻斷 XSS 側漏 Token 的資安隱憂。

### 2. 初始化預設管理員 (Seed Admin)
* **決策**：在資料庫同步初始化（`db.ts`）時，若檢測到 `User` 表為空，自動寫入一筆預設管理員資料：帳號 `admin`，密碼 `admin123`，角色 `admin`。
* **理由**：確保系統引入鑑權保護後，開發者與管理員依然可以順利完成首次登入以開始進行系統配置。

### 3. 前端 AuthContext 與保護路由
* **決策**：
  - 前端建立 `AuthContext` 管理當前登入的 `user` 物件與 `loading` 狀態。
  - 實作 `<ProtectedRoute>`。非登入狀態強制 `Navigate` 至 `/login`。如果指定了 `requiredRole="admin"`，非管理員帳號訪問時重定向至無權限頁面或回首頁。
  - 在最外層 Root 路由加載時先調用 `/api/auth/me` 以便恢復登入狀態。

### 4. 使用者管理視圖整合 (Settings Tabs)
* **決策**：在「系統設定 `SettingsView`」中整合 `Tabs` 元件。非 admin 使用者僅能看見「一般設定」；admin 使用者則可多看見「成員管理」Tab 分頁。
* **理由**：避免在側邊欄首層塞入過多偏行政管理的選單，將其收攏在系統設定中更符合 Bento 選項架構的整潔性。

## Risks / Trade-offs

* **[風險]** JWT 的 Stateless 特性導致管理員刪除某個帳號時，該帳號已發行的 JWT Cookie 依舊在過期前有效。
  * **[對策]** 考量當前專案規模，採用 24 小時的短效 JWT 即可。若未來需要強效阻斷，可引入 Redis 黑名單機制或在後端 `/api/auth/me` 及敏感操作前，由資料庫校驗該使用者是否依然啟用。
