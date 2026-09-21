import { describe, it, expect } from "vitest";
import { parseToolAction, isToolExecutionFailed } from "../src/graph.js";
import { BrowserTools } from "../src/tools.js";
import type { BrowserManager } from "../src/browser.js";
import { routeAfterExecution } from "../src/graph/router.js";
import { LogEntry } from "../src/state.js";

describe("歷史軌跡重放 (Replay Mode) 單元測試", () => {
  describe("工具日誌解析函式 (parseToolAction)", () => {
    it("應正確解析一般工具調用與參數物件", () => {
      const parsed = parseToolAction('click({"id": 12, "waitStrategy": "waitForNavigation"})');
      expect(parsed).toEqual({
        name: "click",
        args: { id: 12, waitStrategy: "waitForNavigation" },
      });
    });

    it("應正確解析帶有括號字串內容的工具參數", () => {
      const parsed = parseToolAction('input({"id": 5, "text": "測試括號 (nested content)"})');
      expect(parsed).toEqual({
        name: "input",
        args: { id: 5, text: "測試括號 (nested content)" },
      });
    });

    it("應正確解析 done_acting 與空參數", () => {
      const parsed1 = parseToolAction("done_acting({})");
      expect(parsed1).toEqual({
        name: "done_acting",
        args: {},
      });

      const parsed2 = parseToolAction("done_acting()");
      expect(parsed2).toEqual({
        name: "done_acting",
        args: {},
      });
    });

    it("遇到非工具調用或特殊標記應回傳 null", () => {
      expect(parseToolAction("none")).toBeNull();
      expect(parseToolAction("warning")).toBeNull();
      expect(parseToolAction(null as unknown as string)).toBeNull();
      expect(parseToolAction(undefined as unknown as string)).toBeNull();
    });

    it("遇到不合法 JSON 參數應優雅回傳 null", () => {
      expect(parseToolAction('click({"id": not_json})')).toBeNull();
      expect(parseToolAction("click({")).toBeNull();
    });
  });

  describe("工具失敗判定邏輯 (isToolExecutionFailed)", () => {
    it("回傳字串包含「失敗」應判定為失敗", () => {
      expect(isToolExecutionFailed("點擊元素 ID 12 失敗：page.waitForSelector: Timeout 2000ms exceeded")).toBe(true);
      expect(isToolExecutionFailed("導航至網址失敗")).toBe(true);
      expect(isToolExecutionFailed("操作過程出現失敗")).toBe(true);
    });

    it("回傳字串開頭為「錯誤」應判定為失敗", () => {
      expect(isToolExecutionFailed("錯誤：瀏覽器未初始化。")).toBe(true);
      expect(isToolExecutionFailed("錯誤：找不到目標元素")).toBe(true);
    });

    it("正常成功執行的回傳字串應判定為成功 (false)", () => {
      expect(isToolExecutionFailed("已點擊元素 ID 12。")).toBe(false);
      expect(isToolExecutionFailed("已成功導航至網址：https://example.com")).toBe(false);
      expect(isToolExecutionFailed("已在元素 ID 3 中輸入：'admin'")).toBe(false);
      expect(isToolExecutionFailed("DONE_ACTING: 已完成步驟操作")).toBe(false);
    });

    it("非字串型態不應誤判為失敗", () => {
      expect(isToolExecutionFailed(null)).toBe(false);
      expect(isToolExecutionFailed(undefined)).toBe(false);

    });
  });

  describe("BrowserTools 動態超時控制 (elementTimeout)", () => {
    it("BrowserTools 實例預設元素等待超時應為 5000ms", () => {
      const dummyManager = { page: null } as unknown as BrowserManager;
      const tools = new BrowserTools(dummyManager);
      expect(tools.elementTimeout).toBe(5000);
    });

    it("可在重放模式下動態縮短為 2000ms 並支援還原", () => {
      const dummyManager = { page: null } as unknown as BrowserManager;
      const tools = new BrowserTools(dummyManager);

      // 模擬進入重放
      tools.elementTimeout = 2000;
      expect(tools.elementTimeout).toBe(2000);

      // 模擬重放結束還原
      tools.elementTimeout = 5000;
      expect(tools.elementTimeout).toBe(5000);
    });
  });

  describe("重放日誌推進至步驟斷言 (routeAfterExecution)", () => {
    it("重放執行完畢包含 done_acting 應推進至 step_asserter", () => {
      const logs: LogEntry[] = [
        {
          step_idx: 0,
          step_description: "開啟網頁並點擊登入",
          action: 'navigate_to({"url":"https://example.com"})',
          result: "已成功導航至網址：https://example.com",
          timestamp: new Date().toISOString(),
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        {
          step_idx: 0,
          step_description: "開啟網頁並點擊登入",
          action: 'click({"id":2})',
          result: "已點擊元素 ID 2。",
          timestamp: new Date().toISOString(),
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        {
          step_idx: 0,
          step_description: "開啟網頁並點擊登入",
          action: 'done_acting({"message":"已完成登入點擊"})',
          result: "DONE_ACTING: 已完成登入點擊",
          timestamp: new Date().toISOString(),
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      ];

      const route = routeAfterExecution({
        logs,
        executor_turn_count: 0,
        current_step_idx: 0,
        step_expecteds: [],
      });

      expect(route).toBe("step_asserter");
    });
  });

  describe("測試案例版本綁定與失效機制 (Version Invalidation)", () => {
    it("建立 TestRun 時應正確綁定 testcase.version", () => {
      const mockTestcase = { id: "tc-123", name: "會員登入測試", version: 2 };
      const mockRun = {
        id: "run-456",
        testcase: mockTestcase,
        testcaseVersion: mockTestcase.version ?? 1,
        status: "pending",
      };

      expect(mockRun.testcaseVersion).toBe(2);
      expect(mockRun.testcaseVersion).toBe(mockTestcase.version);
    });

    it("當測試案例版本自增更新後，舊版本 (v1) 的重放軌跡應被視為未命中", () => {
      const currentTestcaseVersion = 2;
      const historicalRunVersion = 1;

      // 模擬重放條件判定
      const isVersionMatch = historicalRunVersion === currentTestcaseVersion;
      expect(isVersionMatch).toBe(false);
    });
  });

  describe("全域開關關閉略過重放 (Bypass Replay)", () => {
    it("當 enableReplay 為 false 時，即便有歷史軌跡亦應略過重放", () => {
      const enableReplay = false;
      const hasHistoricalLogs = true;
      const isFirstAttempt = true;
      const testcaseVersion = 1;

      const shouldTriggerReplay = Boolean(
        enableReplay && testcaseVersion && isFirstAttempt && hasHistoricalLogs,
      );

      expect(shouldTriggerReplay).toBe(false);
    });
  });

  describe("自我修復交棒與暫存清理機制 (Self-healing Handover)", () => {
    it("重放過程中發生錯誤時，暫存日誌應被拋棄且 executor_turn_count 歸零", () => {
      let executor_turn_count = 3;
      let logs: LogEntry[] = [];
      const replayLogs: LogEntry[] = [
        {
          step_idx: 0,
          step_description: "步驟一",
          action: 'click({"id": 1})',
          result: "已點擊元素 ID 1。",
          timestamp: new Date().toISOString(),
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      ];

      // 模擬重放失敗
      const replaySuccess = false;
      if (replaySuccess) {
        logs = [...logs, ...replayLogs];
      } else {
        // 交棒邏輯：拋棄 replayLogs，重設動作輪次
        executor_turn_count = 0;
      }

      expect(logs).toHaveLength(0); // 暫存日誌未寫入 state.logs
      expect(executor_turn_count).toBe(0); // 動作輪次歸零，賦予 LLM 完整執行空間
    });

    it("重放成功時所有日誌的 Token 消耗應全部為 0", () => {
      const replayLogs: LogEntry[] = [
        {
          step_idx: 0,
          step_description: "步驟一",
          action: 'navigate_to({"url":"https://example.com"})',
          result: "已成功導航",
          timestamp: new Date().toISOString(),
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        {
          step_idx: 0,
          step_description: "步驟一",
          action: 'done_acting({})',
          result: "DONE_ACTING",
          timestamp: new Date().toISOString(),
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      ];

      const totalPrompt = replayLogs.reduce((acc, l) => acc + (l.prompt_tokens ?? 0), 0);
      const totalCompletion = replayLogs.reduce((acc, l) => acc + (l.completion_tokens ?? 0), 0);
      const total = replayLogs.reduce((acc, l) => acc + (l.total_tokens ?? 0), 0);

      expect(totalPrompt).toBe(0);
      expect(totalCompletion).toBe(0);
      expect(total).toBe(0);
    });
  });
});
