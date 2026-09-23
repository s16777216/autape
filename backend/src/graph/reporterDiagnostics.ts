import type { LogEntry, TerminationCause } from "../state.js";
import { isFailedToolResult } from "./noProgress.js";

const REAL_TOOLS = new Set([
  "navigate_to",
  "observe_web_page",
  "click",
  "input",
  "key",
  "hover",
  "wait_for_seconds",
  "execute_javascript",
  "done_acting",
]);

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizeRecentToolActions(logs: LogEntry[], limit = 5): string[] {
  const summaries: string[] = [];
  for (const log of logs) {
    const match = log.action.match(/^([a-zA-Z0-9_]+)\((.*)\)$/s);
    if (!match || !REAL_TOOLS.has(match[1])) continue;

    let args: Record<string, unknown> = {};
    try {
      const parsed = match[2].trim() ? JSON.parse(match[2]) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
    } catch {}

    const fields: string[] = [];
    if (typeof args.id === "number" || typeof args.id === "string") {
      fields.push(`id=${String(args.id).replace(/[^a-zA-Z0-9_-]/g, "")}`);
    }
    const argumentUrl = safeHttpUrl(args.url);
    if (argumentUrl) fields.push(`url=${argumentUrl}`);
    const resultUrlMatch = log.result.match(/https?:\/\/[^\s；。]+/i);
    const resultUrl = safeHttpUrl(resultUrlMatch?.[0]);
    if (resultUrl && resultUrl !== argumentUrl) fields.push(`url=${resultUrl}`);

    summaries.push(
      `${match[1]}${fields.length ? ` (${fields.join(", ")})` : ""}: ${isFailedToolResult(log.result) ? "失敗" : "成功"}`,
    );
  }
  return summaries.slice(-limit);
}

export function buildTerminationFinalReason(params: {
  cause: TerminationCause;
  stepNumber: number;
  stepDescription: string;
  assertionReason?: string;
  logs: LogEntry[];
}): string {
  const header = `步驟 ${params.stepNumber} (『${params.stepDescription}』)`;
  const hints = params.logs
    .filter((log) => log.action === "strategy_hint")
    .map((log) => log.result);
  const diagnosticSections: string[] = [];
  if (params.assertionReason) {
    diagnosticSections.push(`斷言診斷：\n- ${params.assertionReason}`);
  }
  if (hints.length) {
    diagnosticSections.push(`策略診斷：\n${hints.map((hint) => `- ${hint}`).join("\n")}`);
  }
  const diagnostics = diagnosticSections.length
    ? `\n${diagnosticSections.join("\n")}`
    : "";

  if (params.cause === "business_assertion_failure") {
    return `${header} 業務斷言失敗：${params.assertionReason || "未提供斷言理由"}${diagnostics}`;
  }

  if (params.cause === "unsupported_new_page") {
    const popupLog = [...params.logs].reverse().find((log) => log.result.includes("unsupported_new_page"));
    const popupUrl = safeHttpUrl(popupLog?.result.match(/https?:\/\/[^\s；。]+/i)?.[0]);
    return `${header} 因 unsupported_new_page 終止${popupUrl ? `；新分頁網址：${popupUrl}` : ""}。${diagnostics}`;
  }

  const label = params.cause === "operational_budget_exhausted"
    ? "操作補救預算已耗盡"
    : "Executor 回合預算已耗盡";
  const actions = sanitizeRecentToolActions(params.logs);
  const actionSection = actions.length
    ? `\n最近工具動作：\n${actions.map((action) => `- ${action}`).join("\n")}`
    : "";
  return `${header} ${label}，測試終止。${actionSection}${diagnostics}`;
}
