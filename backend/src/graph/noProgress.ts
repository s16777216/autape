import type { LogEntry } from "../state.js";

export type NoProgressReason = "all_tools_failed" | "repeated_side_effect";

const SIDE_EFFECT_TOOLS = new Set([
  "navigate_to",
  "click",
  "input",
  "key",
  "hover",
  "execute_javascript",
]);

export function canonicalizeToolArguments(value: unknown): string {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    if (current && typeof current === "object") {
      return Object.fromEntries(
        Object.entries(current as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, normalize(child)]),
      );
    }
    return current;
  };
  return JSON.stringify(normalize(value));
}

type ParsedLog = { name: string; args: Record<string, unknown>; result: string };

function parseToolLog(log: LogEntry): ParsedLog | null {
  if (
    log.action === "strategy_hint" ||
    log.action.startsWith("assert_") ||
    log.action === "none" ||
    log.action.startsWith("unknown_tool:")
  ) return null;

  const match = log.action.match(/^([a-zA-Z0-9_]+)\((.*)\)$/s);
  if (!match) return null;
  try {
    const args = match[2].trim() ? JSON.parse(match[2]) : {};
    if (!args || typeof args !== "object" || Array.isArray(args)) return null;
    return { name: match[1], args, result: log.result };
  } catch {
    return null;
  }
}

export function isFailedToolResult(result: unknown): boolean {
  if (typeof result !== "string") return false;
  const normalized = result.trim();
  return normalized.includes("失敗") || normalized.startsWith("錯誤");
}

function sideEffectSignature(log: LogEntry): string | null {
  const parsed = parseToolLog(log);
  if (!parsed || !SIDE_EFFECT_TOOLS.has(parsed.name) || isFailedToolResult(parsed.result)) {
    return null;
  }
  return `${parsed.name}:${canonicalizeToolArguments(parsed.args)}`;
}

export function detectNoProgress(params: {
  currentRoundLogs: LogEntry[];
  previousLogs: LogEntry[];
}): NoProgressReason | null {
  const currentTools = params.currentRoundLogs.map(parseToolLog).filter((x): x is ParsedLog => x !== null);
  if (currentTools.length > 0 && currentTools.every((tool) => isFailedToolResult(tool.result))) {
    return "all_tools_failed";
  }

  const currentSideEffects = params.currentRoundLogs
    .map(sideEffectSignature)
    .filter((value): value is string => value !== null);
  if (currentSideEffects.length === 0) return null;

  const previousRound = Math.max(
    0,
    ...params.previousLogs.map((log) => log.executor_round ?? 0),
  );
  const previousSideEffects = params.previousLogs
    .filter((log) => previousRound === 0 || log.executor_round === previousRound)
    .map(sideEffectSignature)
    .filter((value): value is string => value !== null);

  if (
    previousSideEffects.length > 0 &&
    currentSideEffects.every((signature) => signature === currentSideEffects[0]) &&
    previousSideEffects.at(-1) === currentSideEffects[0]
  ) {
    return "repeated_side_effect";
  }
  return null;
}
