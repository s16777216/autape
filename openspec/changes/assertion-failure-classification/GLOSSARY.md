## e2e-runner

- **failure_type** — Step Asserter 於 FAIL 時根據頁面證據產生的結構化失敗分類，值為 `business` 或 `operational`；它直接決定 assertion failure 是否可返回 Executor，缺欄位時預設為 `operational`。
- **business failure** — Step Action 已完成但頁面狀態與 `stepExpected` 不符的失敗；系統直接進入 reporter，後續不得再呼叫 Executor。Aliases: 業務性失敗、業務性斷言失敗。
- **operational failure** — Step Action 可能未完成或存在元素變動、等待失效等操作層障礙；只有仍有 Executor round 預算時才可返回 Executor 補救，缺少分類時採此預設。Aliases: 操作性失敗。
- **business_assertion_failure** — business failure 的結構化終止原因，表示流程由 Asserter FAIL 直接進入 reporter。Aliases: 業務斷言終止。
- **operational_budget_exhausted** — operational failure 發生時已無剩餘 Executor round 的結構化終止原因。Aliases: 操作補救預算耗盡。
