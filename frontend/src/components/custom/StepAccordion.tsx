import React, { useState } from "react";
import {
  ChevronDown,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Image as ImageIcon,
  MessageSquare,
} from "lucide-react";
import type { TestRunStep, TestcaseStep } from "../../types/api";
import { cn } from "../../lib/utils";
import { Timeline, TimelineItem } from "../shadcn-studio/blocks/timeline-component-05/timeline-component-05";
import { ImagePreview } from "./ImagePreview";

interface StepAccordionProps {
  steps: TestRunStep[];
  testcaseSteps?: TestcaseStep[];
  defaultOpenAll?: boolean;
}

export function StepAccordion({
  steps,
  testcaseSteps = [],
  defaultOpenAll = false,
}: StepAccordionProps) {
  // 對齊靜態定義與動態執行紀錄
  const alignedSteps = React.useMemo(() => {
    if (!testcaseSteps || testcaseSteps.length === 0) {
      return steps;
    }

    // 判斷是否已經有任何步驟出錯
    const hasFailedStep = steps.some(
      (s) => s.status === "failed" || s.status === "error",
    );

    return testcaseSteps.map((tcStep) => {
      const matchedRunStep = steps.find((s) => s.stepIdx === tcStep.stepIdx);
      if (matchedRunStep) {
        return {
          ...matchedRunStep,
          stepExpected: tcStep.expected,
        };
      }

      // 判定是否為已略過 (若前方有步驟失敗，或者整個執行已非 pending/running 結束)
      const isSkipped =
        hasFailedStep ||
        (steps.length > 0 &&
          steps.every((s) => s.status !== "running" && s.status !== "pending"));

      return {
        id: `tc-step-${tcStep.id}`,
        stepIdx: tcStep.stepIdx,
        stepDescription: tcStep.action,
        status: isSkipped ? "skipped" : "pending",
        screenshotUrl: null,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        logs: [],
        stepExpected: tcStep.expected,
      } as TestRunStep & { stepExpected?: string };
    });
  }, [steps, testcaseSteps]);

  return (
    <div className="space-y-4">
      {alignedSteps.map((step) => (
        <StepCard key={step.stepIdx} step={step} defaultOpen={defaultOpenAll} />
      ))}
    </div>
  );
}

