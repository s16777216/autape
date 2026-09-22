## ADDED Requirements

### Requirement: Executor Step Objective Guidance
系統 MUST 在 Executor 的決策上下文中提供非權威的 Step Objective，並以固定規則明定 Step Action 的權限高於 Step Objective。Step Objective 只能協助消除目標元素、目的地或動作方向的歧義，MUST NOT 改寫 Step Action、要求未由 Step Action 指定的追加操作，亦 MUST NOT 授予 Executor 自行判定 PASS/FAIL 的權力。Step Objective SHALL 置於 Human message 的明確資料區塊；系統不得對其內容進行 URL、前綴或其他格式特徵解析。內容超過 500 個 Unicode 字元時，系統 SHALL 保留前 350 與後 150 個字元，並在中間加入省略標記。

#### Scenario: Action 與 Objective 衝突時以 Action 為準
- **WHEN** Step Objective 暗示的結果可能透過改變 Step Action、輸入值或追加操作達成
- **THEN** Executor SHALL 忠實執行 Step Action，且不得為迎合 Step Objective 而改變或追加操作

#### Scenario: Objective 只作為 Human message 中的目標參考
- **WHEN** 當前步驟具有非空白的 `stepExpected`
- **THEN** 系統 SHALL 將其作為 Step Objective 放入 Human message 的資料區塊，並由 System 規則聲明其非權威性及獨立 Asserter 的最終判定權

#### Scenario: 長 Objective 保留開頭與結尾
- **WHEN** Step Objective 超過 500 個 Unicode 字元
- **THEN** 系統 SHALL 呈現前 350 與後 150 個字元，並在兩者之間標示內容已省略

#### Scenario: 無 Objective 時維持既有行為
- **WHEN** 當前步驟未設定 `stepExpected` 或其內容為空白
- **THEN** Executor 的 Human message SHALL NOT 包含 Step Objective 資料區塊

### Requirement: Conservative No-Progress Recovery
系統 MUST 僅依執行行為偵測 Executor 無進展，且僅允許 `all_tools_failed` 與 `repeated_side_effect` 兩種原因。`all_tools_failed` 表示該輪至少呼叫一個工具且全部依共同工具失敗契約判定為失敗；`repeated_side_effect` 表示相鄰 Executor rounds 在沒有介入之不同成功副作用動作時，重複相同副作用工具及其 canonicalized 完整參數。`observe_web_page`、`wait_for_seconds`、`done_acting`、斷言日誌與 `strategy_hint` MUST NOT 參與重複比較。系統 MUST NOT 以累計日誌數或尚未呼叫 `done_acting` 單獨判定無進展。

命中時系統 SHALL 產生最多一筆 `strategy_hint`，固定以 `all_tools_failed` 優先於 `repeated_side_effect`。該提示 MUST 持久化並可由下一輪 Execution History 讀取，但 MUST NOT 參與工具失敗判定、動作數量、回合預算、重複比較或路由判斷；相同原因不得連續重複寫入。

#### Scenario: 本輪工具全部失敗
- **WHEN** 一個 Executor round 至少呼叫一個工具且所有工具結果皆符合共同失敗契約
- **THEN** 系統 SHALL 寫入一筆原因為 `all_tools_failed` 的 `strategy_hint`

#### Scenario: 重複相同副作用工具
- **WHEN** 相鄰 Executor rounds 重複呼叫具相同工具名與 canonicalized 完整參數的副作用工具，且中間沒有不同的成功副作用動作
- **THEN** 系統 SHALL 寫入一筆原因為 `repeated_side_effect` 的 `strategy_hint`

#### Scenario: 觀察或等待工具重複不算無進展
- **WHEN** 相鄰回合僅重複 `observe_web_page` 或 `wait_for_seconds`
- **THEN** 系統 SHALL NOT 以 `repeated_side_effect` 為由產生策略提示

#### Scenario: 多個原因同輪命中
- **WHEN** 同一輪同時符合全部工具失敗與重複副作用動作
- **THEN** 系統 SHALL 僅寫入一筆原因為 `all_tools_failed` 的策略提示

#### Scenario: 策略提示不自我觸發
- **WHEN** 既有日誌包含 `strategy_hint` 或斷言回饋
- **THEN** 該等合成日誌 SHALL NOT 被無進展偵測器計入或比較

### Requirement: Shared Executor Round Budget and Terminal Handoff
每個測試步驟 MUST 共用最多 5 個 Executor rounds，且 Asserter 判定失敗後不得重置此預算。一次 LLM Executor 決策 SHALL 計為一輪，不論該輪產生多少工具呼叫；Replay、Asserter 與純框架處理 SHALL NOT 計入。每輪決策提示 MUST 顯示已使用與剩餘回合數。`done_acting` MUST 是 terminal tool：同批工具呼叫依序執行至 `done_acting` 後即停止，其後工具不得執行，並應將流程交給 Asserter。

#### Scenario: 斷言失敗不重置回合預算
- **WHEN** Executor 已使用部分回合後呼叫 `done_acting`，且 Asserter 判定為可補救的 operational failure
- **THEN** 返回 Executor 時 SHALL 保留已使用回合數，只能使用該步驟剩餘的共用預算

