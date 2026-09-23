import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { BrowserTools } from "../src/tools.js";
import { isToolExecutionFailed } from "../src/graph.js";

describe("BrowserTools fixed Playwright navigation page", () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;
  let click: ReturnType<BrowserTools["getTools"]>[number];

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    page = await context.newPage();
    await context.route("https://autape.test/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const body = pathname === "/hard"
        ? "<title>Hard target</title><h1>Hard target</h1>"
        : `<title>Start</title>
          <a data-e2e-agent-id="1" href="/hard">Hard</a>
          <button data-e2e-agent-id="2" onclick="history.pushState({}, '', '/spa')">SPA</button>
          <button data-e2e-agent-id="3">No navigation</button>
          <a data-e2e-agent-id="4" target="_blank" href="/popup">Popup</a>`;
      await route.fulfill({ status: 200, contentType: "text/html", body });
    });
    click = new BrowserTools({ page } as any).getTools().find((tool) => tool.name === "click")!;
  }, 30_000);

  afterAll(async () => {
    await context?.close();
    await browser?.close();
  });

  it.each([1, 2, 3])("hard navigation run %s/3 reports actual URL", async () => {
    await page.goto("https://autape.test/start");
    const result = await click.invoke({ id: 1, waitStrategy: "waitForNavigation" });
    expect(result).toContain("https://autape.test/hard");
    expect(isToolExecutionFailed(result)).toBe(false);
  }, 20_000);

  it.each([1, 2, 3])("SPA navigation run %s/3 reports actual URL", async () => {
    await page.goto("https://autape.test/start");
    const result = await click.invoke({ id: 2, waitStrategy: "waitForNavigation" });
    expect(result).toContain("https://autape.test/spa");
    expect(isToolExecutionFailed(result)).toBe(false);
  }, 20_000);

  it("declared navigation without a URL change reports failure and current URL", async () => {
    await page.goto("https://autape.test/start");
    const result = await click.invoke({ id: 3, waitStrategy: "waitForNavigation" });
    expect(result).toContain("https://autape.test/start");
    expect(isToolExecutionFailed(result)).toBe(true);
  }, 20_000);

  it("target blank is detected once and reported as unsupported_new_page", async () => {
    await page.goto("https://autape.test/start");
    const result = await click.invoke({ id: 4 });
    expect(result).toContain("unsupported_new_page");
    expect(result).toContain("https://autape.test/popup");
    expect(isToolExecutionFailed(result)).toBe(true);
  }, 20_000);
});
