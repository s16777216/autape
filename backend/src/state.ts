import { Annotation } from "@langchain/langgraph";

export interface LogEntry {
  step_idx: number;
  step_description: string;
  action: string;
  result: string;
  ai_response?: string;
  timestamp: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  executor_round?: number;
}

export type AssertionFailureType = "business" | "operational";
export type TerminationCause =
  | "business_assertion_failure"
  | "operational_budget_exhausted"
  | "executor_budget_exhausted"
  | "unsupported_new_page"
  | null;

export const TestState = Annotation.Root({
  // 測試案例基本資訊
  run_id: Annotation<string>(),
  test_id: Annotation<string>(),
  testcase_version: Annotation<number>(),
  test_name: Annotation<string>(),
  steps: Annotation<string[]>(),
  step_expecteds: Annotation<string[]>(),
  expected: Annotation<string>(),
  
// 執行過程狀態
  current_step_idx: Annotation<number>(),
  executor_turn_count: Annotation<number>(),  // 動作輪次計數（executor 尚未宣告完成前的執行次數）
  executor_last_round_done: Annotation<boolean>(),
  step_retry_count: Annotation<number>(),     // 斷言重試計數（step_asserter 判定 FAIL 後的重試次數）
  step_assertion_result: Annotation<"PASS" | "FAIL" | null>(),
  step_assertion_reason: Annotation<string>(),
  step_assertion_failure_type: Annotation<AssertionFailureType | null>(),
  termination_cause: Annotation<TerminationCause>(),
  last_screenshot: Annotation<string | null>(),   // base64 字串，用以傳給 Gemini 多模態
  simplified_dom: Annotation<string>(),          // 簡化過濾後的 DOM 文字
  
  // 紀錄與產出
  reports_dir: Annotation<string>(),              // 報告輸出目錄
  screenshots_paths: Annotation<string[]>(),      // 存檔截圖檔案路徑清單 (相對路徑)
  logs: Annotation<LogEntry[]>(),                 // 測試日誌記錄
  system_prompt: Annotation<string | undefined>(), // 前置提示詞 / UI 指引
  final_result: Annotation<string>(),             // "PASS" | "FAIL" | "ERROR"
  final_reason: Annotation<string>()              // 結果判定理由
});

// 導出 State 型別，以便在 Node 函數中進行型別標記
export type TestStateType = typeof TestState.State;
