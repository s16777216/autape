## 1. Step Objective 目標提示

- [ ] 1.1 於 `backend/src/graph/prompt.ts` 的 `buildExecutorSystemPrompt` 新增選用參數 `stepObjective`：非空時注入「Step Objective」區塊（原始全文、僅供動作導向、不得自行判定 PASS/FAIL），超過 500 字元時截斷並標註「(已截斷)」，且不針對內容做格式特徵解析；以 `npm run test -w backend` 的 `graph.test.ts` 驗證輸出內容
- [ ] 1.2 於 `backend/src/graph.ts` 的 `executorNode` 讀取 `state.step_expecteds?.[idx]` 並傳入 `buildExecutorSystemPrompt`；以新增單元測試驗證傳遞邏輯
- [ ] 1.3 擴充 `backend/tests/graph.test.ts`：涵蓋「objective 非空（短文本）」「objective 超 500 字元截斷」「objective 為空」三種 prompt 輸出情境
- [ ] 1.4 擴充 `backend/tests/graph.test.ts`：驗證 Objective 區塊含「不得追加翻轉失敗狀態之動作（NO OVER-CORRECTION）」規則文字

## 2. No-Progress Recovery

- [ ] 2.1 新增 `backend/src/graph/noProgress.ts`，匯出純函數 `shouldFlagNoProgress`（三分支：單輪全失敗／動作完全重複／步驟累計 ≥6 筆且未 done_acting）；以純函數單元測試驗證三個分支與「正常進展不觸發」
- [ ] 2.2 於 `backend/src/graph.ts` `executorNode` 每輪工具執行完畢後（return 前）計算前一輪最後動作與當前輪資料並呼叫偵測，命中時 push `strategy_hint` 日誌（建議內容依無進展原因配對、併帶剩餘回合數）；以單元測試驗證日誌內容與不變更路由
- [ ] 2.3 新增 `backend/tests/graph.test.ts` 或獨立測試檔，驗證 `strategy_hint` 日誌會進入下一輪 Execution History 所需之 `logs` 結構

## 3. 回合意識與優雅收斂

- [ ] 3.1 於 `executorNode` 的 Human message 附加「本步驟已使用回合 X / 上限 5」，並在 `executor_turn_count >= 4`（最後一輪）追加「若無法推進目標請立即呼叫 done_acting 交由驗證器判定」；以新增單元測試驗證 Human message 內容分支
- [ ] 3.2 依設計在 System Prompt 追加「多次嘗試無法前進時應改變策略或呼叫 done_acting」規則；以 prompt 輸出測試驗證

## 4. 工具回饋強化

- [ ] 4.1 於 `backend/src/tools.ts` `click` 的 `waitForNavigation` 成功回報補上 `page.url()`（「導航後網址: ...」）；以新增測試或手動執行驗證
- [ ] 4.2 於 `backend/src/browser.ts` `observeWebPage` 元素清單對 `<a>` 附加 `href`（相對路徑以 `new URL(href, location.href)` 轉絕對）；以 browser 相關測試驗證清單格式
- [ ] 4.3 確認前端 log 串流渲染對新 `strategy_hint` action 值相容（檢查 `frontend/src/views` log 解析是否有依 action 值分支）；驗證方式：查閱前端程式碼 + 前後端連動手動驗證

## 5. 報告診斷強化

- [ ] 5.1 於 `backend/src/graph.ts` `reporterNode` 在「因動作輪次／斷言重試上限」而失敗時，`finalReason` 附加該步驟最後 5 筆動作摘錄（每筆 100 字元）；以單元測試或資料庫查詢驗證 reason 內容
- [ ] 5.2 檢查 `system_setting` 是否設定 `reportModelId`（未設定則無法生成 `failureSummary`）；若未設定，於執行案例前提醒使用者補齊，不改動規格禁令

## 6. 整合驗證

- [ ] 6.1 執行 `npm test -w backend`（vitest）全數通過且既有 `replay.test.ts`／`graph.test.ts` 不因變更而回歸
- [ ] 6.2 使用同一 `https://example.com` 測試案例（run 於 Queue）手動重跑 2-3 次，確認步驟 1 不再卡死（預期：執行器直接導航至目標或點對後 `done_acting`）
- [ ] 6.3 建立一個非 URL 預期案例（如點擊加入購物車後預期「購物車圖示出現」）手動重跑，驗證 Step Objective 與 No-Progress 對非 URL 目標的通用性
- [ ] 6.4 資料庫核對：查 `test_log`／`test_run_step` 確認 `strategy_hint` 日誌、導航後 URL 回報、`finalReason` 摘要均正確落庫
- [ ] 6.5 將已評估但本次不實作的工具陷阱（`target=_blank` 新分頁不被 `waitForNavigation` 偵測、`Promise.all([waitForLoadState, click])` 未真正等待新導航）記錄為後續 change 主題