## Context

現行狀態機為 `init → executor → (routeAfterExecution) → step_asserter | executor | reporter`（見 `openspec/changes/separate-action-and-assertion/design.md`）。其中 `executorNode` 專職網頁操作，System Prompt（`backend/src/graph/prompt.ts` 的 `buildExecutorSystemPrompt`）僅接收 `testName / stepIdx / stepContent / currentUrl / systemPrompt`，**不包含步驟預期結果**。`step_expecteds` 已存在於 `TestState`（`backend/src/state.ts:22`）並由 Queue 初始化（`backend/src/queue.ts:334`），但執行器從未讀取。

觀察失敗軌跡（run `dc041b0b`）：執行器在 example.com 點錯元素導航至 `iana.org/domains/reserved` 後，因不知道目標 URL、也無「無進展」訊號，在錯誤頁面盲目試 5 輪後被 `routeAfterExecution` 強制送往 reporter。根因是**資訊不足**（無目標意圖）與**缺乏進程觀測**（無無進展自癒），並非工具本身壞掉。

## Goals / Non-Goals

**Goals:**
- 讓執行器具備「步驟目標意圖」的導向資訊（不限於 URL，通用於任何自然語言預期）。
- 在執行器陷入無進展循環時注入可讀的策略切換反饋，使其有機會自癒。
- 讓「無法推進目標」以優雅的 `done_acting` → 驗證器判定收尾，而非僅靠硬性 turn 上限中斷。
- 提升工具回饋品質（導航後 URL、元素 href），強化執行器對「目前身在何處」的認知。
- 全部機制保持 100% 向後相容：不變 Schema、不變路由、不移動驗證職責。

**Non-Goals:**
- 不把 `stepExpected` 作為「判定權力」交還執行器；最終 PASS/FAIL 仍由 `step_asserter` 獨家判定。
- 不在斷言路徑引入 `text:`/`url:` 等本地解析規則（延續 `separate-action-and-assertion` 決策 2）。
- 不調整 `executor_turn_count` / `step_retry_count` 上限值與既有路由邏輯。
- 不為 `reportModelId` 未設定時提供 fallback（維持現行「跳過報告生成」禁令）。

## Decisions

### 1. Step Objective 以「目標參考」注入 Executor Prompt，而非「驗證標準」

`buildExecutorSystemPrompt` 新增選用參數 `stepObjective`。非空時以**原始 expected 全文**插入：

```
# Step Objective
本步驟預期目標（僅供你規劃動作方向，**不得自行評判 PASS/FAIL**，最終由獨立驗證器判定）：
"<stepObjective>"
完成目標導向動作後，即使畫面狀態與預期結果不符，也不得追加試圖翻轉該狀態的動作；請如實呼叫 done_acting。
```

- 注入位置固定於 System Prompt：`executorNode` 每輪重建 system prompt（`graph.ts:484-489`），Objective 於每次回合皆生效，且跨步驟自動對齊 `state.step_expecteds[idx]`。
- 超過 500 字元時截斷並於句末標註「(已截斷)」，避免稀釋工具描述與規則的注意力。
- **不針對 expected 內容做任何格式特徵解析**（例如不偵測 `https?://`），執行器自行從全文判讀目標並運用既有工具達成。

- **緣由**：本例根因是執行器走錯頁面後不知道該去哪。給它「地圖」(目標意圖) 但不給「裁判證」(判定權)，與分離設計的精神相容——消除的是「自知之明」的落差，不是職責。
- **替代方案（否決）**：在 Objective 中允許執行器自行宣稱成功。這會重現「球員兼裁判」，違反 `separate-action-and-assertion` 的設計決策 1，否決。
- **替代方案（否決）**：先由系統以模型「提煉」成動作導向摘要再注入。多一次 LLM 呼叫的成本與延遲，且摘要可能遺漏語意，否決。
- **替代方案（否決）**：URL 特化（含「URL 比對 → 自動導正」與「URL 特徵 → navigate_to 提示」）。屬 expected 字串特徵解析，踩決策 2 紅線，且無法覆蓋非 URL 案例；改由「Objective 全文供執行器判讀 + No-Progress 自癒」取代。

### 2. No-Progress Recovery：行為層偵測（非內容層解析）

在 `executorNode` 每輪工具執行完畢後（return 前）呼叫純函數 `shouldFlagNoProgress(prevTurnLastAction, currentTurnLogs, stepLogsLength)`，命中任一即 true：
1. 該輪所有工具結果皆判定失敗（`isToolExecutionFailed`，即含「失敗」或開頭「錯誤」）；
2. 該輪第一個動作字串與上一輪最後一個動作字串相同（重複嘗試）；
3. 該步驟累計日誌數 ≥ 6 且仍不含 `done_acting`（多輪無進展）。

命中後 push 一筆日誌，其建議內容依**無進展原因配對**（併帶剩餘回合數 R）：

```ts
{ step_idx, step_description, action: "strategy_hint", result: "<依原因配對之建議>。剩餘回合 R。若動作已完成請直接呼叫 done_acting。", timestamp }
```

| 無進展原因 | result 建議 |
|---|---|
| 單輪全數失敗 | 「本輪所有工具皆失敗。建議重新觀察頁面取得最新狀態，再決定下一步。」 |
| 動作完全重複 | 「重複嘗試相同動作（'<動作>'）未見進展。建議更換目標元素或改用不同工具。」 |
| 累計 ≥6 筆仍未宣告完成 | 「本步驟已累計多輪未宣告動作完成。建議收斂：若動作已完成請直接呼叫 done_acting。」 |

