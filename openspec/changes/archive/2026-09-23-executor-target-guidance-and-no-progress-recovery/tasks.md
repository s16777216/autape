## 0. 相依契約確認

- [x] 0.1 確認 `assertion-failure-classification` 已提供 `step_assertion_failure_type` state，並以 `graph.test.ts` 驗證缺少分類時仍預設為 `operational`
- [x] 0.2 確認 `routeAfterAssertion` 已實作 PASS → `step_tracker`、business FAIL → `reporter`、operational FAIL 依剩餘 Executor round 預算分流，並以 router 單元測試覆蓋所有分支

## 1. Step Objective 權限與訊息層級

- [x] 1.1 更新 `backend/src/graph/prompt.ts` 的固定 System 規則，明訂 `Step Action > Step Objective`、Objective 不得改寫 Action／輸入值／追加操作或自行判定 PASS/FAIL，並以 prompt snapshot/string assertions 驗證
- [x] 1.2 實作 Objective normalize 與 Unicode 截斷：空白內容視為不存在，超過 500 字元時保留前 350、後 150 並加入省略標記；以中英文及 surrogate-pair 測試驗證邊界
- [x] 1.3 更新 `backend/src/graph.ts` 的 `executorNode`，從 `state.step_expecteds[idx]` 取得 Objective 並只放入 Human message 的資料區塊；以 mocked model messages 驗證 Objective 不出現在 System message
- [x] 1.4 擴充 `backend/tests/graph.test.ts`，覆蓋 Action/Objective 衝突、短 Objective、長 Objective、空 Objective 與 URL-like Objective，驗證不做內容特徵解析

## 2. 保守的 No-Progress Recovery

- [x] 2.1 新增 `backend/src/graph/noProgress.ts`，定義 `all_tools_failed | repeated_side_effect` reason 與 recursive key-sorted argument canonicalization；以純函數測試驗證不同 JSON key 順序得到相同結果
- [x] 2.2 實作 `all_tools_failed`：要求本輪至少一個工具且全部符合 `isToolExecutionFailed`；以空工具輪、全失敗、部分成功及全成功測試驗證
- [x] 2.3 實作 `repeated_side_effect`：只比較 `navigate_to`、`click`、`input`、`key`、`hover`、`execute_javascript`，排除 observe、wait、done 及合成日誌；以相鄰回合及中間成功動作測試驗證
- [x] 2.4 固定同輪原因優先序 `all_tools_failed > repeated_side_effect`，並以同時命中測試驗證只回傳一個 reason
- [x] 2.5 在 `executorNode` 整合 `strategy_hint`：每輪最多一筆、相同 reason 不連續重複、持久化至 logs 並進入下一輪 Execution History；以 state/log 測試驗證
- [x] 2.6 驗證 `strategy_hint`、assertion log 與其他合成日誌不參與失敗判定、回合預算、動作數量或重複比較，並以回歸測試防止提示自我觸發
- [x] 2.7 為所有 BrowserTools 成功與錯誤結果補齊 `isToolExecutionFailed` 契約測試，確認錯誤文字包含「失敗」或以「錯誤」開頭，且 Replay 與 No-Progress 使用同一判定結果

## 3. 共用回合預算與 Terminal Tool

- [x] 3.1 修改 `stepAsserterNode`，使 PASS/FAIL/例外分支均不重設 `executor_turn_count`；以 operational retry 測試驗證已使用回合會保留
- [x] 3.2 確認只有 `initNode` 與成功推進下一步的 `stepTrackerNode` 重設 Executor round，並以跨步驟測試驗證每個新步驟從 0 開始
- [x] 3.3 在 Executor Human message 顯示「已使用 X／上限 5／剩餘 R」，最後一輪加入收斂指示；以首輪、中間輪及第 5 輪 message 測試驗證
- [x] 3.4 修改 Executor 工具迴圈，使 `done_acting` 成為 terminal tool：記錄該 call 後立即停止且不執行同批後續工具；以 spy tools 驗證後續副作用為零
- [x] 3.5 修改 `routeAfterExecution` 以本輪明確 done 訊號優先於預算耗盡判斷，不再依賴全域最後一筆 log；以第 5 輪 done、done 後合成日誌及無 done 超限測試驗證
- [x] 3.6 擴充整合型 graph tests，驗證一次 LLM 決策無論產生多少工具都只增加一輪，Replay、Asserter 與框架處理不增加回合

