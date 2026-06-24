const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { installConsoleLogger } = require("./console-logger");
const { loadConfig } = require("./config");
const {
  sleep,
  firstVisibleByTexts,
  allVisibleByTexts,
  countVisibleByTexts,
  nthVisibleByText,
  snapshotFiles,
  newFilesSince,
  safeFilename
} = require("./playwright-utils");

installConsoleLogger();

const projectRoot = path.resolve(__dirname, "..");
const dataDir = path.join(projectRoot, "data");
const coverManifestPath = path.join(dataDir, "note-covers.json");
const runStartedAt = new Date();
const runLogPath = path.join(
  projectRoot,
  "logs",
  `export-${runStartedAt.toISOString().replace(/[:.]/g, "-")}.log`
);

function logLine(level, args) {
  const text = args
    .map((arg) => {
      if (arg instanceof Error) return arg.stack || arg.message;
      if (typeof arg === "string") return arg;
      return JSON.stringify(arg);
    })
    .join(" ");
  fs.mkdirSync(path.dirname(runLogPath), { recursive: true });
  fs.appendFileSync(runLogPath, `[${new Date().toISOString()}] [${level}] ${text}\n`, "utf8");
}

for (const level of ["log", "warn", "error"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    logLine(level.toUpperCase(), args);
    original(...args);
  };
}

async function connectToBrowser(config) {
  try {
    return await chromium.connectOverCDP(`http://127.0.0.1:${config.debugPort}`);
  } catch (error) {
    throw new Error(
      `连接浏览器失败。请先运行 npm.cmd run browser，并确认浏览器窗口没有关闭。\n原始错误: ${error.message}`
    );
  }
}

function uniqueDownloadTarget(config, noteNumber, buttonNumber, originalName) {
  return path.join(
    config.downloadDir,
    `${String(noteNumber).padStart(4, "0")}-${buttonNumber}-${Date.now()}-${safeFilename(originalName)}`
  );
}

function readCoverManifest() {
  if (!fs.existsSync(coverManifestPath)) return [];
  try {
    const payload = JSON.parse(fs.readFileSync(coverManifestPath, "utf8"));
    return Array.isArray(payload) ? payload : [];
  } catch (error) {
    console.log(`read cover manifest failed: ${error.message}`);
    return [];
  }
}

