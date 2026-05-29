const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const projectRoot = path.resolve(__dirname, "..");
const downloadsDir = path.join(projectRoot, "downloads");
const dataDir = path.join(projectRoot, "data");

const BASIC_OVERVIEW = "基础数据总览";
const INTERACTION_OVERVIEW = "互动数据总览";

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeMetricName(value) {
  return cleanText(value).replace(/\s+/g, "").replace(/（/g, "(").replace(/）/g, ")");
}

function numberValue(value) {
  if (value == null || value === "") return 0;
  const text = String(value).replace(/,/g, "").replace(/%/g, "").replace(/秒|s/gi, "").trim();
  const number = Number.parseFloat(text);
  return Number.isFinite(number) ? number : 0;
}

function parseChineseDate(value) {
  const text = cleanText(value);
  const match = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseChineseHour(value) {
  const text = cleanText(value);
  const match = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日(\d{1,2})时/);
  if (!match) return null;
  const [, year, month, day, hour] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")} ${hour.padStart(2, "0")}:00`;
}

function parseFileName(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const base = path.basename(fileName, ext);
  const suffix = "-数据明细表";
  if (!base.endsWith(suffix)) return null;

  const body = base.slice(0, -suffix.length);
  const match = body.match(/^(\d+)-(\d+)-(\d+)-([\s\S]+)$/u);
  if (!match) return null;

  const [, exportOrder, buttonIndex, stamp, title] = match;
  return {
    fileName,
    ext,
    exportOrder: Number(exportOrder),
    buttonIndex: Number(buttonIndex),
    stamp: Number(stamp),
    title: cleanText(title),
    kind: Number(buttonIndex) === 1 ? "basic" : "interaction"
  };
}

function sheetRows(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
}

function parseOverview(rows) {
  const metrics = {};
  for (const row of rows.slice(1)) {
    const key = normalizeMetricName(row[0]);
    if (!key) continue;
    metrics[key] = numberValue(row[1]);
  }
  return metrics;
}

function parseSeries(workbook, meta, granularity) {
  const rows = [];
  for (const sheetName of workbook.SheetNames) {
    if (sheetName.includes("总览")) continue;
    const isHour = sheetName.includes("小时");
    if (granularity === "day" && isHour) continue;
    if (granularity === "hour" && !isHour) continue;

    const data = sheetRows(workbook, sheetName);
    if (data.length < 2) continue;

    const metric = normalizeMetricName(data[0][1] || sheetName.replace(/（.*$/, ""));
    for (const row of data.slice(1)) {
      const bucket = isHour ? parseChineseHour(row[0]) : parseChineseDate(row[0]);
      if (!bucket) continue;
      rows.push({
        noteKey: meta.noteKey,
        title: meta.title,
        granularity,
        bucket,
        metric,
        value: numberValue(row[1]),
        sourceFile: meta.fileName
      });
    }
  }
  return rows;
}

function metricBelongsToKind(metric, kind) {
  const basic = new Set(["曝光数", "观看数", "封面点击率", "人均观看时长", "涨粉数"]);
  const interaction = new Set(["点赞数", "评论数", "收藏数", "笔记分享数"]);
  if (kind === "basic") return basic.has(metric);
  if (kind === "interaction") return interaction.has(metric);
  return true;
}

function derivedMetrics(note) {
  const views = note.views || 0;
  const impressions = note.impressions || 0;
  const interactions = (note.likes || 0) + (note.comments || 0) + (note.collects || 0) + (note.shares || 0);

  return {
    interactions,
    viewRate: impressions ? views / impressions : 0,
    interactionRate: views ? interactions / views : 0,
    collectRate: views ? (note.collects || 0) / views : 0,
    commentRate: views ? (note.comments || 0) / views : 0,
    shareRate: views ? (note.shares || 0) / views : 0,
    followRate: views ? (note.followersGained || 0) / views : 0
  };
}

function diagnosisFor(note) {
  const tags = [];
  if ((note.impressions || 0) >= 1000 && (note.viewRate || 0) < 0.1) tags.push("高曝光低点击");
  if ((note.viewRate || 0) >= 0.15) tags.push("封面/标题有效");
  if ((note.collectRate || 0) >= 0.04) tags.push("高收藏价值");
  if ((note.commentRate || 0) >= 0.01) tags.push("高讨论");
  if ((note.followRate || 0) >= 0.004) tags.push("转粉效率好");
  if ((note.interactionRate || 0) >= 0.08) tags.push("高互动");
  if ((note.impressions || 0) < 800 && (note.interactionRate || 0) >= 0.08) tags.push("潜力笔记");
  if (tags.length === 0) tags.push("待观察");
  return tags;
}

