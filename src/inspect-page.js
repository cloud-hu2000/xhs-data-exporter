const { chromium } = require("playwright-core");
const { loadConfig } = require("./config");

async function main() {
  const config = loadConfig();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${config.debugPort}`);
  const context = browser.contexts()[0] || await browser.newContext();
  const page =
    context.pages().find((item) => item.url().includes("creator.xiaohongshu.com")) ||
    context.pages()[0] ||
    await context.newPage();

  await page.goto(config.targetUrl, { waitUntil: "domcontentloaded" });

  const items = await page.locator("button, a, [role='button'], [tabindex]").evaluateAll((els) => {
    const seen = new Set();
    return els
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim(),
        disabled:
          el.hasAttribute("disabled") ||
          el.getAttribute("aria-disabled") === "true" ||
          String(el.className || "").toLowerCase().includes("disabled")
      }))
      .filter((item) => item.text)
      .filter((item) => {
        const key = `${item.tag}:${item.text}:${item.disabled}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 300);
  });

  console.log("当前页面可点击元素文字：");
  for (const item of items) {
    console.log(`${item.disabled ? "[disabled] " : ""}<${item.tag}> ${item.text}`);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(`检查失败: ${error.message}`);
  process.exit(1);
});
