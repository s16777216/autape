import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { calculateSelector } from "./browser/selector.js";
import { getSettings } from "./services/settingsService.js";

export function getAnchorHrefInfo(hrefRaw: string, baseUrl: string): {
  hrefRaw: string;
  href: string;
  navigable: boolean;
} {
  try {
    const href = new URL(hrefRaw, baseUrl).href;
    const protocol = new URL(href).protocol;
    return {
      hrefRaw,
      href,
      navigable:
        !hrefRaw.trim().startsWith("#") &&
        (protocol === "http:" || protocol === "https:"),
    };
  } catch {
    return { hrefRaw, href: "", navigable: false };
  }
}

export class BrowserManager {
  public browser: Browser | null = null;
  public context: BrowserContext | null = null;
  public page: Page | null = null;

  constructor(
    private viewportWidth: number = 1280,
    private viewportHeight: number = 800,
  ) {}

  /**
   * 初始化 Playwright 並開啟瀏覽器
   */
  async initBrowser(headlessOverride?: boolean) {
    const settings = await getSettings();

    // 優先度判定：環境變數 > 明確傳入參數 > 資料庫設定值
    let finalHeadless = settings.headless;
    if (process.env.CI || process.env.HEADLESS_FORCE) {
      finalHeadless = true;
    } else if (headlessOverride !== undefined) {
      finalHeadless = headlessOverride;
    }

    const width = settings.viewportWidth;
    const height = settings.viewportHeight;

    this.browser = await chromium.launch({
      headless: finalHeadless,
      slowMo: settings.slowMo,
      channel: "chrome",
      args: ["--disable-web-security", "--no-sandbox"],
    });
    this.context = await this.browser.newContext({
      viewport: { width, height },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      ignoreHTTPSErrors: true, // 忽略自簽憑證 SSL 安全警告
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(settings.defaultTimeout);
  }

  /**
   * 關閉瀏覽器與 Playwright 實例
   */
  async closeBrowser() {
    if (this.page) {
      await this.page.close().catch(() => {});
      this.page = null;
    }
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  /**
   * 感知工具核心邏輯：
   * 1. 注入 data-e2e-agent-id 至所有可見互動元素
   * 2. 渲染黃底黑字浮動貼紙 Overlay
   * 3. 截圖（含貼紙）
   * 4. 清除貼紙與 CSS
   * 5. 回傳元素文字清單與截圖 base64
   */
  async observeWebPage(): Promise<{ elementList: string; screenshotBase64: string }> {
    if (!this.page) {
      throw new Error("瀏覽器尚未初始化或已被關閉");
    }

    // Step 1 & 2：注入 data-e2e-agent-id + 渲染浮動貼紙
    const elementList = await this.page.evaluate(() => {
      // 清除上一輪殘留的標籤與屬性
      document.querySelectorAll("[data-e2e-agent-id]").forEach((el) => {
        el.removeAttribute("data-e2e-agent-id");
      });
      document.querySelectorAll(".agent-floating-label").forEach((el) => el.remove());
      const oldStyle = document.getElementById("agent-floating-label-style");
      if (oldStyle) oldStyle.remove();

      // 注入浮動貼紙 CSS
      const style = document.createElement("style");
      style.id = "agent-floating-label-style";
      style.textContent = `
        .agent-floating-label {
          position: absolute;
          background: #FFD700;
          color: #000;
          font-size: 10px;
          font-weight: bold;
          font-family: monospace;
          padding: 1px 3px;
          border: 1px solid #999;
          border-radius: 2px;
          pointer-events: none;
          z-index: 2147483647;
          line-height: 1.2;
          white-space: nowrap;
        }
      `;
      document.head.appendChild(style);

      // 定義可互動的元素 selector
      const INTERACTIVE_SELECTORS = [
        "button",
        "a",
        "input",
        "select",
        "textarea",
        '[role="button"]',
        '[role="link"]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(", ");

      const elements = document.querySelectorAll(INTERACTIVE_SELECTORS);
      const results: string[] = [];
      let currentId = 1;

      elements.forEach((el) => {
        // 過濾不可見或 disabled 元素
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const style = window.getComputedStyle(el);
        if (
          style.visibility === "hidden" ||
          style.display === "none" ||
          style.opacity === "0" ||
          (el as HTMLInputElement).disabled
        )
          return;

        // 注入唯一 ID 屬性
        el.setAttribute("data-e2e-agent-id", String(currentId));

        // 萃取語意資訊
        const tagName = el.tagName.toLowerCase();
        const inputType = el.getAttribute("type")
          ? ` type="${el.getAttribute("type")}"`
          : "";
        let textContent =
          (el as HTMLElement).innerText?.trim() ||
          (el as HTMLInputElement).value ||
          (el as HTMLInputElement).placeholder ||
          el.getAttribute("aria-label") ||
          el.getAttribute("title") ||
          "";
        textContent = textContent.replace(/\s+/g, " ").trim().substring(0, 60);

        if (!textContent && !inputType && tagName !== "select") {
          currentId++;
          return;
        }

        let linkInfo = "";
        if (tagName === "a") {
          const hrefRaw = el.getAttribute("href") || "";
          const href = (el as HTMLAnchorElement).href || "";
          let navigable = false;
          try {
            const protocol = new URL(href, document.baseURI).protocol;
            navigable = !hrefRaw.trim().startsWith("#") && (protocol === "http:" || protocol === "https:");
          } catch {}
          linkInfo = ` hrefRaw=${JSON.stringify(hrefRaw)} href=${JSON.stringify(href)} navigable=${navigable}`;
        }
        results.push(`[${currentId}] <${tagName}${inputType}> ${textContent}${linkInfo}`);

        // 渲染浮動貼紙（絕對定位）
        const label = document.createElement("div");
        label.className = "agent-floating-label";
        label.textContent = String(currentId);
        label.style.top = `${rect.top + window.scrollY}px`;
        label.style.left = `${rect.left + window.scrollX}px`;
        document.body.appendChild(label);

        currentId++;
      });

      return results;
    });

    // Step 3：截圖（含貼紙）
    const buffer = await this.page.screenshot({ type: "png" });
    const screenshotBase64 = buffer.toString("base64");

    // Step 4：清除所有貼紙 DOM 與 CSS
    await this.page.evaluate(() => {
      document.querySelectorAll(".agent-floating-label").forEach((el) => el.remove());
      const style = document.getElementById("agent-floating-label-style");
      if (style) style.remove();
    });

    // Step 5：組裝文字清單
    const currentUrl = this.page.url();
    const pageTitle = await this.page.title();

    let listText: string;
    if (elementList.length === 0) {
      listText = `當前網址: ${currentUrl}\n頁面標題: ${pageTitle}\n狀態: 畫面上沒有找到任何可互動的元素。`;
    } else {
      listText = [
        `當前網址: ${currentUrl}`,
        `頁面標題: ${pageTitle}`,
        `可互動元素清單:`,
        ...elementList,
      ].join("\n");
    }

    return { elementList: listText, screenshotBase64 };
  }

  /**
   * 取得當前網頁畫面截圖，並轉成 Base64 字串以利 Gemini 多模態讀取
   */
  async getPageScreenshotBase64(): Promise<string> {
    if (!this.page) {
      throw new Error("瀏覽器尚未初始化或已被關閉");
    }
    const buffer = await this.page.screenshot({ type: "png" });
    return buffer.toString("base64");
  }

  /**
   * 將當前頁面截圖儲存至指定檔案路徑
   */
  async saveScreenshot(filePath: string) {
    if (!this.page) {
      throw new Error("瀏覽器尚未初始化或已被關閉");
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    await this.page.screenshot({ path: filePath, type: "png" });
  }

  /**
   * 執行瀏覽器內 JS 提取可見互動元素，產出精簡 DOM 文字且整合輸入框當前 value
   */
  async getSimplifiedDOM(): Promise<string> {
    if (!this.page) {
      throw new Error("瀏覽器尚未初始化或已被關閉");
    }

    try {
      const calcSelectorStr = calculateSelector.toString();
      const simplifiedDom = await this.page.evaluate((fnStr) => {
        // 還原為瀏覽器端可執行的 selector 計算函數
        const calculateSelector = new Function("return " + fnStr)();

        const results: any[] = [];
        // 抓取按鈕、連結、輸入欄位與標題
        const elements = document.querySelectorAll(
          'button, a, input, select, textarea, h1, h2, h3, h4, h5, h6, [role="button"], [role="link"], [role="alert"], .p-toast-message, .error, .alert',
        );

        elements.forEach((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          // 忽略隱藏的元素
          if (
            rect.width === 0 ||
            rect.height === 0 ||
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0"
          ) {
            return;
          }

          const htmlEl = el as HTMLElement;
          const tagName = el.tagName.toLowerCase();
          const text = htmlEl.innerText
            ? htmlEl.innerText.trim().replace(/\s+/g, " ").substring(0, 100)
            : "";
          const id = el.id || "";
          const placeholder = el.getAttribute("placeholder") || "";
          const name = el.getAttribute("name") || "";
          const type = el.getAttribute("type") || "";
          const value = (el as HTMLInputElement).value || ""; // 讀取當前已輸入內容
          const hrefRaw = tagName === "a" ? el.getAttribute("href") || "" : "";
          const href = tagName === "a" ? (el as HTMLAnchorElement).href || "" : "";
          let navigable = false;
          if (tagName === "a") {
            try {
              const protocol = new URL(href, document.baseURI).protocol;
              navigable = !hrefRaw.trim().startsWith("#") && (protocol === "http:" || protocol === "https:");
            } catch {}
          }

          // 調用抽離後的定位演算法
          const selector = calculateSelector({
            tagName,
            id,
            name,
            placeholder,
            text,
          });

          results.push({
            tagName,
            text,
            id,
            placeholder,
            name,
            type,
            value,
            hrefRaw,
            href,
            navigable,
            selector,
          });
        });

        // 對映為精簡的 HTML 標籤結構文字
        return results
          .map((item) => {
            let desc = `<${item.tagName}`;
            if (item.id) desc += ` id="${item.id}"`;
            if (item.name) desc += ` name="${item.name}"`;
            if (item.placeholder) desc += ` placeholder="${item.placeholder}"`;
            if (item.type) desc += ` type="${item.type}"`;
            if (item.tagName === "a") {
              desc += ` hrefRaw=${JSON.stringify(item.hrefRaw)}`;
              desc += ` href=${JSON.stringify(item.href)}`;
              desc += ` navigable="${item.navigable}"`;
            }
            if (item.value) desc += ` value="${item.value}"`; // 渲染 value，補足 AI 感知
            desc += ` selector=\`${item.selector}\``;
            desc += `>`;
            if (item.text) desc += ` ${item.text} `;
            desc += `</${item.tagName}>`;
            return desc;
          })
          .join("\n");
      }, calcSelectorStr);

      return simplifiedDom || "<!-- 頁面目前沒有檢測到可見的互動元素 -->";
    } catch (e: any) {
      return `<!-- 無法提取 DOM 資訊：${e.message} -->`;
    }
  }
}
