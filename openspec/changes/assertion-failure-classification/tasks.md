## 1. Schema 與 Parser：斷言失敗分類

- [ ] 1.1 在 `backend/src/graph/prompt.ts` 的 `StepAssertionSchema` 新增 optional `failure_type: z.enum(["business", "operational"])`，並於 `buildStepAsserterPrompt` 定義 business/operational 及「FAIL 時必須輸出」規則；以 schema 與 prompt tests 驗證
- [ ] 1.2 擴充 `backend/src/graph.ts` 的 `StepAssertion` 型別與 `parseStepAssertionResponse`，支援 structured output、raw tool call 與 raw JSON content 中的 failure type；以各 provider response shape 測試驗證
- [ ] 1.3 對 FAIL 缺欄位、無效分類及分類解析例外統一補 `operational`，並以回歸測試確認不會因資訊不足產生 business 終止
- [ ] 1.4 確認 PASS parsing 不攜帶可被 state 沿用的 failure type，並以先 FAIL 後 PASS 的連續解析測試驗證

## 2. State、Asserter 與診斷資料

- [ ] 2.1 在 `backend/src/state.ts` 新增並初始化 `step_assertion_failure_type: "business" | "operational" | null`，並以 init state 與舊 fixture 相容性測試驗證
- [ ] 2.2 新增 assertion 相關 `termination_cause` 值 `business_assertion_failure` 與 `operational_budget_exhausted`，並以 state 型別測試驗證；保留後續 change 擴充其他原因的空間
- [ ] 2.3 更新 `stepAsserterNode` 的 PASS 與無 expected 分支，清空 failure type 與 assertion termination cause；以 graph tests 驗證不會跨斷言或跨步驟殘留
- [ ] 2.4 更新 `stepAsserterNode` 的 FAIL 與例外分支，保存解析後 failure type：business 設 `business_assertion_failure`，operational 只有在 Executor round 已耗盡時設 `operational_budget_exhausted`；以分支測試驗證
- [ ] 2.5 移除 `stepAsserterNode` 對 `executor_turn_count` 的重設，並以 operational retry 測試驗證 Asserter 前後已使用回合數保持不變
- [ ] 2.6 更新 `stepTrackerNode`，成功推進下一步時清空 assertion result、reason、failure type、assertion termination cause 並重設 Executor round；以跨步驟測試驗證
- [ ] 2.7 更新 `assert_failure` log，使其保存 failure type 與未改寫的 Asserter reason；以 log payload、SSE mapping 與資料庫自由文字相容性測試驗證

## 3. 分類式 Assertion Router

- [ ] 3.1 擴充 `backend/src/graph/router.ts` 的 `routeAfterAssertion` input，使其讀取 assertion result、failure type 與 `executor_turn_count`，並維持 pure function；以型別與單元測試驗證
- [ ] 3.2 實作並測試 PASS → `step_tracker` 與 business FAIL → `reporter`，確認 business 分支不受剩餘回合數影響
- [ ] 3.3 實作並測試 operational／缺分類 FAIL 在 `executor_turn_count < 5` 時回 `executor`、在 `>= 5` 時進 `reporter`
- [ ] 3.4 更新 graph wiring 與所有 route fixture，確保新增 state 欄位正確傳入且舊 fixture 缺分類時走 operational 相容路徑
- [ ] 3.5 移除 business failure 回流 Executor 所需的「請立即 done_acting」History 指導；operational 回流只呈現原始 assertion reason，並以 history message tests 驗證

## 4. 整合與回歸驗證

- [ ] 4.1 新增 graph-level business failure 案例，驗證 Asserter FAIL 後直接進 reporter，且其後 Executor 模型與工具呼叫次數皆為 0
- [ ] 4.2 新增 operational failure 案例，驗證已使用 Executor round 不重置，且仍有預算時可返回 Executor 補救
- [ ] 4.3 新增第 5 輪 operational failure 案例，驗證設定 `operational_budget_exhausted` 並直接進 reporter
- [ ] 4.4 執行 `npm test -w backend`，確認既有 `graph.test.ts`、`replay.test.ts`、router tests 與新增分類測試全部通過
- [ ] 4.5 確認資料庫無 Schema migration，並以 API/SSE 或既有前端 log 畫面驗證 failure type 可透過自由文字呈現而不需新增前端型別
