const fs = require("fs");
const path = require("path");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quoteText(text) {
  return JSON.stringify(text);
}

function clickableSelectorForText(text) {
  const quoted = quoteText(text);
  return [
    `button:visible:has-text(${quoted})`,
    `a:visible:has-text(${quoted})`,
    `[role="button"]:visible:has-text(${quoted})`,
    `[tabindex]:visible:has-text(${quoted})`
  ].join(", ");
}

function textLocator(page, text) {
  return page.getByText(text, { exact: true });
}

async function visibleItems(locator) {
  const items = [];
  const count = await locator.count();
  for (let i = 0; i < count; i += 1) {
    const item = locator.nth(i);
    if (await item.isVisible().catch(() => false)) {
      items.push(item);
    }
  }
  return items;
}

async function visibleItemsByText(page, text) {
  const clickableItems = await visibleItems(page.locator(clickableSelectorForText(text)));
  if (clickableItems.length > 0) return clickableItems;
  return visibleItems(textLocator(page, text));
}

async function firstVisibleByTexts(page, texts) {
  for (const text of texts) {
    const items = await visibleItemsByText(page, text);
    if (items.length > 0) return { text, locator: items[0] };
  }
  return null;
}

async function countVisibleByTexts(page, texts) {
  let best = { text: texts[0], count: 0 };
  for (const text of texts) {
    const items = await visibleItemsByText(page, text);
    if (items.length > best.count) {
      best = { text, count: items.length };
    }
  }
  return best;
}

async function nthVisibleByText(page, text, index) {
  const items = await visibleItemsByText(page, text);
  return items[index] || null;
}

async function allVisibleByTexts(page, texts) {
  const all = [];
  for (const text of texts) {
    const items = await visibleItemsByText(page, text);
    for (const item of items) {
      all.push({ text, locator: item });
    }
    if (all.length > 0) break;
  }
  return all;
}

function snapshotFiles(dir) {
  const snapshot = new Map();
  if (!fs.existsSync(dir)) return snapshot;
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    try {
      const stat = fs.statSync(file);
      snapshot.set(file, `${stat.size}:${stat.mtimeMs}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return snapshot;
}

function newFilesSince(dir, before) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((file) => {
      try {
        const stat = fs.statSync(file);
        return before.get(file) !== `${stat.size}:${stat.mtimeMs}`;
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    });
}

function safeFilename(name) {
  const sanitized = name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  const maxLength = 160;
  if (sanitized.length <= maxLength) return sanitized;

  const ext = path.extname(sanitized);
  const stem = path.basename(sanitized, ext);
  const reportSuffix = "-数据明细表";
  const preservedSuffix = stem.endsWith(reportSuffix)
    ? `${reportSuffix}${ext}`
    : ext;
  const trimmableStem = stem.endsWith(reportSuffix)
    ? stem.slice(0, -reportSuffix.length)
    : stem;
  return `${trimmableStem.slice(0, Math.max(1, maxLength - preservedSuffix.length))}${preservedSuffix}`;
}

module.exports = {
  sleep,
  firstVisibleByTexts,
  allVisibleByTexts,
  countVisibleByTexts,
  nthVisibleByText,
  snapshotFiles,
  newFilesSince,
  safeFilename
};
