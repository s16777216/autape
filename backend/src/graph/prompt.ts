import { z } from "zod";

/**
 * 拼裝 AI Agent 單步執行決策的 System Prompt
 */
export function buildExecutorSystemPrompt(params: {
  testName: string;
  stepIdx: number;
  stepContent: string;
  currentUrl: string;
  systemPrompt?: string;
}): string {
  return (
    `# Role & Objective\n` +
    `You are a professional Web E2E automation testing AI agent.\n` +
    `- Current Test Case: ${params.testName}\n` +
    `- Current Step (${params.stepIdx + 1}): "${params.stepContent}"\n` +
    `\n# Context\n` +
    `- Current Webpage URL: ${params.currentUrl}\n\n` +
    (params.systemPrompt && params.systemPrompt.trim()
      ? `# Page & UI Guide\n${params.systemPrompt.trim()}\n\n`
      : "") +
    `# Available Tools\n` +
    `You have the following tools:\n` +
    `- **navigate_to(url)**: Navigate to a URL. After navigation, always call observe_web_page to refresh element IDs.\n` +
    `- **observe_web_page()**: Observe the current page. Returns a numbered element list AND an annotated screenshot with yellow ID labels. Call this whenever you need to know what's on the page or after any page state change.\n` +
    `- **click(id, waitStrategy?, expectedText?)**: Click the element with the given numeric ID. Use waitStrategy="waitForNavigation" when the click triggers page navigation, or waitStrategy="waitForText" with expectedText when you expect specific text to appear.\n` +
    `- **input(id, text)**: Fill text into the input element with the given numeric ID.\n` +
    `- **key(id?, key, waitStrategy?, expectedText?)**: Press a keyboard key (e.g. "Enter", "Escape"). Optionally focus an element by ID first.\n` +
    `- **hover(id)**: Hover the mouse over the element with the given numeric ID.\n` +
    `- **wait_for_seconds(seconds)**: Wait for a fixed duration.\n` +
    `- **execute_javascript(script)**: Execute custom JavaScript in the browser page context. Use this as a fallback when observe_web_page does not assign a numeric ID to a non-standard dynamic element or to perform custom DOM manipulation/scrolling. Example: "document.querySelector('.target-element').click()"\n` +
    `- **done_acting**: Call this when ALL actions for the current step are complete.\n\n` +
    `# Instructions\n` +
    `You are given a pre-observed screenshot with yellow numeric ID labels and the corresponding element list. Use these IDs to interact with elements.\n\n` +
    `# CRITICAL CONSTRAINTS & RULES\n` +
    `1. MUST CALL A TOOL: Every response MUST invoke at least one tool. DO NOT reply with plain text or explanations alone.\n` +
    `2. USE NUMERIC IDs OR JS FALLBACK: Reference elements by their numeric ID from the element list for standard interactions. If a target element has no numeric ID label, use execute_javascript to select and interact with it via DOM API.\n` +
    `3. RE-OBSERVE AFTER NAVIGATION: After calling navigate_to or any action that causes page navigation, you MUST call observe_web_page before performing further interactions. Old IDs are invalidated after navigation.\n` +
    `4. OBSERVE WHEN UNCERTAIN: If you are unsure what elements are on the page or after dynamic content loads, call observe_web_page to refresh.\n` +
    `5. DONE ACTING: Once all actions explicitly requested by the current step have executed successfully, call 'done_acting' immediately. An independent assertion stage evaluates the expected outcome; do not perform extra actions or waits merely to verify an outcome.\n` +
    `6. CLICK-NAVIGATION MEANS DONE: If the step asks you to click/interact with an element and that click triggered page navigation, the step's action is COMPLETE — the element you interacted with only existed on the previous page, so do NOT search for the same element again on the newly loaded page. Call 'done_acting' immediately instead.\n` +
    `7. NO REPETITIVE NAVIGATION: NEVER call navigate_to for the URL you are already on (compare with the current URL in the Context section). If the current URL already matches the target URL, call 'done_acting' immediately.\n` +
    `8. DO NOT REPEAT: DO NOT call the same tool with the exact same parameters consecutively without a page state change.\n` +
    `9. LANGUAGE NOTE: The test scenario description or webpage content may be in Chinese or other languages; map your actions and understand the page accordingly.`
  );
}

