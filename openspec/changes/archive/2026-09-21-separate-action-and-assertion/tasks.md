## 1. 狀態機與提示詞重構 (State Machine & Prompt Refactoring)

- [x] 1.1 調整 `backend/src/graph/prompt.ts` 中的 `buildExecutorSystemPrompt`，移除要求 Executor 自行負擔 `Step Expected Outcome` 斷言與等待之約束，專注於動作調用並於完成後呼叫 `done_acting`，執行單元測試驗證提示詞輸出。
- [x] 1.2 在 `backend/src/graph/prompt.ts` 中新增 `buildStepAsserterPrompt` 與 `StepAssertionSchema`，提供步驟預期結果的結構化視覺斷言支援，並驗證 schema 與 prompt 格式。
- [x] 1.3 更新 `backend/src/graph/router.ts`：修改 `routeAfterExecution`，當 `done_acting` 觸發時流轉至 `step_asserter`；新增 `routeAfterAssertion` 條件路由器以處理斷言通過（推進步驟）、重試（返回 executor）與失敗超限（導向 reporter），並透過單元測試驗證路由邏輯。

## 2. 模型斷言與節點實作 (Model Assertion & Node Implementation)

- [x] 2.1 於 `backend/src/graph.ts` 中實作 `stepAsserterNode` 的頁面證據蒐集，將 DOM 與目前畫面提供給 Asserter，並以測試驗證非空 `stepExpected` 不會觸發 URL、整句文字或前綴解析等本地斷言分流。
- [x] 2.2 於 `stepAsserterNode` 中對每個非空 `stepExpected` 調用模型進行結構化 PASS/FAIL + reason 判定，正確計算與紀錄 Token 消耗，並以單元測試驗證 PASS 與 FAIL 結果。
- [x] 2.3 實作斷言失敗之反饋回圈：斷言未通過時在 `state.logs` 寫入失敗原因，遞增 `step_retry_count`，使下一輪 `executorNode` 能在 `Execution History` 中讀取具體失敗回饋。

## 3. 圖結構組裝與 Replay 自我修復串接 (Graph Wiring & Replay Integration)

- [x] 3.1 於 `E2EGraphBuilder.buildGraph()` 中註冊 `step_asserter` 節點與相應的條件邊（`routeAfterExecution` 與 `routeAfterAssertion`），確保完整執行鏈路串接。
- [x] 3.2 串接 Replay 重放流程：確保重放模式執行完工具歷史動作後，同樣流轉至 `step_asserterNode` 進行斷言檢核，並在斷言失敗時啟動 Self-healing 切換回 LLM 推導。

## 4. 單元測試與回歸驗證 (Testing & Verification)

- [x] 4.1 更新與擴充 `backend/tests/graph.test.ts`，新增 `step_asserter` 路由與 Prompt 測試案例，執行 `npm test` 確認通過。
- [x] 4.2 撰寫斷言引擎單元測試，覆蓋無 expected 直接通過、所有非空 expected 一律呼叫模型、模型判定通過、未通過重試循環與重試超限中斷情境。
- [x] 4.3 執行後端完整測試套件（`npm test`），確保既有測試案例與重放邏輯皆能正常通過。
- [x] 4.4 修正 OpenAI-compatible／LiteLLM 回傳 `parsed: null` 時的步驟斷言解析，保留 raw response 與 Token 診斷資訊，並以回歸測試覆蓋 raw tool call、raw JSON content 與不可解析回應。
- [x] 4.5 拆分動作輪次與斷言重試計數：新增 `executor_turn_count`（執行節點每輪遞增，上限 5 次，超限導向 reporter），`step_retry_count` 僅由 `stepAsserterNode` 於 FAIL 時遞增（上限 5 次），並於步驟推進／斷言失敗回饋時各自重置，避免 Executor 無限循環或計數互斥。
