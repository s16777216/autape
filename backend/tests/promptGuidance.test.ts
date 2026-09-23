import { describe, expect, it } from "vitest";
import {
  buildExecutorHumanText,
  buildExecutorSystemPrompt,
  normalizeStepObjective,
  STEP_OBJECTIVE_OMISSION_MARKER,
} from "../src/graph/prompt.js";

describe("Executor Step Objective guidance", () => {
  it("固定規則宣告 Action 權限、禁止改寫與保留 Asserter 判定權", () => {
    const prompt = buildExecutorSystemPrompt({
      testName: "test",
      stepIdx: 0,
      stepContent: "輸入 A",
      currentUrl: "https://example.com",
    });
    expect(prompt).toContain("Step Action > Step Objective");
    expect(prompt).toContain("Never rewrite the Step Action");
    expect(prompt).toContain("change an input value");
    expect(prompt).toContain("add an operation");
    expect(prompt).toContain("independent Asserter alone decides PASS/FAIL");
  });

  it("空白 objective 視為不存在", () => {
    expect(normalizeStepObjective(" \n\t ")).toBeNull();
    expect(buildExecutorHumanText({ elementList: "DOM", stepObjective: "  ", usedRounds: 0 }))
      .not.toContain("<step-objective>");
  });

  it.each(["顯示完成頁", "https://example.com/target", "url:/target"])(
    "Objective『%s』原樣放入 Human data block，不做特徵解析",
    (objective) => {
      const text = buildExecutorHumanText({ elementList: "DOM", stepObjective: objective, usedRounds: 2 });
      expect(text).toContain(`<step-objective>\n${objective}\n</step-objective>`);
      expect(text).toContain("已使用 2／上限 5／剩餘 3");
    },
  );

  it("以 Unicode code point 截斷中英文與 surrogate pairs", () => {
    const objective = "前".repeat(349) + "😀" + "中".repeat(10) + "尾".repeat(149) + "🧭";
    const normalized = normalizeStepObjective(objective)!;
    const [head, tail] = normalized.split(STEP_OBJECTIVE_OMISSION_MARKER);
    expect(Array.from(head)).toHaveLength(350);
    expect(Array.from(tail)).toHaveLength(150);
    expect(head.endsWith("😀")).toBe(true);
    expect(tail.endsWith("🧭")).toBe(true);
    expect(normalized).not.toContain("�");
  });

  it("第 5 輪顯示零剩餘與收斂指示", () => {
    const text = buildExecutorHumanText({ elementList: "DOM", usedRounds: 4 });
    expect(text).toContain("已使用 4／上限 5／剩餘 1");
    expect(text).toContain("final available Executor round");
  });
});
