## Why

斷言失敗（`step_asserter` 判定 FAIL）導回 `executor` 重試時，失敗回饋會以模型產生的自然語言原文（`step_assertion_reason`）混入該步驟的 Execution History，且與動作結果共用同一個「Result/Feedback」欄位。執行器無從分辨「動作未完成、該補救」與「動作已完成但結果與預期不符、該收手」這兩種本質不同的失敗——於是傾向將任何 FAIL 解讀為「任務沒做完」，追加動作企圖讓畫面符合預期，導致「應該失敗的案例被修正成成功」的過度修正問題。

此外，`separate-action-and-assertion`（2026-09-11）的提案已點出「操作性失敗 vs 業務性斷言失敗」的錯誤歸因需求，但至今只在語言層提及，未落地為可程式判讀的訊號。

## What Changes

- **斷言失敗分類欄位**：`StepAssertionSchema` 新增 `failure_type` 欄位（`business` | `operational`），並於 `buildStepAsserterPrompt` 明確要求模型在 FAIL 時一併標記分類（保持純模型語意，不引入本地字串解析）。
  - `business`：動作已完成，但頁面結果與 `stepExpected` 不符（預期的失敗型結果或業務性落差）——執行器應收手，不得追加動作翻轉失敗狀態。
  - `operational`：動作可能未完成或執行的操作層障礙（如元素動態變化、等待失效）——執行器可重新觀察/補救。
- **Execution History 語意分流**：`executorNode` 組裝該步驟 Execution History 時，將 `assert_failure` 回饋依 `failure_type` 分流語意——`business` 附加「此為步驟預期結果未被滿足之失敗，完成要求的動作後請直接呼叫 `done_acting`，不得追加以改變失敗狀態」；`operational` 維持「動作可能未完成，可重新觀察或補救」。
- **展示與診斷**：`failure_type` 寫入 `step_assertion_reason` 對應的 log，供報告與除錯引用，不改變既有 PASS/FAIL 路由與重試計數。

## Capabilities

### New Capabilities

無新增 capability。

### Modified Capabilities

- `e2e-runner`: 修改步驟斷言（step_asserter）失敗回饋的行為規範—— FAIL 結果新增結構化分類（business/operational），並規範 executor 的 Execution History 依分類分流語氣，使「失敗型預期未滿足」不再被執行器嘗試修正成成功。

## Impact

- **後端核心 (`backend/src/graph.ts`)**：
  - `stepAsserterNode`：讀取模型回傳之 `failure_type`，於 `step_assertion_reason` log 中保留分類資訊。
  - `executorNode`：組裝該步驟 Execution History 時依 `failure_type` 分流 `assert_failure` 回饋語意。
- **提示詞體系 (`backend/src/graph/prompt.ts`)**：
  - `StepAssertionSchema` 新增 `failure_type` 欄位與 zod 定義。
  - `buildStepAsserterPrompt` 增加分類指示與對應規則。
- **執行狀態 (`backend/src/state.ts`)**：若不透傳 `failure_type` 至 state，則維持既有欄位；分類僅存在於 log 語意與 `step_assertion_reason` 推導——實作時確認最小改動面。
- **相容性保證**：不變更 PASS/FAIL 判定、不變更 `routeAfterAssertion` 路由、不變更 `executor_turn_count`/`step_retry_count` 計數、不變更前端 UI 與資料庫 Schema。舊日誌（無 `failure_type`）以 `operational` 預設處理，行為與現行一致。