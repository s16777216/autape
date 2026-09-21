## 1. Schema 與 Prompt：斷言失敗分類

- [ ] 1.1 於 `backend/src/graph/prompt.ts` 的 `StepAssertionSchema` 新增 `failure_type: z.enum(["business", "operational"])`（可選輸出，附 description），並於 `buildStepAsserterPrompt` Rules 新增定義（business = 動作已完成但結果與預期不符；operational = 動作可能未完成或操作層障礙）與「FAIL 時必須一併標記 failure_type」指示；以 `graph.test.ts` 擴充 schema 測試驗證含/不含 failure_type 皆可解析
- [ ] 1.2 於 `backend/src/graph.ts` 的 `StepAssertion` 型別與 `parseStepAssertionResponse` 增加 `failure_type` 解析，缺欄位時以 `"operational"` 作預設，例外路徑與各供應商 response shape 兼容；以 `graph.test.ts` 的 `parseStepAssertionResponse` 測試覆蓋「含 failure_type」「缺 failure_type 補預設」「raw tool call／raw JSON content」情境

## 2. 狀態與節點回流

- [ ] 2.1 於 `backend/src/state.ts` 的 `TestState` 新增 `step_assertion_failure_type: Annotation<"business" | "operational" | null>()`，並於 `stepAsserterNode` 各 return 分支（PASS／FAIL／例外）帶出該欄位；以 `graph.test.ts` 的 `stepAsserterNode` 測試驗證 FAIL 時回傳正確 failure_type
- [ ] 2.2 於 `backend/src/graph.ts` 的 `executorNode` Execution History 組裝處（`graph.ts:492-503`），依 `state.step_assertion_failure_type` 分流 `assert_failure` 回饋語意：`business` 附加「此步驟預期結果未被滿足，完成要求的動作後請直接呼叫 done_acting，不得追加以改變失敗狀態」，`operational`／無值維持現行補救語意；以 `graph.test.ts` 新增測試驗證 historyPrompt 字串分支

## 3. 回歸驗證

- [ ] 3.1 執行 `npm test -w backend`（vitest）確認既有 `graph.test.ts`／`replay.test.ts` 不因 `failure_type` 欄位與語意分流而回歸；資料庫無 Schema 變更，前端 log 維持自由文字、失敗分類以文字呈現於 `assert_failure` log