## Context

現行狀態機為 `init → executor → (routeAfterExecution) → step_asserter | executor | reporter`（見 `openspec/changes/separate-action-and-assertion/specs/e2e-runner/spec.md`）。斷言失敗回流路徑：`stepAsserterNode`（`backend/src/graph.ts:604`）在 FAIL 時以模型產生的自然語言 `step_assertion_reason` 寫入 `assert_failure` log，並遞增 `step_retry_count`；`executorNode` 於下一輪組裝該步驟 Execution History（`graph.ts:492-503`）時，將動作結果與斷言失敗回饋併入單一 `Action N: ... / Result/Feedback: ...` 欄位，開頭標題即 `Learn from failures/retries`。執行器因此無法分辨「操作未完成（應補救）」與「結果不符（應收手）」，傾向將任何 FAIL 解讀為任務未完，追加動作企圖讓畫面符合預期——此即「過度修正致假成功」的誘因。動機詳見 proposal.md - Why。

`separate-action-and-assertion`（2026-09-11）提案第 6 行已提出「操作性失敗 vs 業務性斷言失敗」的錯誤歸因概念，但僅停在語言層，未落地為可程式讀取的訊號。本 change 將該概念結構化。

## Goals / Non-Goals

**Goals:**
- 讓 `step_asserter` 的 FAIL 結果攜帶結構化 `failure_type`（`business`/`operational`），由模型基於證據判定，不引本地解析。
- 讓 `executor` 的 Execution History 依 `failure_type` 分流回饋語意：`business` 附加「不得翻轉失敗狀態」的收手指示，`operational` 維持補救語意。
- 維持 100% 向後相容：不變 PASS/FAIL 判定、不變路由、不變重試計數、不變資料庫 Schema 與前端 UI。

**Non-Goals:**
- 不把最終 PASS/FAIL 決定權交還執行器（延續 `separate-action-and-assertion` 設計決策 1）。
- 不在斷言路徑引入 `text:`/`url:` 等本地解析規則（延續既有決策）。
- 不調整 `executor_turn_count` / `step_retry_count` 上限與既有路由邏輯。
- 不處理「期望失敗型結果」的目標監護規則（另案併入 `executor-target-guidance-and-no-progress-recovery`）。

## Decisions

### 1. `failure_type` 由 Asserter 模型結構化輸出，而非本地規則推斷

`StepAssertionSchema` 新增欄位 `failure_type: z.enum(["business", "operational"])`，`buildStepAsserterPrompt` 在 Rules 中定義兩類語意（business = 動作已完成但結果與預期不符；operational = 動作可能未完成或操作層障礙），並要求模型 FAIL 時一併輸出。

- **緣由**：延續 `separate-action-and-assertion` 的「純模型語意斷言」路線——本地規則無法可靠區分語意性落差，且踩「禁止解析預期字串」紅線。用模型產出分類與現有 PASS/FAIL 判定同源同證，一致性最高。
- **替代方案（否決）**：以本地啟發式（比對重試次數、工具回傳是否含「失敗/錯誤」字樣）推斷類別。會被動態等待失敗誤判、無法覆蓋語意性落差，且違背既有「不許本地解析」決策。
- **替代方案（否決）**：由 `executor_turn_count` / `step_retry_count` 數值高低代理分類。計數是流程狀態不是失敗本質，數值門檻無法對應失敗性質。
- **相容性**：schema 新增欄位為可選輸出；舊模型或例外路徑缺欄位時，`parseStepAssertionResponse` 以 `"operational"` 補預設，行為與現行一致。

### 2. `failure_type` 隨 `step_asserter` 回傳狀態，供 `executorNode` 分流

`stepAsserterNode` 於 return 時新增 `step_assertion_failure_type` 狀態欄位（`TestState` 新增 Annotation）；`executorNode` 組裝該步驟 Execution History 時讀取該欄位：

```
Step: <idx+1> 的斷言結果為 FAIL (failure_type: business)
```

- `business`：於 History 尾端附加「此步驟預期結果未被滿足。完成要求的動作後請直接呼叫 done_acting，不得追加以改變失敗狀態。」

- `operational`：維持現行語意（允許重新觀察/補救）。

- **緣由**：`failure_type` 若只存於 log 文字，執行器仍無法可靠解讀；以 state 欄位顯式傳遞，讓分流語意由程式碼組裝而非依賴模型複述。分割點放在 `executorNode` 的 historyPrompt 組裝處（`graph.ts:492-503`），與現有機制同點，改動面最小。
- **替代方案（否決）**：把分流語意直接寫進 `step_assertion_reason` 的文字。會讓同一 FAIL 理由因執行器重試次數不同而變異，且理由從「診斷」變成「指導」，偏離 `step_asserter` 的證據判定位。
- **替代方案（否決）**：於 `routeAfterAssertion` 預先分流（business 直接送 reporter）。會剝奪執行器對操作性失敗的補救機會，並改變既有路由語意。

### 3. 分流語意置於 `historyPrompt`，不動工具與路由

- System Prompt 的既有規則 5（「獨立斷言階段評估預期結果；勿為驗證而追加動作」）維持不變，作為與本機制一致的底座。
- `routeAfterAssertion` 邏輯完全不改（仍依 `step_retry_count` 上限判斷回流或送 reporter）；`failure_type` 只影響回流後 executor 讀到的語意，不影響是否回流。
- **緣由**：將「防過度修正」落回執行器的決策上下文，而非提升至路由層，符合「資訊流放寬、結構不放寬」的既有架構精神。

## Risks / Trade-offs

- **[Risk] 模型分類不精準（誤將 operational 標成 business）** → *Mitigation*：`failure_type` 僅影響回流語意與提示措辭，不改變 PASS/FAIL、不改變重試與路由；最壞情形是執行器少做一輪補救即收手，最終仍由 `step_asserter` 依證據做最後判定，不會造成系統誤判通過。
- **[Risk] 誤導執行器對操作性失敗過早收手** → *Mitigation*：prompt 對 `operational` 明確定義為「動作可能未完成」，且無分類預設即 `operational`（維持現行行為為主流）；僅當模型確信為業務性落差時才觸發收手指示。
- **[Risk] 新增 state 欄位對既有測試/前端無意影響** → *Mitigation*：欄位僅存在於後端 LangGraph 執行態，前端 log 渲染與資料庫不受影響；既有 vitest 中的 state 初始化不讀新欄位（可選），以測試確認無回歸。

## Migration Plan

無資料庫遷移與外部相依變更；僅重啟後端 Worker 生效。Rollback：還原 `prompt.ts`、`graph.ts`、`state.ts` 修改即可（`failure_type` 為可選輸出的附加欄位，移除後舊日誌仍以 `operational` 語意運作）。已存在之歷史 FAIL log 不具 `failure_type`，依決策 1/3 之預設處理，無需遷移。

## Open Questions

- 前端 log 畫面是否需以視覺化標記區分 `business`/`operational` 失敗？（可安全延後：現行為自由文字 `Result/Feedback` 呈現，`failure_type` 可直接置入 log 文字供檢視；不影響規格與實作結果。）