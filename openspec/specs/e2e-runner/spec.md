# e2e-runner Specification

## Purpose
端到端執行核心，包含步驟解析、執行佇列、Gemini/OpenAI 多模態決策、observe_web_page 視覺感知標籤貼紙、各操作工具 (click/input/key/hover) 與等待策略、Replay 重放模式、將動作執行（Executor）與步驟預期結果判定（Step Assertion）拆分為獨立狀態機階段的邏輯，以及最後以 reporter 節點取代獨立 Asserter 節點的邏輯。
## Requirements
### Requirement: TS JSON Test Scenario Parsing
系統 MUST 能夠解析符合結構的 JSON 測試劇本檔案（使用 Zod 進行欄位驗證），包含：唯一的 `id`、腳本名稱 `name`、測試步驟清單 `steps` 與預期結果描述 `expected`。

#### Scenario: Parse TS valid test cases
- **WHEN** 系統讀取一個格式正確的 TS JSON 測試劇本
- **THEN** 系統成功解析並初始化測試步驟佇列與預期結果變數

### Requirement: TS Step-by-Step execution queue
系統 MUST 依照測試步驟清單的順序，逐步調度並完成每一個步驟。在步驟 $n$ 成功完成前，不得執行步驟 $n+1$。

#### Scenario: Execute TS steps in sequence
- **WHEN** 系統啟動測試案例
- **THEN** 系統從第一個步驟（$n=1$）開始執行，成功完成後依序前進到下一個步驟，直到所有步驟執行完畢

### Requirement: LLM TS Step Reasoning using Playwright Tools
對於每個步驟，系統 MUST 支援「重放模式 (Replay Mode)」與「LLM 推導模式 (Agent Mode)」的雙軌執行。
- **重放觸發條件**：當全域設定 `enableReplay` 為開啟，且該測試步驟於先前的執行中已有相同測試案例版本（`testcaseVersion`）且成功完成（`passed`）的工具執行日誌（`TestLog`）時，系統 MUST 進入重放模式，依序執行該成功日誌中的工具呼叫，而不發送請求給 LLM。
- **DOM ID 自動保障**：在重放模式下，若即將執行需要 `id` 參數的工具前，或在執行頁面跳轉工具（如 `navigate_to`）後，系統 MUST 確保呼叫 `observeWebPage()` 刷新頁面之 `data-e2e-agent-id` 標記。
- **自我修復判定與無縫交棒**：當重放過程中發生以下任一狀況：
  1. 工具執行拋出例外；
  2. 工具回傳字串包含「失敗」或開頭為「錯誤」；
  3. 等待元素超時超過 2000ms；
  系統 MUST 判定重放失敗並啟動自我修復（Self-healing）：拋棄當前步驟已執行的重放暫存日誌，保留瀏覽器當前畫面現場，將單步重試計數（`step_retry_count`）歸零，呼叫 `observeWebPage()` 重新感知並切換回 LLM 推導模式。由 LLM 根據「當前步驟描述」、「當前網址」、「當前 DOM 結構」與「當前視窗截圖」重新推導合適的動作，並在完成時呼叫 `done_acting`。系統向 LLM 發送提示詞時，MUST 使用結構化全英文的 System Prompt (English Core) 作為角色定義、步驟引導與強烈規則約束，以確保最高的指令遵循率與工具調用精準度。

#### Scenario: Execute TS tool call for step via Replay
- **WHEN** 執行測試步驟時，全域 `enableReplay` 開啟，且該步驟存在相同 `testcaseVersion` 之最新 passed 執行紀錄
- **THEN** 系統依序重放舊有的工具日誌並於操作前確保 DOM ID 存在，完成步驟操作，消耗 0 個 LLM Token

#### Scenario: Bypass Replay on Version Mismatch
- **WHEN** 執行測試步驟時，該測試案例版本已更新（`version` 不等於歷史紀錄之 `testcaseVersion`），或全域 `enableReplay` 為關閉
- **THEN** 系統略過重放模式，直接進入 LLM 推導模式進行決策

#### Scenario: Execute TS tool call for step via Self-healing fallback
- **WHEN** 執行重放時，工具回傳失敗、超時 2000ms 或拋出例外
- **THEN** 系統自動拋棄該步重放暫存日誌，重設單步重試次數，保留瀏覽器現場並由 LLM 重新觀察推導出正確操作，於測試通過後更新成功日誌
### Requirement: observe_web_page tool
系統 MUST 提供 `observe_web_page` 工具，用以擷取網頁中所有可見、可互動的元素（例如按鈕、連結、輸入框、下拉選單），將這些元素標記唯一數字 ID，並回傳格式化後的純文字清單。

