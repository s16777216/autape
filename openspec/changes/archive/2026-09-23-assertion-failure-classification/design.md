## Context

現行狀態機為 `init → executor → (routeAfterExecution) → step_asserter → (routeAfterAssertion) → step_tracker | executor | reporter`。`stepAsserterNode` 在 FAIL 時記錄自然語言 `step_assertion_reason` 並遞增 `step_retry_count`，但所有未達上限的 FAIL 都回流 Executor。Executor 因而無法區分「操作可能未完成」與「操作完成但業務結果不符」，容易把 business failure 當成待修復工作而追加操作。

既有設計曾以 Execution History 提示 business failure 後「直接呼叫 done_acting」且不改路由，但這仍會進行一次沒有新證據的 Executor 決策，並可能形成 `done_acting → business FAIL → executor` 循環。已確認的新路線是讓 `failure_type` 直接參與路由：business 收斂至 reporter，operational 才有資格使用剩餘動作預算補救。

本 change 是 `executor-target-guidance-and-no-progress-recovery` 的先行依賴。它負責分類、state propagation 與 `routeAfterAssertion`；後續 change 讓 5 個 Executor rounds 成為完整的跨斷言共用預算，並加入 Objective、No-Progress、terminal tool、導航與完整 Reporter 診斷。

## Goals / Non-Goals

**Goals:**
- 讓每個 FAIL 帶有可程式判讀的 business/operational 分類，並保留模型原始理由。
- 讓 business failure 直接且確定地終止，不再呼叫 Executor。
- 讓 operational failure 只在尚有 Executor round 預算時回流補救。
- 對舊 response、缺欄位與解析例外維持安全相容預設。
- 為 assertion 類終止分支提供明確的 `termination_cause`，避免 Reporter 由文字或計數器倒推。

**Non-Goals:**
- 不把 PASS/FAIL 決定權交還 Executor。
- 不使用 `text:`、`url:`、錯誤關鍵字、retry count 或其他本地規則推定 failure type。
- 不在本 change 實作 Step Objective、No-Progress、導航回饋、popup 護欄或完整安全動作摘要。
- 不變更資料庫 Schema或前端 API。

## Decisions

### 1. `failure_type` 由 Asserter 模型產生，Parser 提供 operational 預設

`StepAssertionSchema` 增加 optional 的 `failure_type: z.enum(["business", "operational"])`，供 parser 接受舊 response 與不同 provider shape。另以 provider-facing structured-output schema 將 `failure_type` 定義為 required nullable，滿足 OpenAI Responses API「所有欄位必須 required」的限制；模型回傳 `null` 時由 parser 視同缺欄位並採 `operational` 預設。`buildStepAsserterPrompt` 明確定義：

- `business`：Step Action 已完成，但頁面狀態與 `stepExpected` 不符；
- `operational`：Step Action 可能未完成，或有元素變動、等待失效、操作未生效等障礙。

Prompt 要求模型在 FAIL 時提供分類；parser schema 的欄位保持 optional，讓舊模型及不同 provider response shape 仍可解析，而送入模型 SDK 的 schema 採 required nullable 以符合 strict structured outputs。`parseStepAssertionResponse` 對 `null`、缺欄位、無效值或分類解析例外一律回傳 `operational`。不得由本地內容、工具字串或計數器推斷分類。

**理由**：缺少分類代表資訊不足，不應因此採取不可回復的提早終止；operational 預設保留補救機會並維持舊行為方向。

### 2. `step_assertion_failure_type` 是明確的 LangGraph state

`TestState` 新增 `step_assertion_failure_type: "business" | "operational" | null`，並於 init 設為 `null`。`stepAsserterNode` 的回傳規則：

- PASS 或無 `stepExpected` 的直接通過 → `null`；
- 可解析 FAIL → 模型分類；
- 缺欄位或例外 FAIL → `operational`。

成功推進下一步時再次清空 assertion result、reason 與 failure type，避免跨步驟殘留。分類不可只編碼在 log 文字中，因 Router 必須以型別安全的 state 分流。

### 3. Asserter 保留已使用的 Executor round

