import { describe, it, expect, vi } from "vitest";
import { END, START, StateGraph } from "@langchain/langgraph";
import {
  buildExecutorSystemPrompt,
  buildAsserterSystemPrompt,
  buildStepAsserterPrompt,
  StepAssertionSchema,
  StepAssertionStructuredOutputSchema,
} from "../src/graph/prompt.js";
import { zodResponseFormat } from "openai/helpers/zod";
import {
  routeAfterAssertion,
  routeAfterExecution,
  routeNextStep,
} from "../src/graph/router.js";
import {
  LogEntry,
  TestState,
  type TestStateType,
  type TerminationCause,
} from "../src/state.js";
import {
  buildExecutionHistoryPrompt,
  E2EGraphBuilder,
  parseStepAssertionResponse,
} from "../src/graph.js";
import { AppDataSource } from "../src/db.js";
import { TestLog } from "../src/entities/TestLog.js";
import { TestRun } from "../src/entities/TestRun.js";
import { TestRunStep } from "../src/entities/TestRunStep.js";

function createStepAsserterHarness(response: unknown) {
  const invoke = vi.fn().mockResolvedValue(response);
  const getSimplifiedDOM = vi.fn().mockResolvedValue(
    '<div role="alert">登入成功</div>',
  );
  const getPageScreenshotBase64 = vi.fn().mockResolvedValue("cG5n");
  const builder = Object.create(E2EGraphBuilder.prototype) as E2EGraphBuilder;
  Object.assign(builder as any, {
    asserter_model: { invoke },
    browserManager: { getSimplifiedDOM, getPageScreenshotBase64 },
  });
  return { builder, invoke, getSimplifiedDOM, getPageScreenshotBase64 };
}

function createAssertionState(
  stepExpected: string,
  stepRetryCount = 1,
  executorTurnCount = 3,
) {
  return {
    test_name: "登入測試",
    steps: ["點擊登入"],
    step_expecteds: [stepExpected],
    current_step_idx: 0,
    step_retry_count: stepRetryCount,
    executor_turn_count: executorTurnCount,
    step_assertion_result: null,
    step_assertion_reason: "",
    step_assertion_failure_type: null,
    termination_cause: null,
    logs: [],
    last_screenshot: null,
    simplified_dom: "",
  } as any;
}

