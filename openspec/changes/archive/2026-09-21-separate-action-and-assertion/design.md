## Context

在目前的系統架構中，端到端測試執行的核心為 `backend/src/graph.ts` 中的 `E2EGraphBuilder`。目前狀態機的圖結構為：
`START` -> `init` -> `executor` -> (條件邊 `routeAfterExecution`) -> `step_tracker` 或 `executor` 或 `reporter`。
當前若步驟宣告 `done_acting`，`routeAfterExecution` 便無條件將狀態流轉至 `step_tracker`，導致缺乏獨立於操作者之外的預期結果客觀驗證機制（參見 `proposal.md` - Why）。

本設計在不更動既有資料庫 Schema（`TestcaseStep` 實體）與前端 UI 介面的前提下，重構狀態機拓撲結構，將預期結果驗證抽離為獨立的 `step_asserter` 節點，並以純模型語意審核自然語言預期。

## Goals / Non-Goals

**Goals:**
- **解耦狀態機節點職責**：`executorNode` 專職負責網頁操作與工具調用；`stepAsserterNode` 專職負責檢核畫面是否達成步驟預期結果（`stepExpected`）。
- **實作一致的模型語意斷言**：所有非空 `stepExpected` 都由模型結合 DOM 與視覺畫面判定，不依賴字串格式或本地推測規則。
- **強化回歸防護與 Replay 自我修復**：重放模式在重放歷史動作後，同樣需經由 `step_asserter` 驗證，若畫面未符合預期則觸發 Self-healing 切換回 LLM 推導。
- **維持 100% 向下相容**：現有測試案例設定、API 介面、日誌串流協定均無縫相容。

**Non-Goals:**
- 不拆分前端的「測試步驟」UI 為獨立的「動作清單」與「斷言清單」（此為方案 B 範疇）。
- 不變更全域測試案例最後的報告總結（`reporterNode` 之 `failureSummary` 保持既有行為）。

## Decisions

### 1. 狀態機拓撲重構（Graph Topology）
- **節點遷移**：
  - `init` -> `executor`
  - `executor` -> (透過 `routeAfterExecution`)：
    - 若上一動作包含 `done_acting` -> 流轉至 `step_asserter`。
    - 若 `executor_turn_count` 超限 (>= 5) -> 流轉至 `reporter`（防 Executor 無限動作循環）。
    - 其餘情況（工具執行後需繼續操作）-> 自循環回 `executor`。
  - `step_asserter` -> (透過新條件路由 `routeAfterAssertion`)：
    - 斷言成功（或步驟無 `stepExpected`）-> 流轉至 `step_tracker` 推進步驟。
    - 斷言失敗且重試次數未達上限 -> 流轉回 `executor` 進行補救操作。
    - 斷言失敗且重試次數超限 -> 流轉至 `reporter` 標記失敗。
- **替代方案評估**：
  - *替代方案*：讓 Executor 在 `done_acting` 之前呼叫專用的 `assert_outcome()` 工具。
  - *否決理由*：這仍由 Executor 決定何時調用以及是否調用，並未真正消除「球員兼裁判」的問題，模型依然可能遺漏調用。

### 2. 純模型語意斷言（Model-only Semantic Assertion）
在 `step_asserterNode` 中採用單一路徑：
1. 提取 `stepExpected`；若為空，直接通過（PASS），不呼叫模型。
2. 若非空，擷取目前頁面 DOM 與視覺畫面，連同 `stepExpected` 傳給 Asserter prompt。
3. 模型依可觀察到的頁面證據回傳結構化二元判定（PASS/FAIL + reason）；節點記錄結果與模型 Token 用量。
4. 不支援 `text:`／`url:` 等斷言 DSL，也不依字串是否像網址、是否包含頁面文字等特徵切換執行路徑。這確保任意自然語言預期都具有一致且可解釋的處理方式。
- **替代方案評估**：
  - *替代方案*：提供顯式 `text:`／`url:` 前綴走 Playwright 確定性比對，其餘自然語言交給模型。
  - *否決理由*：雖然可降低部分 Token 與延遲，但會引入另一套使用者需學習的斷言語法與分流行為。本次決策優先維持單一、無本地解析規則的自然語言契約。

### 3. 反饋導向的補救重試（Remedial Retry Loop）
- 當斷言失敗時，`step_asserterNode` 將產生一筆失敗日誌：
  - `action`: `assert_failure`
  - `result`: `斷言未通過：[具體原因]`
- 將 `step_retry_count` 遞增（**僅由 `stepAsserterNode` 於 FAIL 時遞增，Executor 不再觸及**），並重新路由至 `executorNode`。
- `executorNode` 的 `Execution History for the Current Step` 機制會將此失敗日誌呈現給模型，使 Agent 知道：「上一個動作雖然自認完成，但預期結果『${stepExpected}』尚未出現」，從而採取重試、重新點擊或等待操作。
- **計數器職責分離**：`executor_turn_count` 專門計算 Executor 尚未宣告 `done_acting` 前的動作輪次（每次 Executor 執行 +1），上限 5 次，超限導向 `reporter`，防止無限動作循環；`step_retry_count` 專門計算斷言失敗重試次數，上限 5 次，超限導向 `reporter`，防止無限補救循環。兩者在步驟推進（`step_tracker`）時各自歸零。

### 4. 重放模式（Replay Mode）的天然適配
- 在重放模式下，Executor 依序重放動作並發出 `done_acting`。
- 接著自然流轉至 `step_asserter`。
- 若被測系統正常，模型根據重放後的 DOM 與視覺畫面確認預期；只要步驟具有 `stepExpected`，重放也會產生模型呼叫與 Token 用量。
- 若被測系統改版或出現 Bug，`step_asserter` 攔截失敗，立即將控制權移交給 LLM 推導模式（Self-healing），實現真正具備防禦力的回歸測試。

## Risks / Trade-offs

- **[Risk] 每個非空預期都呼叫模型，增加延遲與 Token 成本**
  - → *Mitigation*：只在 `stepExpected` 非空時呼叫模型，並記錄每次斷言的 Token 用量，讓成本可觀測；本次設計明確接受此成本以換取一致語意。
- **[Risk] 動態載入時畫面證據尚未穩定，造成模型過早判定失敗**
  - → *Mitigation*：提供 DOM 與視覺畫面兩種互補證據，並沿用斷言失敗回饋與單步重試機制處理短暫狀態。
- **[Risk] 使用者輸入的預期結果過於主觀（例如「畫面看起來很舒服」）**
  - → *Mitigation*：Asserter prompt 要求模型僅依可觀察證據說明 PASS/FAIL 理由；無法由頁面證據支持時不得臆測通過。
- **[Risk] 模型在重試迴圈中反覆嘗試無效操作**
  - → *Mitigation*：拆分為兩道獨立防線——`executor_turn_count >= 5` 防止 Executor 單次補救中無限動作（每輪 +1，`done_acting` 後由 `stepAsserter` 歸零），`step_retry_count >= 5` 防止斷言失敗無限重試（僅由 `stepAsserter` 於 FAIL 時 +1，步驟推進時歸零）。兩者均超限時強制中斷並交由 `reporterNode` 產出失敗診斷。
