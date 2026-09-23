import { DynamicStructuredToolInput, tool } from "@langchain/core/tools";
import { z } from "zod";
import { BrowserManager } from "./browser.js";

export class BrowserTools {
  public elementTimeout: number = 5000;
  constructor(private browserManager: BrowserManager) {}

  /**
   * 取得綁定了 Playwright 實例的 LangChain Tools 列表
   */
  public getTools() {
    const navigate_to = tool(
      async ({ url }) => {
        try {
          const page = this.browserManager.page;
          if (!page) return "錯誤：瀏覽器未初始化。";

          await page.goto(url);
          // 等待網頁載入完成，最多等 5 秒
          try {
            await page.waitForLoadState("networkidle", { timeout: 5000 });
          } catch (e) {}

          return `已成功導航至網址：${url}`;
        } catch (error: any) {
          return `導航至網址 ${url} 失敗：${error.message}`;
        }
      },
      {
        name: "navigate_to",
        description:
          "將瀏覽器導航至指定的 URL 網址。參數 url 必須是完整的網址，例如 'https://www.google.com'。導航完成後，請務必呼叫 observe_web_page 以刷新元素清單。",
        schema: z.object({
          url: z.string().url().describe("要導航的完整目標網址"),
        }),
      },
    );

    /**
     * observe_web_page：感知工具
     * 回傳 multipart content（文字清單 + 帶貼紙截圖），供多模態模型同時閱讀
     */
    const observe_web_page = tool(
      async () => {
        try {
          const { elementList } = await this.browserManager.observeWebPage();
          return elementList;
        } catch (error: any) {
          return `observe_web_page 失敗：${error.message}`;
        }
      },
      {
        name: "observe_web_page",
        description:
          "觀察當前網頁，取得所有可見且可互動的元素清單（含唯一數字 ID）。在執行任何點擊或輸入操作前，或頁面內容發生變化後，請先呼叫此工具以獲取最新的元素 ID。",
        schema: z.object({}),
      },
    );

    /**
     * click：點擊指定 ID 的元素，支援非同步等待策略
     */
    const click = tool(
      async ({ id, waitStrategy, expectedText }) => {
        try {
          const page = this.browserManager.page;
          if (!page) return "錯誤：瀏覽器未初始化。";

          const selector = `[data-e2e-agent-id="${id}"]`;
          await page.waitForSelector(selector, {
            state: "visible",
            timeout: this.elementTimeout,
          });

          let popupPage: any = null;
          let resolvePopup!: (value: "popup") => void;
          const popupSignal = new Promise<"popup">((resolve) => {
            resolvePopup = resolve;
          });
          const onPopup = (popup: any) => {
            popupPage = popup;
            resolvePopup("popup");
          };
          page.on("popup", onPopup);

          try {
            if (waitStrategy === "waitForNavigation") {
              const originalUrl = page.url();
              const documentNavigation = page
                .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 })
                .then(() => "document_navigation" as const)
                .catch(() => "timeout" as const);
              const urlChange = page
                .waitForURL((url) => url.toString() !== originalUrl, {
                  waitUntil: "domcontentloaded",
                  timeout: 10000,
                })
                .then(() => "url_change" as const)
                .catch(() => "timeout" as const);

              await page.click(selector);
              const outcome = await Promise.race([
                popupSignal,
                Promise.race([documentNavigation, urlChange]),
              ]);

              if (outcome === "popup" && popupPage) {
                await popupPage.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
                const popupUrl = popupPage.url();
                await popupPage.close().catch(() => {});
                return `錯誤：unsupported_new_page；點擊元素 ID ${id} 開啟了不支援的新分頁：${popupUrl}`;
              }
              if (
                outcome === "timeout" ||
                (outcome === "url_change" && page.url() === originalUrl)
              ) {
                return `點擊元素 ID ${id} 失敗：等待頁面導航逾時；目前網址：${page.url()}`;
              }
              await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
              return `已點擊元素 ID ${id}，並完成頁面導航。目前網址：${page.url()}`;
            } else if (waitStrategy === "waitForText" && expectedText) {
              await page.click(selector);
              await Promise.race([popupSignal, page.waitForTimeout(500)]);
              if (popupPage) {
                await popupPage.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
                const popupUrl = popupPage.url();
                await popupPage.close().catch(() => {});
                return `錯誤：unsupported_new_page；點擊元素 ID ${id} 開啟了不支援的新分頁：${popupUrl}`;
              }
              await page
                .getByText(expectedText)
                .waitFor({ state: "visible", timeout: this.elementTimeout });
              return `已點擊元素 ID ${id}，並確認畫面出現「${expectedText}」。`;
            } else {
              await page.click(selector);
              await Promise.race([popupSignal, page.waitForTimeout(500)]);
              if (popupPage) {
                await popupPage.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
                const popupUrl = popupPage.url();
                await popupPage.close().catch(() => {});
                return `錯誤：unsupported_new_page；點擊元素 ID ${id} 開啟了不支援的新分頁：${popupUrl}`;
              }
              return `已點擊元素 ID ${id}。`;
            }
          } finally {
            page.off("popup", onPopup);
          }
        } catch (error: any) {
          return `點擊元素 ID ${id} 失敗：${error.message}`;
        }
      },
      {
        name: "click",
        description:
          "點擊指定數字 ID 的元素。可選擇附加非同步等待策略：waitForNavigation（等待頁面完成載入）或 waitForText（等待畫面出現指定文字）。",
        schema: z.object({
          id: z
            .number()
            .int()
            .positive()
            .describe("目標元素的數字 ID（來自 observe_web_page）"),
          waitStrategy: z
            .enum(["waitForNavigation", "waitForText"])
            .optional()
            .describe("點擊後的非同步等待策略（選填）"),
          expectedText: z
            .string()
            .optional()
            .describe(
              "當 waitStrategy 為 waitForText 時，指定要等待出現的文字",
            ),
        }),
      },
    );

    /**
     * input：在指定 ID 的輸入框填入文字
     */
    const input = tool(
      async ({ id, text }) => {
        try {
          const page = this.browserManager.page;
          if (!page) return "錯誤：瀏覽器未初始化。";

          const selector = `[data-e2e-agent-id="${id}"]`;
          await page.waitForSelector(selector, {
            state: "visible",
            timeout: this.elementTimeout,
          });
          await page.fill(selector, text);
          return `已在元素 ID ${id} 中輸入：'${text}'`;
        } catch (error: any) {
          return `在元素 ID ${id} 中輸入文字失敗：${error.message}`;
        }
      },
      {
        name: "input",
        description:
          "在指定數字 ID 的輸入框中填入文字內容（使用 fill，會完整取代原有內容）。",
        schema: z.object({
          id: z
            .number()
            .int()
            .positive()
            .describe("目標輸入框的數字 ID（來自 observe_web_page）"),
          text: z.string().describe("要填入的文字內容"),
        }),
      },
    );

    /**
     * key：模擬鍵盤按鍵，可選先 focus 指定元素，支援非同步等待策略
     */
    const key = tool(
      async ({ id, key: keyName, waitStrategy, expectedText }) => {
        try {
          const page = this.browserManager.page;
          if (!page) return "錯誤：瀏覽器未初始化。";

          // 若指定 id，先 focus 該元素
          if (id !== undefined) {
            const selector = `[data-e2e-agent-id="${id}"]`;
            await page.waitForSelector(selector, {
              state: "visible",
              timeout: this.elementTimeout,
            });
            await page.focus(selector);
          }

          if (waitStrategy === "waitForNavigation") {
            await Promise.all([
              page.waitForLoadState("networkidle", { timeout: 10000 }),
              page.keyboard.press(keyName),
            ]);
            return `已按下「${keyName}」，並等待頁面導航完成。`;
          } else if (waitStrategy === "waitForText" && expectedText) {
            await page.keyboard.press(keyName);
            await page
              .getByText(expectedText)
              .waitFor({ state: "visible", timeout: this.elementTimeout });
            return `已按下「${keyName}」，並確認畫面出現「${expectedText}」。`;
          } else {
            await page.keyboard.press(keyName);
            return `已按下「${keyName}」。`;
          }
        } catch (error: any) {
          return `按鍵操作失敗：${error.message}`;
        }
      },
      {
        name: "key",
        description:
          "模擬鍵盤按鍵事件（如 Enter、Escape、Tab）。可選先 focus 指定 ID 的元素，以及附加非同步等待策略。",
        schema: z.object({
          id: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("選填：按鍵前先 focus 的元素 ID"),
          key: z.string().describe('鍵名，例如 "Enter"、"Escape"、"Tab"'),
          waitStrategy: z
            .enum(["waitForNavigation", "waitForText"])
            .optional()
            .describe("按鍵後的非同步等待策略（選填）"),
          expectedText: z
            .string()
            .optional()
            .describe(
              "當 waitStrategy 為 waitForText 時，指定要等待出現的文字",
            ),
        }),
      },
    );

    /**
     * hover：將滑鼠懸停至指定 ID 的元素
     */
    const hover = tool(
      async ({ id }) => {
        try {
          const page = this.browserManager.page;
          if (!page) return "錯誤：瀏覽器未初始化。";

          const selector = `[data-e2e-agent-id="${id}"]`;
          await page.waitForSelector(selector, {
            state: "visible",
            timeout: this.elementTimeout,
          });
          await page.hover(selector);
          return `已將滑鼠懸停至元素 ID ${id}。`;
        } catch (error: any) {
          return `懸停至元素 ID ${id} 失敗：${error.message}`;
        }
      },
      {
        name: "hover",
        description:
          "將滑鼠游標移動並懸停至指定數字 ID 的元素上，用於觸發 tooltip 或下拉選單等 hover 互動。",
        schema: z.object({
          id: z
            .number()
            .int()
            .positive()
            .describe("目標元素的數字 ID（來自 observe_web_page）"),
        }),
      },
    );

    const wait_for_seconds = tool(
      async ({ seconds }) => {
        try {
          const page = this.browserManager.page;
          if (!page) return "錯誤：瀏覽器未初始化。";
          await page.waitForTimeout(seconds * 1000);
          return `已強制等待了 ${seconds} 秒`;
        } catch (error: any) {
          return `強制等待失敗：${error.message}`;
        }
      },
      {
        name: "wait_for_seconds",
        description:
          "強制等待指定的秒數，可用於等待動態動畫、網頁跳轉或異步加載完畢。",
        schema: z.object({
          seconds: z.number().int().min(1).describe("要等待的秒數"),
        }),
      },
    );

    const done_acting = tool(
      async ({ message }) => {
        return `DONE_ACTING: ${message}`;
      },
      {
        name: "done_acting",
        description:
          "宣告當前測試步驟中要求的所有必要動作（Action）已經執行完畢。當你確認已經在瀏覽器上點擊、輸入或操作完該步驟指定的所有動作後，你必須呼叫此工具，將控制權交回給框架以進行下一步或斷言驗證。",
        schema: z.object({
          message: z.string().describe("動作執行的總結說明"),
        }),
      },
    );

    /**
     * execute_javascript：於瀏覽器 context 執行自訂 JS
     */
    const execute_javascript = tool(
      async ({ script }) => {
        try {
          const page = this.browserManager.page;
          if (!page) return "錯誤：瀏覽器未初始化。";

          const result = await page.evaluate(async (code) => {
            const fn = new Function(`return (async () => { ${code} })();`);
            return await fn();
          }, script);

          const resultString =
            typeof result === "object" ? JSON.stringify(result) : String(result);
          return `JavaScript 執行成功。腳本回傳值: ${resultString}`;
        } catch (error: any) {
          return `執行 JavaScript 失敗：${error.message}`;
        }
      },
      {
        name: "execute_javascript",
        description:
          "在當前瀏覽器頁面中執行自訂的 JavaScript 腳本。當 observe_web_page 未能標記出特定動態元素的數字 ID 時，可用此工具透過 DOM API 直接進行點擊、選取、觸發事件、動態捲動或檢索複雜 DOM 資訊。",
        schema: z.object({
          script: z
            .string()
            .describe(
              "要在頁面 context 執行的 JavaScript 程式碼片段（例如: \"document.querySelector('.target-element').click()\"）",
            ),
        }),
      },
    );

    return [
      navigate_to,
      observe_web_page,
      click,
      input,
      key,
      hover,
      wait_for_seconds,
      execute_javascript,
      done_acting,
    ];
  }
}
