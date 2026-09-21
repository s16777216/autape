## e2e-runner

- **failure_type** — 步驟斷言（step_asserter）於 FAIL 時由驗證模型基於頁面證據產出的結構化失敗分類，值為 `business` 或 `operational`；缺欄位時預設為 `operational`。
- **business failure** — 動作已完成但頁面狀態與預期結果不符的失敗；執行器應收手並直接呼叫 `done_acting`，不得追加以改變失敗狀態。Aliases: 業務性失敗、業務性斷言失敗。
- **operational failure** — 動作可能未完成或存在操作層障礙（如元素動態變化、等待失效）的失敗；執行器可重新觀察或補救。Aliases: 操作性失敗。