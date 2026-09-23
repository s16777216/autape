import { describe, expect, it } from "vitest";
import {
  buildTerminationFinalReason,
  sanitizeRecentToolActions,
} from "../src/graph/reporterDiagnostics.js";
import type { LogEntry } from "../src/state.js";

const entry = (action: string, result = "成功"): LogEntry => ({
  step_idx: 0,
  step_description: "step",
  action,
  result,
  timestamp: new Date().toISOString(),
});

describe("safe reporter diagnostics", () => {
  it("只保留最近五個真實工具動作並排除 synthetic logs", () => {
    const logs = [
      entry("strategy_hint", "secret"),
      entry("assert_failure", "assertion"),
      ...Array.from({ length: 6 }, (_, i) => entry(`click({\"id\":${i + 1}})`)),
    ];
    const summary = sanitizeRecentToolActions(logs);
    expect(summary).toHaveLength(5);
    expect(summary[0]).toContain("id=2");
    expect(summary.join(" ")).not.toContain("secret");
    expect(summary.join(" ")).not.toContain("assertion");
  });

  it("遮蔽輸入、按鍵、JavaScript、cookie、token、authorization 與 credentials", () => {
    const secrets = ["password-123", "EnterSecret", "document.cookie", "cookie-value", "token-value", "Bearer abc", "credential-value"];
    const logs = [
      entry('input({"id":3,"text":"password-123","token":"token-value"})'),
      entry('key({"id":3,"key":"EnterSecret"})'),
      entry('execute_javascript({"script":"document.cookie=\\"cookie-value\\"","authorization":"Bearer abc","credentials":"credential-value"})'),
      entry('navigate_to({"url":"https://user:pass@example.com/path?token=token-value#cookie-value"})'),
    ];
    const rendered = sanitizeRecentToolActions(logs).join("\n");
    for (const secret of secrets) expect(rendered).not.toContain(secret);
    expect(rendered).toContain("https://example.com/path");
  });

  it("business 保留 assertion reason，budget 顯示安全摘要，popup 顯示 URL", () => {
    expect(buildTerminationFinalReason({
      cause: "business_assertion_failure", stepNumber: 1, stepDescription: "登入",
      assertionReason: "帳號遭拒絕", logs: [],
    })).toContain("帳號遭拒絕");
    expect(buildTerminationFinalReason({
      cause: "executor_budget_exhausted", stepNumber: 1, stepDescription: "登入",
      assertionReason: "登入按鈕未生效",
      logs: [
        entry('input({"id":3,"text":"secret"})'),
        entry("strategy_hint", "[all_tools_failed] switch strategy"),
      ],
    })).toEqual(expect.stringContaining("斷言診斷：\n- 登入按鈕未生效"));
    const budgetReason = buildTerminationFinalReason({
      cause: "executor_budget_exhausted", stepNumber: 1, stepDescription: "登入",
      assertionReason: "登入按鈕未生效",
      logs: [
        entry('input({"id":3,"text":"secret"})'),
        entry("strategy_hint", "[all_tools_failed] switch strategy"),
      ],
    });
    expect(budgetReason).toContain("input (id=3): 成功");
    expect(budgetReason).toContain("策略診斷：");
    expect(buildTerminationFinalReason({
      cause: "unsupported_new_page", stepNumber: 1, stepDescription: "開啟",
      logs: [entry('click({"id":1})', "錯誤：unsupported_new_page：https://example.com/popup?token=secret")],
    })).toContain("https://example.com/popup");
  });
});
