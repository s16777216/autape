import { describe, expect, it } from "vitest";
import {
  canonicalizeToolArguments,
  detectNoProgress,
  isFailedToolResult,
} from "../src/graph/noProgress.js";
import type { LogEntry } from "../src/state.js";

const log = (action: string, result: string, executor_round = 1): LogEntry => ({
  step_idx: 0,
  step_description: "step",
  action,
  result,
  executor_round,
  timestamp: new Date().toISOString(),
});

describe("conservative no-progress detection", () => {
  it("recursive canonicalization ignores object key order", () => {
    expect(canonicalizeToolArguments({ b: 2, a: { y: 2, x: 1 } }))
      .toBe(canonicalizeToolArguments({ a: { x: 1, y: 2 }, b: 2 }));
  });

  it.each([
    { currentRoundLogs: [], expected: null },
    { currentRoundLogs: [log('click({"id":1})', "點擊失敗")], expected: "all_tools_failed" },
    { currentRoundLogs: [log('click({"id":1})', "點擊失敗"), log("observe_web_page({})", "成功")], expected: null },
    { currentRoundLogs: [log('click({"id":1})', "成功")], expected: null },
  ])("all_tools_failed requires a non-empty, entirely failed tool round", ({ currentRoundLogs, expected }) => {
    expect(detectNoProgress({ currentRoundLogs, previousLogs: [] })).toBe(expected);
  });

  it("相鄰 round 重複 canonicalized side effect", () => {
    expect(detectNoProgress({
      previousLogs: [log('click({"options":{"b":2,"a":1},"id":7})', "成功", 1)],
      currentRoundLogs: [log('click({"id":7,"options":{"a":1,"b":2}})', "成功", 2)],
    })).toBe("repeated_side_effect");
  });

  it.each(["observe_web_page({})", "wait_for_seconds({\"seconds\":1})", "done_acting({})"])(
    "%s 不參與 repeated_side_effect",
    (action) => expect(detectNoProgress({
      previousLogs: [log(action, "成功", 1)],
      currentRoundLogs: [log(action, "成功", 2)],
    })).toBeNull(),
  );

  it("不同成功副作用打斷重複，synthetic logs 不自我觸發", () => {
    expect(detectNoProgress({
      previousLogs: [
        log('click({"id":1})', "成功", 1),
        log("strategy_hint", "all_tools_failed", 2),
        log('navigate_to({"url":"https://example.com"})', "成功", 2),
      ],
      currentRoundLogs: [log('click({"id":1})', "成功", 3)],
    })).toBeNull();
  });

  it("同輪兩原因命中時 all_tools_failed 優先", () => {
    expect(detectNoProgress({
      previousLogs: [log('click({"id":1})', "成功", 1)],
      currentRoundLogs: [log('click({"id":1})', "錯誤：失敗", 2)],
    })).toBe("all_tools_failed");
  });

  it("shared failure classifier follows the Replay string contract", () => {
    expect(isFailedToolResult("操作失敗：timeout")).toBe(true);
    expect(isFailedToolResult("錯誤：未初始化")).toBe(true);
    expect(isFailedToolResult("已成功完成")).toBe(false);
  });
});