function exportedTitleFromFile(file) {
  if (!file) return "";
  const base = path.basename(file, path.extname(file));
  const suffix = "-数据明细表";
  const body = base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
  const match = body.match(/^\d+-\d+-\d+-([\s\S]+)$/u);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

function saveCoverRecord(record) {
  if (!record || !record.coverImageUrl) return;
  fs.mkdirSync(dataDir, { recursive: true });
  const titleFromDownload = (record.downloadedFiles || []).map(exportedTitleFromFile).find(Boolean);
  const normalized = {
    ...record,
    title: titleFromDownload || record.title || "",
    noteKey: (titleFromDownload || record.title || "").replace(/\s+/g, " ").trim().toLowerCase()
  };
  const manifest = readCoverManifest();
  const key = normalized.noteKey || normalized.noteId || normalized.detailUrl;
  const next = manifest.filter((item) => (item.noteKey || item.noteId || item.detailUrl) !== key);
  next.push(normalized);
  fs.writeFileSync(coverManifestPath, JSON.stringify(next, null, 2), "utf8");
}

async function captureCover(detailPage, noteNumber) {
  await detailPage.waitForSelector(
    ".note-info-container .thumbnail img, [class*='note-info'] [class*='thumbnail'] img, .note-detail-contain .thumbnail img",
    { timeout: 5000 }
  ).catch(() => {});
  return await detailPage.evaluate((capturedNoteNumber) => {
    const absolute = (value) => {
      try {
        return value ? new URL(value, location.href).href : "";
      } catch {
        return "";
      }
    };
    const coverSelectors = [
      ".note-info-container .thumbnail img",
      "[class*='note-info'] [class*='thumbnail'] img",
      ".note-detail-contain .thumbnail img",
      "[class*='thumbnail'] img"
    ];
    const directCover = coverSelectors
      .map((selector) => {
        const img = document.querySelector(selector);
        if (!img) return null;
        const rect = img.getBoundingClientRect();
        const src = absolute(img.currentSrc || img.src || img.getAttribute("src"));
        if (!src || rect.width < 40 || rect.height < 40) return null;
        return {
          src,
          alt: img.alt || img.getAttribute("aria-label") || "",
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          naturalWidth: img.naturalWidth || 0,
          naturalHeight: img.naturalHeight || 0,
          selector
        };
      })
      .find(Boolean);

    const badPattern = /avatar|logo|icon|emoji|default|placeholder/i;
    const candidates = [...document.images]
      .map((img) => {
        const rect = img.getBoundingClientRect();
        const src = absolute(img.currentSrc || img.src);
        const alt = img.alt || img.getAttribute("aria-label") || "";
        const visible = rect.width >= 96 && rect.height >= 96 && rect.bottom > 0 && rect.right > 0;
        const ratio = rect.height ? rect.width / rect.height : 0;
        const ratioScore = ratio >= 0.55 && ratio <= 1.8 ? 1.25 : 0.8;
        const penalty = badPattern.test(`${src} ${alt}`) ? 0.2 : 1;
        return {
          src,
          alt,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          naturalWidth: img.naturalWidth || 0,
          naturalHeight: img.naturalHeight || 0,
          score: rect.width * rect.height * ratioScore * penalty,
          visible
        };
      })
      .filter((item) => item.visible && item.src)
      .sort((a, b) => b.score - a.score);
    const metaImage = absolute(document.querySelector("meta[property='og:image'],meta[name='og:image']")?.content);
    const best = directCover || candidates[0] || (metaImage ? { src: metaImage, alt: "", width: 0, height: 0, selector: "meta[property='og:image']" } : null);
    const noteId = new URL(location.href).searchParams.get("noteId") || "";
    const heading = [...document.querySelectorAll("h1,h2,[class*='title']")]
      .map((el) => el.textContent.replace(/\s+/g, " ").trim())
      .find((text) => text.length >= 2 && text.length <= 120) || document.title || "";
    return best ? {
      noteNumber: capturedNoteNumber,
      noteId,
      title: heading,
      detailUrl: location.href,
      coverImageUrl: best.src,
      coverAlt: best.alt || "",
      coverWidth: best.width || best.naturalWidth || 0,
      coverHeight: best.height || best.naturalHeight || 0,
      coverSelector: best.selector || "",
      capturedAt: new Date().toISOString()
    } : null;
  }, noteNumber).catch((error) => {
    console.log(`  [${noteNumber}] capture cover failed: ${error.message}`);
    return null;
  });
}

function renameBrowserSavedFile(config, file, noteNumber, buttonNumber) {
  const target = uniqueDownloadTarget(config, noteNumber, buttonNumber, path.basename(file));
  fs.renameSync(file, target);
  return target;
}

function failedJsonDownload(file) {
  if (!file || path.extname(file).toLowerCase() !== ".json") return null;
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    if (payload && payload.success === false) {
      return payload.msg || payload.message || `code=${payload.code ?? "unknown"}`;
    }
  } catch (error) {
    return `JSON parse failed: ${error.message}`;
  }
  return null;
}

function downloadResult(file) {
  const reason = failedJsonDownload(file);
  if (reason) return { ok: false, file, reason };
  return { ok: true, file };
}

function isTemporaryDownload(file) {
  const name = path.basename(file).toLowerCase();
  return name.endsWith(".crdownload") || name.endsWith(".tmp");
}

async function waitForNewFiles(dir, before, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const created = newFilesSince(dir, before).filter((file) => !isTemporaryDownload(file));
    if (created.length > 0) return created;
    await sleep(500);
  }
  return [];
}

async function getWorkingPage(browser, config) {
  const context = browser.contexts()[0] || await browser.newContext();
  const pages = context.pages();
  const existing =
    pages.find((page) => page.url().includes("/statistics/data-analysis")) ||
    pages.find((page) => page.url().includes("creator.xiaohongshu.com"));
  const page = existing || pages[0] || await context.newPage();

  page.setDefaultTimeout(config.pageReadyTimeoutMs);
  await page.goto(config.targetUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    (texts) => texts.some((text) => document.body && document.body.innerText.includes(text)),
    config.detailTexts,
    { timeout: config.pageReadyTimeoutMs }
  ).catch(() => {});

  const client = await context.newCDPSession(page);
  try {
    await client.send("Page.setDownloadBehavior", {
      behavior: "allowAndName",
      downloadPath: config.downloadDir
    });
  } catch (error) {
    console.log(`download behavior allowAndName failed, fallback to allow: ${error.message}`);
    await client.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: config.downloadDir
    });
  }

  return page;
}

