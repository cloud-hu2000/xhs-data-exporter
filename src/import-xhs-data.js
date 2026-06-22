const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const projectRoot = path.resolve(__dirname, "..");
const downloadsDir = path.join(projectRoot, "downloads");
const dataDir = path.join(projectRoot, "data");
const coverManifestPath = path.join(dataDir, "note-covers.json");

const BASIC_OVERVIEW = "基础数据总览";
const INTERACTION_OVERVIEW = "互动数据总览";
const MIN_DIAGNOSTIC_VIEWS = 100;

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function noteKeyFromTitle(value) {
  return cleanText(value).toLowerCase();
}

function loadCoverRecords() {
  if (!fs.existsSync(coverManifestPath)) return [];
  try {
    const records = JSON.parse(fs.readFileSync(coverManifestPath, "utf8"));
    return Array.isArray(records) ? records : [];
  } catch (error) {
    console.log(`Cover manifest skipped: ${error.message}`);
    return [];
  }
}

function coverRecordsByNoteKey(records) {
  const map = new Map();
  for (const record of records) {
    const key = record.noteKey || noteKeyFromTitle(record.title);
    if (!key || !record.coverImageUrl) continue;
    const previous = map.get(key);
    if (!previous || String(record.capturedAt || "") > String(previous.capturedAt || "")) {
      map.set(key, record);
    }
  }
  return map;
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
  const cesScore = (note.likes || 0)
    + (note.collects || 0)
    + (note.comments || 0) * 4
    + (note.shares || 0) * 4
    + (note.followersGained || 0) * 8;

  return {
    interactions,
    cesScore,
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
  if ((note.views || 0) < MIN_DIAGNOSTIC_VIEWS) {
    return ["! 样本不足"];
  }
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
  const hasOfficialCoverClickRate = Object.prototype.hasOwnProperty.call(metrics, "封面点击率(%)");
  Object.assign(note, {
    impressions: metrics["曝光数"] ?? note.impressions ?? 0,
    views: metrics["观看数"] ?? note.views ?? 0,
    coverClickRatePct: metrics["封面点击率(%)"] ?? note.coverClickRatePct ?? 0,
    hasOfficialCoverClickRate: hasOfficialCoverClickRate || note.hasOfficialCoverClickRate || false,
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

function writeTextFile(filePath, content, required = true) {
  try {
    fs.writeFileSync(filePath, content, "utf8");
    return true;
  } catch (error) {
    const message = `Write skipped for ${filePath}: ${error.message}`;
    if (required) throw error;
    console.log(message);
    return false;
  }
}

function importData() {
  ensureDataDir();

  const files = fs.existsSync(downloadsDir)
    ? fs.readdirSync(downloadsDir).filter((file) => /\.(xlsx|json)$/i.test(file))
    : [];

  const { chosen, skipped } = latestFiles(files);
  const coverRecords = loadCoverRecords();
  const coverByNoteKey = coverRecordsByNoteKey(coverRecords);
  const noteMap = new Map();
  const dailyMetrics = [];
  const hourlyMetrics = [];
  const importedFiles = [];

  for (const file of chosen) {
    const noteKey = noteKeyFromTitle(file.title);
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
      const cover = coverByNoteKey.get(enriched.noteKey);
      if (cover) {
        Object.assign(enriched, {
          noteId: cover.noteId || enriched.noteId || "",
          detailUrl: cover.detailUrl || enriched.detailUrl || "",
          coverImageUrl: cover.coverImageUrl || "",
          coverAlt: cover.coverAlt || "",
          coverSelector: cover.coverSelector || "",
          coverCapturedAt: cover.capturedAt || ""
        });
      }
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
  const database = { summary, notes, dailyMetrics, hourlyMetrics, lifecycleMilestones, coverRecords, importedFiles, skippedFiles: skipped };
  writeTextFile(path.join(dataDir, "xhs-unified-data.json"), JSON.stringify(database, null, 2), true);
  writeTextFile(path.join(dataDir, "notes.csv"), toCsv(notes), false);
  writeTextFile(path.join(dataDir, "daily_metrics.csv"), toCsv(dailyMetrics), false);
  writeTextFile(path.join(dataDir, "hourly_metrics.csv"), toCsv(hourlyMetrics), false);

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

function bucketDate(row) {
  if (row.granularity === "hour") return new Date(row.bucket.replace(" ", "T"));
  return new Date(`${row.bucket}T23:00:00`);
}

function inferLifecycleStart(note, hourlyMetrics) {
  const firstHour = hourlyMetrics
    .filter((row) => row.noteKey === note.noteKey)
    .map((row) => row.bucket)
    .sort()[0];
  if (firstHour) return new Date(firstHour.replace(" ", "T"));
  if (note.firstMetricDate) return new Date(`${note.firstMetricDate}T00:00:00`);
  return null;
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3600000);
}

function cumulativeMetricWithCoverage(note, metric, milestone, dailyMetrics, hourlyMetrics, lifecycleStart) {
  const hourlyRows = hourlyMetrics.filter((row) => row.noteKey === note.noteKey && row.metric === metric);
  const dailyRows = dailyMetrics.filter((row) => row.noteKey === note.noteKey && row.metric === metric);
  const rows = hourlyRows.length > 0 ? hourlyRows : dailyRows;
  const usesDailyOnly = hourlyRows.length === 0 && dailyRows.length > 0;
  if (!lifecycleStart || rows.length === 0) {
    return {
      value: null,
      rawValue: null,
      status: "missing",
      coverageEnd: ""
    };
  }

  const windowEnd = addHours(lifecycleStart, milestone.hours);
  const rowsWithDate = rows
    .map((row) => ({ ...row, bucketDate: bucketDate(row) }))
    .filter((row) => !Number.isNaN(row.bucketDate.getTime()))
    .sort((a, b) => a.bucketDate - b.bucketDate);

  if (rowsWithDate.length === 0) {
    return {
      value: null,
      rawValue: null,
      status: "missing",
      coverageEnd: ""
    };
  }

  const coverageEnd = rowsWithDate[rowsWithDate.length - 1].bucketDate;
  const rawValue = rowsWithDate
    .filter((row) => row.bucketDate <= windowEnd)
    .reduce((sum, row) => sum + row.value, 0);
  const dailyOnlyAligned = !usesDailyOnly || lifecycleStart.getHours() === 0;
  const status = coverageEnd >= windowEnd && dailyOnlyAligned ? "complete" : "partial";

  return {
    value: status === "complete" ? rawValue : null,
    rawValue,
    status,
    coverageEnd: coverageEnd.toISOString()
  };
}

function combineMetricCoverage(parts, valueFactory) {
  if (parts.every((part) => part.status === "missing")) {
    return {
      value: null,
      rawValue: null,
      status: "missing",
      coverageEnd: ""
    };
  }

  const coverageEnd = parts
    .map((part) => part.coverageEnd)
    .filter(Boolean)
    .sort()[0] || "";
  const rawValue = valueFactory("rawValue");
  const complete = parts.every((part) => part.status === "complete");

  return {
    value: complete ? valueFactory("value") : null,
    rawValue,
    status: complete ? "complete" : "partial",
    coverageEnd
  };
}

function assignCoveredMetric(record, key, covered) {
  record[key] = covered.value;
  record[`${key}Raw`] = covered.rawValue;
  record[`${key}Status`] = covered.status;
  record[`${key}CoverageEnd`] = covered.coverageEnd;
}

function buildLifecycleMilestones(notes, dailyMetrics, hourlyMetrics) {
  const milestones = [
    { key: "1h", label: "发布后1小时", hours: 1 },
    { key: "6h", label: "发布后6小时", hours: 6 },
    { key: "24h", label: "发布后24小时", hours: 24 },
    { key: "3d", label: "发布后3天", hours: 72 },
    { key: "7d", label: "发布后7天", hours: 168 },
    { key: "14d", label: "发布后14天", hours: 336 }
  ];

  const records = [];

  for (const note of notes) {
    const lifecycleStart = inferLifecycleStart(note, hourlyMetrics);
    for (const milestone of milestones) {
      const impressions = cumulativeMetricWithCoverage(note, "曝光数", milestone, dailyMetrics, hourlyMetrics, lifecycleStart);
      const views = cumulativeMetricWithCoverage(note, "观看数", milestone, dailyMetrics, hourlyMetrics, lifecycleStart);
      const likes = cumulativeMetricWithCoverage(note, "点赞数", milestone, dailyMetrics, hourlyMetrics, lifecycleStart);
      const comments = cumulativeMetricWithCoverage(note, "评论数", milestone, dailyMetrics, hourlyMetrics, lifecycleStart);
      const collects = cumulativeMetricWithCoverage(note, "收藏数", milestone, dailyMetrics, hourlyMetrics, lifecycleStart);
      const shares = cumulativeMetricWithCoverage(note, "笔记分享数", milestone, dailyMetrics, hourlyMetrics, lifecycleStart);
      const followersGained = cumulativeMetricWithCoverage(note, "涨粉数", milestone, dailyMetrics, hourlyMetrics, lifecycleStart);
      const interactions = combineMetricCoverage([likes, comments, collects, shares], (field) => (
        (likes[field] || 0) + (comments[field] || 0) + (collects[field] || 0) + (shares[field] || 0)
      ));
      const cesScore = combineMetricCoverage([likes, comments, collects, shares, followersGained], (field) => (
        (likes[field] || 0) + (collects[field] || 0) + (comments[field] || 0) * 4 + (shares[field] || 0) * 4 + (followersGained[field] || 0) * 8
      ));
      const viewRate = combineMetricCoverage([impressions, views], (field) => (
        impressions[field] ? (views[field] || 0) / impressions[field] : 0
      ));
      const interactionRate = combineMetricCoverage([views, interactions], (field) => (
        views[field] ? (interactions[field] || 0) / views[field] : 0
      ));
      const collectRate = combineMetricCoverage([views, collects], (field) => (
        views[field] ? (collects[field] || 0) / views[field] : 0
      ));
      const followRate = combineMetricCoverage([views, followersGained], (field) => (
        views[field] ? (followersGained[field] || 0) / views[field] : 0
      ));

      const record = {
        noteKey: note.noteKey,
        title: note.title,
        milestone: milestone.key,
        milestoneLabel: milestone.label,
        milestoneOrder: milestones.indexOf(milestone) + 1,
        lifecycleStart: lifecycleStart ? lifecycleStart.toISOString() : ""
      };

      assignCoveredMetric(record, "impressions", impressions);
      assignCoveredMetric(record, "views", views);
      assignCoveredMetric(record, "interactions", interactions);
      assignCoveredMetric(record, "likes", likes);
      assignCoveredMetric(record, "comments", comments);
      assignCoveredMetric(record, "collects", collects);
      assignCoveredMetric(record, "shares", shares);
      assignCoveredMetric(record, "followersGained", followersGained);
      assignCoveredMetric(record, "cesScore", cesScore);
      assignCoveredMetric(record, "viewRate", viewRate);
      assignCoveredMetric(record, "interactionRate", interactionRate);
      assignCoveredMetric(record, "collectRate", collectRate);
      assignCoveredMetric(record, "followRate", followRate);

      records.push(record);
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
