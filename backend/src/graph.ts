import { StateGraph, START, END } from "@langchain/langgraph";
import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";

import {
  TestState,
  LogEntry,
  type AssertionFailureType,
  type TerminationCause,
} from "./state.js";
import { BrowserManager } from "./browser.js";
import { BrowserTools } from "./tools.js";
import { AppDataSource } from "./db.js";
import { TestRun } from "./entities/TestRun.js";
import { TestLog } from "./entities/TestLog.js";
import { TestRunStep } from "./entities/TestRunStep.js";
import {
  buildExecutorSystemPrompt,
  buildExecutorHumanText,
  buildFailureSummarizerSystemPrompt,
  buildStepAsserterPrompt,
  StepAssertionSchema,
} from "./graph/prompt.js";
import {
  detectNoProgress,
  isFailedToolResult,
  type NoProgressReason,
} from "./graph/noProgress.js";
import { buildTerminationFinalReason } from "./graph/reporterDiagnostics.js";
import {
  routeAfterAssertion,
  routeAfterExecution,
  routeNextStep,
} from "./graph/router.js";
import { getSettings } from "./services/settingsService.js";
import {
  getExecutorModel,
  getStepAsserterModel,
  getSummarizerModel,
} from "./services/llmFactory.js";
import { AppDataSource as _AppDS } from "./db.js";
import { ModelSetting } from "./entities/ModelSetting.js";
import { Runnable } from "@langchain/core/runnables";
import { ClientTool, DynamicStructuredToolInput } from "@langchain/core/tools";

function parseContentToString(content: any): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item)
          return item.text;
        return "";
      })
      .join("");
  }
  return "";
}

export type StepAssertion = {
  result: "PASS" | "FAIL";
  reason: string;
  failure_type: AssertionFailureType | null;
};

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

/**
 * 解析不同供應商／代理層可能產生的 structured-output response shape。
 */
export function parseStepAssertionResponse(response: any): StepAssertion {
  const candidates: unknown[] = [];

  if (response?.parsed != null) {
    candidates.push(response.parsed);
  }

  const raw = response?.raw ?? response;
  if (Array.isArray(raw?.tool_calls)) {
    for (const toolCall of raw.tool_calls) {
      if (toolCall?.args != null) candidates.push(toolCall.args);
    }
  }

  const providerToolCalls = raw?.additional_kwargs?.tool_calls;
  if (Array.isArray(providerToolCalls)) {
    for (const toolCall of providerToolCalls) {
      const args = toolCall?.function?.arguments;
      if (typeof args === "string") {
        try {
          candidates.push(parseJsonText(args));
        } catch {
          // 留給下方統一錯誤處理。
        }
      } else if (args != null) {
        candidates.push(args);
      }
    }
  }

  const content = parseContentToString(raw?.content);
  if (content.trim()) {
    try {
      candidates.push(parseJsonText(content));
    } catch {
      // 純文字不是合法 JSON 時，留給下方統一錯誤處理。
    }
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;

    try {
      const result = (candidate as { result?: unknown }).result;
      const reason = (candidate as { reason?: unknown }).reason;
      if (
        (result !== "PASS" && result !== "FAIL") ||
        typeof reason !== "string" ||
        reason.length === 0
      ) {
        continue;
      }

      if (result === "PASS") {
        return { result, reason, failure_type: null };
      }

      let failureType: AssertionFailureType = "operational";
      try {
        const parsed = StepAssertionSchema.safeParse(candidate);
        if (parsed.success && parsed.data.failure_type) {
          failureType = parsed.data.failure_type;
        }
      } catch {
        // 分類欄位讀取或驗證異常時採可補救的 operational 預設。
      }
      return { result, reason, failure_type: failureType };
    } catch {
      // 無法讀取必要欄位時繼續嘗試其他 provider response shape。
    }
  }

  throw new Error(
    "模型未回傳可解析的步驟斷言；預期包含 result (PASS/FAIL) 與 reason。",
  );
}

function serializeStepAssertionRawResponse(response: any): string {
  const raw = response?.raw ?? response;
  if (raw == null) return "";

  try {
    return JSON.stringify({
      content: raw.content,
      tool_calls: raw.tool_calls,
      additional_kwargs: raw.additional_kwargs,
      response_metadata: raw.response_metadata,
    }).slice(0, 8000);
  } catch {
    return String(raw).slice(0, 8000);
  }
}

/**
 * 建立 Executor 可見的同一步驟歷史。Assertion 失敗只回饋模型原始理由，
 * 不把 business 流程指令或結構化分類混入操作指導。
 */
export function buildExecutionHistoryPrompt(logs: LogEntry[]): string {
  if (logs.length === 0) return "";

  return (
    "\n\n# Execution History for the Current Step (Learn from failures/retries):\n" +
    logs
      .map((log, i) => {
        let feedback = log.result;
        if (log.action === "assert_failure" && log.ai_response) {
          try {
            const assertion = JSON.parse(log.ai_response) as { reason?: unknown };
            if (typeof assertion.reason === "string") {
              feedback = assertion.reason;
            }
          } catch {
            // 解析失敗時保留既有自由文字，兼容舊日誌。
          }
        }
        return `Action ${i + 1}: ${log.action}\nResult/Feedback: ${feedback}`;
      })
      .join("\n\n")
  );
}

export interface ParsedToolAction {
  name: string;
  args: Record<string, unknown>;
}