async function clickOneExportAttempt(detailPage, config, noteNumber, buttonNumber, exportButton) {
  const before = snapshotFiles(config.downloadDir);
  const downloadPromise = detailPage
    .waitForEvent("download", { timeout: config.downloadTimeoutMs })
    .catch(() => null);

  console.log(`  [${noteNumber}.${buttonNumber}] 点击“${exportButton.text}”`);
  await exportButton.locator.click();

  const download = await downloadPromise;
  if (download) {
    const suggested = safeFilename(download.suggestedFilename());
    const target = uniqueDownloadTarget(config, noteNumber, buttonNumber, suggested);
    const browserSaved = await waitForNewFiles(config.downloadDir, before, config.afterExportWaitMs + 8000);
    if (browserSaved.length > 0) {
      const renamed = path.join(config.downloadDir, path.basename(target));
      fs.renameSync(browserSaved[0], renamed);
      const result = downloadResult(renamed);
      if (!result.ok) return result;
      console.log(`  [${noteNumber}.${buttonNumber}] browser saved and renamed: ${renamed}`);
      return { ok: true, file: renamed };
    }
    try {
      await download.saveAs(target);
      const result = downloadResult(target);
      if (!result.ok) return result;
      console.log(`  [${noteNumber}.${buttonNumber}] 已保存: ${target}`);
      return { ok: true, file: target };
    } catch (error) {
      console.log(`  [${noteNumber}.${buttonNumber}] download.saveAs failed: ${error.message}`);
      const created = await waitForNewFiles(config.downloadDir, before, config.afterExportWaitMs + 5000);
      if (created.length > 0) {
        const renamed = renameBrowserSavedFile(config, created[0], noteNumber, buttonNumber);
        const result = downloadResult(renamed);
        if (!result.ok) return result;
        console.log(`  [${noteNumber}.${buttonNumber}] 浏览器已保存并重命名: ${renamed}`);
        return { ok: true, file: renamed };
      }
      return { ok: false, reason: error.message || "download.saveAs failed", file: target };
    }
  }

  const created = await waitForNewFiles(config.downloadDir, before, config.afterExportWaitMs);
  if (created.length > 0) {
    const renamed = renameBrowserSavedFile(config, created[0], noteNumber, buttonNumber);
    const result = downloadResult(renamed);
    if (!result.ok) return result;
    console.log(`  [${noteNumber}.${buttonNumber}] 检测到新文件并重命名: ${renamed}`);
    return { ok: true, file: renamed };
  }

  console.log(`  [${noteNumber}.${buttonNumber}] 已点击导出，但没有检测到下载文件。可能是页面创建了异步导出任务。`);
  return { ok: true, file: null };
}

async function clickOneExport(detailPage, config, noteNumber, buttonNumber, exportButton) {
  const maxAttempts = Math.max(1, Number(config.exportRetryCount || 0) + 1);
  let lastResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    lastResult = await clickOneExportAttempt(detailPage, config, noteNumber, buttonNumber, exportButton);
    if (lastResult.ok) return lastResult;
    console.log(`  [${noteNumber}.${buttonNumber}] export failed: ${lastResult.reason}`);
    if (attempt < maxAttempts) {
      console.log(`  [${noteNumber}.${buttonNumber}] retry after ${config.exportRetryWaitMs}ms`);
      await sleep(config.exportRetryWaitMs);
    }
  }
  return lastResult;
}

async function clickExports(detailPage, config, noteNumber) {
  const exportButtons = config.exportAllButtonsInDetail
    ? await allVisibleByTexts(detailPage, config.exportTexts)
    : [await firstVisibleByTexts(detailPage, config.exportTexts)].filter(Boolean);

  if (exportButtons.length === 0) {
    console.log(`  [${noteNumber}] 没找到导出按钮，跳过。`);
    return { ok: false, reason: "no-export-button" };
  }

  console.log(`  [${noteNumber}] 找到 ${exportButtons.length} 个导出按钮。`);
  const results = [];
  for (let i = 0; i < exportButtons.length; i += 1) {
    results.push(await clickOneExport(detailPage, config, noteNumber, i + 1, exportButtons[i]));
    await sleep(config.slowMoMs);
  }
  return { ok: results.some((item) => item.ok), results };
}

