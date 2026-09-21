import { describe, it, expect, vi } from "vitest";
import {
  buildExecutorSystemPrompt,
  buildAsserterSystemPrompt,
  buildStepAsserterPrompt,
  StepAssertionSchema,
} from "../src/graph/prompt.js";
import {
  routeAfterAssertion,
  routeAfterExecution,
  routeNextStep,
} from "../src/graph/router.js";
import { LogEntry } from "../src/state.js";
import {
  E2EGraphBuilder,
  parseStepAssertionResponse,
} from "../src/graph.js";

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

function createAssertionState(stepExpected: string, stepRetryCount = 1) {
  return {
    test_name: "登入測試",
    steps: ["點擊登入"],
    step_expecteds: [stepExpected],
    current_step_idx: 0,
    step_retry_count: stepRetryCount,
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
      expect(StepAssertionSchema.parse({ result: "PASS", reason: "提示可見" }))
        .toEqual({ result: "PASS", reason: "提示可見" });
      expect(() => StepAssertionSchema.parse({ result: "UNKNOWN", reason: "" }))
        .toThrow();
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
      expect(routeAfterAssertion({ step_assertion_result: "PASS", step_retry_count: 5 }))
        .toBe("step_tracker");
    });

    it("5c. routeAfterAssertion: FAIL 未超限應返回 executor", () => {
      expect(routeAfterAssertion({ step_assertion_result: "FAIL", step_retry_count: 4 }))
        .toBe("executor");
    });

    it("5d. routeAfterAssertion: FAIL 達上限應導向 reporter", () => {
      expect(routeAfterAssertion({ step_assertion_result: "FAIL", step_retry_count: 5 }))
        .toBe("reporter");
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
        raw: {
          content: '```json\n{"result":"PASS","reason":"Example Domain 可見"}\n```',
        },
      })).toEqual({ result: "PASS", reason: "Example Domain 可見" });
    });

    it("parsed 為 null 時可從 LangChain raw tool_calls 解析回應", () => {
      expect(parseStepAssertionResponse({
        parsed: null,
        raw: {
          content: "",
          tool_calls: [
            { name: "extract", args: { result: "FAIL", reason: "尚未跳轉" } },
          ],
        },
      })).toEqual({ result: "FAIL", reason: "尚未跳轉" });
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
                  arguments: '{"result":"PASS","reason":"網址符合預期"}',
                },
              },
            ],
          },
        },
      })).toEqual({ result: "PASS", reason: "網址符合預期" });
    });

    it("無 expected 時直接通過且不呼叫模型", async () => {
      const { builder, invoke, getSimplifiedDOM, getPageScreenshotBase64 } =
        createStepAsserterHarness({});

      const update = await builder.stepAsserterNode(createAssertionState("   "));

      expect(update.step_assertion_result).toBe("PASS");
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
      expect(update.logs.at(-1)).toMatchObject({
        action: "assert_pass",
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      });
    });

    it("模型判定 FAIL 時記錄理由、遞增重試並返回 executor", async () => {
      const { builder } = createStepAsserterHarness({
        parsed: { result: "FAIL", reason: "頁面仍顯示登入表單" },
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
      expect(update.step_retry_count).toBe(4);
      expect(update.logs.at(-1)).toMatchObject({
        action: "assert_failure",
        result: "斷言未通過：頁面仍顯示登入表單",
        total_tokens: 12,
      });
      expect(routeAfterAssertion(update as any)).toBe("executor");
    });

    it("斷言失敗使重試數達上限時路由至 reporter", async () => {
      const { builder } = createStepAsserterHarness({
        parsed: { result: "FAIL", reason: "預期狀態不存在" },
        raw: { usage_metadata: {} },
      });

      const update = await builder.stepAsserterNode(
        createAssertionState("顯示完成畫面", 4),
      );

      expect(update.step_retry_count).toBe(5);
      expect(routeAfterAssertion(update as any)).toBe("reporter");
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
});