`stepAsserterNode` 不再把 `executor_turn_count` 重設為 0。Router 必須看見實際已使用回合，才能判斷 operational failure 是否仍可補救。只有成功進入下一步的 `stepTrackerNode` 才重設計數。

本 change 建立「斷言不補滿動作預算」的必要 state 行為；後續 `executor-target-guidance-and-no-progress-recovery` 再補齊每輪顯示、terminal `done_acting` 及所有預算邊界測試。

### 4. `routeAfterAssertion` 以分類與剩餘預算分流

Router 保持 pure function，輸入至少包含 `step_assertion_result`、`step_assertion_failure_type` 與 `executor_turn_count`：

- PASS → `step_tracker`；
- FAIL + business → `reporter`；
- FAIL + operational/缺值 + `executor_turn_count < 5` → `executor`；
- FAIL + operational/缺值 + `executor_turn_count >= 5` → `reporter`。

PASS 的優先序最高。business 不讀剩餘預算，因動作已完成且不允許翻轉結果。缺值在進入 Router 前或 Router 邊界統一視為 operational。

### 5. `stepAsserterNode` 設定 assertion 類 `termination_cause`

Router 不修改 state。`stepAsserterNode` 在產生 FAIL state 時，依分類與目前回合數設定：

- business → `business_assertion_failure`；
- operational 且回合已達上限 → `operational_budget_exhausted`；
- operational 且仍可補救 → `null`。

`termination_cause` 在本 change 先支援 assertion 相關值；後續 change 擴充 `executor_budget_exhausted`、`unsupported_new_page` 等值及完整 Reporter 文案。

### 6. Business 不再建立 Executor 指導，Operational 保留原始回饋

`assert_failure` log 保存結構化分類與 Asserter 原始 reason。business failure 直接進 reporter，因此不再將「請立即 done_acting」之類指導注入 Execution History。operational failure 返回 Executor 時，既有 History 可呈現原始 reason 作為重新觀察或補救依據。

Reason 保持證據診斷，不混入流程指令；分類與指導責任分離，可避免同一理由隨路由狀態改寫。

## Risks / Trade-offs

- **[Risk] operational 被誤分類為 business，造成過早終止** → **Mitigation**：缺值與例外預設 operational；Prompt 以「動作是否已完成」作為核心界線；測試覆蓋典型分類。最壞結果為提早 FAIL，不會產生假 PASS。
- **[Risk] business 被誤分類為 operational，造成額外補救** → **Mitigation**：後續 change 的 Step Action/Objective 權限規則與共用 5 輪預算限制過度修正範圍；本 change 測試確保正確分類時絕不回 Executor。
- **[Risk] optional schema 看似允許模型省略分類** → **Mitigation**：Prompt 對 FAIL 明訂必填；optional 僅作 provider/舊 response 相容，Parser 永遠輸出明確分類。
- **[Risk] OpenAI strict structured outputs 拒絕 optional-only 欄位** → **Mitigation**：provider-facing schema 使用 required nullable，並以 OpenAI schema helper 回歸測試確認可轉換；`null` 仍採 operational 預設。
- **[Risk] 新 state 與 route signature 影響既有測試** → **Mitigation**：初始化提供 null，舊 state 缺值按 operational 處理，並擴充所有 Router 與 graph fixture。
- **[Risk] 本 change 單獨部署時完整共用預算提示尚未到位** → **Mitigation**：分類路由與計數保留先建立穩定契約；按 migration 順序緊接套用依賴本 change 的 guidance change。

## Migration Plan

1. 先套用本 change：Schema/Parser、state、Asserter 計數保留、分類式 route 與 assertion 終止原因。
2. 再套用 `executor-target-guidance-and-no-progress-recovery`：補齊完整共用回合 UX、Objective、No-Progress、terminal tool、導航與 Reporter 診斷。
3. 無資料庫 migration；新欄位只存在 LangGraph 執行 state，failure type 以既有自由文字 log 呈現。
4. 部署時重啟後端 Worker。
5. Rollback 時先還原後續 guidance change，再還原本 change，避免 Router 讀取已被移除的 state 契約。
