## MODIFIED Requirements

### Requirement: Executor-level Step Expected Result Validation
系統 MUST 將「動作執行（Executor）」與「步驟預期結果判定（Step Assertion）」拆分為狀態機中之獨立階段。
Executor 節點專注於調用 Playwright 操作工具執行步驟內容，並在完成動作後呼叫 `done_acting`。
狀態機在收到 `done_acting` 後，MUST 流轉至獨立的 `step_asserter` 節點執行預期結果驗證，而非由 Executor 自行直接核准通過。
若該步驟未提供 `stepExpected`，`step_asserter` 節點 SHALL 直接判定為通過並推進至 `step_tracker`；
若該步驟提供 `stepExpected`，`step_asserter` MUST 一律將自然語言預期、目前頁面 DOM 與視覺畫面交由模型進行語意判定，並取得結構化的 PASS/FAIL 與理由。系統 MUST NOT 以 `text:`／`url:` 前綴、URL 字串特徵、整句文字查找或其他本地啟發式規則解析 `stepExpected`；一般自然語言與任何字串格式皆走相同的模型審核路徑。
若驗證不通過且未達重試上限，系統 MUST 產生失敗反饋理由並將流程導回 `executor` 重試；若超過重試上限則判定步驟失敗並導向 `reporter`。

#### Scenario: 步驟執行完成後直接推進
- **WHEN** AI E2E Agent 在步驟中呼叫 `done_acting` 且當前步驟無額外 `stepExpected` 或已通過 `step_asserter` 驗證
- **THEN** 狀態機 SHALL 將該步驟狀態標記為 `passed`，並自動推進至下一個步驟。

#### Scenario: 點擊後等待 Toast 出現
- **WHEN** 當前步驟有預期結果為 "出現錯誤訊息：帳號或是密碼錯誤" 且 AI 執行操作後宣告 `done_acting`
- **THEN** `step_asserter` 節點將自然語言預期、頁面 DOM 與視覺畫面交由模型審核，模型確認 Toast 所表達的結果符合預期並回傳 PASS 後推進至下一個步驟。

#### Scenario: 不以字串格式觸發隱性斷言規則
- **WHEN** `stepExpected` 是一般自然語言、包含 URL 片段，或看似可直接用頁面文字查找的描述
- **THEN** `step_asserter` SHALL 對所有格式採用相同的模型語意審核流程，不得先執行 URL 或整句文字的本地推測式比對。

#### Scenario: 步驟預期結果未達成時啟動回饋重試
- **WHEN** 當前步驟設定有 `stepExpected` 但驗證未通過，且單步重試次數尚未超過上限
- **THEN** `step_asserter` 節點記錄驗證失敗日誌與具體反饋，將單步重試計數加 1，並將狀態機路由回 `executor` 節點重新觀察並修正操作。

#### Scenario: 步驟預期結果重試超限判定失敗
- **WHEN** 當前步驟預期結果驗證持續未通過且重試次數達到上限
- **THEN** 狀態機路由至 `reporter` 節點，標記步驟為 failed 並生成失敗總結與截圖。
