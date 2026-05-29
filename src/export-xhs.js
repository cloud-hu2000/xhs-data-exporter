const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
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

function renameBrowserSavedFile(config, file, noteNumber, buttonNumber) {
  const target = uniqueDownloadTarget(config, noteNumber, buttonNumber, path.basename(file));
  fs.renameSync(file, target);
  return target;
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
  await client.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: config.downloadDir
  });

  return page;
}

async function clickOneExport(detailPage, config, noteNumber, buttonNumber, exportButton) {
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
    try {
      await download.saveAs(target);
      console.log(`  [${noteNumber}.${buttonNumber}] 已保存: ${target}`);
      return { ok: true, file: target };
    } catch (error) {
      await sleep(config.afterExportWaitMs);
      const created = newFilesSince(config.downloadDir, before);
      if (created.length > 0) {
        const renamed = renameBrowserSavedFile(config, created[0], noteNumber, buttonNumber);
        console.log(`  [${noteNumber}.${buttonNumber}] 浏览器已保存并重命名: ${renamed}`);
        return { ok: true, file: renamed };
      }
      throw error;
    }
  }

  await sleep(config.afterExportWaitMs);
  const created = newFilesSince(config.downloadDir, before);
  if (created.length > 0) {
    const renamed = renameBrowserSavedFile(config, created[0], noteNumber, buttonNumber);
    console.log(`  [${noteNumber}.${buttonNumber}] 检测到新文件并重命名: ${renamed}`);
    return { ok: true, file: renamed };
  }

  console.log(`  [${noteNumber}.${buttonNumber}] 已点击导出，但没有检测到下载文件。可能是页面创建了异步导出任务。`);
  return { ok: true, file: null };
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

  const result = await clickExports(detailPage, config, noteNumber);

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
  const next = await firstVisibleByTexts(page, config.nextPageTexts);
  if (!next) return false;

  const disabled = await next.locator.evaluate((el) => {
    const attrDisabled = el.getAttribute("disabled") !== null;
    const ariaDisabled = el.getAttribute("aria-disabled") === "true";
    const className = String(el.className || "").toLowerCase();
    return attrDisabled || ariaDisabled || className.includes("disabled");
  }).catch(() => false);

  if (disabled) return false;

  console.log(`进入下一页: 点击“${next.text}”`);
  await next.locator.click();
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await sleep(config.slowMoMs * 2);
  return true;
}

async function main() {
  const config = loadConfig();
  const browser = await connectToBrowser(config);
  const page = await getWorkingPage(browser, config);

  console.log(`页面: ${page.url()}`);
  console.log(`下载目录: ${config.downloadDir}`);

  let exported = 0;
  let pageNo = 1;

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
      await exportNoteByIndex(page, config, detailInfo.text, i, exported);
      await sleep(config.slowMoMs);
    }

    const hasNext = await goNextPage(page, config);
    if (!hasNext) break;
    pageNo += 1;
  }

  await browser.close();
  console.log(`完成。共处理 ${exported} 条笔记。`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
