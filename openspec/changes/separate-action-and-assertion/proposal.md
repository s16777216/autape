## Why

在目前的測試執行狀態機架構中，步驟執行（Executor）與步驟預期結果判定（Step Expected Outcome）高度耦合在同一個 `executor` 節點內。Executor 既負責呼叫 Playwright 工具進行網頁操作，又被要求自行檢驗畫面狀態並宣告 `done_acting`，形成「球員兼裁判」的設計。這導致多個實務問題：
1. **可靠性與防禦力不足**：若模型產生幻覺或動作未正確產生預期效果，只要 Executor 呼叫 `done_acting`，步驟即被無條件標記為 `passed`。
2. **重放（Replay）失去回歸檢驗能力**：重放模式僅重放工具歷史日誌，在缺乏獨立驗證的情況下，若待測系統因改版發生功能回歸（Regression Bug），重放仍然可能盲目通過。
3. **錯誤歸因模糊**：系統無法清晰界定「操作性失敗（如找不著元素）」與「業務性斷言失敗（操作已完成但畫面結果與預期不符）」。

因此，本提案採用「方案 A：執行狀態機內部拆分」，在維持現有測試案例資料模型（`TestcaseStep` 的 `action` 與 `expected`）與前端 UI 不變的前提下，於狀態機中獨立劃分「動作執行（Executor）」與「預期結果驗證（Step Asserter）」節點。Step Asserter 一律由模型結合頁面 DOM 與視覺畫面理解自然語言預期，不以本地字串規則猜測斷言意圖。

## What Changes

- **狀態機節點拆分**：在 LangGraph 狀態機中引入獨立的 `step_asserter` 節點。`executor` 專注於執行操作工具（點擊、輸入、導航等），在動作完成宣告 `done_acting` 後，流轉至 `step_asserter` 節點而非直接前進至 `step_tracker`。
- **純模型語意斷言**：若步驟設定了 `stepExpected`，`step_asserter` 一律將自然語言預期、頁面 DOM 與目前畫面交由模型，輸出結構化 PASS/FAIL 與理由；不解析 `text:`／`url:` 前綴，也不以 URL 特徵或整句 `getByText` 等本地啟發式規則預判。
- **斷言回饋與重試循環**：若斷言未通過且單步重試次數未達上限，斷言器將生成具體失敗回饋，將狀態重新導回 `executor` 重新觀察或補救操作；若重試超限則導向 `reporter` 標記步驟失敗。
- **Prompt 與規則清理**：更新 `buildExecutorSystemPrompt`，移除要求 Executor 自行承擔預期結果驗證的束縛，讓 Executor 工具調用更為輕量專注。

## Capabilities

### New Capabilities
<!-- 無新增獨立 capability -->

### Modified Capabilities
- `e2e-runner`: 修改測試步驟執行規範，將單步流程拆解為「動作執行（Executor）」與「結果斷言（Step Asserter）」獨立階段，定義純模型語意／視覺驗證機制，並規範斷言失敗時的回饋與重試路由器。

## Impact

- **後端狀態機核心 (`backend/src/graph.ts` & `backend/src/graph/router.ts`)**：
  - 新增 `step_asserterNode`，更新條件路由 `routeAfterExecution` 與新增 `routeAfterAssertion`。
  - 更新 LangGraph 圖結構：`executor` -> `routeAfterExecution` (包含流向 `step_asserter` 或自循環)。
- **提示詞體系 (`backend/src/graph/prompt.ts`)**：
  - 調整 `buildExecutorSystemPrompt`，專注於動作完成宣告。
  - 新增或調整步驟級斷言提示詞 `buildStepAsserterPrompt`。
- **執行狀態 (`backend/src/state.ts`)**：
  - 狀態機中記錄斷言結果與反饋訊息，傳遞至重試迴圈或 TestLog。
- **相容性保證**：
  - 前端步驟 UI、API 介面、資料庫實體（`TestcaseStep`）皆保持向下相容，既有腳本無需遷移。