function latestFiles(files) {
  const chosen = new Map();
  const skipped = [];

  for (const fileName of files) {
    const parsed = parseFileName(fileName);
    if (!parsed) {
      skipped.push({ fileName, reason: "filename-not-recognized" });
      continue;
    }

    const fullPath = path.join(downloadsDir, fileName);
    const stat = fs.statSync(fullPath);
    const key = `${parsed.title}::${parsed.kind}`;
    const record = { ...parsed, fullPath, mtimeMs: stat.mtimeMs, size: stat.size };
    const previous = chosen.get(key);
    if (!previous || record.mtimeMs > previous.mtimeMs) {
      if (previous) skipped.push({ fileName: previous.fileName, reason: "older-duplicate" });
      chosen.set(key, record);
    } else {
      skipped.push({ fileName, reason: "older-duplicate" });
    }
  }

  return { chosen: [...chosen.values()], skipped };
}

function mergeBasic(note, metrics) {
  Object.assign(note, {
    impressions: metrics["曝光数"] ?? note.impressions ?? 0,
    views: metrics["观看数"] ?? note.views ?? 0,
    coverClickRatePct: metrics["封面点击率(%)"] ?? note.coverClickRatePct ?? 0,
    avgWatchSeconds: metrics["平均观看时长(s)"] ?? note.avgWatchSeconds ?? 0,
    completionRatePct: metrics["完播率(%)"] ?? note.completionRatePct ?? 0,
    twoSecondExitRatePct: metrics["2秒退出率(%)"] ?? note.twoSecondExitRatePct ?? 0,
    followersGained: metrics["涨粉数"] ?? note.followersGained ?? 0
  });
}

function mergeInteraction(note, metrics) {
  Object.assign(note, {
    likes: metrics["点赞数"] ?? note.likes ?? 0,
    comments: metrics["评论数"] ?? note.comments ?? 0,
    collects: metrics["收藏数"] ?? note.collects ?? 0,
    shares: metrics["分享数"] ?? note.shares ?? 0,
    danmaku: metrics["弹幕数"] ?? note.danmaku ?? 0
  });
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const headers = [...rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set())];
  const escape = (value) => {
    if (Array.isArray(value)) value = value.join("|");
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((key) => escape(row[key])).join(","))].join("\n");
}

function importData() {
  ensureDataDir();

  const files = fs.existsSync(downloadsDir)
    ? fs.readdirSync(downloadsDir).filter((file) => /\.(xlsx|json)$/i.test(file))
    : [];

  const { chosen, skipped } = latestFiles(files);
  const noteMap = new Map();
  const dailyMetrics = [];
  const hourlyMetrics = [];
  const importedFiles = [];

  for (const file of chosen) {
    const noteKey = cleanText(file.title).toLowerCase();
    const meta = { ...file, noteKey };

    if (file.ext === ".json") {
      const payload = JSON.parse(fs.readFileSync(file.fullPath, "utf8"));
      skipped.push({ fileName: file.fileName, reason: payload.msg || "json-export-error" });
      continue;
    }

    const workbook = XLSX.readFile(file.fullPath, { cellDates: true });
    const overviewName = file.kind === "basic" ? BASIC_OVERVIEW : INTERACTION_OVERVIEW;
    const overview = parseOverview(sheetRows(workbook, overviewName));

    const note = noteMap.get(noteKey) || {
      noteKey,
      title: file.title,
      exportOrder: file.exportOrder,
      sourceFiles: []
    };

    if (file.kind === "basic") mergeBasic(note, overview);
    if (file.kind === "interaction") mergeInteraction(note, overview);

    note.sourceFiles.push(file.fileName);
    noteMap.set(noteKey, note);

    dailyMetrics.push(...parseSeries(workbook, meta, "day").filter((row) => metricBelongsToKind(row.metric, file.kind)));
    hourlyMetrics.push(...parseSeries(workbook, meta, "hour").filter((row) => metricBelongsToKind(row.metric, file.kind)));
    importedFiles.push({
      fileName: file.fileName,
      kind: file.kind,
      title: file.title,
      size: file.size,
      importedAt: new Date().toISOString()
    });
  }

  const notes = [...noteMap.values()]
    .map((note) => {
      const enriched = { ...note, ...derivedMetrics(note) };
      enriched.diagnosis = diagnosisFor(enriched);
      enriched.firstMetricDate = dailyMetrics
        .filter((row) => row.noteKey === note.noteKey)
        .map((row) => row.bucket)
        .sort()[0] || "";
      return enriched;
    })
    .sort((a, b) => (b.impressions || 0) - (a.impressions || 0));

  const summary = {
    generatedAt: new Date().toISOString(),
    downloadDir: downloadsDir,
    noteCount: notes.length,
    importedFileCount: importedFiles.length,
    skippedFileCount: skipped.length,
    totalImpressions: notes.reduce((sum, row) => sum + (row.impressions || 0), 0),
    totalViews: notes.reduce((sum, row) => sum + (row.views || 0), 0),
    totalInteractions: notes.reduce((sum, row) => sum + (row.interactions || 0), 0),
    totalFollowersGained: notes.reduce((sum, row) => sum + (row.followersGained || 0), 0)
  };

  const lifecycleMilestones = buildLifecycleMilestones(notes, dailyMetrics, hourlyMetrics);
  const database = { summary, notes, dailyMetrics, hourlyMetrics, lifecycleMilestones, importedFiles, skippedFiles: skipped };
  fs.writeFileSync(path.join(dataDir, "xhs-unified-data.json"), JSON.stringify(database, null, 2), "utf8");
  fs.writeFileSync(path.join(dataDir, "notes.csv"), toCsv(notes), "utf8");
  fs.writeFileSync(path.join(dataDir, "daily_metrics.csv"), toCsv(dailyMetrics), "utf8");
  fs.writeFileSync(path.join(dataDir, "hourly_metrics.csv"), toCsv(hourlyMetrics), "utf8");

  console.log(`Imported ${summary.noteCount} notes from ${summary.importedFileCount} files.`);
  console.log(`Skipped ${summary.skippedFileCount} files.`);
  console.log(`Data written to ${path.join(dataDir, "xhs-unified-data.json")}`);
  return database;
}