async function exportNoteByIndex(listPage, config, detailText, index, noteNumber) {
  const detailButton = await nthVisibleByText(listPage, detailText, index);
  if (!detailButton) {
    console.log(`[${noteNumber}] 找不到第 ${index + 1} 个“${detailText}”，跳过。`);
    return { ok: false, reason: "no-detail-button" };
  }

  console.log(`[${noteNumber}] 打开第 ${index + 1} 条笔记详情`);
  const context = listPage.context();
  const pagesBefore = new Set(context.pages());
  const newPagePromise = context.waitForEvent("page", { timeout: 10000 }).catch(() => null);
  const urlBefore = listPage.url();

  await detailButton.click();
  const openedPage =
    await newPagePromise ||
    context.pages().find((candidate) => !pagesBefore.has(candidate)) ||
    null;
  const detailPage = openedPage || listPage;

  await detailPage.waitForLoadState("domcontentloaded").catch(() => {});
  await detailPage.waitForFunction(
    (texts) => texts.some((text) => document.body && document.body.innerText.includes(text)),
    config.exportTexts,
    { timeout: config.pageReadyTimeoutMs }
  ).catch(() => {});
  await sleep(config.slowMoMs);

  const coverRecord = await captureCover(detailPage, noteNumber);
  const result = await clickExports(detailPage, config, noteNumber);
  if (coverRecord) {
    saveCoverRecord({
      ...coverRecord,
      downloadedFiles: (result.results || []).map((item) => item.file).filter(Boolean)
    });
  }

  if (openedPage) {
    await openedPage.close().catch(() => {});
  } else if (detailPage.url() !== urlBefore) {
    await detailPage.goBack({ waitUntil: "domcontentloaded" }).catch(async () => {
      await detailPage.goto(config.targetUrl, { waitUntil: "domcontentloaded" });
    });
    await sleep(config.slowMoMs);
  } else {
    const closeButton = await firstVisibleByTexts(detailPage, config.closeTexts);
    if (closeButton) {
      await closeButton.locator.click().catch(() => {});
    } else {
      await detailPage.keyboard.press("Escape").catch(() => {});
    }
    await sleep(config.slowMoMs);
  }

  return result;
}

async function goNextPage(page, config) {
  let next = await firstVisibleByTexts(page, config.nextPageTexts);
  if (!next) {
    const iconNext = page.locator(
      ".d-pagination .d-pagination-page:has(svg path[d^='M19 12'])"
    ).last();
    if (await iconNext.isVisible().catch(() => false)) {
      next = { text: "下一页图标", locator: iconNext };
    }
  }
  if (!next) return false;

  const disabled = await next.locator.evaluate((el) => {
    const attrDisabled = el.getAttribute("disabled") !== null;
    const ariaDisabled = el.getAttribute("aria-disabled") === "true";
    const className = String(el.className || "").toLowerCase();
    return attrDisabled || ariaDisabled || className.includes("disabled");
  }).catch(() => false);

  if (disabled) return false;

  const activePageBefore = await page
    .locator(".d-pagination-page[class*='primary'] .d-pagination-page-content")
    .first()
    .textContent()
    .catch(() => "");
  console.log(`进入下一页: 点击“${next.text}”`);
  await next.locator.click();
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  if (activePageBefore) {
    await page.waitForFunction(
      (previous) => {
        const active = document.querySelector(
          ".d-pagination-page[class*='primary'] .d-pagination-page-content"
        );
        return active && active.textContent.trim() !== previous.trim();
      },
      activePageBefore,
      { timeout: config.pageReadyTimeoutMs }
    ).catch(() => {});
  }
  await sleep(config.slowMoMs * 2);
  return true;
}

async function main() {
  const config = loadConfig();
  console.log(`Export run log: ${runLogPath}`);
  console.log(`Retry config: count=${config.exportRetryCount}, waitMs=${config.exportRetryWaitMs}`);
  const browser = await connectToBrowser(config);
  const page = await getWorkingPage(browser, config);

  console.log(`页面: ${page.url()}`);
  console.log(`下载目录: ${config.downloadDir}`);

  let exported = 0;
  let pageNo = 1;
  const failures = [];

  while (pageNo <= config.maxPages && exported < config.maxNotes) {
    await sleep(config.slowMoMs);
    const detailInfo = await countVisibleByTexts(page, config.detailTexts);

    if (detailInfo.count === 0) {
      console.log(`第 ${pageNo} 页没有找到“详情数据”按钮。`);
      break;
    }

    console.log(`第 ${pageNo} 页找到 ${detailInfo.count} 个“${detailInfo.text}”按钮。`);

    for (let i = 0; i < detailInfo.count && exported < config.maxNotes; i += 1) {
      exported += 1;
      const result = await exportNoteByIndex(page, config, detailInfo.text, i, exported);
      const failedButtons = (result.results || []).filter((item) => !item.ok);
      for (const failed of failedButtons) {
        failures.push({
          noteNumber: exported,
          reason: failed.reason || "unknown",
          file: failed.file || ""
        });
      }
      await sleep(config.slowMoMs);
    }

    const hasNext = await goNextPage(page, config);
    if (!hasNext) break;
    pageNo += 1;
  }

  await browser.close();
  if (failures.length > 0) {
    console.log("Export failures:");
    for (const failure of failures) {
      console.log(`  note ${failure.noteNumber}: ${failure.reason} ${failure.file}`);
    }
  }
  console.log(`完成。共处理 ${exported} 条笔记。`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