#### Scenario: 一次決策包含多個工具仍只算一輪
- **WHEN** 一次 LLM Executor 決策產生多個工具呼叫
- **THEN** 系統 SHALL 將該次決策計為一個 Executor round

#### Scenario: done_acting 終止同批後續工具
- **WHEN** 一批工具呼叫在 `done_acting` 後仍包含其他工具
- **THEN** 系統 SHALL 記錄 `done_acting`、停止執行其後工具並路由至 Asserter

#### Scenario: 最後一輪仍先進行斷言
- **WHEN** Executor 在第 5 輪呼叫 `done_acting`
- **THEN** 系統 SHALL 先路由至 Asserter，而非直接以回合耗盡終止

### Requirement: Classified Failure Convergence
系統 MUST 使用 `assertion-failure-classification` 所提供的結構化失敗分類決定是否允許 Executor 補救。`business` failure MUST 直接進入 reporter，且其後不得再有 Executor 工具呼叫；`operational` failure 僅在該步驟尚有共用 Executor round 預算時得返回 Executor，否則 MUST 進入 reporter。

#### Scenario: Business failure 立即收斂
- **WHEN** Asserter 回傳 FAIL 且 `failure_type` 為 `business`
- **THEN** 系統 SHALL 直接路由至 reporter，並且不得再呼叫 Executor

#### Scenario: Operational failure 尚有預算
- **WHEN** Asserter 回傳 FAIL、`failure_type` 為 `operational` 且該步驟仍有 Executor round 預算
- **THEN** 系統 SHALL 返回 Executor 並保留已使用回合數

#### Scenario: Operational failure 預算耗盡
- **WHEN** Asserter 回傳 FAIL、`failure_type` 為 `operational` 且該步驟已用盡 5 個 Executor rounds
- **THEN** 系統 SHALL 直接路由至 reporter

### Requirement: Reliable Navigation and Link Feedback
當 `click` 使用 `waitForNavigation` 時，系統 MUST 在點擊前記錄原 URL 並註冊導航監測，支援同一分頁的 document navigation 與 SPA URL 變更；成功後 MUST 回報實際 URL。若等待逾時，系統 MUST 依共同工具失敗契約回報逾時及當前 URL。`observe_web_page` 對連結元素 SHALL 同時提供原始 href、解析後 href 與是否可直接導航；只有 `http:` 與 `https:` SHALL 標示為可供 `navigate_to` 使用。

#### Scenario: Document navigation 完成後回報 URL
- **WHEN** `click(waitForNavigation)` 觸發同分頁 document navigation
- **THEN** 系統 SHALL 等待該導航完成並回報導航後實際 URL

#### Scenario: SPA URL 變更後回報 URL
- **WHEN** `click(waitForNavigation)` 觸發同分頁 SPA route change
- **THEN** 系統 SHALL 偵測 URL 已相對點擊前改變，等待設定的穩定條件並回報新 URL

#### Scenario: 宣告等待導航但未發生導航
- **WHEN** `click(waitForNavigation)` 在期限內未觀察到同分頁導航或 URL 變更
- **THEN** 系統 SHALL 回報符合共同失敗契約的逾時結果及當前 URL

#### Scenario: 連結回傳 raw 與解析資訊
- **WHEN** `observe_web_page` 發現具有 href 的連結元素
- **THEN** 元素資訊 SHALL 包含原始 href、解析後 href 與可導航標記，且只有 HTTP(S) 連結可標示為可直接導航

#### Scenario: 點擊開啟未支援的新分頁
- **WHEN** 點擊觸發 popup 或 `target=_blank` 新分頁
- **THEN** 系統 SHALL 停止重試該點擊，以 `unsupported_new_page` 終止，並保留 popup URL 供診斷

### Requirement: Structured and Redacted Failure Diagnostics
系統 MUST 以結構化 `termination_cause` 記錄失敗流程的實際終止原因，至少涵蓋 `business_assertion_failure`、`operational_budget_exhausted`、`executor_budget_exhausted` 與 `unsupported_new_page`。Reporter MUST 依原因產生對應 `finalReason`；business failure MUST 保留 Asserter 的原始理由。最近動作摘要 MUST 僅包含最近 5 個真實工具動作的 allowlist 資訊，包括工具名、非敏感目標識別、URL 與成功／失敗狀態；輸入文字、按鍵內容、JavaScript、cookie、token 與其他憑證 MUST 被遮蔽。`strategy_hint` 與 assertion reason SHALL 分區呈現，不得混算為最近工具動作。

#### Scenario: Business failure 保留斷言理由
- **WHEN** 測試因 `business_assertion_failure` 終止
- **THEN** `finalReason` SHALL 清楚標示終止原因並包含 Asserter 的原始失敗理由

#### Scenario: 預算耗盡產生安全動作摘要
- **WHEN** 測試因 Executor 或 operational 補救預算耗盡而終止
- **THEN** `finalReason` SHALL 包含最多 5 個經 allowlist 與遮蔽處理的真實工具動作摘要

#### Scenario: 敏感工具參數不得進入 finalReason
- **WHEN** 最近工具動作包含 input 文字、按鍵內容、JavaScript、cookie、token 或憑證
- **THEN** `finalReason` MUST NOT 包含其原始值
