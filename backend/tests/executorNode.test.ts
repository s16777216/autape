import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemMessage } from "@langchain/core/messages";
import { E2EGraphBuilder } from "../src/graph.js";
import { routeAfterExecution } from "../src/graph/router.js";
import { AppDataSource } from "../src/db.js";

function state(overrides: Record<string, unknown> = {}) {
  return {
    run_id: "run",
    test_id: "test",
    testcase_version: 0,
    test_name: "Objective test",
    steps: ["輸入固定值 A"],
    step_expecteds: ["改成輸入 B 才會成功"],
    current_step_idx: 0,
    executor_turn_count: 0,
    executor_last_round_done: false,
    step_retry_count: 0,
    step_assertion_result: null,
    step_assertion_reason: "",
    step_assertion_failure_type: null,
    termination_cause: null,
    logs: [],
    ...overrides,
  } as any;
}

function harness(toolCalls: Array<{ name: string; args: Record<string, unknown> }>, results: Record<string, string>) {
  const invoke = vi.fn().mockResolvedValue({
    tool_calls: toolCalls,
    content: "",
    usage_metadata: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
  });
  const toolSpies = Object.fromEntries(Object.entries(results).map(([name, result]) => [
    name,
    vi.fn().mockResolvedValue(result),
  ]));
  const builder = Object.create(E2EGraphBuilder.prototype) as E2EGraphBuilder;
  Object.assign(builder as any, {
    enableReplay: false,
    model: { invoke },
    browserManager: {
      page: { url: () => "https://example.com/current" },
      observeWebPage: vi.fn().mockResolvedValue({ elementList: "DOM", screenshotBase64: "cG5n" }),
      getPageScreenshotBase64: vi.fn().mockResolvedValue("cG5n"),
    },
    browserToolsInstance: { elementTimeout: 5000 },
    tools: Object.entries(toolSpies).map(([name, call]) => ({ name, invoke: call })),
  });
  vi.spyOn(AppDataSource, "getRepository").mockReturnValue({ findOne: vi.fn().mockResolvedValue(null) } as any);
  return { builder, invoke, toolSpies };
}

afterEach(() => vi.restoreAllMocks());

describe("executorNode objective, round and terminal behavior", () => {
  it("Objective only appears in Human data; System retains Action and authority rule", async () => {
    const { builder, invoke } = harness([{ name: "done_acting", args: { message: "done" } }], {
      done_acting: "DONE_ACTING: done",
    });
    await builder.executorNode(state());
    const messages = invoke.mock.calls[0][0];
    expect(messages[0]).toBeInstanceOf(SystemMessage);
    expect(messages[0].content).toContain("輸入固定值 A");
    expect(messages[0].content).toContain("Step Action > Step Objective");
    expect(messages[0].content).not.toContain("改成輸入 B 才會成功");
    expect(JSON.stringify(messages[1].content)).toContain("改成輸入 B 才會成功");
  });

  it("fixed non-URL Objective preserves the Step Action in 3/3 runs", async () => {
    for (let run = 0; run < 3; run++) {
      const { builder, invoke } = harness([{ name: "done_acting", args: { message: "action A completed" } }], {
        done_acting: "DONE_ACTING: action A completed",
      });
      const update = await builder.executorNode(state({ step_expecteds: ["畫面顯示 B，但不得改寫輸入值"] }));
      const messages = invoke.mock.calls[0][0];
      expect(messages[0].content).toContain("輸入固定值 A");
      expect(messages[0].content).not.toContain("畫面顯示 B，但不得改寫輸入值");
      expect(update.executor_turn_count).toBeLessThanOrEqual(5);
      expect(update.executor_last_round_done).toBe(true);
      vi.restoreAllMocks();
    }
  });

  it("done_acting terminates the batch, preserves one-round accounting and wins over budget", async () => {
    const { builder, toolSpies } = harness([
      { name: "click", args: { id: 1 } },
      { name: "done_acting", args: { message: "done" } },
      { name: "input", args: { id: 2, text: "must-not-run" } },
    ], { click: "成功", done_acting: "DONE_ACTING", input: "成功" });
    const update = await builder.executorNode(state({ executor_turn_count: 4 }));
    expect(toolSpies.click).toHaveBeenCalledOnce();
    expect(toolSpies.done_acting).toHaveBeenCalledOnce();
    expect(toolSpies.input).not.toHaveBeenCalled();
    expect(update.executor_turn_count).toBe(5);
    expect(update.executor_last_round_done).toBe(true);
    expect(routeAfterExecution({
      ...state(),
      ...update,
      logs: [...update.logs, {
        step_idx: 0, step_description: "step", action: "strategy_hint",
        result: "synthetic after done", timestamp: new Date().toISOString(),
      }],
    })).toBe("step_asserter");
  });

  it("all-tools-failed adds one deduplicated strategy hint that enters history", async () => {
    const first = harness([{ name: "click", args: { id: 1 } }], { click: "點擊失敗：missing" });
    const firstUpdate = await first.builder.executorNode(state());
    expect(firstUpdate.logs.filter((log: any) => log.action === "strategy_hint")).toHaveLength(1);

    vi.restoreAllMocks();
    const second = harness([{ name: "click", args: { id: 1 } }], { click: "點擊失敗：missing" });
    const secondUpdate = await second.builder.executorNode(state({
      executor_turn_count: 1,
      logs: firstUpdate.logs,
    }));
    expect(secondUpdate.logs.filter((log: any) => log.action === "strategy_hint")).toHaveLength(1);
    expect(JSON.stringify(second.invoke.mock.calls[0][0])).toContain("strategy_hint");
  });

  it("unsupported_new_page stops later tools and sets an explicit termination cause", async () => {
    const { builder, toolSpies } = harness([
      { name: "click", args: { id: 1 } },
      { name: "click", args: { id: 1 } },
    ], { click: "錯誤：unsupported_new_page：https://example.com/popup" });
    const update = await builder.executorNode(state());
    expect(toolSpies.click).toHaveBeenCalledTimes(1);
    expect(update.termination_cause).toBe("unsupported_new_page");
    expect(routeAfterExecution({ ...state(), ...update })).toBe("reporter");
  });
});
