## Context

現行狀態機為 `init → executor → (routeAfterExecution) → step_asserter | executor | reporter`。`step_expecteds` 已存在於 `TestState` 並由 Queue 初始化，但 Executor 的決策上下文未包含步驟目標，因此在錯誤頁面上缺少導正資訊。失敗軌跡 run `dc041b0b` 顯示，Executor 在 example.com 點錯連結後於錯誤頁面重複嘗試，最終只留下回合超限的粗略原因。

現行實作另有四項會放大問題的限制：

1. `stepAsserterNode` 在每次斷言後把 `executor_turn_count` 重設為 0；搭配最多 5 次斷言重試，單一步驟最壞可產生約 25 個 Executor rounds。
2. `routeAfterExecution` 只檢查全域最後一筆 log 是否包含 `done_acting`；當同一批 tool calls 在 `done_acting` 後仍有其他工具時，終止訊號可能失效，後續工具也會繼續執行。
3. `click(waitForNavigation)` 使用的 `waitForLoadState("networkidle")` 可能在點擊前已經滿足，不能保證回傳的是導航後 URL，也未涵蓋 SPA URL 變更。
4. 既有 `isToolExecutionFailed` 以工具回傳文字中的「失敗」或開頭「錯誤」作為共同契約；本次需沿用並固定此契約，避免 No-Progress 與 Replay 對同一結果產生不同解讀。

本 change 依賴 `assertion-failure-classification` 先提供結構化 `failure_type` state，並將 `routeAfterAssertion` 改為依 business/operational 與剩餘 Executor round 預算分流。兩個 change 必須按依賴順序實作，不能各自保留互相矛盾的路由規則。

## Goals / Non-Goals

**Goals:**
- 以明確的提示權限階層提供 Step Objective，同時維持 Step Action 的權威性與 Asserter 的獨家判定權。
- 只用保守、可測試的強訊號偵測無進展，並保留不會自我觸發的診斷證據。
- 將 5 個 Executor rounds 定義為整個步驟共用的真實預算，避免斷言重試隱性補滿回合。
- 讓 `done_acting`、business/operational failure 與各種耗盡原因具有確定路由及可解釋的終止診斷。
- 正確處理同分頁 document/SPA navigation，並對尚未支援的新分頁提供不可重試護欄。
- 產生不揭露輸入文字、JavaScript 或憑證的安全 `finalReason`。

**Non-Goals:**
- 不讓 Executor 自行判定 PASS/FAIL，也不在斷言路徑解析 `stepExpected` 的字串格式或內容。
- 不完整接管、切換或操作 `target=_blank`/popup 新分頁；本次只做安全偵測與終止。
- 不把所有工具回傳全面改造成結構化物件；沿用既有字串失敗契約。
- 不變更資料庫 Schema，也不為缺少 `reportModelId` 的情況增加 fallback 模型。

## Decisions

### 1. Step Action 與 Step Objective 使用不同訊息層級

Step Action 與固定規則保留在 System message；Step Objective 由 `executorNode` 從 `state.step_expecteds[idx]` 讀取後，放入 Human message 的明確資料區塊。System 規則 MUST 明定：

- `Step Action > Step Objective`；
- Objective 只能協助消除目標元素、目的地或方向歧義；
- Objective 不得改寫 Action、改變輸入值、要求額外動作或授予 PASS/FAIL 判定權；
- 動作完成後，即使結果不符合 Objective，也應呼叫 `done_acting` 交給 Asserter。

Objective 先 normalize 空白；超過 500 個 Unicode 字元時保留前 350 與後 150，中間插入明確省略標記。不針對 URL、前綴或其他內容特徵做解析。

**理由**：訊息層級直接表達權限關係，比在同一 System message 中放入 Action 與可能衝突的 expected 再靠文字排序更可靠。

### 2. No-Progress 只採兩個強訊號

`backend/src/graph/noProgress.ts` 提供純函數，回傳 `all_tools_failed | repeated_side_effect | null`：