## 4. 可靠導航、連結資訊與新分頁護欄

- [x] 4.1 重構 `backend/src/tools.ts` 的 `click(waitForNavigation)`：點擊前保存原 URL 並註冊同頁 URL/navigation watcher，支援 document navigation 與 SPA URL change；以固定 Playwright 測試頁驗證兩條成功路徑及回報 URL
- [x] 4.2 實作導航逾時結果，確保符合 `isToolExecutionFailed` 契約並包含當前 URL；以未導航按鈕測試驗證不會誤報成功
- [x] 4.3 點擊前註冊 popup watcher；命中時回傳穩定的 `unsupported_new_page` marker 與 popup URL，並由 Executor 設定同名 `termination_cause`、停止重試及路由至 reporter；以 `target=_blank` 測試驗證只點擊一次
- [x] 4.4 更新 `backend/src/browser.ts` 的 anchor 表示，輸出 `hrefRaw`、resolved `href` 與 `navigable`；以相對 URL、HTTP(S)、fragment、mailto、tel、javascript、data 與 blob 測試驗證只有 HTTP(S) 可直接導航
- [x] 4.5 執行工具層回歸測試，確認無 `waitStrategy` 與 `waitForText` 的既有 click 行為不受 navigation watcher 影響

## 5. 結構化且安全的失敗診斷

- [x] 5.1 在 `backend/src/state.ts` 新增並於 init 初始化 `termination_cause`，至少支援 `business_assertion_failure`、`operational_budget_exhausted`、`executor_budget_exhausted`、`unsupported_new_page`；以型別與 state 初始化測試驗證
- [x] 5.2 在各 reporter 前置路由設定正確 `termination_cause`，並以 business、operational budget、executor budget 與 popup 測試驗證原因不靠計數器倒推
- [x] 5.3 新增 Reporter 動作摘要 sanitizer，只保留工具名、非敏感 ID、HTTP(S) URL 與成敗狀態，排除 synthetic logs；以最近 5 個真實工具動作的單元測試驗證排序與上限
- [x] 5.4 擴充 sanitizer 測試，確認 `input.text`、按鍵內容、JavaScript、cookie、token、authorization 及憑證原值不會出現在輸出
- [x] 5.5 更新 `reporterNode` 依 `termination_cause` 組裝 `finalReason`：business 保留 Asserter reason，預算耗盡附安全動作摘要，popup 附 URL；以各分支單元測試及資料庫 mapping 測試驗證
- [x] 5.6 確認 `strategy_hint` 與 assertion reason 以診斷區段呈現、不混算為最近動作，並以輸出字串測試驗證

## 6. 整合驗收

- [x] 6.1 執行 `npm test -w backend`，確認新增測試及既有 `graph.test.ts`、`replay.test.ts`、router 與 BrowserTools 測試全部通過
- [x] 6.2 查核前端 TestLog/SSE 自由文字渲染並進行前後端連動測試，確認未知 `strategy_hint` action 能正常顯示且不誤標為 pending/error
- [x] 6.3 使用固定 URL 目標案例連跑 3 次，確認 3/3 成功、每步不超過 5 個 Executor rounds，且 hard/SPA 導航後 URL 均正確落入日誌
- [x] 6.4 使用固定非 URL Objective 案例連跑 3 次，確認 3/3 成功且 Executor 未為迎合 Objective 改寫 Step Action
- [x] 6.5 執行 business failure 案例，確認 Asserter FAIL 後零 Executor 工具呼叫、`termination_cause` 正確、`finalReason` 保留斷言理由且無敏感值
- [x] 6.6 執行 operational failure 與 popup 案例，確認共用回合不重置、預算耗盡或 `unsupported_new_page` 正確收斂，且不重複開啟分頁
- [x] 6.7 核對 `test_log`／`test_run_step`／`test_run`，確認 strategy hint、導航 URL、分類式終止 reason 與遮蔽動作摘要正確持久化；同時檢查 `reportModelId` 設定但不改變未設定時跳過 failure summary 的既有規則