export function parseToolAction(action: string): ParsedToolAction | null {
  if (!action || typeof action !== "string") return null;
  const trimmed = action.trim();
  const firstParen = trimmed.indexOf("(");
  if (firstParen <= 0 || !trimmed.endsWith(")")) return null;

  const toolName = trimmed.slice(0, firstParen).trim();
  if (!/^[a-zA-Z0-9_]+$/.test(toolName)) return null;

  const argsStr = trimmed.slice(firstParen + 1, trimmed.length - 1).trim();
  if (!argsStr) {
    return { name: toolName, args: {} };
  }

  try {
    const parsed = JSON.parse(argsStr);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { name: toolName, args: parsed };
    }
    return null;
  } catch {
    return null;
  }
}

export function isToolExecutionFailed(toolResult: unknown): boolean {
  return isFailedToolResult(toolResult);
}

function buildStrategyHint(reason: NoProgressReason, remainingRounds: number): string {
  const guidance = reason === "all_tools_failed"
    ? "本輪所有工具均失敗；請重新觀察頁面並改用不同且更可靠的定位或操作策略。"
    : "相鄰回合重複了相同副作用操作；請停止重試相同動作並改採不同策略。";
  return `[${reason}] ${guidance} 剩餘 Executor rounds：${remainingRounds}。`;
}


export class E2EGraphBuilder {
  private browserManager: BrowserManager;
  private browserToolsInstance: BrowserTools;
  private tools: ClientTool[];
  private model!: Runnable;
  private asserter_model!: Runnable;
  private summarizer_model?: Runnable;
  private executorModelSetting!: ModelSetting;
  private reportModelSetting?: ModelSetting;
  private sendFailureScreenshot: boolean = true;
  private enableReplay: boolean = true;

  /**
   * 使用靜態 create() 工廠方法取得實例，以便在建構子外進行非同步設定載入。
   */
  private constructor(browserManager: BrowserManager) {
    this.browserManager = browserManager;
    this.browserToolsInstance = new BrowserTools(browserManager);
    this.tools = this.browserToolsInstance.getTools();
  }

  /**
   * 靜態工廠方法：從 DB 取得 aiConfig 設定後，動態初始化 Executor 與 Asserter 模型。
   */
  static async create(
    browserManager: BrowserManager,
  ): Promise<E2EGraphBuilder> {
    const instance = new E2EGraphBuilder(browserManager);
    try {
      const settings = await getSettings();
      const aiConfig = settings.aiConfig;
      const modelRepo = _AppDS.getRepository(ModelSetting);

      // 執行器模型：未設定或不存在則拋錯
      if (!aiConfig.executorModelId) {
        throw new Error("executorModelId 未設定，請前往系統設定配置執行器模型。");
      }
      const executorModel = await modelRepo.findOne({ where: { id: aiConfig.executorModelId } });
      if (!executorModel) {
        throw new Error(`executorModelId 所指的模型不存在（id: ${aiConfig.executorModelId}），請重新設定。`);
      }
      instance.executorModelSetting = executorModel;
      instance.model = getExecutorModel(executorModel, instance.tools);
      instance.asserter_model = getStepAsserterModel(executorModel);

      // 報告器模型：未設定或不存在則 skip（不拋錯）
      if (aiConfig.reportModelId) {
        const reportModel = await modelRepo.findOne({ where: { id: aiConfig.reportModelId } });
        if (reportModel) {
          instance.reportModelSetting = reportModel;
          instance.summarizer_model = getSummarizerModel(reportModel);
        }
      }

      // sendFailureScreenshot 從頂層讀取
      instance.sendFailureScreenshot = settings.sendFailureScreenshot ?? true;

      instance.enableReplay = settings.enableReplay ?? true;
      return instance;
    } catch (err) {
      console.error(
        "[E2EGraphBuilder] 初始化失敗：",
        err,
      );
      throw err;
    }
  }

  /**
   * 初始化節點：將索引與狀態歸零
   */
async initNode(state: typeof TestState.State) {
    return {
      current_step_idx: 0,
      executor_turn_count: 0,
      executor_last_round_done: false,
      step_retry_count: 0,
      step_assertion_result: null,
      step_assertion_reason: "",
      step_assertion_failure_type: null,
      termination_cause: null,
      screenshots_paths: [],
      logs: [],
    };
  }
  /**
   * 查詢最新一筆 passed 執行的歷史工具日誌
   */
  async getLatestPassedStepLogs(
    testcaseId: string,
    testcaseVersion: number,
    stepIdx: number,
  ): Promise<TestLog[]> {
    const stepRepo = AppDataSource.getRepository(TestRunStep);
    const step = await stepRepo
      .createQueryBuilder("step")
      .innerJoin("step.run", "run")
      .innerJoin("run.testcase", "testcase")
      .leftJoinAndSelect("step.logs", "logs")
      .where("testcase.id = :testcaseId", { testcaseId })
      .andWhere("run.testcaseVersion = :testcaseVersion", { testcaseVersion })
      .andWhere("step.stepIdx = :stepIdx", { stepIdx })
      .andWhere("step.status = :status", { status: "passed" })
      .orderBy("step.createdAt", "DESC")
      .addOrderBy("logs.createdAt", "ASC")
      .getOne();

    return step?.logs || [];
  }