1. `all_tools_failed`：本輪至少有一個工具，且全部依 `isToolExecutionFailed` 判定失敗。
2. `repeated_side_effect`：相鄰 rounds 在沒有介入之不同成功副作用動作時，重複相同副作用工具與完整參數。

重複比較先將工具參數遞迴依 key 排序後 canonicalize，再比較工具名與參數。副作用工具包含 `navigate_to`、`click`、`input`、`key`、`hover`、`execute_javascript`；`observe_web_page`、`wait_for_seconds` 與 `done_acting` 排除。`strategy_hint`、assertion log 及其他合成日誌不得參與任何偵測。

同輪多重命中時固定採 `all_tools_failed > repeated_side_effect`，每輪最多一個 reason。刪除原設計的「累計 ≥6 筆 log 且未 done」條件，因一輪可產生多筆 log，且未 done 不等於沒有進展。

### 3. `strategy_hint` 是持久化但不具控制權的診斷日誌

命中 No-Progress 時新增一筆 `action: "strategy_hint"` 的 LogEntry，包含 reason、切換策略建議與剩餘回合數。它會進入下一輪 Execution History，並於步驟完成或失敗時沿用既有 TestLog/SSE 流程持久化和顯示。

為避免回饋迴圈，`strategy_hint` MUST：

- 不參與失敗判定、回合預算、工具動作數量與重複比較；
- 每輪最多一筆；
- 與前一筆 strategy hint reason 相同時不得連續重複寫入；
- 不混入 Reporter 的「最近 5 個真實工具動作」。

### 4. 整個步驟共用 5 個 Executor rounds

一次 `executorNode` 的 LLM 決策計為一個 Executor round，不論該次產生幾個工具。Replay、Asserter 與純框架處理不計。`stepAsserterNode` 不再重設 `executor_turn_count`；只有 `stepTrackerNode` 推進到下一步時才重設。

每輪 Human message 顯示已使用與剩餘回合。第 5 輪若呼叫 `done_acting`，路由優先進入 Asserter；若 Asserter 回傳 operational FAIL，因預算已耗盡而進 reporter。這使「每步最多 5 輪」成為真實且可預測的上限。

### 5. 分類式斷言失敗決定是否補救

`assertion-failure-classification` 負責產生 `step_assertion_failure_type` 並擴充 `routeAfterAssertion`：

- PASS → `step_tracker`；
- FAIL + business → 設定 `business_assertion_failure` 並直接進 `reporter`；
- FAIL + operational + 尚有 Executor round → `executor`；
- FAIL + operational + 預算耗盡 → 設定 `operational_budget_exhausted` 並進 `reporter`。

缺少分類時仍依相依 change 的相容性規則視為 operational。此 change 不重複實作 failure type 解析，但其回合預算與 Reporter 診斷依賴該 state。

### 6. `done_acting` 為 terminal tool

Executor 依序處理一批 tool calls；遇到 `done_acting` 時記錄該 call 並立即停止，不執行其後工具。`routeAfterExecution` 判斷本輪是否出現 `done_acting`，而非依賴全域最後一筆 log。若同輪同時有一般工具與 `done_acting`，該次 LLM 決策仍只計一輪。

**理由**：交付驗證之後不應再改變頁面狀態，也不能讓後續合成日誌遮蔽終止訊號。

### 7. 點擊前註冊同頁導航與 popup watcher

`click(waitForNavigation)` 在點擊前記錄原 URL，並同時準備：

- 同分頁 URL/navigation watcher：接受 document navigation 或 SPA URL 變更，成功後等待設定的穩定載入條件並回報實際 `page.url()`；
- popup watcher：偵測 `target=_blank` 或等價的新分頁事件。

若同頁導航成功，取消/清理其他 watcher。若逾時且沒有 popup，回傳符合 `isToolExecutionFailed` 契約的錯誤並附當前 URL。若 popup 發生，不嘗試接管新 Page；保留 popup URL，設定 `termination_cause: unsupported_new_page` 並直接收斂至 reporter，避免 Executor 重點擊。