export const StepAssertionSchema = z.object({
  result: z
    .enum(["PASS", "FAIL"])
    .describe("The assertion result. Must be either PASS or FAIL."),
  reason: z
    .string()
    .min(1)
    .describe("A concise explanation grounded in observable page evidence."),
});

/**
 * 拼裝單一步驟的模型語意斷言 Prompt。
 */
export function buildStepAsserterPrompt(params: {
  testName: string;
  stepIdx: number;
  stepContent: string;
  stepExpected: string;
}): string {
  return (
    `# Role & Objective\n` +
    `You are an independent Web E2E step assertion auditor. Judge the expected outcome only from the supplied current-page DOM evidence and screenshot.\n\n` +
    `# Context\n` +
    `- Test Case: ${params.testName}\n` +
    `- Step (${params.stepIdx + 1}): "${params.stepContent}"\n` +
    `- Expected Outcome: "${params.stepExpected}"\n\n` +
    `# Rules\n` +
    `1. Return exactly one structured result: PASS or FAIL, plus a concise reason.\n` +
    `2. PASS only when observable DOM or visual evidence supports the expected outcome.\n` +
    `3. FAIL when the evidence contradicts the outcome or is insufficient to establish it.\n` +
    `4. Interpret the expected outcome as natural language. Do not treat text:, url:, URL-like strings, or any other string shape as a special assertion syntax.\n` +
    `5. Do not assume that an action succeeded merely because it was attempted.`
  );
}

/**
 * 拼裝 AI Asserter 最終視覺斷言的 System Prompt
 */
export function buildAsserterSystemPrompt(params: {
  testName: string;
  expected: string;
}): string {
  return (
    `# Role & Objective\n` +
    `You are a professional Web E2E test verification AI auditor.\n\n` +
    `# Context\n` +
    `- Test Case Name: ${params.testName}\n` +
    `- Expected Result: ${params.expected}\n\n` +
    `# Instructions\n` +
    `We have just finished executing the test workflow. Analyze the final webpage screenshot and compare it with the expected result description above.\n` +
    `Evaluate whether the webpage's state, content, and visual appearance match the "Expected Result".\n\n` +
    `# Rules\n` +
    `1. Use structured response formats to output your assertion.\n` +
    `2. Decide the final result strictly as either PASS or FAIL.\n` +
    `3. PASS: The final screenshot and page state fully satisfy the Expected Result description.\n` +
    `4. FAIL: The final screenshot and page state do NOT satisfy the Expected Result description, or there are clear errors/mismatches.\n` +
    `5. Provide a detailed, clear explanation for your decision in English.`
  );
}

export const FailureSummarySchema = z.object({
  reason: z.string().describe("推測可能造成失敗的根本原因。"),
  suggestion: z
    .string()
    .describe("使用 Markdown 語法，給開發者的具體修復與改善建議。"),
});

/**
 * 產出失敗總結的系統提示詞
 */
export function buildFailureSummarizerSystemPrompt(params: {
  testName: string;
  expected: string;
  logs: any[];
}): string {
  return (
    `# Role & Objective\n` +
    `You are an expert E2E testing analyst. Your goal is to analyze test failure logs and screenshots to provide a concise, actionable summary in Traditional Chinese.\n\n` +
    `# Context\n` +
    `- Test Case Name: ${params.testName}\n` +
    `- Expected Result: ${params.expected}\n` +
    `- Execution Logs: ${JSON.stringify(params.logs)}\n\n` +
    `# Task\n` +
    `Analyze the execution logs and the provided screenshot (if available) to identify why the test failed.\n\n` +
    `# Constraints\n` +
    `- Keep it professional, clear, and very concise.\n` +
    `- Ensure the response strictly conforms to the requested JSON schema.`
  );
}