  /**
   * 執行節點：負責擷取目前畫面、呼叫 Gemini 進行推理，並執行對應的 Playwright Tool Call
   */
  async executorNode(state: typeof TestState.State) {
    const idx = state.current_step_idx;
    const step_content = state.steps[idx];

    // 新增：在步驟開始時建立或載入 TestRunStep，狀態設為 running
    const testRunRepo = AppDataSource.getRepository(TestRun);
    const testRunStepRepo = AppDataSource.getRepository(TestRunStep);
    const run = await testRunRepo.findOne({ where: { id: state.run_id } });
    if (run) {
      let stepRunEntity = await testRunStepRepo.findOne({
        where: { run: { id: run.id }, stepIdx: idx },
      });
      if (!stepRunEntity) {
        stepRunEntity = new TestRunStep();
        stepRunEntity.run = run;
        stepRunEntity.stepIdx = idx;
        stepRunEntity.stepDescription = step_content;
        stepRunEntity.status = "running";
        await testRunStepRepo.save(stepRunEntity);

        // 廣播 step_status 事件通知前端
        await testRunStepRepo.query(`SELECT pg_notify('test_run_logs', $1)`, [
          JSON.stringify({
            runId: run.id,
            stepIdx: idx,
            stepId: stepRunEntity.id,
            stepDescription: step_content,
            status: "running",
            event: "step_status",
            timestamp: new Date().toISOString(),
          }),
        ]);
      }
    }
    // 檢查全域重放開關 (從最新設定或實例屬性)
    let enableReplay = this.enableReplay;
    try {
      const currentSettings = await getSettings();
      enableReplay = currentSettings.enableReplay ?? true;
    } catch {}

    const stepLogs = (state.logs || []).filter((l) => l.step_idx === idx);
    const isFirstAttempt =
      stepLogs.length === 0 && (state.step_retry_count ?? 0) === 0;

    if (enableReplay && state.testcase_version && isFirstAttempt) {
      const historicalLogs = await this.getLatestPassedStepLogs(
        state.test_id,
        state.testcase_version,
        idx,
      );

      const parsedTools = historicalLogs
        .map((log) => (log.action ? parseToolAction(log.action) : null))
        .filter((t): t is ParsedToolAction => t !== null);

      const hasDoneActing = parsedTools.some((t) => t.name === "done_acting");

      if (parsedTools.length > 0 && hasDoneActing) {
        console.log(
          `[Replay] 步驟 ${idx + 1} 命中歷史版本 v${state.testcase_version} 之 passed 軌跡，包含 ${parsedTools.length} 個動作，啟動重放模式...`,
        );

        let replaySuccess = true;
        let replayFailureReason = "";
        const replayLogs: LogEntry[] = [];
        let domNeedsRefresh = true;

        this.browserToolsInstance.elementTimeout = 2000;

        try {
          for (let i = 0; i < parsedTools.length; i++) {
            const toolAction = parsedTools[i];
            const tool_name = toolAction.name;
            const tool_args = toolAction.args;

            // DOM ID 自動保障：若需要 id 參數且尚未刷新，先執行 observeWebPage
            if (tool_args && "id" in tool_args && domNeedsRefresh) {
              await this.browserManager.observeWebPage();
              domNeedsRefresh = false;
            }

            const selected_tool = this.tools.find((t) => t.name === tool_name);
            if (!selected_tool) {
              throw new Error(`重放時找不到工具：${tool_name}`);
            }

            // 執行工具呼叫，搭配 2500ms 安全超時守門員
            let timeoutTimer: NodeJS.Timeout | null = null;
            const timeoutPromise = new Promise<never>((_, reject) => {
              timeoutTimer = setTimeout(() => {
                reject(new Error("等待元素超時超過 2000ms"));
              }, 2500);
            });

            let tool_result: unknown;
            try {
              tool_result = await Promise.race([
                selected_tool.invoke(tool_args),
                timeoutPromise,
              ]);
            } finally {
              clearTimeout(timeoutTimer!);
            }

            // 重放失敗判定邏輯：若回傳包含「失敗」或開頭為「錯誤」
            if (isToolExecutionFailed(tool_result)) {
              throw new Error(
                typeof tool_result === "string"
                  ? tool_result
                  : "工具執行判定為失敗",
              );
            }

            // 成功記錄該工具之 0 Token 重放日誌
            replayLogs.push({
              step_idx: idx,
              step_description: step_content,
              action: `${tool_name}(${JSON.stringify(tool_args)})`,
              result:
                typeof tool_result === "string"
                  ? tool_result
                  : JSON.stringify(tool_result),
              timestamp: new Date().toISOString(),
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
            });

            if (tool_name === "done_acting") break;

            // 若執行完 navigate_to 或 waitForNavigation，標記並刷新 DOM ID
            const waitStrategy = (
              tool_args as { waitStrategy?: string } | undefined
            )?.waitStrategy;
            if (
              tool_name === "navigate_to" ||
              waitStrategy === "waitForNavigation"
            ) {
              await this.browserManager.observeWebPage();
              domNeedsRefresh = false;
            } else if (tool_name === "click") {
              // 點擊可能動態改變頁面元素，下個需要 id 的動作需再確保刷新
              domNeedsRefresh = true;
            }
          }
        } catch (replayErr: unknown) {
          replaySuccess = false;
          replayFailureReason =
            replayErr instanceof Error
              ? replayErr.message
              : String(replayErr);
        } finally {
          this.browserToolsInstance.elementTimeout = 5000;
        }

        if (replaySuccess) {
          console.log(
            `[Replay] 步驟 ${idx + 1} 工具重放成功完成（工具重放為 0 Token）！推進至 stepAsserterNode...`,
          );
// 若重放順利執行完包含 done_acting 的所有工具，條件路由會推進至 stepAsserterNode
          return {
            logs: [...(state.logs || []), ...replayLogs],
            executor_turn_count: 0,
            executor_last_round_done: true,
            step_retry_count: 0,
          };
        } else {
          // 4.1 重放失敗交棒處理：
          // 1. 清除當前步驟在重放期間寫入的臨時暫存日誌 (replayLogs 不併入 state.logs)
          // 2. 保留瀏覽器當前操作現場 (不關閉、不重整)
          // 3. 重設 executor_turn_count = 0，給予 LLM 完整的動作輪次容錯空間
          // 4. 重新呼叫 observeWebPage() 擷取最新畫面與元素清單，無縫交棒至一般的 LLM Executor 推導
          console.warn(
            `[Replay] 步驟 ${idx + 1} 重放中斷/失敗：${replayFailureReason}。正在交棒啟動 LLM 自我修復 (Self-healing)...`,
          );
          state.executor_turn_count = 0;
        }
      }
    }


    // 1. 框架預熱：呼叫 observeWebPage() 注入 ID、渲染貼紙、截圖、清除貼紙
    //    回傳帶有 ID 標籤的截圖與元素清單，一次傳給 LLM
    let screenshot_base64: string;
    let element_list: string;

    try {
      const observed = await this.browserManager.observeWebPage();
      screenshot_base64 = observed.screenshotBase64;
      element_list = observed.elementList;
    } catch (e: any) {
      // observeWebPage 失敗時 fallback 到純截圖
      screenshot_base64 = await this.browserManager.getPageScreenshotBase64();
      element_list = "（無法取得元素清單）";
    }

    const current_url = this.browserManager.page
      ? this.browserManager.page.url()
      : "";

    // 2. 建構系統 Prompt
    const system_prompt = buildExecutorSystemPrompt({
      testName: state.test_name,
      stepIdx: idx,
      stepContent: step_content,
      currentUrl: current_url,
      systemPrompt: state.system_prompt,
    });

    // 2.5 取得當前步驟的歷史執行紀錄（包含工具呼叫與驗證失敗反饋）
    const currentStepLogs = (state.logs || []).filter((l) => l.step_idx === idx);
    const historyPrompt = buildExecutionHistoryPrompt(currentStepLogs);
    const usedRounds = state.executor_turn_count ?? 0;

    // 3. 呼叫模型（使用帶貼紙的截圖 + 元素清單）
    const messages = [
      new SystemMessage(system_prompt),
      new HumanMessage({
        content: [
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${screenshot_base64}` },
          },
          {
            type: "text",
            text: buildExecutorHumanText({
              elementList: element_list,
              stepObjective: state.step_expecteds[idx],
              historyPrompt,
              usedRounds,
            }),
          },
        ],
      }),
    ];

    const response = await this.model.invoke(messages);

    const tool_calls = response.tool_calls || [];
    const logs = [...(state.logs || [])];

    const prompt_tokens = response.usage_metadata?.input_tokens ?? 0;
    const completion_tokens = response.usage_metadata?.output_tokens ?? 0;
    const total_tokens = response.usage_metadata?.total_tokens ?? 0;

    // 4. 如果 AI 沒有呼叫工具，則記錄錯誤並增加重試次數
    if (tool_calls.length === 0) {
      logs.push({
        step_idx: idx,
        step_description: step_content,
        action: "none",
        result: "AI Agent 未呼召 any 工具，直接回覆文字說明",
        ai_response: parseContentToString(response.content),
        timestamp: new Date().toISOString(),
        prompt_tokens,
        completion_tokens,
        total_tokens,
      });
      return {
        logs,
        executor_turn_count: (state.executor_turn_count ?? 0) + 1,
        executor_last_round_done: false,
        termination_cause:
          (state.executor_turn_count ?? 0) + 1 >= 5
            ? "executor_budget_exhausted"
            : state.termination_cause,
        last_screenshot: screenshot_base64,
        simplified_dom: element_list,
      };
    }

    // 5. 依序執行工具呼叫。一次模型決策只算一輪；done_acting 為 terminal tool。
    const currentRound = (state.executor_turn_count ?? 0) + 1;
    const currentRoundLogs: LogEntry[] = [];
    let didDoneActing = false;
    let terminationCause: TerminationCause = state.termination_cause ?? null;
    for (let i = 0; i < tool_calls.length; i++) {
      const tc = tool_calls[i];
      const tool_name = tc.name;
      const tool_args = tc.args;

      // 尋找對應的工具並執行
      const selected_tool = this.tools.find((t) => t.name === tool_name);
      const pTokens = i === 0 ? prompt_tokens : 0;
      const cTokens = i === 0 ? completion_tokens : 0;
      const tTokens = i === 0 ? total_tokens : 0;

      if (selected_tool) {
        const tool_result = await selected_tool.invoke(tool_args);
        const log: LogEntry = {
          step_idx: idx,
          step_description: step_content,
          action: `${tool_name}(${JSON.stringify(tool_args)})`,
          result:
            typeof tool_result === "string"
              ? tool_result
              : JSON.stringify(tool_result),
          timestamp: new Date().toISOString(),
          prompt_tokens: pTokens,
          completion_tokens: cTokens,
          total_tokens: tTokens,
          executor_round: currentRound,
        };
        logs.push(log);
        currentRoundLogs.push(log);
        if (
          tool_name === "click" &&
          typeof tool_result === "string" &&
          tool_result.includes("unsupported_new_page")
        ) {
          terminationCause = "unsupported_new_page";
          break;
        }
      } else {
        const log: LogEntry = {
          step_idx: idx,
          step_description: step_content,
          action: `unknown_tool: ${tool_name}`,
          result: "無法辨識的工具",
          timestamp: new Date().toISOString(),
          prompt_tokens: pTokens,
          completion_tokens: cTokens,
          total_tokens: tTokens,
          executor_round: currentRound,
        };
        logs.push(log);
        currentRoundLogs.push(log);
      }

      if (tool_name === "done_acting") {
        didDoneActing = true;
        break;
      }
    }

    if (!didDoneActing && !terminationCause) {
      const reason = detectNoProgress({
        currentRoundLogs,
        previousLogs: state.logs || [],
      });
      const lastHint = [...(state.logs || [])]
        .reverse()
        .find((log) => log.step_idx === idx && log.action === "strategy_hint");
      const repeatsPreviousRound =
        lastHint?.ai_response === reason &&
        (lastHint.executor_round === currentRound - 1 ||
          (lastHint.executor_round === undefined && state.logs?.at(-1) === lastHint));
      if (reason && !repeatsPreviousRound) {
        logs.push({
          step_idx: idx,
          step_description: step_content,
          action: "strategy_hint",
          result: buildStrategyHint(reason, Math.max(0, 5 - currentRound)),
          ai_response: reason,
          timestamp: new Date().toISOString(),
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          executor_round: currentRound,
        });
      }
    }

    if (!didDoneActing && !terminationCause && currentRound >= 5) {
      terminationCause = "executor_budget_exhausted";
    }

    return {
      logs,
      executor_turn_count: currentRound,
      executor_last_round_done: didDoneActing,
      termination_cause: terminationCause,
      last_screenshot: screenshot_base64,
      simplified_dom: element_list,
    };
  }

  /**
   * 獨立步驟斷言節點：所有非空 expected 一律交由模型結合 DOM 與畫面判定。
   */
  async stepAsserterNode(state: typeof TestState.State) {
    const idx = state.current_step_idx;
    const stepContent = state.steps[idx];
    const stepExpected = (state.step_expecteds[idx] || "").trim();
    const logs = [...(state.logs || [])];

    if (!stepExpected) {
      const reason = "此步驟未設定預期結果，略過模型斷言。";
      logs.push({
        step_idx: idx,
        step_description: stepContent,
        action: "assert_skipped",
        result: reason,
        timestamp: new Date().toISOString(),
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      });
      return {
        logs,
        step_assertion_result: "PASS" as const,
        step_assertion_reason: reason,
        step_assertion_failure_type: null,
        termination_cause: null,
      };
    }

    let simplifiedDom: string;
    try {
      simplifiedDom = await this.browserManager.getSimplifiedDOM();
    } catch (error: unknown) {
      simplifiedDom = `<!-- 無法提取 DOM 資訊：${error instanceof Error ? error.message : String(error)} -->`;
    }

    let screenshotBase64: string | null = null;
    try {
      screenshotBase64 = await this.browserManager.getPageScreenshotBase64();
    } catch {
      // 保留 DOM-only 證據，並由模型依證據是否充分做出判定。
    }

    const systemPrompt = buildStepAsserterPrompt({
      testName: state.test_name,
      stepIdx: idx,
      stepContent,
      stepExpected,
    });

    let currentUrl = "";
    let pageTitle = "";
    try {
      currentUrl = this.browserManager.page?.url() ?? "";
    } catch {}
    try {
      pageTitle = (await this.browserManager.page?.title()) ?? "";
    } catch {}

    const evidenceContent: any[] = [
      {
        type: "text",
        text:
          `目前頁面網址（Current URL）: ${currentUrl}` +
          (pageTitle ? `\n頁面標題（Page Title）: ${pageTitle}` : "") +
          `\n\n以下是目前頁面的精簡 DOM 證據：\n\n${simplifiedDom}`,
      },
    ];
    if (screenshotBase64) {
      evidenceContent.unshift({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${screenshotBase64}` },
      });
    }

    let response: any;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    try {
      response = await this.asserter_model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage({ content: evidenceContent }),
      ]);
      const raw = response.raw ?? response;
      promptTokens = raw.usage_metadata?.input_tokens ?? 0;
      completionTokens = raw.usage_metadata?.output_tokens ?? 0;
      totalTokens = raw.usage_metadata?.total_tokens ?? 0;
      const assertion = parseStepAssertionResponse(response);
      const passed = assertion.result === "PASS";
      const failureType = passed ? null : assertion.failure_type;
      const terminationCause: TerminationCause = passed
        ? null
        : failureType === "business"
          ? "business_assertion_failure"
          : (state.executor_turn_count ?? 0) >= 5
            ? "operational_budget_exhausted"
            : null;