describe("狀態機 Prompt 拼接與條件路由單元測試", () => {
  describe("Prompt 拼接 (prompt.ts)", () => {
    it("1. buildExecutorSystemPrompt 應正確渲染測試案例、步驟與當前網址", () => {
      const prompt = buildExecutorSystemPrompt({
        testName: "會員註冊功能測試",
        stepIdx: 1,
        stepContent: "點擊同意服務條款",
        currentUrl: "https://example.com/register"
      });

      expect(prompt).toContain("會員註冊功能測試");
      expect(prompt).toContain("Current Step (2)");
      expect(prompt).toContain("點擊同意服務條款");
      expect(prompt).toContain("https://example.com/register");
      expect(prompt).not.toContain("- Step Expected Outcome:");
    });

    it("1b. buildExecutorSystemPrompt 不應要求 Executor 驗證預期結果", () => {
      const prompt = buildExecutorSystemPrompt({
        testName: "會員註冊功能測試",
        stepIdx: 1,
        stepContent: "點擊同意服務條款",
        currentUrl: "https://example.com/register"
      });

      expect(prompt).not.toContain("Step Expected Outcome");
      expect(prompt).not.toContain("waitStrategy or wait_for_seconds");
      expect(prompt).toContain("independent assertion stage");
      expect(prompt).toContain("call 'done_acting' immediately");
    });

    it("1b2. buildExecutorSystemPrompt 應在點擊觸發導航後要求立即 done_acting，而非在新頁面重搜同一元素", () => {
      const prompt = buildExecutorSystemPrompt({
        testName: "會員註冊功能測試",
        stepIdx: 1,
        stepContent: "點擊同意服務條款",
        currentUrl: "https://example.com/register"
      });

      expect(prompt).toContain("CLICK-NAVIGATION MEANS DONE");
      expect(prompt).toContain("do NOT search for the same element again on the newly loaded page");
      expect(prompt).toContain("NEVER call navigate_to for the URL you are already on");
    });

    it("1c. buildStepAsserterPrompt 與 schema 應支援純模型結構化斷言", () => {
      const prompt = buildStepAsserterPrompt({
        testName: "會員註冊功能測試",
        stepIdx: 1,
        stepContent: "點擊同意服務條款",
        stepExpected: "看到同意成功提示",
      });

      expect(prompt).toContain("independent Web E2E step assertion auditor");
      expect(prompt).toContain("看到同意成功提示");
      expect(prompt).toContain("DOM evidence and screenshot");
      expect(prompt).toContain("Do not treat text:, url:");
      expect(prompt).toContain("Always return failure_type");
      expect(prompt).toContain("For PASS, return null");
      expect(prompt).toContain("Use business");
      expect(prompt).toContain("Use operational");
      expect(StepAssertionSchema.parse({ result: "PASS", reason: "提示可見" }))
        .toEqual({ result: "PASS", reason: "提示可見" });
      expect(StepAssertionSchema.parse({
        result: "FAIL",
        reason: "顯示拒絕訊息",
        failure_type: "business",
      })).toEqual({
        result: "FAIL",
        reason: "顯示拒絕訊息",
        failure_type: "business",
      });
      expect(() => StepAssertionSchema.parse({
        result: "FAIL",
        reason: "未知",
        failure_type: "unknown",
      })).toThrow();
      expect(() => StepAssertionSchema.parse({ result: "UNKNOWN", reason: "" }))
        .toThrow();
    });

    it("1d. provider schema 符合 OpenAI strict structured outputs", () => {
      const format = zodResponseFormat(
        StepAssertionStructuredOutputSchema,
        "step_assertion",
      );
      const jsonSchema = (format as any).json_schema.schema;

      expect(jsonSchema.required).toEqual([
        "result",
        "reason",
        "failure_type",
      ]);
      expect(jsonSchema.properties.failure_type.anyOf).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "string" }),
          { type: "null" },
        ]),
      );
      expect(StepAssertionStructuredOutputSchema.parse({
        result: "FAIL",
        reason: "供應商無法分類",
        failure_type: null,
      }).failure_type).toBeNull();
    });

    it("2. buildAsserterSystemPrompt 應正確渲染斷言資訊", () => {
      const prompt = buildAsserterSystemPrompt({
        testName: "購物車結帳測試",
        expected: "顯示訂單成立與交易序號"
      });

      expect(prompt).toContain("購物車結帳測試");
      expect(prompt).toContain("顯示訂單成立與交易序號");
    });
  });

  describe("條件路由邏輯 (router.ts)", () => {
    it("3. routeAfterExecution: 沒有日誌時應回傳 executor 繼續執行", () => {
      const result = routeAfterExecution({
        logs: [],
        executor_turn_count: 0,
        current_step_idx: 0,
        step_expecteds: []
      });
      expect(result).toBe("executor");
    });

    it("4a. routeAfterExecution: 無預期結果時呼叫 done_acting 仍應路由至 step_asserter", () => {
      const result = routeAfterExecution({
        logs: [
          {
            step_idx: 0,
            step_description: "點擊按鈕",
            action: "done_acting()",
            result: "Done",
            timestamp: new Date().toISOString()
          }
        ],
        executor_turn_count: 1,
        current_step_idx: 0,
        step_expecteds: [""]
      });
      expect(result).toBe("step_asserter");
    });

    it("4b. routeAfterExecution: 有預期結果時呼叫 done_acting 應路由至 step_asserter", () => {
      const result = routeAfterExecution({
        logs: [
          {
            step_idx: 0,
            step_description: "點擊登入按鈕",
            action: "done_acting()",
            result: "Done",
            timestamp: new Date().toISOString()
          }
        ],
        executor_turn_count: 1,
        current_step_idx: 0,
        step_expecteds: ["顯示儀表板"]
      });
      expect(result).toBe("step_asserter");
    });

    it("5b. routeAfterAssertion: PASS 應推進至 step_tracker", () => {
      expect(routeAfterAssertion({
        step_assertion_result: "PASS",
        step_assertion_failure_type: "business",
        executor_turn_count: 5,
      }))
        .toBe("step_tracker");
    });

    it.each([0, 4, 5])("5c. routeAfterAssertion: business FAIL 在第 %s 輪皆直接進 reporter", (executorTurnCount) => {
      expect(routeAfterAssertion({
        step_assertion_result: "FAIL",
        step_assertion_failure_type: "business",
        executor_turn_count: executorTurnCount,
      })).toBe("reporter");
    });

    it.each(["operational", null, undefined] as const)(
      "5d. routeAfterAssertion: %s FAIL 依 Executor 預算補救或終止",
      (failureType) => {
        expect(routeAfterAssertion({
          step_assertion_result: "FAIL",
          step_assertion_failure_type: failureType,
          executor_turn_count: 4,
        })).toBe("executor");
        expect(routeAfterAssertion({
          step_assertion_result: "FAIL",
          step_assertion_failure_type: failureType,
          executor_turn_count: 5,
        })).toBe("reporter");
      },
    );

    it("5e. termination_cause 型別接受 assertion 終止原因", () => {
      const causes: TerminationCause[] = [
        "business_assertion_failure",
        "operational_budget_exhausted",
        null,
      ];
      expect(causes).toHaveLength(3);
    });

    it("5. routeAfterExecution: 動作輪次達到 5 次且未呼叫 done_acting 時應路由至 reporter 失敗中斷", () => {
      const result = routeAfterExecution({
        logs: [
          {
            step_idx: 0,
            step_description: "找不到按鈕",
            action: "click()",
            result: "Element not found",
            timestamp: new Date().toISOString()
          }
        ],
        executor_turn_count: 5,
        current_step_idx: 0,
        step_expecteds: []
      });
      expect(result).toBe("reporter");
    });

    it("5b2. routeAfterExecution: 動作輪次未達上限 (且未 done_acting) 應回執行 executor", () => {
      const result = routeAfterExecution({
        logs: [
          {
            step_idx: 0,
            step_description: "找不到按鈕",
            action: "click()",
            result: "Element not found",
            timestamp: new Date().toISOString()
          }
        ],
        executor_turn_count: 4,
        current_step_idx: 0,
        step_expecteds: []
      });
      expect(result).toBe("executor");
    });

    it("6. routeNextStep: 當前步驟索引小於總步驟時應回傳 executor", () => {
      const result = routeNextStep({
        current_step_idx: 1,
        steps: ["第一步", "第二步"]
      });
      expect(result).toBe("executor");
    });

    it("7. routeNextStep: 當前步驟索引達到或大於總步驟時應回傳 reporter 進行收尾報告", () => {
      const result = routeNextStep({
        current_step_idx: 2,
        steps: ["第一步", "第二步"]
      });
      expect(result).toBe("reporter");
    });
  });

  describe("步驟模型斷言 (stepAsserterNode)", () => {
    it("parsed 為 null 時可從 raw JSON content 解析 LiteLLM 回應", () => {
      expect(parseStepAssertionResponse({
        parsed: null,
        raw: { content: '```json\n{"result":"FAIL","reason":"結果不符","failure_type":"business"}\n```' },
      })).toEqual({
        result: "FAIL",
        reason: "結果不符",
        failure_type: "business",
      });
    });

    it("parsed 為 null 時可從 LangChain raw tool_calls 解析回應", () => {
      expect(parseStepAssertionResponse({
        parsed: null,
        raw: {
          content: "",
          tool_calls: [
            {
              name: "extract",
              args: {
                result: "FAIL",
                reason: "尚未跳轉",
                failure_type: "operational",
              },
            },
          ],
        },
      })).toEqual({
        result: "FAIL",
        reason: "尚未跳轉",
        failure_type: "operational",
      });
    });

    it("parsed 為 null 時可從 OpenAI-compatible raw tool call arguments 解析回應", () => {
      expect(parseStepAssertionResponse({
        parsed: null,
        raw: {
          content: "",
          additional_kwargs: {
            tool_calls: [
              {
                function: {
                  arguments: '{"result":"FAIL","reason":"拒絕登入","failure_type":"business"}',
                },
              },
            ],
          },
        },
      })).toEqual({
        result: "FAIL",
        reason: "拒絕登入",
        failure_type: "business",
      });
    });

    it.each([
      { result: "FAIL", reason: "缺少分類" },
      { result: "FAIL", reason: "無效分類", failure_type: "unknown" },
      { result: "FAIL", reason: "nullable provider 分類", failure_type: null },
    ])("FAIL 缺少或無效分類時採 operational 預設", (parsed) => {
      expect(parseStepAssertionResponse({ parsed })).toEqual({
        result: "FAIL",
        reason: parsed.reason,
        failure_type: "operational",
      });
    });

    it("分類欄位讀取例外時採 operational 預設", () => {
      const parsed = {
        result: "FAIL",
        reason: "分類供應商欄位異常",
        get failure_type(): never {
          throw new Error("provider getter failed");
        },
      };
      expect(parseStepAssertionResponse({ parsed })).toEqual({
        result: "FAIL",
        reason: "分類供應商欄位異常",
        failure_type: "operational",
      });
    });

    it("PASS 永遠清除 failure type，連續解析不沿用前一次 FAIL", () => {
      expect(parseStepAssertionResponse({
        parsed: { result: "FAIL", reason: "先失敗", failure_type: "business" },
      }).failure_type).toBe("business");
      expect(parseStepAssertionResponse({
        parsed: { result: "PASS", reason: "後通過", failure_type: "business" },
      })).toEqual({ result: "PASS", reason: "後通過", failure_type: null });
    });

    it("無 expected 時直接通過且不呼叫模型", async () => {
      const { builder, invoke, getSimplifiedDOM, getPageScreenshotBase64 } =
        createStepAsserterHarness({});

      const update = await builder.stepAsserterNode(createAssertionState("   "));

      expect(update.step_assertion_result).toBe("PASS");
      expect(update.step_assertion_failure_type).toBeNull();
      expect(update.termination_cause).toBeNull();
      expect(update.logs.at(-1)?.action).toBe("assert_skipped");
      expect(invoke).not.toHaveBeenCalled();
      expect(getSimplifiedDOM).not.toHaveBeenCalled();
      expect(getPageScreenshotBase64).not.toHaveBeenCalled();
    });

    it.each([
      "顯示登入成功訊息",
      "url:/dashboard",
      "https://example.com/dashboard",
    ])("非空 expected『%s』一律蒐集 DOM/畫面並呼叫模型", async (expected) => {
      const { builder, invoke, getSimplifiedDOM, getPageScreenshotBase64 } =
        createStepAsserterHarness({
          parsed: { result: "PASS", reason: "畫面證據符合預期" },
          raw: {
            usage_metadata: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
            },
          },
        });

      const update = await builder.stepAsserterNode(createAssertionState(expected));

      expect(invoke).toHaveBeenCalledOnce();
      expect(getSimplifiedDOM).toHaveBeenCalledOnce();
      expect(getPageScreenshotBase64).toHaveBeenCalledOnce();
      expect(update.step_assertion_result).toBe("PASS");
      expect(update.step_assertion_failure_type).toBeNull();
      expect(update.termination_cause).toBeNull();
      expect(update.logs.at(-1)).toMatchObject({
        action: "assert_pass",
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      });
    });

    it("operational FAIL 保留理由、已用 Executor round 並返回 executor", async () => {
      const { builder } = createStepAsserterHarness({
        parsed: {
          result: "FAIL",
          reason: "頁面仍顯示登入表單",
          failure_type: "operational",
        },
        raw: {
          usage_metadata: {
            input_tokens: 8,
            output_tokens: 4,
            total_tokens: 12,
          },
        },
      });

      const update = await builder.stepAsserterNode(
        createAssertionState("顯示登入成功訊息", 3),
      );

      expect(update.step_assertion_result).toBe("FAIL");
      expect(update.step_assertion_failure_type).toBe("operational");
      expect(update.termination_cause).toBeNull();
      expect(update.executor_turn_count).toBeUndefined();
      expect(update.step_retry_count).toBe(4);
      expect(update.logs.at(-1)).toMatchObject({
        action: "assert_failure",
        result: "斷言未通過 [operational]：頁面仍顯示登入表單",
        ai_response: JSON.stringify({
          result: "FAIL",
          reason: "頁面仍顯示登入表單",
          failure_type: "operational",
        }),
        total_tokens: 12,
      });
      expect(routeAfterAssertion({
        ...createAssertionState("顯示登入成功訊息", 3, 3),
        ...update,
      })).toBe("executor");
    });

    it("business FAIL 設終止原因並直接路由至 reporter", async () => {
      const { builder } = createStepAsserterHarness({
        parsed: {
          result: "FAIL",
          reason: "帳號遭拒絕",
          failure_type: "business",
        },
        raw: { usage_metadata: {} },
      });

      const update = await builder.stepAsserterNode(
        createAssertionState("顯示完成畫面", 1, 1),
      );

      expect(update.step_assertion_failure_type).toBe("business");
      expect(update.termination_cause).toBe("business_assertion_failure");
      expect(routeAfterAssertion({
        ...createAssertionState("顯示完成畫面", 1, 1),
        ...update,
      })).toBe("reporter");
    });

    it("第 5 輪 operational FAIL 設預算耗盡並路由至 reporter", async () => {
      const { builder } = createStepAsserterHarness({
        parsed: {
          result: "FAIL",
          reason: "按鈕仍未生效",
          failure_type: "operational",
        },
        raw: { usage_metadata: {} },
      });
      const state = createAssertionState("顯示完成畫面", 2, 5);
      const update = await builder.stepAsserterNode(state);

      expect(update.termination_cause).toBe("operational_budget_exhausted");
      expect(routeAfterAssertion({ ...state, ...update })).toBe("reporter");
    });

    it("不可解析的 raw 回應會保留診斷內容與 Token 用量", async () => {
      const { builder } = createStepAsserterHarness({
        parsed: null,
        raw: {
          content: "無法判斷",
          usage_metadata: {
            input_tokens: 21,
            output_tokens: 3,
            total_tokens: 24,
          },
        },
      });

      const update = await builder.stepAsserterNode(
        createAssertionState("顯示 Example Domain", 1),
      );

      expect(update.step_assertion_result).toBe("FAIL");
      expect(update.step_assertion_failure_type).toBe("operational");
      expect(update.termination_cause).toBeNull();
      expect(update.logs.at(-1)).toMatchObject({
        action: "assert_failure",
        prompt_tokens: 21,
        completion_tokens: 3,
        total_tokens: 24,
      });
      expect(update.logs.at(-1)?.result).toContain("模型未回傳可解析的步驟斷言");
      expect(update.logs.at(-1)?.ai_response).toContain("無法判斷");
    });
  });

  describe("Assertion state 與歷史清理", () => {
    it("init state 初始化 failure type 與 termination cause，兼容舊輸入 fixture", async () => {
      const builder = Object.create(E2EGraphBuilder.prototype) as E2EGraphBuilder;
      const update = await (builder as any).initNode({
        step_assertion_result: "FAIL",
        step_assertion_reason: "舊理由",
      });

      expect(update).toMatchObject({
        step_assertion_result: null,
        step_assertion_reason: "",
        step_assertion_failure_type: null,
        termination_cause: null,
      });
    });

    it("stepTracker 成功推進時清除 assertion state 並重設 Executor round", async () => {
      const getRepository = vi.spyOn(AppDataSource, "getRepository").mockReturnValue({
        findOne: vi.fn().mockResolvedValue(null),
      } as any);
      const builder = Object.create(E2EGraphBuilder.prototype) as E2EGraphBuilder;
      Object.assign(builder as any, {
        browserManager: {
          getPageScreenshotBase64: vi.fn().mockResolvedValue("cG5n"),
        },
      });

      try {
        const update = await builder.stepTrackerNode({
          ...createAssertionState("顯示完成畫面", 2, 4),
          run_id: "legacy-run",
          step_assertion_result: "PASS",
          step_assertion_reason: "已完成",
          step_assertion_failure_type: "business",
          termination_cause: "business_assertion_failure",
        } as any);
        expect(update).toMatchObject({
          current_step_idx: 1,
          executor_turn_count: 0,
          step_retry_count: 0,
          step_assertion_result: null,
          step_assertion_reason: "",
          step_assertion_failure_type: null,
          termination_cause: null,
        });
      } finally {
        getRepository.mockRestore();
      }
    });

    it("assert_failure 分類與原始 reason 沿用既有 DB 自由文字及 SSE mapping", async () => {
      const run = {
        id: "run-1",
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
      };
      const runRepo = {
        findOne: vi.fn().mockResolvedValue(run),
        save: vi.fn().mockResolvedValue(run),
      };
      const stepRepo = {
        findOne: vi.fn().mockResolvedValue(null),
        save: vi.fn(async (entity: TestRunStep) => {
          entity.id = "step-1";
          return entity;
        }),
        query: vi.fn().mockResolvedValue(undefined),
      };
      const logRepo = {
        save: vi.fn(async (entity: TestLog) => {
          entity.id = "log-1";
          return entity;
        }),
        query: vi.fn().mockResolvedValue(undefined),
      };
      const getRepository = vi
        .spyOn(AppDataSource, "getRepository")
        .mockImplementation(((entity: unknown) => {
          if (entity === TestRun) return runRepo;
          if (entity === TestRunStep) return stepRepo;
          if (entity === TestLog) return logRepo;
          throw new Error("unexpected repository");
        }) as any);
      const builder = Object.create(E2EGraphBuilder.prototype) as E2EGraphBuilder;
      Object.assign(builder as any, {
        browserManager: {
          getPageScreenshotBase64: vi.fn().mockResolvedValue("cG5n"),
        },
      });
      const reason = "帳號遭拒絕";
      const aiResponse = JSON.stringify({
        result: "FAIL",
        reason,
        failure_type: "business",
      });

      try {
        await builder.stepTrackerNode({
          ...createAssertionState("顯示登入成功", 1, 1),
          run_id: run.id,
          logs: [{
            step_idx: 0,
            step_description: "登入",
            action: "assert_failure",
            result: `斷言未通過 [business]：${reason}`,
            ai_response: aiResponse,
            timestamp: new Date().toISOString(),
          }],
        } as any);

        expect(logRepo.save).toHaveBeenCalledWith(expect.objectContaining({
          action: "assert_failure",
          result: `斷言未通過 [business]：${reason}`,
          aiResponse,
        }));
        const ssePayload = JSON.parse(logRepo.query.mock.calls[0][1][0]);
        expect(ssePayload).toMatchObject({
          event: "log",
          action: "assert_failure",
          result: `斷言未通過 [business]：${reason}`,
          aiResponse,
        });
      } finally {
        getRepository.mockRestore();
      }
    });

    it("operational 回流 History 只呈現 Asserter 原始 reason", () => {
      const history = buildExecutionHistoryPrompt([
        {
          step_idx: 0,
          step_description: "登入",
          action: "assert_failure",
          result: "斷言未通過 [operational]：頁面仍顯示登入表單",
          ai_response: JSON.stringify({
            result: "FAIL",
            reason: "頁面仍顯示登入表單",
            failure_type: "operational",
          }),
          timestamp: new Date().toISOString(),
        },
      ]);

      expect(history).toContain("Result/Feedback: 頁面仍顯示登入表單");
      expect(history).not.toContain("failure_type");
      expect(history).not.toContain("done_acting");
      expect(history).not.toContain("請立即");
    });
  });

  describe("分類式 assertion graph 整合", () => {
    async function runGraph(
      failureType: "business" | "operational",
      executorTurnCount: number,
    ) {
      const { builder, invoke: asserterModel } = createStepAsserterHarness({
        parsed: {
          result: "FAIL",
          reason: failureType === "business" ? "帳號遭拒絕" : "點擊未生效",
          failure_type: failureType,
        },
        raw: { usage_metadata: {} },
      });
      const executorModel = vi.fn();
      const executorTool = vi.fn();
      const reporter = vi.fn(async () => ({}));
      const stepTracker = vi.fn(async () => ({}));
      const executor = vi.fn(async () => {
        await executorModel();
        await executorTool();
        return {};
      });

      const workflow = new StateGraph(TestState)
        .addNode("step_asserter", builder.stepAsserterNode.bind(builder))
        .addNode("executor", executor)
        .addNode("step_tracker", stepTracker)
        .addNode("reporter", reporter)
        .addEdge(START, "step_asserter")
        .addConditionalEdges("step_asserter", routeAfterAssertion as any, {
          executor: "executor",
          step_tracker: "step_tracker",
          reporter: "reporter",
        })
        .addEdge("executor", END)
        .addEdge("step_tracker", END)
        .addEdge("reporter", END)
        .compile();

      const result = await workflow.invoke(
        createAssertionState("顯示登入成功", 1, executorTurnCount),
      ) as TestStateType;
      return {
        result,
        asserterModel,
        executor,
        executorModel,
        executorTool,
        reporter,
      };
    }

    it("business FAIL 直接進 reporter，其後沒有 Executor 模型或工具呼叫", async () => {
      const run = await runGraph("business", 1);
      expect(run.asserterModel).toHaveBeenCalledOnce();
      expect(run.reporter).toHaveBeenCalledOnce();
      expect(run.executor).not.toHaveBeenCalled();
      expect(run.executorModel).not.toHaveBeenCalled();
      expect(run.executorTool).not.toHaveBeenCalled();
      expect(run.result.termination_cause).toBe("business_assertion_failure");
    });

    it("operational FAIL 保留已用 round 並在尚有預算時返回 Executor", async () => {
      const run = await runGraph("operational", 4);
      expect(run.executor).toHaveBeenCalledOnce();
      expect(run.reporter).not.toHaveBeenCalled();
      expect(run.result.executor_turn_count).toBe(4);
      expect(run.result.termination_cause).toBeNull();
    });

    it("第 5 輪 operational FAIL 設終止原因並直接進 reporter", async () => {
      const run = await runGraph("operational", 5);
      expect(run.executor).not.toHaveBeenCalled();
      expect(run.reporter).toHaveBeenCalledOnce();
      expect(run.result.termination_cause).toBe("operational_budget_exhausted");
    });
  });
});
