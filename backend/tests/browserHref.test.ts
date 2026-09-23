import { describe, expect, it } from "vitest";
import { getAnchorHrefInfo } from "../src/browser.js";

describe("anchor href representation", () => {
  const base = "https://example.com/base/page";
  it.each([
    ["/relative", "https://example.com/relative", true],
    ["https://other.example/path", "https://other.example/path", true],
    ["#section", "https://example.com/base/page#section", false],
    ["mailto:a@example.com", "mailto:a@example.com", false],
    ["tel:123", "tel:123", false],
    ["javascript:void(0)", "javascript:void(0)", false],
    ["data:text/plain,x", "data:text/plain,x", false],
    ["blob:https://example.com/id", "blob:https://example.com/id", false],
  ])("%s resolves and classifies navigability", (raw, href, navigable) => {
    expect(getAnchorHrefInfo(raw as string, base)).toEqual({ hrefRaw: raw, href, navigable });
  });
});
