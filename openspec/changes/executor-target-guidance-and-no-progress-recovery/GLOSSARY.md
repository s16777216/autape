# Glossary

## e2e-runner

- **stepExpected** — 步驟的預期結果文字；由獨立驗證器（step_asserter）獨家判定通過與否。Aliases: 預期結果、預期。
- **Step Action** — `stepContent` 所描述、Executor 必須忠實完成的權威動作；優先於 Step Objective。Aliases: 步驟動作、Action。
- **Step Objective** — 從 `stepExpected` 提供給 Executor 的非權威目標提示，只能消除動作方向或目標歧義，不得改寫 Step Action 或授予 PASS/FAIL 判定權。Aliases: 目標意圖、Objective。
- **done_acting** — Executor 宣告當前 Step Action 已完成並交由 Asserter 判定的 terminal tool；同批後續工具不得繼續執行。Aliases: 動作完成。
- **Executor round** — 一次 LLM Executor 決策，不論該次產生多少工具呼叫；包含 terminal `done_acting`，不包含 Replay、Asserter 或純框架處理。Aliases: 執行器回合、動作回合。
- **strategy_hint** — 流程層診斷日誌；無進展偵測命中時產生並帶入下一輪 Execution History，但不參與失敗判定、回合或動作計數、重複比較及最近動作摘要。Aliases: 策略導正日誌。
- **Execution History** — Executor 每輪決策時可見的歷史日誌串。Aliases: 執行歷史。
- **termination_cause** — 執行態中的結構化終止原因，供路由及 Reporter 產生正確診斷。Aliases: 終止原因。
- **unsupported_new_page** — 點擊開啟新分頁但系統尚不支援接管時使用的不可重試終止原因；保留 popup URL 供診斷。Aliases: 不支援新分頁。
