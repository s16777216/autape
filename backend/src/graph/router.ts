import { LogEntry } from "../state.js";

/**
 * 執行後的條件路由：決定下一步是繼續執行、完成步驟、還是失敗中斷
 */
export function routeAfterExecution(state: {
  logs: LogEntry[];
  executor_turn_count: number;
  executor_last_round_done?: boolean;
  termination_cause?: string | null;
  current_step_idx: number;
  step_expecteds: string[];
}): "executor" | "step_asserter" | "reporter" {
  const logs = state.logs || [];
  if (state.termination_cause === "unsupported_new_page") {
    return "reporter";
  }

  const legacyLastAction = logs[logs.length - 1]?.action || "";
  if (
    state.executor_last_round_done === true ||
    (state.executor_last_round_done === undefined && legacyLastAction.includes("done_acting"))
  ) {
    return "step_asserter";
  }

  // 檢查動作輪次是否超限 (上限 5 次，防止 Executor 無限循環執行)
  if ((state.executor_turn_count ?? 0) >= 5) {
    return "reporter";
  }

  return "executor";
}

/**
 * 步驟斷言後的條件路由：通過則推進，失敗則補救或在超限後中斷。
 */
export function routeAfterAssertion(state: {
  step_assertion_result: "PASS" | "FAIL" | null;
  step_assertion_failure_type?: "business" | "operational" | null;
  executor_turn_count: number;
}): "step_tracker" | "executor" | "reporter" {
  if (state.step_assertion_result === "PASS") {
    return "step_tracker";
  }

  if (state.step_assertion_failure_type === "business") {
    return "reporter";
  }

  if ((state.executor_turn_count ?? 0) >= 5) {
    return "reporter";
  }

  return "executor";
}

/**
 * 步驟推進後的路由：判斷是否還有下一步，或是進入最終報告收尾
 */
export function routeNextStep(state: {
  current_step_idx: number;
  steps: string[];
}): "executor" | "reporter" {
  if (state.current_step_idx < state.steps.length) {
    return "executor";
  }
  return "reporter";
}
