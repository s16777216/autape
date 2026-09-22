## Why

斷言失敗（`step_asserter` 判定 FAIL）目前一律導回 Executor，且自然語言失敗理由與動作結果共用同一個 Execution History 欄位。Executor 無法可靠分辨「動作未完成、可補救」與「動作已完成但結果不符、必須收手」，因此可能追加操作把本應保留的業務失敗狀態修正成成功。

僅以提示文字要求 Executor 收手仍會產生一次沒有新證據的回流，並可能重複 `done_acting → business FAIL → executor`。系統需要可程式判讀的失敗分類及明確路由，讓是否補救由失敗本質與剩餘動作預算決定。

## What Changes

- **斷言失敗分類**：`StepAssertionSchema` 在 FAIL 時提供 `failure_type: business | operational`。`business` 表示動作已完成但頁面結果與 `stepExpected` 不符；`operational` 表示動作可能未完成或存在操作層障礙。分類由 Asserter 模型基於頁面證據產生，不使用本地字串規則。
- **相容性預設**：模型缺少分類、舊供應商 response 未帶欄位或解析例外時，系統以 `operational` 處理，避免因資訊不足而提早終止可補救流程。
- **明確 state propagation**：`step_assertion_failure_type` 成為 LangGraph 執行 state 的必要欄位；PASS 時清空，FAIL 時保存解析後分類。`assert_failure` log 同時保留分類與 Asserter 原始理由供診斷。
- **分類式路由**：`PASS` 進入 `step_tracker`；`business` FAIL 直接進入 `reporter` 且不得再呼叫 Executor；`operational` FAIL 只有在仍有 Executor round 預算時才返回 Executor，預算耗盡則進入 reporter。
- **Assertion 終止原因**：路由為終止分支設定 `business_assertion_failure` 或 `operational_budget_exhausted`，使 Reporter 不需從計數器或 log 文字倒推原因。

本 change 是 `executor-target-guidance-and-no-progress-recovery` 的先行依賴：本 change 擁有分類、state propagation 與 `routeAfterAssertion` 分流；後續 change 擁有 Step Objective、No-Progress、共用回合提示、terminal `done_acting`、導航回饋及完整 Reporter 摘要。

## Capabilities

### New Capabilities

無新增 capability。

### Modified Capabilities

- `e2e-runner`: 步驟斷言 FAIL 新增結構化 business/operational 分類，並依分類與剩餘 Executor round 預算決定立即失敗或返回補救；business failure 後不得再有 Executor 工具呼叫。

## Impact

- **提示與解析 (`backend/src/graph/prompt.ts`, `backend/src/graph.ts`)**：擴充 `StepAssertionSchema`、Asserter prompt、response parser 與 assertion log；缺欄位時預設 operational。
- **執行 state (`backend/src/state.ts`)**：新增並初始化 `step_assertion_failure_type`；建立 assertion 相關的 `termination_cause` 值，後續 change 再擴充其他終止原因。
- **路由 (`backend/src/graph/router.ts`)**：`routeAfterAssertion` 改為讀取 PASS/FAIL、failure type 與剩餘 Executor round 預算；business FAIL 不再回 Executor。
- **相依 change**：`executor-target-guidance-and-no-progress-recovery` 依賴本 change 的 state 與路由契約，並負責讓 5 個 Executor rounds 成為跨斷言共用的預算。
- **相容性**：不變更資料庫 Schema、前端 API 或 PASS/FAIL 決定權；舊回應缺少分類時仍走 operational 補救路徑。路由與重試行為則依本提案有意改變。
