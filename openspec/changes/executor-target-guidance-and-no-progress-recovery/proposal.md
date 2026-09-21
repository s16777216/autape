## Why

執行器（Executor）僅收到「步驟動作文字」而不知道「步驟目標意圖」，一旦在執行中走錯方向（例如點錯元素導航至錯誤頁面），既無法察覺「沒有進展」，也沒有能力走回正軌，只能盲目重試直到 `executor_turn_count` 達上限被路由強制終止。實務上同一測試案例（步驟「找到 'Learn more' 的超連結並點擊」）已反覆以完全相同模式失敗多次（2026-09-11 至 2026-09-17 共 5 次），且失敗時僅留下「執行次數達上限」的粗略原因，缺乏可操作的診斷資訊。

## What Changes

- **Step Objective 目標提示**：在 Executor System Prompt 中新增「步驟目標意圖」區塊。當步驟提供 `stepExpected` 時，將其以目標參考形式注入，並明文約束「僅供動作導向，不得自行評判成敗，最終由獨立驗證器判定」。並明文約束執行器即使動作完成後畫面與預期結果不符，亦不得以追加動作翻轉之（NO OVER-CORRECTION，防過度修正）。若目標文字含完整 URL，額外提示可直接使用 `navigate_to` 前往。
- **無進展自癒**：在 Executor 每輪執行結束後，以流程層偵測判斷是否陷入無進展循環（該輪工具全部失敗、動作與前輪重複、或已累積多輪仍未宣告 `done_acting`）。命中時注入一筆 `strategy_hint` 日誌，使其自動進入下一輪的 Execution History 引導模型改變策略。
- **回合意識與優雅收斂**：在每輪提示中加入剩餘回合數；於最後一輪提示執行器「若無法再推進目標，應呼叫 `done_acting` 交由驗證器客觀判定」，避免以「強制中斷」作為唯一收尾方式。
- **工具回饋強化**：`click` 於 `waitForNavigation` 後回報導航後實際 URL；`observe_web_page` 的元素清單對 `<a>` 元素附加 `href`。
- **報告診斷強化**：因動作/重試上限而失敗時，`finalReason` 附帶該步驟近期動作摘要，提升可讀性。

既有架構決策「動作與驗證分離」（最終成敗判定權保留於 `step_asserter`）維持不變；本次僅放寬執行器的**資訊流**（提供目標導向）而不放寬**決定權**。

## Capabilities

### New Capabilities

無新增 Capability。所有行為變更皆屬既有 `e2e-runner` 執行核心的行為調整。

### Modified Capabilities

- `e2e-runner`: 新增「Step Objective 目標提示」、「No-Progress Recovery」、「回合意識與優雅收斂」與工具回饋強化（導航後 URL 回報、元素清單含 href）；並明確界定這些流程層機制與「斷言路徑不引入本地啟發式規則」正交。

## Impact

- **後端程式碼**：
  - `backend/src/graph/prompt.ts`：`buildExecutorSystemPrompt` 新增 `stepExpected` 參數與對應規則。
  - `backend/src/graph.ts`：`executorNode` 讀取 `step_expecteds`、執行無進展偵測、注入回合數與最後一輪收斂提示；`reporterNode` 失敗原因附動作摘要。
  - `backend/src/browser.ts`：`observeWebPage` 元素清單對 `<a>` 附加 `href`。
  - `backend/src/tools.ts`：`click` 於 `waitForNavigation` 後回報導航後 URL。
- **測試**：於既有 `backend/tests/` 新增/擴充 vitest 單元測試（Prompt 輸出、無進展偵測邏輯）。
- **資料庫**：無 Schema 變更（新日誌型態 `strategy_hint` 沿用現有 `TestLog` 自由文字）。
- **前端**：預期零變更（`strategy_hint` 以 log 自由文字呈現；實作時確認前端 log 渲染無特殊分支）。