const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const { installConsoleLogger } = require("./console-logger");
const { loadConfig, projectRoot } = require("./config");
const { safeFilename, sleep } = require("./playwright-utils");

installConsoleLogger();

const profileUrl =
  process.env.XHS_PROFILE_URL ||
  "https://www.xiaohongshu.com/user/profile/642c02490000000011020cf8";
const maxNotes = Number(process.env.XHS_PROFILE_MAX_NOTES || 500);
const downloadMedia = process.env.XHS_PROFILE_DOWNLOAD_MEDIA !== "false";
const outputDir = path.join(projectRoot, "profile-exports");
const manifestPath = path.join(outputDir, "manifest.json");

function noteIdFromHref(href) {
  const match = String(href || "").match(
    /\/user\/profile\/[0-9a-f]{24}\/([0-9a-f]{24})(?:\?|$)/i
  );
  return match ? match[1] : "";
}

function sanitizeFolderName(index, noteId, title) {
  const prefix = String(index).padStart(4, "0");
  const safeTitle = safeFilename(title || "无标题笔记")
    .replace(/\.[^.]+$/, "")
    .slice(0, 80);
  return `${prefix}-${noteId}-${safeTitle}`;
}

function normalizeUrl(url) {
  return String(url || "").replace(/^http:/i, "https:");
}

function readManifest() {
  if (!fs.existsSync(manifestPath)) return [];
  try {
    const value = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveManifest(records) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(records, null, 2), "utf8");
}

function chooseVideoStream(noteCard) {
  const stream = noteCard?.video?.media?.stream || {};
  const h264 = Array.isArray(stream.h264) ? stream.h264 : [];
  const fallback = [
    ...h264,
    ...(Array.isArray(stream.h265) ? stream.h265 : []),
    ...(Array.isArray(stream.av1) ? stream.av1 : [])
  ];
  const candidates = h264.length > 0 ? h264 : fallback;
  return candidates
    .filter((item) => item.master_url)
    .sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0];
}

function imageUrls(noteCard) {
  return (noteCard?.image_list || [])
    .map((image) => image.url_default || image.url_pre || image.url)
    .filter(Boolean)
    .map(normalizeUrl);
}

function subtitleUrls(noteCard) {
  let mediaV2 = null;
  try {
    mediaV2 = JSON.parse(
      noteCard?.video?.media_v2 ||
      noteCard?.video?.media?.media_v2 ||
      "null"
    );
  } catch {
    mediaV2 = null;
  }
  const subtitles =
    noteCard?.video?.media?.video?.subtitles ||
    mediaV2?.video?.subtitles ||
    {};
  return Object.entries(subtitles).flatMap(([language, items]) =>
    (items || []).map((item, index) => ({
      language,
      index,
      url: normalizeUrl(item.url)
    }))
  );
}

async function downloadFile(context, url, target, referer) {
  const response = await context.request.get(normalizeUrl(url), {
    headers: {
      Referer: referer,
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/137 Safari/537.36"
    },
    timeout: 120000
  });
  if (!response.ok()) {
    throw new Error(`download ${response.status()}: ${url}`);
  }
  fs.writeFileSync(target, await response.body());
  return target;
}

async function collectVisibleCards(page) {
  await page.locator("section.note-item a.cover").first().waitFor({
    state: "attached",
    timeout: 30000
  });
  const cardsById = new Map();
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= pageHeight; y += 350) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(120);
    const cards = await page.locator("section.note-item").evaluateAll((sections) =>
      sections.map((section) => {
        const cover = section.querySelector("a.cover");
        const href = cover?.getAttribute("href") || "";
        const title =
          section.querySelector(".title")?.textContent?.trim() ||
          section.innerText.split("\n").map((line) => line.trim()).find(Boolean) ||
          "";
        return {
          href,
          title,
          typeHint: section.querySelector(".play-icon") ? "video" : "image",
          private: section.innerText.includes("仅自己可见")
        };
      })
    );
    for (const card of cards) {
      const noteId = noteIdFromHref(card.href);
      if (noteId) cardsById.set(noteId, { ...card, noteId });
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  return [...cardsById.values()];
}

async function returnToProfile(page) {
  await page.goBack({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  if (!page.url().includes("/user/profile/")) {
    await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  await page.locator("section.note-item a.cover").first().waitFor({
    state: "attached",
    timeout: 30000
  });
}

async function clickCardAndRead(page, noteId) {
  const selector = `section.note-item a.cover[href*="/${noteId}?"]`;
  let card = page.locator(selector).first();
  if ((await card.count()) === 0) {
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y <= pageHeight && (await card.count()) === 0; y += 350) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForTimeout(120);
      card = page.locator(selector).first();
    }
  }
  if ((await card.count()) === 0) throw new Error("profile card not found after scrolling");
  await card.scrollIntoViewIfNeeded();
  const clickedHref = await card.getAttribute("href");
  const feedPromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/sns/web/v1/feed") && response.status() === 200,
    { timeout: 30000 }
  );
  await card.click({ delay: 120 });
  const feedResponse = await feedPromise;
  const payload = await feedResponse.json();
  const item = (payload?.data?.items || []).find(
    (candidate) => candidate.id === noteId || candidate.note_card?.note_id === noteId
  );
  if (!item?.note_card) {
    throw new Error("clicked detail response did not contain the target note");
  }
  await page.waitForTimeout(800);
  return { clickedHref, detailUrl: page.url(), noteCard: item.note_card };
}