      logs.push({
        step_idx: idx,
        step_description: stepContent,
        action: passed ? "assert_pass" : "assert_failure",
        result: passed
          ? `斷言通過：${assertion.reason}`
          : `斷言未通過 [${failureType}]：${assertion.reason}`,
        ai_response: JSON.stringify(assertion),
        timestamp: new Date().toISOString(),
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      });

return {
        logs,
        last_screenshot: screenshotBase64 ?? state.last_screenshot,
        simplified_dom: simplifiedDom,
        step_assertion_result: assertion.result,
        step_assertion_reason: assertion.reason,
        step_assertion_failure_type: failureType,
        termination_cause: terminationCause,
        step_retry_count: passed
          ? state.step_retry_count
          : (state.step_retry_count ?? 0) + 1,
      };
    } catch (error: unknown) {
      const reason = `模型斷言執行失敗：${error instanceof Error ? error.message : String(error)}`;
      logs.push({
        step_idx: idx,
        step_description: stepContent,
        action: "assert_failure",
        result: `斷言未通過 [operational]：${reason}`,
        ai_response: serializeStepAssertionRawResponse(response),
        timestamp: new Date().toISOString(),
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      });
return {
        logs,
        last_screenshot: screenshotBase64 ?? state.last_screenshot,
        simplified_dom: simplifiedDom,
        step_assertion_result: "FAIL" as const,
        step_assertion_reason: reason,
        step_assertion_failure_type: "operational" as const,
        termination_cause:
          (state.executor_turn_count ?? 0) >= 5
            ? ("operational_budget_exhausted" as const)
            : null,
        step_retry_count: (state.step_retry_count ?? 0) + 1,
      };
    }
  }

  /**
   * 記錄追蹤節點：當步驟完成時，將截圖存入資料庫並推進步驟索引
   */
  async stepTrackerNode(state: typeof TestState.State) {
    const idx = state.current_step_idx;

    // 取得與目前步驟相關的 logs
    const stepLogs = (state.logs || []).filter((l) => l.step_idx === idx);

    let stepPromptTokens = 0;
    let stepCompletionTokens = 0;
    let stepTotalTokens = 0;

    for (const log of stepLogs) {
      stepPromptTokens += log.prompt_tokens ?? 0;
      stepCompletionTokens += log.completion_tokens ?? 0;
      stepTotalTokens += log.total_tokens ?? 0;
    }

    // 擷取目前步驟完成時的截圖 Buffer
    let screenshotBuffer: Buffer | undefined;
    try {
      const base64 = await this.browserManager.getPageScreenshotBase64();
      screenshotBuffer = Buffer.from(base64, "base64");
    } catch (e: any) {
      console.error(`[Autape] 擷取步驟完成畫面失敗: ${e.message}`);
    }

    // 將日誌與二進位截圖寫入資料庫
    const testRunRepo = AppDataSource.getRepository(TestRun);
    const testRunStepRepo = AppDataSource.getRepository(TestRunStep);
    const testLogRepo = AppDataSource.getRepository(TestLog);

    const run = await testRunRepo.findOne({ where: { id: state.run_id } });
    if (run) {
      // 1. 尋找或建立當前步驟實體
      let stepRunEntity = await testRunStepRepo.findOne({
        where: { run: { id: run.id }, stepIdx: idx },
      });
      if (!stepRunEntity) {
        stepRunEntity = new TestRunStep();
        stepRunEntity.run = run;
        stepRunEntity.stepIdx = idx;
        stepRunEntity.stepDescription = state.steps[idx];
      }

      // 2. 更新步驟狀態、Token 及截圖
      stepRunEntity.status = "passed";
      stepRunEntity.promptTokens = stepPromptTokens;
      stepRunEntity.completionTokens = stepCompletionTokens;
      stepRunEntity.totalTokens = stepTotalTokens;
      if (screenshotBuffer) {
        stepRunEntity.screenshotData = screenshotBuffer;
      }
      await testRunStepRepo.save(stepRunEntity);

      // 3. 累加這一步的 Token 至 TestRun 最上層的總累計欄位
      run.totalPromptTokens = (run.totalPromptTokens || 0) + stepPromptTokens;
      run.totalCompletionTokens =
        (run.totalCompletionTokens || 0) + stepCompletionTokens;
      run.totalTokens = (run.totalTokens || 0) + stepTotalTokens;
      await testRunRepo.save(run);

      // 4. 寫入該步驟的所有操作日誌并關聯
      for (let i = 0; i < stepLogs.length; i++) {
        const log = stepLogs[i];
        const entity = new TestLog();
        entity.step = stepRunEntity;
        entity.action = log.action;
        entity.result = log.result;
        entity.aiResponse = log.ai_response;
        entity.promptTokens = log.prompt_tokens ?? 0;
        entity.completionTokens = log.completion_tokens ?? 0;
        entity.totalTokens = log.total_tokens ?? 0;

        await testLogRepo.save(entity);

        // 每寫入一筆日誌，就調用 NOTIFY 通知監聽者
        await testLogRepo.query(`SELECT pg_notify('test_run_logs', $1)`, [
          JSON.stringify({
            runId: run.id,
            stepIdx: idx,
            stepId: stepRunEntity.id,
            action: log.action,
            result: log.result,
            aiResponse: log.ai_response,
            logId: entity.id,
            event: "log",
            timestamp: new Date().toISOString(),
            promptTokens: entity.promptTokens,
            completionTokens: entity.completionTokens,
            totalTokens: entity.totalTokens,
          }),
        ]);
      }

      // 5. 廣播步驟更新通知 (passed)
      await testRunStepRepo.query(`SELECT pg_notify('test_run_logs', $1)`, [
        JSON.stringify({
          runId: run.id,
          stepIdx: idx,
          stepId: stepRunEntity.id,
          stepDescription: stepRunEntity.stepDescription,
          status: "passed",
          event: "step_status",
          totalTokens: stepRunEntity.totalTokens,
          timestamp: new Date().toISOString(),
        }),
      ]);
    }

    return {
      current_step_idx: idx + 1,
      executor_turn_count: 0,
      executor_last_round_done: false,
      step_retry_count: 0,
      step_assertion_result: null,
      step_assertion_reason: "",
      step_assertion_failure_type: null,
      termination_cause: null,
    };
  }

  /**
   * 報告節點：處理成功完成或失敗中斷時的安全寫入與收尾
   */
  async reporterNode(state: typeof TestState.State) {
    const update_data: any = {};
    const currentStepIdx = state.current_step_idx ?? 0;
    const steps = state.steps || [];

    // 如果測試尚未執行完所有步驟就被迫中斷 (例如重試超限)
    if (currentStepIdx < steps.length) {
      update_data.final_result = "FAIL";
      update_data.final_reason = buildTerminationFinalReason({
        cause: state.termination_cause ?? "executor_budget_exhausted",
        stepNumber: currentStepIdx + 1,
        stepDescription: steps[currentStepIdx],
        assertionReason: state.step_assertion_reason,
        logs: (state.logs || []).filter((log) => log.step_idx === currentStepIdx),
      });
    } else {
      update_data.final_result = "PASS";
      update_data.final_reason = "所有測試步驟均已成功執行完畢。";
    }

    const merged_result = update_data.final_result || state.final_result;
    let screenshotFailBuffer: Buffer | undefined;

    if (["FAIL", "ERROR"].includes(merged_result) && this.browserManager.page) {
      try {
        const base64 = await this.browserManager.getPageScreenshotBase64();
        screenshotFailBuffer = Buffer.from(base64, "base64");
      } catch (e: any) {
        console.error(`[Autape] 無法擷取最終失敗畫面：${e.message}`);
      }
    }

    // 確保關閉瀏覽器
    try {
      await this.browserManager.closeBrowser();
    } catch (e) {}

    // 更新資料庫中的 TestRun 與 TestRunStep 紀錄
    const testRunRepo = AppDataSource.getRepository(TestRun);
    const testRunStepRepo = AppDataSource.getRepository(TestRunStep);
    const testLogRepo = AppDataSource.getRepository(TestLog);

    const run = await testRunRepo.findOne({
      where: { id: state.run_id },
      relations: { testcase: true },
    });
    if (run) {
      // 1. 如果測試失敗，嘗試生成 AI 總結（reportModelId 未設定則跳過）
      if (["FAIL", "ERROR"].includes(merged_result)) {
        if (!this.summarizer_model) {
          // reportModelId 未設定或模型不存在，跳過報告生成，failureSummary 保持 null
          console.log("[Autape] reportModelId 未設定，跳過失敗總結生成。");
        } else {
          try {
            const system_prompt = buildFailureSummarizerSystemPrompt({
              testName: state.test_name,
              expected: run.testcase?.expected || "未知",
              logs: state.logs || [],
            });

            const messages: BaseMessage[] = [new SystemMessage(system_prompt)];
            const sendScreenshot = this.sendFailureScreenshot;
            if (screenshotFailBuffer && sendScreenshot) {
              messages.push(
                new HumanMessage({
                  content: [
                    {
                      type: "text",
                      text: "這是測試失敗時的截圖：",
                    },
                    {
                      type: "image_url",
                      image_url: {
                        url: `data:image/png;base64,${screenshotFailBuffer.toString("base64")}`,
                      },
                    },
                  ],
                }),
              );
            } else if (!sendScreenshot) {
              messages.push(new HumanMessage("設定已關閉傳送失敗截圖（使用非多模態模型）。"));
            } else {
              messages.push(new HumanMessage("無法提供失敗截圖。"));
            }

            const response = await this.summarizer_model.invoke(messages);

            console.log("response", response);

            const result = response.raw.content.at(0);

            if (result && result.type === "text") {
              run.failureSummary = JSON.parse(result.text);
            } else {
              run.failureSummary = {
                reason: "AI 總結生成出錯：無法解析的內容，請檢查輸出格式。",
                suggestion: `收到非預期的回應格式：${JSON.stringify(result)}`,
              };
            }
          } catch (e: any) {
            console.error(
              `[Autape] AI 失敗總結失敗，採用 Fallback 物件: ${e.message}`,
            );
            run.failureSummary = {
              reason: `AI 總結生成出錯：${e.message}`,
              suggestion: "請手動檢查步驟日誌與執行截圖以進行排查。",
            };
          }
        }
      }

      // 1. (舊邏輯) 如果步驟尚未跑完，說明最後一步失敗了。更新當前步驟為 failed，並補存相關 logs。
      if (currentStepIdx < steps.length) {
        let stepRunEntity = await testRunStepRepo.findOne({
          where: { run: { id: run.id }, stepIdx: currentStepIdx },
        });
        if (!stepRunEntity) {
          stepRunEntity = new TestRunStep();
          stepRunEntity.run = run;
          stepRunEntity.stepIdx = currentStepIdx;
          stepRunEntity.stepDescription = steps[currentStepIdx];
        }

        // 篩選與當前失敗步驟相關的記憶體 logs
        let stepLogs = (state.logs || []).filter(
          (l) => l.step_idx === currentStepIdx,
        );

        // 如果完全無日誌則自動補充一筆虛擬日誌
        if (stepLogs.length === 0) {
          stepLogs.push({
            step_idx: currentStepIdx,
            step_description: steps[currentStepIdx],
            action: "error",
            result: "步驟超限未完成",
            timestamp: new Date().toISOString(),
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          });
        }

        let stepPromptTokens = 0;
        let stepCompletionTokens = 0;
        let stepTotalTokens = 0;
        for (const log of stepLogs) {
          stepPromptTokens += log.prompt_tokens ?? 0;
          stepCompletionTokens += log.completion_tokens ?? 0;
          stepTotalTokens += log.total_tokens ?? 0;
        }

        // 寫入/更新步驟狀態為 failed
        stepRunEntity.status = "failed";
        stepRunEntity.promptTokens = stepPromptTokens;
        stepRunEntity.completionTokens = stepCompletionTokens;
        stepRunEntity.totalTokens = stepTotalTokens;
        if (screenshotFailBuffer) {
          stepRunEntity.screenshotData = screenshotFailBuffer;
        }
        await testRunStepRepo.save(stepRunEntity);

        // 累加 Token 到 TestRun 總數
        run.totalPromptTokens = (run.totalPromptTokens || 0) + stepPromptTokens;
        run.totalCompletionTokens =
          (run.totalCompletionTokens || 0) + stepCompletionTokens;
        run.totalTokens = (run.totalTokens || 0) + stepTotalTokens;

        // 寫入當前失敗步驟的所有 TestLog 並與該步驟關聯
        for (const log of stepLogs) {
          const entity = new TestLog();
          entity.step = stepRunEntity;
          entity.action = log.action;
          entity.result = log.result;
          entity.aiResponse = log.ai_response;
          entity.promptTokens = log.prompt_tokens ?? 0;
          entity.completionTokens = log.completion_tokens ?? 0;
          entity.totalTokens = log.total_tokens ?? 0;
          await testLogRepo.save(entity);

          // 廣播操作日誌
          await testLogRepo.query(`SELECT pg_notify('test_run_logs', $1)`, [
            JSON.stringify({
              runId: run.id,
              stepIdx: currentStepIdx,
              stepId: stepRunEntity.id,
              action: log.action,
              result: log.result,
              aiResponse: log.ai_response,
              logId: entity.id,
              event: "log",
              timestamp: new Date().toISOString(),
              promptTokens: entity.promptTokens,
              completionTokens: entity.completionTokens,
              totalTokens: entity.totalTokens,
            }),
          ]);
        }

        // 廣播步驟更新通知 (failed)
        await testRunStepRepo.query(`SELECT pg_notify('test_run_logs', $1)`, [
          JSON.stringify({
            runId: run.id,
            stepIdx: currentStepIdx,
            stepId: stepRunEntity.id,
            stepDescription: stepRunEntity.stepDescription,
            status: "failed",
            event: "step_status",
            totalTokens: stepRunEntity.totalTokens,
            timestamp: new Date().toISOString(),
          }),
        ]);
      }

      // 2. 更新 TestRun 屬性
      const statusValue =
        merged_result === "PASS"
          ? "passed"
          : merged_result === "ERROR"
            ? "error"
            : "failed";
      run.status = statusValue;
      run.finalResult = merged_result;
      run.finalReason = update_data.final_reason || state.final_reason;
      run.finishedAt = new Date();
      if (screenshotFailBuffer) {
        run.screenshotFailData = screenshotFailBuffer;
      }
      await testRunRepo.save(run);

      // 3. 發送任務結束通知 (包含 failureSummary)
      await testRunRepo.query(`SELECT pg_notify('test_run_logs', $1)`, [
        JSON.stringify({
          runId: state.run_id,
          status: run.status,
          finalResult: merged_result,
          finalReason: run.finalReason,
          failureSummary: run.failureSummary,
          event: "completed",
          timestamp: new Date().toISOString(),
          totalPromptTokens: run.totalPromptTokens,
          totalCompletionTokens: run.totalCompletionTokens,
          totalTokens: run.totalTokens,
        }),
      ]);
    }

    return update_data;
  }

  buildGraph() {
    const workflow = new StateGraph(TestState)
      // 加入節點
      .addNode("init", this.initNode.bind(this))
      .addNode("executor", this.executorNode.bind(this))
      .addNode("step_asserter", this.stepAsserterNode.bind(this))
      .addNode("step_tracker", this.stepTrackerNode.bind(this))
      .addNode("reporter", this.reporterNode.bind(this))

      // 設定起始點
      .addEdge(START, "init")
      .addEdge("init", "executor")

      // 執行後的條件邊
      .addConditionalEdges("executor", routeAfterExecution as any, {
        executor: "executor",
        step_asserter: "step_asserter",
        reporter: "reporter",
      })

      // 斷言後的條件邊
      .addConditionalEdges("step_asserter", routeAfterAssertion as any, {
        executor: "executor",
        step_tracker: "step_tracker",
        reporter: "reporter",
      })

      // 步驟追蹤後的條件邊
      .addConditionalEdges("step_tracker", routeNextStep as any, {
        executor: "executor",
        reporter: "reporter",
      })

      // 最終邊
      .addEdge("reporter", END);

    return workflow.compile();
  }
}