### 8. Anchor 同時回傳 raw、resolved 與 navigable

`observeWebPage` 對 `<a>` 元素輸出：

- `hrefRaw`：DOM attribute 原值；
- `href`：以目前頁面為 base 的解析值；
- `navigable`：僅 `http:`/`https:` 為 true。

`mailto:`、`tel:`、`javascript:`、fragment、`data:`、`blob:` 等仍保留語意資訊，但不得引導 Executor 直接使用 `navigate_to`。

### 9. 以 `termination_cause` 驅動安全 Reporter 診斷

`TestState` 新增僅存在於執行態的 `termination_cause`，至少支援：

- `business_assertion_failure`；
- `operational_budget_exhausted`；
- `executor_budget_exhausted`；
- `unsupported_new_page`。

Reporter 不再把所有未完成步驟統稱為「執行次數達上限」。business failure 保留 `step_assertion_reason`；預算耗盡附最近 5 個真實工具動作的安全摘要。摘要採 allowlist：保留工具名、非敏感目標 ID、HTTP(S) URL 與成敗狀態；遮蔽 `input.text`、按鍵內容、JavaScript、cookie、token、authorization 與其他憑證。`strategy_hint` 和 assertion reason 分區顯示，不計入 5 個動作。

### 10. 維持並測試共同工具失敗字串契約

本次不改變工具公開回傳型態。所有工具錯誤結果必須包含「失敗」或以「錯誤」開頭，並由既有 `isToolExecutionFailed` 同時服務 Replay 與 No-Progress。測試需覆蓋每個工具的成功與失敗輸出，避免新增工具文案破壞判定。

## Risks / Trade-offs

- **[Risk] Executor 把 Objective 視為命令** → **Mitigation**：Action 保留於 System、Objective 降至 Human 資料區塊，並以固定規則限制其權力。
- **[Risk] Asserter 把 operational 誤分類為 business，造成過早終止** → **Mitigation**：最終結果仍是 FAIL，不會產生假 PASS；缺欄位與例外預設 operational，優先保留補救機會。
- **[Risk] 動態網站頻繁改寫 URL，造成 SPA watcher 過早完成** → **Mitigation**：URL 變更後仍等待設定的穩定載入條件，並以測試頁覆蓋 pushState/replaceState 與完整導航。
- **[Risk] `strategy_hint` 增加 Token 與儲存量** → **Mitigation**：每輪最多一筆、相同原因連續去重，且只在兩個強訊號命中時產生。
- **[Risk] 字串失敗契約易受工具文案變更影響** → **Mitigation**：集中使用單一判定器並以所有工具的契約測試固定格式；結構化工具結果另立 change。
- **[Risk] popup 終止使原本可由人工切換分頁的案例直接失敗** → **Mitigation**：回報 popup URL 與 `unsupported_new_page`，提供明確後續改善方向，且避免重複產生分頁。
- **[Risk] 動作摘要洩露測試資料或憑證** → **Mitigation**：只使用 allowlist 欄位，敏感參數一律遮蔽，不直接截取原始 action/result。

## Migration Plan

1. 先更新並實作 `assertion-failure-classification`，使 failure type state 與分類式路由符合本設計。
2. 再實作本 change 的 Objective、No-Progress、共用回合、terminal tool、導航與診斷變更。
3. 無資料庫 migration；`strategy_hint` 沿用現有 TestLog 自由文字欄位，`termination_cause` 僅存在於執行 state。
4. 部署時重啟後端 Worker，使新的狀態機與 Playwright 工具初始化生效。
5. Rollback 必須協調還原兩個 changes 的分類路由、回合語意與 Reporter 分支；單獨還原其中一側可能留下不一致狀態。

前端已確認以自由文字呈現未知 `action`，因此 `strategy_hint` 不需新增 UI 分支；仍以整合測試確認 SSE 與歷史紀錄呈現正常。