#### Scenario: 成功提取可互動元素
- **WHEN** 呼叫 `observe_web_page` 工具
- **THEN** 系統 SHALL 過濾掉隱藏或 `disabled` 的元素，並在剩餘的互動元素上注入 `data-e2e-agent-id` 屬性，回傳包含 `[ID] <tagName> textContent` 格式的元素清單字串。

### Requirement: Visual ID Tag Overlay
系統在 `observe_web_page` 執行過程中，MUST 於網頁畫面上對應元素位置渲染黃底黑字的數字貼紙，以便多模態模型能夠在截圖上直觀看到標籤，並在截圖結束後自動清理該貼紙。

#### Scenario: 渲染與清除視覺貼紙
- **WHEN** 系統執行 observe 流程並擷取畫面
- **THEN** 網頁會短暫呈現 ID 浮動貼紙，完成截圖後，這些貼紙與相關 CSS SHALL 被完全移除，不留下任何殘餘樣式影響原始網頁排版。

### Requirement: Click action tool
系統 MUST 提供基於 ID 的 `click` 工具，支援點擊指定 ID 的元素，並可選宣告非同步等待策略。當無提供 `waitStrategy` 時，點擊後直接回傳結果。

#### Scenario: 使用 ID 進行點擊並等待特定文字出現
- **WHEN** 呼叫 `click` 工具，傳入 `id: 15`，`waitStrategy: "waitForText"` 及 `expectedText: "儲存成功"`
- **THEN** 系統點擊該元素，並在 5 秒內等待網頁畫面上出現 `"儲存成功"` 文本，若超時則拋出對應錯誤提示。

#### Scenario: 使用 ID 進行點擊不附加等待
- **WHEN** 呼叫 `click` 工具，傳入 `id: 8` 且未提供 `waitStrategy`
- **THEN** 系統點擊該元素後立即回傳成功訊息。

### Requirement: Input action tool
系統 MUST 提供基於 ID 的 `input` 工具，支援在指定 ID 的輸入框元素中填入文字。

#### Scenario: 使用 ID 進行文字輸入
- **WHEN** 呼叫 `input` 工具，傳入 `id: 12` 與 `text: "test_username"`
- **THEN** 系統 SHALL 在 `[data-e2e-agent-id="12"]` 元素中填入該文字。

### Requirement: Key action tool
系統 MUST 提供基於 ID 或全域的 `key` 工具，支援模擬鍵盤按鍵事件，並可選附加非同步等待策略。

#### Scenario: 對特定元素按 Enter 鍵並等待換頁
- **WHEN** 呼叫 `key` 工具，傳入 `id: 12`，`key: "Enter"` 及 `waitStrategy: "waitForNavigation"`
- **THEN** 系統 focus 到 `[data-e2e-agent-id="12"]`，發送 `"Enter"` 按鍵，並等待網頁載入狀態進入 `networkidle`。

#### Scenario: 按下特定鍵並等待文字出現
- **WHEN** 呼叫 `key` 工具，傳入 `id: 5`，`key: "Enter"`，`waitStrategy: "waitForText"` 及 `expectedText: "查詢中..."`
- **THEN** 系統 focus 到 `[data-e2e-agent-id="5"]` 元素並發送 `"Enter"` 按鍵，並在 5 秒內等待網頁畫面上出現 `"查詢中..."` 文本。

#### Scenario: 按下鍵盤鍵不附加等待
- **WHEN** 呼叫 `key` 工具，傳入 `key: "Escape"` 且未提供 `waitStrategy`
- **THEN** 系統向目前頁面發送 `"Escape"` 按鍵並立即回傳成功。

### Requirement: Hover action tool
系統 MUST 提供基於 ID 的 `hover` 工具，支援將滑鼠懸停至指定 ID 的元素上。

#### Scenario: 使用 ID 進行懸停操作
- **WHEN** 呼叫 `hover` 工具，傳入 `id: 8`
- **THEN** 系統 SHALL 將滑鼠游標移動至 `[data-e2e-agent-id="8"]` 元素上方。

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

### Requirement: Bypassing Overall Visual Expected Result Check
系統 MUST 廢棄在測試最後的獨立驗證節點（asserterNode），並將成功的測試結果標記與瀏覽器關閉整合至流程終點的 `reporterNode`。

#### Scenario: 測試所有步驟均順利完成
- **WHEN** 測試流程中所有定義的步驟均已被 AI 成功執行且單步預期結果（step_expecteds）均校驗通過，且流程到達 reporterNode
- **THEN** 系統 SHALL 自動將 TestRun 的 finalResult 設為 "PASS"，finalReason 設為 "所有測試步驟均已成功執行完畢。"，並安全關閉 Playwright 瀏覽器實例。

