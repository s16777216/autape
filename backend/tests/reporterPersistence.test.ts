import { afterEach, describe, expect, it, vi } from "vitest";
import { E2EGraphBuilder } from "../src/graph.js";
import { AppDataSource } from "../src/db.js";
import { TestRun } from "../src/entities/TestRun.js";
import { TestRunStep } from "../src/entities/TestRunStep.js";
import { TestLog } from "../src/entities/TestLog.js";

afterEach(() => vi.restoreAllMocks());

describe("reporter persistence mapping", () => {
  it("persists diagnostic logs and a redacted classified finalReason without a report model", async () => {
    const run: any = {
      id: "run-1", testcase: { expected: "done" }, failureSummary: null,
      totalPromptTokens: 0, totalCompletionTokens: 0, totalTokens: 0,
    };
    const runRepo = {
      findOne: vi.fn().mockResolvedValue(run),
      save: vi.fn(async (value) => value),
      query: vi.fn().mockResolvedValue(undefined),
    };
    const stepRepo = {
      findOne: vi.fn().mockResolvedValue(null),
      save: vi.fn(async (value: any) => Object.assign(value, { id: "step-1" })),
      query: vi.fn().mockResolvedValue(undefined),
    };
    const savedLogs: any[] = [];
    const logRepo = {
      save: vi.fn(async (value: any) => {
        value.id = `log-${savedLogs.length + 1}`;
        savedLogs.push(value);
        return value;
      }),
      query: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(AppDataSource, "getRepository").mockImplementation(((entity: unknown) => {
      if (entity === TestRun) return runRepo;
      if (entity === TestRunStep) return stepRepo;
      if (entity === TestLog) return logRepo;
      throw new Error("unexpected repository");
    }) as any);

    const builder = Object.create(E2EGraphBuilder.prototype) as E2EGraphBuilder;
    Object.assign(builder as any, {
      browserManager: { page: null, closeBrowser: vi.fn().mockResolvedValue(undefined) },
      summarizer_model: undefined,
    });
    const logs = [
      { step_idx: 0, step_description: "登入", action: 'navigate_to({"url":"https://example.com/dashboard?token=secret"})', result: "已成功導航至網址：https://example.com/dashboard?token=secret", timestamp: new Date().toISOString() },
      { step_idx: 0, step_description: "登入", action: 'input({"id":2,"text":"password"})', result: "成功", timestamp: new Date().toISOString() },
      { step_idx: 0, step_description: "登入", action: "strategy_hint", result: "[all_tools_failed] switch strategy", ai_response: "all_tools_failed", timestamp: new Date().toISOString() },
    ];

    const update = await builder.reporterNode({
      run_id: run.id, test_name: "test", current_step_idx: 0, steps: ["登入"],
      termination_cause: "executor_budget_exhausted", step_assertion_reason: "",
      logs, final_result: "", final_reason: "",
    } as any);

    expect(update.final_reason).toContain("Executor 回合預算已耗盡");
    expect(update.final_reason).toContain("策略診斷");
    expect(update.final_reason).toContain("https://example.com/dashboard");
    expect(update.final_reason).not.toContain("password");
    expect(update.final_reason).not.toContain("token=secret");
    expect(savedLogs.map((log) => log.action)).toContain("strategy_hint");
    expect(run.finalReason).toBe(update.final_reason);
    expect(run.failureSummary).toBeNull();
  });
});
