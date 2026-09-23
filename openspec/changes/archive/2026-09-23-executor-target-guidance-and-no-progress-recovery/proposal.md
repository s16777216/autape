## Why

執行器（Executor）僅收到「步驟動作文字」而不知道「步驟目標意圖」，一旦在執行中走錯方向（例如點錯元素導航至錯誤頁面），既無法察覺「沒有進展」，也沒有能力走回正軌，只能盲目重試直到動作回合耗盡。實務上同一測試案例（步驟「找到 'Learn more' 的超連結並點擊」）已於 2026-09-11 至 2026-09-17 以相同模式失敗 5 次，且失敗原因未能區分業務性斷言失敗、操作性補救耗盡或不支援的新分頁，缺乏可操作且安全的診斷資訊。

## What Changes

- **Step Objective 目標提示**：當步驟提供 `stepExpected` 時，將其作為 Human message 中的非權威目標參考；System Prompt 明訂 `Step Action > Step Objective`，Objective 只能消除目標與方向歧義，不得改寫動作、要求額外動作或自行判定 PASS/FAIL。Objective 超過 500 個 Unicode 字元時保留前 350 與後 150 字元，中間標示省略；不解析其格式或語意特徵。
- **保守的無進展自癒**：僅在「本輪工具全部失敗」或「跨相鄰回合重複相同副作用工具與參數」時產生 `strategy_hint`。提示會持久化並進入下一輪 Execution History，但不參與失敗判定、動作計數或重複比較；每輪最多一筆，相同原因不得連續重複。
- **共用回合預算與確定終止**：整個步驟共用最多 5 個 Executor rounds，斷言失敗不得重置；一次 LLM Executor 決策算一輪，Replay、Asserter 與純框架處理不計。`done_acting` 為 terminal tool，遇到後停止執行同批後續工具並交由 Asserter 判定。
- **分類式斷言收斂**：本 change 依賴 `assertion-failure-classification` 提供的結構化失敗類型與路由。`business` failure 直接進入 reporter，不再回 Executor；只有 `operational` failure 且仍有共用回合預算時才可補救。
- **可靠導航與連結資訊**：`click(waitForNavigation)` 在點擊前註冊 watcher，支援同分頁 document navigation 與 SPA URL 變更，完成後回報實際 URL；逾時回報失敗與當前 URL。`observe_web_page` 對連結同時提供 raw href 與解析值，僅將 HTTP(S) 標示為可直接導航。
- **新分頁安全護欄**：點擊若觸發 popup，不在本次實作完整的新分頁接管；改以不可重試的 `unsupported_new_page` 終止，保留 popup URL 供診斷並避免重複點擊產生更多分頁。
- **結構化且安全的失敗診斷**：以 `termination_cause` 區分 `business_assertion_failure`、`operational_budget_exhausted`、`executor_budget_exhausted`、`unsupported_new_page` 等原因。`finalReason` 保留相關斷言理由，最近動作摘要採 allowlist，只輸出工具名、非敏感目標、URL 與成敗狀態，遮蔽輸入文字、按鍵內容、JavaScript、cookie、token 等敏感值。

既有「動作與驗證分離」架構維持不變：Executor 取得目標導向資訊，但最終 PASS/FAIL 判定仍由獨立 `step_asserter` 負責。

## Capabilities

### New Capabilities

無新增 Capability。

### Modified Capabilities

- `e2e-runner`: 強化 Executor 的目標提示、No-Progress Recovery、共用動作回合預算、terminal `done_acting`、分類式失敗收斂、同頁導航回饋、連結資訊、新分頁安全終止與敏感資料遮蔽診斷。

## Impact

- **跨 change 依賴**：`assertion-failure-classification` 必須先提供 `failure_type` state 與 `routeAfterAssertion` 的 business/operational 分流；其現有 artifacts 需另行更新以移除「不改路由」限制。
- **後端提示與狀態機**：
  - `backend/src/graph/prompt.ts`：建立固定的 Action/Objective 權限規則；Objective 本文改由 Human message 傳入。
  - `backend/src/graph.ts`：注入 Objective 與回合資訊、維持跨斷言共用預算、終止同批後續工具、產生策略提示與安全診斷摘要。
  - `backend/src/graph/router.ts`：依結構化失敗分類、剩餘共用預算及 `termination_cause` 路由。
  - `backend/src/state.ts`：新增僅存在於執行態的 `termination_cause`；無資料庫 Schema 變更。
  - `backend/src/graph/noProgress.ts`：集中實作保守的無進展判定、參數 canonicalization、原因優先序與去重規則。
- **瀏覽器工具**：
  - `backend/src/tools.ts`：可靠等待 document/SPA 導航、回報 URL、偵測 popup，並維持 `isToolExecutionFailed` 字串契約。
  - `backend/src/browser.ts`：連結元素輸出 raw href、解析值與可導航性。
- **報告與前端**：`strategy_hint` 沿用現有自由文字 TestLog/SSE 通道；前端預期無功能變更，但需驗證未知 action 值能正常呈現。
- **測試與驗收**：擴充 prompt、router、No-Progress、共用回合、terminal tool、navigation、popup、href 與敏感資料遮蔽測試；URL 與非 URL 固定案例各連跑 3 次皆須成功，且 business FAIL 後不得再有 Executor 工具呼叫。
