## ADDED Requirements

### Requirement: Assertion Failure Classification
當步驟預期結果驗證判定為 FAIL 時，系統 MUST 產生結構化 `failure_type`，值為 `business` 或 `operational`。`business` 表示 Step Action 已完成但目前頁面狀態與 `stepExpected` 不符；`operational` 表示 Step Action 可能未完成或存在操作層障礙。分類 MUST 由 Asserter 模型基於目前頁面 DOM、視覺證據、Step Action 與 `stepExpected` 產生，系統 MUST NOT 以本地字串規則或計數器推定分類。若模型未提供分類、供應商 response 缺少欄位或解析發生例外，系統 SHALL 預設為 `operational`。PASS 結果 MUST 清除先前的 failure type，避免跨斷言或跨步驟殘留。FAIL 日誌 SHALL 同時保留分類與 Asserter 原始理由。

#### Scenario: 動作完成但結果不符時分類為 business
- **WHEN** Asserter 判定 Step Action 已完成，但可觀察頁面結果不符合 `stepExpected`
- **THEN** Asserter SHALL 回傳 FAIL、`failure_type: business` 與基於頁面證據的原始理由

#### Scenario: 動作可能未完成時分類為 operational
- **WHEN** Asserter 判定結果不符可能來自元素變動、等待失效、操作未生效或其他操作層障礙
- **THEN** Asserter SHALL 回傳 FAIL、`failure_type: operational` 與基於頁面證據的原始理由

#### Scenario: 缺少分類時採 operational 預設
- **WHEN** FAIL response 未帶 `failure_type`、使用舊版 response shape 或解析分類時發生例外
- **THEN** 系統 SHALL 將該失敗視為 `operational`，不得因缺少資訊而直接終止可補救流程

#### Scenario: PASS 清除舊 failure type
- **WHEN** Asserter 回傳 PASS，或步驟沒有 `stepExpected` 而直接通過
- **THEN** 系統 SHALL 將目前步驟的 assertion failure type 清為空值

#### Scenario: Assertion log 保留分類與原始理由
- **WHEN** Asserter 回傳 FAIL
- **THEN** 系統 SHALL 在 assertion log 中保存 `failure_type` 與未改寫的 Asserter reason，供路由與診斷使用

## MODIFIED Requirements

### Requirement: Executor-level Step Expected Result Validation
系統 MUST 將「動作執行（Executor）」與「步驟預期結果判定（Step Assertion）」拆分為狀態機中之獨立階段。
Executor 節點專注於調用 Playwright 操作工具執行步驟內容，並在完成動作後呼叫 `done_acting`。
狀態機在收到 `done_acting` 後，MUST 流轉至獨立的 `step_asserter` 節點執行預期結果驗證，而非由 Executor 自行直接核准通過。
若該步驟未提供 `stepExpected`，`step_asserter` 節點 SHALL 直接判定為通過並推進至 `step_tracker`；
若該步驟提供 `stepExpected`，`step_asserter` MUST 一律將自然語言預期、目前頁面 DOM 與視覺畫面交由模型進行語意判定，並取得結構化的 PASS/FAIL 與理由。系統 MUST NOT 以 `text:`／`url:` 前綴、URL 字串特徵、整句文字查找或其他本地啟發式規則解析 `stepExpected`；一般自然語言與任何字串格式皆走相同的模型審核路徑。

當 Asserter 回傳 PASS 時，系統 MUST 推進至 `step_tracker`。當 Asserter 回傳 FAIL 且 `failure_type` 為 `business` 時，系統 MUST 記錄 `business_assertion_failure` 終止原因並直接路由至 `reporter`，其後不得再呼叫 Executor。當 FAIL 的 `failure_type` 為 `operational` 或分類缺失時，只有在該步驟仍有 Executor round 預算時才 SHALL 返回 Executor 補救；若預算耗盡，系統 MUST 記錄 `operational_budget_exhausted` 並路由至 `reporter`。

#### Scenario: 步驟執行完成後直接推進
- **WHEN** AI E2E Agent 在步驟中呼叫 `done_acting`，且當前步驟無額外 `stepExpected` 或已通過 `step_asserter` 驗證
- **THEN** 狀態機 SHALL 將該步驟狀態標記為 `passed`，並自動推進至下一個步驟

#### Scenario: 點擊後等待 Toast 出現
- **WHEN** 當前步驟有預期結果為「出現錯誤訊息：帳號或是密碼錯誤」，且 AI 執行操作後宣告 `done_acting`
- **THEN** `step_asserter` 將自然語言預期、頁面 DOM 與視覺畫面交由模型審核，模型確認 Toast 所表達的結果符合預期並回傳 PASS 後推進至下一個步驟

#### Scenario: 不以字串格式觸發隱性斷言規則
- **WHEN** `stepExpected` 是一般自然語言、包含 URL 片段，或看似可直接用頁面文字查找的描述
- **THEN** `step_asserter` SHALL 對所有格式採用相同的模型語意審核流程，不得先執行 URL 或整句文字的本地推測式比對

#### Scenario: Business failure 立即終止且不得回流 Executor
- **WHEN** `step_asserter` 回傳 FAIL 且 `failure_type` 為 `business`
- **THEN** 狀態機 SHALL 記錄 `business_assertion_failure`、直接路由至 `reporter`，且在該失敗之後不得再產生 Executor 工具呼叫

#### Scenario: Operational failure 尚有動作預算時補救
- **WHEN** `step_asserter` 回傳 FAIL、`failure_type` 為 `operational`，且該步驟仍有 Executor round 預算
- **THEN** 狀態機 SHALL 保留 Asserter 原始理由與已使用回合數，並路由回 Executor 重新觀察及補救操作

#### Scenario: Operational failure 動作預算耗盡
- **WHEN** `step_asserter` 回傳 FAIL、`failure_type` 為 `operational`，且該步驟的 Executor round 預算已耗盡
- **THEN** 狀態機 SHALL 記錄 `operational_budget_exhausted` 並路由至 `reporter`

#### Scenario: 無分類失敗沿用 operational 路徑
- **WHEN** `step_asserter` 回傳 FAIL 但未提供可解析的 `failure_type`
- **THEN** 系統 SHALL 將其視為 operational failure，依剩餘 Executor round 預算決定補救或終止
