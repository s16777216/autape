import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { Runnable } from "@langchain/core/runnables";
import {
  FailureSummarySchema,
  StepAssertionStructuredOutputSchema,
} from "../graph/prompt.js";
import type { ModelSetting } from "../entities/ModelSetting.js";

/**
 * 依據 ModelSetting.provider 動態實例化並回傳 Executor 模型（已綁定工具）。
 * provider="google" → ChatGoogleGenerativeAI
 * 其他任何值       → ChatOpenAI（OpenAI Compatible 格式）
 */
export function getExecutorModel(modelSetting: ModelSetting, tools: any[]): Runnable {
  if (modelSetting.provider === "google") {
    return new ChatGoogleGenerativeAI({
      model: modelSetting.model,
      temperature: 0.0,
      apiKey: modelSetting.apiKey || undefined,
    }).bindTools(tools);
  }

  return new ChatOpenAI({
    model: modelSetting.model || "gpt-4o",
    temperature: 0.0,
    apiKey: modelSetting.apiKey || "ollama",
    configuration: {
      baseURL: modelSetting.baseUrl || "http://localhost:11434/v1",
    },
  }).bindTools(tools);
}

/**
 * 使用 Executor 的模型設定建立獨立的步驟斷言器。
 * 此模型不綁定工具，並強制輸出 PASS/FAIL 與理由。
 */
export function getStepAsserterModel(modelSetting: ModelSetting): Runnable {
  if (modelSetting.provider === "google") {
    return new ChatGoogleGenerativeAI({
      model: modelSetting.model,
      temperature: 0.0,
      apiKey: modelSetting.apiKey || undefined,
    }).withStructuredOutput(StepAssertionStructuredOutputSchema, {
      includeRaw: true,
    });
  }

  return new ChatOpenAI({
    model: modelSetting.model || "gpt-4o",
    temperature: 0.0,
    apiKey: modelSetting.apiKey || "ollama",
    configuration: {
      baseURL: modelSetting.baseUrl || "http://localhost:11434/v1",
    },
  }).withStructuredOutput(StepAssertionStructuredOutputSchema, {
    includeRaw: true,
  });
}

/**
 * 依據 ModelSetting.provider 建立專用於失敗總結的 LLM 實例，
 * 不繫結工具，Temperature 設為 0.2。
 */
export function getSummarizerModel(modelSetting: ModelSetting): Runnable {
  if (modelSetting.provider === "google") {
    return new ChatGoogleGenerativeAI({
      model: modelSetting.model,
      temperature: 0.2,
      apiKey: modelSetting.apiKey || undefined,
    }).withStructuredOutput(FailureSummarySchema, { includeRaw: true });
  }

  return new ChatOpenAI({
    model: modelSetting.model || "gpt-4o",
    temperature: 0.2,
    apiKey: modelSetting.apiKey || "ollama",
    configuration: {
      baseURL: modelSetting.baseUrl || "http://localhost:11434/v1",
    },
  }).withStructuredOutput(FailureSummarySchema, { includeRaw: true });
}