function StepCard({
  step,
  defaultOpen,
}: {
  step: TestRunStep & { stepExpected?: string };
  defaultOpen: boolean;
}) {
  const hasError = step.status === "failed" || step.status === "error";
  const isPending = step.status === "pending";
  const isRunning = step.status === "running";
  const isSkipped = step.status === "skipped";

  const [isOpen, setIsOpen] = useState(defaultOpen || isRunning || hasError);

  // 當正在執行或出錯時，自動展開卡片
  React.useEffect(() => {
    if (isRunning || hasError) {
      Promise.resolve().then(() => {
        setIsOpen(true);
      });
    }
  }, [isRunning, hasError]);

  const totalTokens =
    (step.promptTokens ?? 0) +
    (step.completionTokens ?? 0) +
    (step.totalTokens ?? 0);

  return (
    <div
      className={cn(
        "bg-zinc-900/40 border backdrop-blur-md rounded-xl transition-all duration-300",
        hasError
          ? "border-rose-500/40 bg-rose-950/5 shadow-rose-950/20"
          : isRunning
            ? "border-emerald-500/30 bg-zinc-900/60"
            : isSkipped
              ? "border-zinc-900/50 bg-zinc-950/20 opacity-50"
              : isPending
                ? "border-zinc-900/80 bg-zinc-950/30"
                : isOpen
                  ? "shadow-lg shadow-black/35 border-zinc-700/40"
                  : "border-zinc-800/80 hover:border-zinc-700/60",
      )}
    >
      {/* Header */}
      <div
        onClick={() => {
          if (!isSkipped && !isPending) {
            setIsOpen(!isOpen);
          } else {
            // 允許 pending 或 skipped 的步驟有 expected 時展開檢視 expected 資訊
            if (step.stepExpected) {
              setIsOpen(!isOpen);
            }
          }
        }}
        className={cn(
          "flex items-center justify-between p-4 select-none transition-colors rounded-xl",
          isSkipped || isPending
            ? step.stepExpected
              ? "cursor-pointer hover:bg-zinc-900/10"
              : "cursor-not-allowed"
            : "cursor-pointer hover:bg-zinc-900/30",
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Status Icon */}
          <div className="flex-shrink-0">
            {hasError ? (
              <XCircle className="w-5 h-5 text-rose-500" />
            ) : isRunning ? (
              <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
            ) : isSkipped ? (
              <AlertCircle className="w-5 h-5 text-zinc-600" />
            ) : isPending ? (
              <AlertCircle className="w-5 h-5 text-zinc-500" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            )}
          </div>

          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={cn(
                "flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold border",
                isSkipped
                  ? "bg-zinc-950 text-zinc-500 border-zinc-900"
                  : "bg-zinc-800 text-zinc-300 border-zinc-700/50",
              )}
            >
              步驟 {step.stepIdx + 1}
            </span>
            <span
              className={cn(
                "font-medium text-sm truncate",
                isSkipped
                  ? "text-zinc-500"
                  : isPending
                    ? "text-zinc-400"
                    : "text-zinc-200",
              )}
            >
              {step.stepDescription || "無步驟描述"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isSkipped && (
            <span className="text-[9px] text-zinc-500 bg-zinc-950/60 px-2 py-0.5 rounded border border-zinc-900">
              已略過
            </span>
          )}
          {isPending && !isSkipped && (
            <span className="text-[9px] text-zinc-500 bg-zinc-950/40 px-2 py-0.5 rounded border border-zinc-900/60 animate-pulse">
              待執行
            </span>
          )}

          {totalTokens > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-zinc-300 bg-indigo-950/40 px-2.5 py-0.5 rounded-full border border-indigo-500/20 transition-all duration-300 hover:border-indigo-400/40 hover:bg-indigo-900/30">
              {step.totalTokens} Tokens
            </span>
          )}

          {step.screenshotUrl && (
            <span className="flex items-center gap-1 text-[10px] text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded-full border border-zinc-700/50">
              <ImageIcon className="w-3 h-3 text-indigo-400" />
              截圖
            </span>
          )}
          {((step.logs?.length || 0) > 0 || step.stepExpected) && (
            <ChevronDown
              className={cn(
                "w-4 h-4 text-zinc-400 transition-transform duration-300",
                isOpen && "transform rotate-180 text-zinc-200",
              )}
            />
          )}
        </div>
      </div>

      {/* Content */}
      <div
        className={cn(
          "transition-all duration-300 ease-in-out overflow-hidden",
          isOpen ? "max-h-[2500px] border-t border-zinc-800/40 p-4" : "max-h-0",
        )}
      >
        {!step.logs || step.logs.length === 0 ? (
          <div className="text-zinc-500 text-xs italic pl-8 py-2 flex flex-col gap-2">
            <div>{isSkipped ? "此步驟已被略過。" : "尚未開始執行動作。"}</div>
            {step.stepExpected && (
              <div className="text-[11px] text-zinc-400 bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-900 max-w-xl not-italic mt-1">
                <span className="font-semibold text-zinc-500 block mb-1 text-[10px] uppercase tracking-wider">
                  預期完成結果：
                </span>
                <span className="text-zinc-300">{step.stepExpected}</span>
              </div>
            )}
          </div>
        ) : (
          <Timeline>
            {step.logs?.map((log, index) => {
              const isStrategyHint = log.action === "strategy_hint";
              const logHasError =
                !isStrategyHint &&
                (log.result?.toLowerCase().includes("fail") ||
                  log.result?.toLowerCase().includes("error"));
              const isLogPending =
                !isStrategyHint &&
                (log.result?.toLowerCase() === "pending" ||
                  log.result?.toLowerCase() === "running");
              const isItemLast = !step.stepExpected && index === (step.logs?.length ?? 0) - 1;

              const logDot = (
                <span className={cn(
                  "flex size-4.5 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
                  logHasError
                    ? "bg-rose-500/20"
                    : isLogPending
                      ? "bg-emerald-500/20 animate-pulse"
                      : "bg-zinc-700/20"
                )}>
                  <span className={cn(
                    "size-2.5 rounded-full border",
                    logHasError
                      ? "bg-rose-500 border-rose-400 shadow-sm shadow-rose-500/50"
                      : isLogPending
                        ? "bg-emerald-500 border-emerald-400 animate-pulse"
                        : "bg-zinc-700 border-zinc-600 group-hover/item:bg-zinc-500"
                  )} />
                </span>
              );

              return (
                <TimelineItem
                  key={log.id || index}
                  compact={true}
                  dot={logDot}
                  isLast={isItemLast}
                >
                  <div className="space-y-2 -mt-1.5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="font-mono text-xs text-zinc-300 font-semibold bg-zinc-900/90 px-2 py-0.5 rounded border border-zinc-800 inline-block">
                          {log.action || "執行操作..."}
                        </div>
                        <p
                          className={cn(
                            "text-xs leading-relaxed",
                            logHasError
                              ? "text-rose-400 font-medium"
                              : "text-zinc-400",
                          )}
                        >
                          {log.result || "-"}
                        </p>
                      </div>
                    </div>

                    {log.aiResponse && (
                      <div className="bg-indigo-950/10 text-indigo-300/90 border border-indigo-900/30 rounded-lg p-3 text-xs space-y-1.5 leading-relaxed mt-2 animate-fadeIn">
                        <div className="flex items-center gap-1.5 font-medium text-[11px] text-indigo-400">
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>AI 推理分析</span>
                        </div>
                        <p className="font-sans whitespace-pre-wrap">
                          {log.aiResponse}
                        </p>
                      </div>
                    )}
                  </div>
                </TimelineItem>
              );
            })}

            {step.stepExpected && (
              <TimelineItem
                compact={true}
                isLast={true}
                dot={
                  <span className="bg-indigo-500/20 flex size-4.5 shrink-0 items-center justify-center rounded-full">
                    <span className="bg-indigo-500 size-2.5 rounded-full border border-indigo-400 shadow-sm shadow-indigo-500/50" />
                  </span>
                }
              >
                <div className="relative group/item mt-0.5 animate-fadeIn">
                  <div className="text-[11px] text-zinc-400 bg-zinc-950/40 p-2.5 rounded-lg border border-zinc-900 max-w-xl">
                    <span className="font-semibold text-zinc-500 block mb-1 text-[10px] uppercase tracking-wider">
                      此步驟預期完成結果：
                    </span>
                    <span className="text-zinc-300">{step.stepExpected}</span>
                  </div>
                </div>
              </TimelineItem>
            )}
          </Timeline>
        )}

        {/* Screenshot View */}
        {step.screenshotUrl && (
          <div className="mt-6 pl-6 pt-4 border-t border-zinc-800/30">
            <div className="text-[10px] text-zinc-500 font-semibold mb-2 flex items-center gap-1.5 uppercase tracking-wider">
              <ImageIcon className="w-3.5 h-3.5 text-zinc-500" />
              <span>步驟執行截圖</span>
            </div>
            <ImagePreview src={step.screenshotUrl} alt={`Step ${step.stepIdx + 1} Screenshot`}>
              <div className="relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 max-w-2xl group/img shadow-md cursor-zoom-in">
                <img
                  src={step.screenshotUrl}
                  alt={`Step ${step.stepIdx + 1} Screenshot`}
                  className="w-full h-auto object-contain transition-transform duration-500 group-hover/img:scale-[1.01]"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity duration-300 pointer-events-none flex items-end p-2">
                  <span className="text-[10px] text-zinc-300 bg-zinc-900/90 px-2 py-1 rounded border border-zinc-700/30 font-mono">
                    步驟 {step.stepIdx + 1} 最終狀態畫面 (點擊全螢幕放大)
                  </span>
                </div>
              </div>
            </ImagePreview>
          </div>
        )}
      </div>
    </div>
  );
}