async function exportRecord(context, card, index, clicked) {
  const noteCard = clicked.noteCard;
  const noteId = noteCard.note_id;
  const folder = path.join(
    outputDir,
    sanitizeFolderName(index, noteId, noteCard.title || card.title)
  );
  fs.mkdirSync(folder, { recursive: true });

  const stream = chooseVideoStream(noteCard);
  const images = imageUrls(noteCard);
  const subtitles = subtitleUrls(noteCard);
  const mediaFiles = [];

  if (downloadMedia && stream?.master_url) {
    const target = path.join(folder, "video.mp4");
    await downloadFile(context, stream.master_url, target, clicked.detailUrl);
    mediaFiles.push(path.relative(projectRoot, target));
  }
  if (downloadMedia) {
    for (let i = 0; i < images.length; i += 1) {
      const target = path.join(folder, `image-${String(i + 1).padStart(2, "0")}.webp`);
      await downloadFile(context, images[i], target, clicked.detailUrl);
      mediaFiles.push(path.relative(projectRoot, target));
    }
    for (const subtitle of subtitles) {
      const target = path.join(
        folder,
        `subtitle-${safeFilename(subtitle.language)}-${subtitle.index + 1}.srt`
      );
      await downloadFile(context, subtitle.url, target, clicked.detailUrl);
      mediaFiles.push(path.relative(projectRoot, target));
    }
  }

  const record = {
    noteId,
    type: noteCard.type,
    title: noteCard.title || card.title,
    description: noteCard.desc || "",
    publishedAt: noteCard.time ? new Date(noteCard.time).toISOString() : null,
    updatedAt: noteCard.last_update_time
      ? new Date(noteCard.last_update_time).toISOString()
      : null,
    ipLocation: noteCard.ip_location || "",
    private: card.private,
    author: noteCard.user || null,
    interactions: noteCard.interact_info || null,
    tags: noteCard.tag_list || [],
    clickedProfileHref: clicked.clickedHref,
    detailUrl: clicked.detailUrl,
    video: stream
      ? {
          durationMs: stream.duration,
          width: stream.width,
          height: stream.height,
          codec: stream.video_codec,
          sourceUrl: normalizeUrl(stream.master_url)
        }
      : null,
    imageUrls: images,
    subtitleUrls: subtitles,
    mediaFiles,
    exportedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(folder, "metadata.json"), JSON.stringify(record, null, 2), "utf8");
  return record;
}

async function main() {
  const config = loadConfig();
  const browser = await chromium.connectOverCDP(
    `http://127.0.0.1:${config.debugPort}`
  );
  const context = browser.contexts()[0] || (await browser.newContext());
  const page =
    context.pages().find((candidate) => candidate.url() === "about:blank") ||
    (await context.newPage());

  await page.bringToFront();
  await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  const cards = await collectVisibleCards(page);
  const inventory = cards
    .slice(0, maxNotes);

  console.log(`Profile: ${profileUrl}`);
  console.log(`可见作品卡片: ${inventory.length}`);
  console.log(`下载媒体: ${downloadMedia ? "是" : "否"}`);

  const prior = readManifest();
  const recordsById = new Map(prior.map((record) => [record.noteId, record]));
  const failures = [];

  for (let i = 0; i < inventory.length; i += 1) {
    const card = inventory[i];
    console.log(`[${i + 1}/${inventory.length}] 点击: ${card.title || card.noteId}`);
    try {
      const clicked = await clickCardAndRead(page, card.noteId);
      console.log(`  详情: ${clicked.detailUrl}`);
      const record = await exportRecord(context, card, i + 1, clicked);
      recordsById.set(record.noteId, record);
      saveManifest([...recordsById.values()]);
      console.log(`  已保存: ${record.mediaFiles.length} 个媒体/字幕文件`);
    } catch (error) {
      failures.push({ noteId: card.noteId, title: card.title, error: error.message });
      console.log(`  失败: ${error.message}`);
    } finally {
      await returnToProfile(page).catch((error) => {
        console.log(`  返回主页失败: ${error.message}`);
      });
      await sleep(800);
    }
  }

  saveManifest([...recordsById.values()]);
  console.log(`完成: ${recordsById.size} 条记录`);
  if (failures.length > 0) {
    console.log("失败记录:");
    for (const failure of failures) {
      console.log(`  ${failure.noteId} ${failure.title}: ${failure.error}`);
    }
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