function hourDiff(startDate, hourBucket) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(hourBucket.replace(" ", "T"));
  return Math.max(1, Math.round((end - start) / 3600000) + 1);
}

function dayDiff(startDate, dayBucket) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${dayBucket}T00:00:00`);
  return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function cumulativeMetric(rows, note, metric, milestone) {
  if (milestone.unit === "hour") {
    return rows
      .filter((row) => row.noteKey === note.noteKey && row.metric === metric)
      .filter((row) => hourDiff(note.firstMetricDate, row.bucket) <= milestone.value)
      .reduce((sum, row) => sum + row.value, 0);
  }

  return rows
    .filter((row) => row.noteKey === note.noteKey && row.metric === metric)
    .filter((row) => dayDiff(note.firstMetricDate, row.bucket) <= milestone.value)
    .reduce((sum, row) => sum + row.value, 0);
}

function buildLifecycleMilestones(notes, dailyMetrics, hourlyMetrics) {
  const milestones = [
    { key: "1h", label: "发布后1小时", unit: "hour", value: 1 },
    { key: "6h", label: "发布后6小时", unit: "hour", value: 6 },
    { key: "24h", label: "发布后24小时", unit: "day", value: 1 },
    { key: "3d", label: "发布后3天", unit: "day", value: 3 },
    { key: "7d", label: "发布后7天", unit: "day", value: 7 },
    { key: "14d", label: "发布后14天", unit: "day", value: 14 }
  ];

  const metricRows = [...hourlyMetrics, ...dailyMetrics];
  const records = [];

  for (const note of notes) {
    for (const milestone of milestones) {
      const impressions = cumulativeMetric(metricRows, note, "曝光数", milestone);
      const views = cumulativeMetric(metricRows, note, "观看数", milestone);
      const likes = cumulativeMetric(metricRows, note, "点赞数", milestone);
      const comments = cumulativeMetric(metricRows, note, "评论数", milestone);
      const collects = cumulativeMetric(metricRows, note, "收藏数", milestone);
      const shares = cumulativeMetric(metricRows, note, "笔记分享数", milestone);
      const followersGained = cumulativeMetric(metricRows, note, "涨粉数", milestone);
      const interactions = likes + comments + collects + shares;

      records.push({
        noteKey: note.noteKey,
        title: note.title,
        milestone: milestone.key,
        milestoneLabel: milestone.label,
        milestoneOrder: milestones.indexOf(milestone) + 1,
        impressions,
        views,
        interactions,
        likes,
        comments,
        collects,
        shares,
        followersGained,
        viewRate: impressions ? views / impressions : 0,
        interactionRate: views ? interactions / views : 0,
        collectRate: views ? collects / views : 0,
        followRate: views ? followersGained / views : 0
      });
    }
  }

  return records;
}

if (require.main === module) {
  importData();
}

module.exports = {
  importData,
  dataDir,
  downloadsDir
};