該筆日誌會自動出現在下一輪的 **Execution History**（`executorNode` 既有機制 `graph.ts:493-503`），不需新增 state 欄位、不需改路由。

- **緣由**：偵測只依「工具成敗、動作是否重複、輪數」判斷——全部屬執行行為，**不解析 `stepExpected` 的字串格式**，與決策 2（禁止在斷言路徑解析預期字串）正交。因此對任何類型的預期（URL、購物車圖示、錯誤訊息…）皆通用。
- **替代方案（否決）**：每次斷言失敗都靠 `step_asserter` 產生 `assert_failure` 再導回執行器。但本問題發生在執行器**尚未 `done_acting`** 的動作階段，根本到不了 assserter；故需在執行迴圈內自癒，而非依賴驗證節點回饋。
- **抽離可測性**：`shouldFlagNoProgress` 置於獨立模組（如 `backend/src/graph/noProgress.ts`）以利 vitest 純函數測試。

### 3. 回合意識與優雅收斂

- 每輪 Human message 附註「本步驟已用回合 X / 上限 5」。
- 當 `executor_turn_count >= 4`（最後一輪）時，Human message 追加：「此為本步驟最後一次動作回合。若無法再推進目標，請立即呼叫 `done_acting` 總結狀態交由驗證器判定，勿再重複嘗試。」對應 System Prompt 新增規則：「若多次嘗試仍無法朝目標前進，應改變策略或呼叫 `done_acting`，不得連續重複相同嘗試。」
- **緣由**：讓卡死狀況以「執行器盡力 + 驗證器 FAIL + 具體 reason」收尾，而非粗糙的「被強制終止」，保住診斷資訊與後續 `step_retry` 補救機會。
- **替代方案（否決）**：直接調高 `executor_turn_count` 上限。無目標資訊時再多輪也只是延後失敗並耗費 Token，療效不彰；維持上限 5，用引導改善「品質」而非「量」。

### 4. 工具回饋強化

- `click`（`tools.ts`）：`waitForNavigation` 成功後回報改為「已點擊元素 ID X，並等待頁面導航完成。導航後網址: `<page.url()>`」。
- `observe_web_page` 元素清單（`browser.ts` `observeWebPage`）：對 `<a>` 元素附加 `href`（`<a href="/foo">...`，相對路徑以 `new URL(href, location.href).href` 取絕對值）。
- **緣由**：執行器每次導航後能得知「自己身在何處」，元素語意更完整；對非 URL 案例同樣提升定位品質。屬低風險純增強。

### 5. 報告診斷強化

`reporterNode` 在「因動作/重試上限失敗」時，將 `finalReason` 附加該步驟最後 **5 筆**動作摘錄（`action → result`，每筆截斷 **100 字元**），讓資料庫中的 failure reason 可直接作為診斷起點。

### 6. 已知工具陷阱（本次僅記錄、不實作）

以下工具陷阱經評估不屬本次範圍，記錄供後續 change 立案：
- `target=_blank` 連結開啟新分頁時 `waitForNavigation` 無法偵測導航；
- `Promise.all([waitForLoadState("networkidle"), page.click(...)])`（`tools.ts:78-82`）在頁面早已 idle 時不會真正等待新導航完成。

本次僅由決策 4 的「點擊後回報真實 `page.url()`」部分緩解表象；完整修正另立 change。

### 7. reportModelId 設定提醒

`system_setting` 未設定 `reportModelId` 時 `failureSummary` 無法生成（run `dc041b0b` 即因此無 AI 總結）。本次不改變「未設定即跳過報告生成」的規格禁令，但於 `tasks.md` 增加檢查與提醒項，降低除錯盲點。

## Risks / Trade-offs

- **[Risk] 執行器把 Objective 誤當作自評標準** → *Mitigation*：Prompt 以強約束措辭（「不得自行評判 PASS/FAIL」）並於設計文檔明示「資訊流放寬、決定權不放寬」；最終判定仍由 assserter 負責，誤解至多造成策略較差，不會造成誤判通過。
- **[Risk] 無進展偵測可能誤報（例：等待動畫中的階段性失敗）** → *Mitigation*：三條件皆具保守性（全部失敗／完全重複／≥6 筆）；`strategy_hint` 僅為建議性日誌，不改變路由或計數器，誤報最壞情形只是多給模型一段指引。
- **[Risk] 新增 prompt 區塊與日誌型態增加 Token/儲存成本** → *Mitigation*：Objective 僅在非空時注入，`strategy_hint` 只在偵測命中時產生（此類失敗案例才觸發），成本可忽略。
- **[Risk] 前端對未知的 `strategy_hint` action 值渲染異常** → *Mitigation*：`strategy_hint` 走既有 `LogEntry` 自由文字通道（`result` 為人讀文字）；實作時確認前端 log 渲染無按 action 值分支的邏輯，若有則以最小調整支援。

## Migration Plan

無資料庫遷移與外部相依變更。部署僅重啟後端 Worker（playwright browser 於下一次執行時重新初始化）。Rollback 策略：還原 `prompt.ts`、`graph.ts`、`browser.ts`、`tools.ts` 的修改即可，所有新增機制皆為附加（additive），不影響既有日誌結構相容。

## Open Questions

- 前端 log 串流渲染是否依 `action` 值做分支？（實作時確認 `frontend/src/views` 對 log 的解析；若為自由文字則零改動。）