## Why

目前專案缺少使用者身分驗證與權限控管功能，系統處於完全公開且無鑑權保護的狀態。為了保護系統資料安全並實現多使用者環境下的協作與專案管理，我們需要追加使用者管理 (User Management) 功能，提供系統登入驗證、路由權限保護，以及系統管理員對平台成員的管理手段。

## What Changes

* **全站路由鑑權保護 (BREAKING)**：全站除獨立的 `/login` 頁面外，其餘路由均受 `<ProtectedRoute>` 保護，未登入之訪客將強制導向登入頁。
* **後端身分認證與 API 鑑權**：
  * 引入 `User` 資料實體，支援 `bcryptjs` 密碼雜湊與 JWT 認證（以 HTTP-Only Cookie 形式儲存）。
  * 提供 `/api/auth/login`、`/api/auth/me`、`/api/auth/logout` 等認證 API。
  * 提供管理員專用的 `/api/users` 使用者管理 API 路由。
* **前端登入與成員管理介面**：
  * 新增獨立的 `/login` 登入頁面。
  * 新增 `AuthContext` 統一管理全站使用者登入狀態。
  * 於「系統設定」內新增管理員專屬的「使用者管理」控制台分頁（Tab），用以列表、建立與管理平台使用者。

## Capabilities

### New Capabilities

- `user-authentication`: 提供全站身分驗證、登入、登出與路由保護機制。
- `user-administration`: 提供系統管理員專屬的成員帳號管理（建立、更新角色、重設密碼與刪除）功能。

### Modified Capabilities

無

## Impact

* **後端變更**：
  * 新增 `backend/src/entities/User.ts` 資料實體。
  * 新增 `backend/src/routes/auth.ts` 與 `backend/src/routes/users.ts` 路由。
  * `backend/src/main.ts` 新增 cookie-parser 中介軟體支援。
* **前端變更**：
  * 新增 `frontend/src/context/AuthContext.tsx` 認證狀態管理。
  * 新增 `frontend/src/views/LoginView.tsx` 與 `frontend/src/views/UserManagementView.tsx` 視圖。
  * `frontend/src/routes.tsx` 整合保護路由。
  * `frontend/src/layouts/SidebarFooter.tsx` 對接真實使用者狀態與登出 API。
