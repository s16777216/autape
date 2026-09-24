## 1. 後端 User 實體與資料初始化 (Backend Entities & Seed)

- [x] 1.1 建立 `backend/src/entities/User.ts` 資料模型（包含 username, email, passwordHash, role）。
- [x] 1.2 在 `backend/src/db.ts` 的資料庫初始化中，新增對 User 資料表的載入；並在資料庫為空時寫入預設的 `admin` / `admin123` 帳號。
- [x] 1.3 安裝後端必要的認證與解析依賴項目（如 `jsonwebtoken`、`bcryptjs`、`cookie-parser` 等）。

## 2. 後端認證與成員管理 API (Backend Auth & User API)

- [x] 2.1 實作 `/api/auth/login` (驗證密碼、簽發並寫入 access_token cookie)。
- [x] 2.2 實作 `/api/auth/me` (讀取 cookie 中的 JWT 以還原狀態) 與 `/api/auth/logout` (清除 cookie)。
- [x] 2.3 實作管理員專屬的 `/api/users` 路由，支援使用者列表取得與新增。建立角色中介軟體 (`requireAdmin`) 進行防護。

## 3. 前端 AuthContext 與全域路由防護 (Frontend Auth & Router Protection)

- [x] 3.1 建立 `frontend/src/context/AuthContext.tsx`，以管理全域 `user`、`login`、`logout` 狀態。
- [x] 3.2 建立 `frontend/src/components/custom/ProtectedRoute.tsx` 鑑權防護元件。
- [x] 3.3 修改 `frontend/src/routes.tsx`，加入對獨立 `/login` 頁面的支持，並將其餘子路由包覆於保護路徑中。

## 4. 前端登入頁面與成員管理視圖 (Frontend UI Integration)

- [x] 4.1 實作精緻且具備微互動效果的 `LoginView.tsx` 登入頁面。
- [x] 4.2 重構 `SettingsView.tsx`，加入 Tabs 控制，在管理員登入時顯示「成員管理」Tab 並展示 `UserManagementView.tsx`。
- [x] 4.3 重構 `SidebarFooter.tsx`，綁定真實 `AuthContext` 取得的使用者 Name、Email，並連結「登出」動作。

## 5. 打包驗證與整合測試 (Build & Validation)

- [x] 5.1 執行後端與前端的打包編譯，確保無 TypeScript 或 ESLint 錯誤。
- [x] 5.2 本地啟動開發環境，手動驗證「首次訪問導航重定向」、「預設管理員登入」、「建立一般成員帳號」以及「一般成員無權限訪問成員管理分頁」等情境。
