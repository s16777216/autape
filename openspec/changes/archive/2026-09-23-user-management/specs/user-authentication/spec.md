## ADDED Requirements

### Requirement: User Authentication Flow
系統 SHALL 提供安全的使用者登入、驗證與狀態維持機制。後端 SHALL 在登入成功後，將 JWT 作為安全 HTTP-Only Cookie 發行；前端 SHALL 在啟動時自動還原會話。

#### Scenario: User login success
- **WHEN** 使用者在 `/login` 頁面輸入正確的 `username` 與 `password` 並送出
- **THEN** 後端驗證密碼成功，回傳 `user` 身分資料，並寫入 `access_token` Cookie 標記為 HttpOnly；前端將使用者導向首頁並進入登入狀態。

#### Scenario: Session restore on startup
- **WHEN** 瀏覽器載入或重整網頁時
- **THEN** 前端自動發送請求至 `/api/auth/me`，若攜帶之認證 Cookie 合法且未過期，後端回傳當前使用者身分，前端自動維持登入狀態。

### Requirement: Frontend Routing Protection
系統 SHALL 實施全域路由存取控制，非登入使用者無法存取任何受保護之專案或測試案例資訊。

#### Scenario: Intercept unauthenticated guests
- **WHEN** 未登入之訪客直接在網址列輸入並訪問 `/project` 或其他受保護頁面
- **THEN** 系統 SHALL 攔截該訪問，並將使用者重定向導航至 `/login` 頁面。
