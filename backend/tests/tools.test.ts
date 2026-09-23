import { describe, expect, it, vi } from "vitest";
import { BrowserTools } from "../src/tools.js";
import { isToolExecutionFailed } from "../src/graph.js";

function fakeBrowser() {
  let currentUrl = "https://example.com/start";
  const listeners = new Map<string, Function>();
  const page: any = {
    url: vi.fn(() => currentUrl),
    goto: vi.fn(async (url: string) => { currentUrl = url; }),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    waitForNavigation: vi.fn(() => new Promise(() => {})),
    waitForURL: vi.fn(() => new Promise(() => {})),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    focus: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    getByText: vi.fn(() => ({ waitFor: vi.fn().mockResolvedValue(undefined) })),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    evaluate: vi.fn().mockResolvedValue("ok"),
    on: vi.fn((event: string, handler: Function) => listeners.set(event, handler)),
    off: vi.fn((event: string) => listeners.delete(event)),
  };
  const manager: any = {
    page,
    observeWebPage: vi.fn().mockResolvedValue({ elementList: "DOM" }),
  };
  return { manager, page, listeners, setUrl: (url: string) => { currentUrl = url; } };
}

describe("BrowserTools navigation and failure contract", () => {
  it("waitForNavigation supports document navigation and reports actual URL", async () => {
    const env = fakeBrowser();
    env.page.waitForNavigation.mockImplementation(async () => { env.setUrl("https://example.com/hard"); });
    const click = new BrowserTools(env.manager).getTools().find((tool) => tool.name === "click")!;
    expect(await click.invoke({ id: 1, waitStrategy: "waitForNavigation" }))
      .toContain("https://example.com/hard");
  });

  it("waitForNavigation supports SPA URL changes", async () => {
    const env = fakeBrowser();
    env.page.waitForURL.mockImplementation(async () => { env.setUrl("https://example.com/spa"); });
    const click = new BrowserTools(env.manager).getTools().find((tool) => tool.name === "click")!;
    expect(await click.invoke({ id: 1, waitStrategy: "waitForNavigation" }))
      .toContain("https://example.com/spa");
  });

  it("declared navigation timeout is a failed result with current URL", async () => {
    const env = fakeBrowser();
    env.page.waitForNavigation.mockRejectedValue(new Error("timeout"));
    env.page.waitForURL.mockRejectedValue(new Error("timeout"));
    const click = new BrowserTools(env.manager).getTools().find((tool) => tool.name === "click")!;
    const result = await click.invoke({ id: 1, waitStrategy: "waitForNavigation" });
    expect(result).toContain("https://example.com/start");
    expect(isToolExecutionFailed(result)).toBe(true);
  });

  it("popup returns stable marker and URL after one click", async () => {
    const env = fakeBrowser();
    const popup = {
      waitForLoadState: vi.fn().mockResolvedValue(undefined),
      url: vi.fn(() => "https://example.com/popup"),
      close: vi.fn().mockResolvedValue(undefined),
    };
    env.page.click.mockImplementation(async () => env.listeners.get("popup")?.(popup));
    const click = new BrowserTools(env.manager).getTools().find((tool) => tool.name === "click")!;
    const result = await click.invoke({ id: 1 });
    expect(result).toContain("unsupported_new_page");
    expect(result).toContain("https://example.com/popup");
    expect(env.page.click).toHaveBeenCalledOnce();
    expect(isToolExecutionFailed(result)).toBe(true);
  });

  it("all tools expose success and contract-compliant error results", async () => {
    const env = fakeBrowser();
    const tools = Object.fromEntries(new BrowserTools(env.manager).getTools().map((tool) => [tool.name, tool]));
    const successArgs: Record<string, any> = {
      navigate_to: { url: "https://example.com/ok" }, observe_web_page: {}, click: { id: 1 },
      input: { id: 1, text: "secret" }, key: { key: "Enter" }, hover: { id: 1 },
      wait_for_seconds: { seconds: 1 }, execute_javascript: { script: "return 1" }, done_acting: { message: "done" },
    };
    for (const [name, args] of Object.entries(successArgs)) {
      expect(isToolExecutionFailed(await tools[name].invoke(args))).toBe(false);
    }

    env.page.goto.mockRejectedValueOnce(new Error("boom"));
    expect(isToolExecutionFailed(await tools.navigate_to.invoke(successArgs.navigate_to))).toBe(true);
    env.manager.observeWebPage.mockRejectedValueOnce(new Error("boom"));
    expect(isToolExecutionFailed(await tools.observe_web_page.invoke({}))).toBe(true);
    for (const name of ["click", "input", "hover"] as const) {
      env.page.waitForSelector.mockRejectedValueOnce(new Error("boom"));
      expect(isToolExecutionFailed(await tools[name].invoke(successArgs[name]))).toBe(true);
    }
    env.page.keyboard.press.mockRejectedValueOnce(new Error("boom"));
    expect(isToolExecutionFailed(await tools.key.invoke(successArgs.key))).toBe(true);
    env.page.waitForTimeout.mockRejectedValueOnce(new Error("boom"));
    expect(isToolExecutionFailed(await tools.wait_for_seconds.invoke(successArgs.wait_for_seconds))).toBe(true);
    env.page.evaluate.mockRejectedValueOnce(new Error("boom"));
    expect(isToolExecutionFailed(await tools.execute_javascript.invoke(successArgs.execute_javascript))).toBe(true);
  });
});
