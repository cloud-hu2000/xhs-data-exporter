const state = {
  data: null,
  sort: "interactions",
  filter: "all",
  search: "",
  selected: new Set(),
  chartMetric: "interactions",
  publishMetric: "impressions",
  funnelNoteKey: "",
  coverSort: "officialCoverClickRate",
  notesCompareSearch: "",
  notesCompareSort: "cesScore",
  notesCompareTag: "all",
  reviewNoteKey: "",
  reviewDraft: null,
  benchmarkCache: new Map(),
  tables: {
    lifecycle: { page: 1, pageSize: 10, sortKey: "m14", sortDir: "desc" },
    publish: { page: 1, pageSize: 10, sortKey: "avgImpressions", sortDir: "desc" },
    funnel: { page: 1, pageSize: 10, sortKey: "impressions", sortDir: "desc" },
    cover: { page: 1, pageSize: 10, sortKey: "officialCoverClickRate", sortDir: "desc" },
    notes: { page: 1, pageSize: 10, sortKey: "cesScore", sortDir: "desc" }
  },
  view: "lifecycle",
  chart: null,
  publishChart: null,
  funnelChart: null,
  coverChart: null
};

const MILESTONES = ["1h", "6h", "24h", "3d", "7d", "14d"];
const MILESTONE_LABELS = ["1小时", "6小时", "24小时", "3天", "7天", "14天"];
const METRIC_LABELS = {
  interactions: "累计互动",
  views: "累计观看",
  impressions: "累计曝光",
  collects: "累计收藏",
  followersGained: "累计涨粉",
  interactionRate: "互动率",
  collectRate: "收藏率",
  followRate: "转粉率"
};
const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const PUBLISH_METRIC_LABELS = {
  impressions: "平均曝光",
  interactions: "平均互动",
  followRate: "平均涨粉效率"
};
const REVIEW_FIELD_META = {
  contentTypes: "内容类型",
  formats: "形式",
  hooks: "核心钩子",
  coverStyles: "封面风格",
  firstFiveSecondStructures: "前 5 秒结构",
  targetActions: "目标动作",
  audiences: "目标人群"
};

const VIEW_META = {
  lifecycle: ["数据看板 / 生命周期对比", "笔记生命周期对比"],
  publish: ["数据看板 / 发布时间分析", "发布时间分析"],
  funnel: ["数据看板 / 内容诊断", "分叉式内容诊断"],
  cover: ["数据看板 / 封面分析", "封面分析"],
  notes: ["数据看板 / 笔记横向对比", "笔记横向对比"]
};

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value || 0));
}

function formatPct(value) {
  return `${((value || 0) * 100).toFixed(1)}%`;
}

function formatOptionalNumber(value) {
  return value == null ? "-" : formatNumber(value);
}

function formatOptionalPct(value) {
  return value == null ? "-" : formatPct(value);
}

function metricFormatter(metric, value) {
  if (metric.endsWith("Rate")) return formatPct(value);
  return formatNumber(value);
}

function normalizeRate(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  const rate = number > 1 ? number / 100 : number;
  return Math.min(1, Math.max(0, rate));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tagClass(label) {
  if (String(label).includes("样本不足") || String(label).includes("基准积累")) return "warning";
  if (label === "待观察") return "";
  return "strong";
}

function tableState(tableId) {
  return state.tables[tableId];
}

function compareValues(a, b) {
  const valueA = a instanceof Date ? a.getTime() : a;
  const valueB = b instanceof Date ? b.getTime() : b;
  const emptyA = valueA == null || valueA === "";
  const emptyB = valueB == null || valueB === "";
  if (emptyA && emptyB) return 0;
  if (emptyA) return -1;
  if (emptyB) return 1;

  const numberA = Number(valueA);
  const numberB = Number(valueB);
  if (Number.isFinite(numberA) && Number.isFinite(numberB)) {
    return numberA - numberB;
  }

  return String(valueA).localeCompare(String(valueB), "zh-CN", { numeric: true, sensitivity: "base" });
}

function sortRows(rows, tableId, getters = {}) {
  const config = tableState(tableId);
  if (!config) return rows;
  const getter = getters[config.sortKey] || ((row) => row[config.sortKey]);
  const direction = config.sortDir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => compareValues(getter(a), getter(b)) * direction);
}

function paginatedRows(rows, tableId) {
  const config = tableState(tableId);
  if (!config) return rows;
  const totalPages = Math.max(1, Math.ceil(rows.length / config.pageSize));
  config.page = Math.min(Math.max(1, config.page), totalPages);
  const start = (config.page - 1) * config.pageSize;
  return rows.slice(start, start + config.pageSize);
}

function resetTablePage(tableId) {
  const config = tableState(tableId);
  if (config) config.page = 1;
}

function setTableSort(tableId, sortKey, renderDirection = true) {
  const config = tableState(tableId);
  if (!config) return;
  if (config.sortKey === sortKey) {
    config.sortDir = config.sortDir === "asc" ? "desc" : "asc";
  } else {
    config.sortKey = sortKey;
    config.sortDir = renderDirection ? "desc" : "asc";
  }
  resetTablePage(tableId);
  syncSortSelect(tableId);
  renderTableById(tableId);
}

function setTableSortFromSelect(tableId, sortKey) {
  const config = tableState(tableId);
  if (!config) return;
  config.sortKey = sortKey;
  config.sortDir = "desc";
  resetTablePage(tableId);
  syncSortSelect(tableId);
  renderTableById(tableId);
}

function syncSortSelect(tableId) {
  if (tableId === "lifecycle") {
    const sortKey = tableState(tableId).sortKey;
    const select = document.getElementById("sortSelect");
    if (select && [...select.options].some((option) => option.value === sortKey)) {
      state.sort = sortKey;
      select.value = sortKey;
    }
  }
  if (tableId === "cover") {
    const sortKey = tableState(tableId).sortKey;
    const select = document.getElementById("coverSortSelect");
    if (select && [...select.options].some((option) => option.value === sortKey)) {
      state.coverSort = sortKey;
      select.value = sortKey;
    }
  }
  if (tableId === "notes") {
    const sortKey = tableState(tableId).sortKey;
    const select = document.getElementById("notesCompareSort");
    if (select && [...select.options].some((option) => option.value === sortKey)) {
      state.notesCompareSort = sortKey;
      select.value = sortKey;
    }
  }
}

function updateSortHeaders(tableId) {
  const config = tableState(tableId);
  if (!config) return;
  document.querySelectorAll(`th[data-table="${tableId}"][data-sort-key]`).forEach((header) => {
    const active = header.dataset.sortKey === config.sortKey;
    header.classList.toggle("sorted", active);
    header.setAttribute("aria-sort", active ? (config.sortDir === "asc" ? "ascending" : "descending") : "none");
    let indicator = header.querySelector(".sort-indicator");
    if (!indicator) {
      indicator = document.createElement("span");
      indicator.className = "sort-indicator";
      header.appendChild(indicator);
    }
    indicator.textContent = active ? (config.sortDir === "asc" ? "↑" : "↓") : "↕";
  });
}

function renderPagination(tableId, totalRows) {
  const container = document.getElementById(`${tableId}Pagination`);
  const config = tableState(tableId);
  if (!container || !config) return;
  const totalPages = Math.max(1, Math.ceil(totalRows / config.pageSize));
  config.page = Math.min(Math.max(1, config.page), totalPages);
  const start = totalRows === 0 ? 0 : (config.page - 1) * config.pageSize + 1;
  const end = Math.min(totalRows, config.page * config.pageSize);
  container.innerHTML = `
    <div class="pagination-info">显示 ${formatNumber(start)}-${formatNumber(end)} / 共 ${formatNumber(totalRows)} 条</div>
    <div class="pagination-controls">
      <label>
        每页
        <select class="page-size-select" data-table="${tableId}" data-page-size>
          ${[5, 10, 20, 50].map((size) => `<option value="${size}" ${size === config.pageSize ? "selected" : ""}>${size}</option>`).join("")}
        </select>
      </label>
      <button class="button page-button" type="button" data-table="${tableId}" data-page-action="prev" ${config.page <= 1 ? "disabled" : ""}>上一页</button>
      <span class="page-current">第 ${formatNumber(config.page)} / ${formatNumber(totalPages)} 页</span>
      <button class="button page-button" type="button" data-table="${tableId}" data-page-action="next" ${config.page >= totalPages ? "disabled" : ""}>下一页</button>
    </div>
  `;
}

function renderTableById(tableId) {
  if (tableId === "lifecycle") renderTable();
  if (tableId === "publish") renderPublishTable();
  if (tableId === "funnel") renderFunnelTable();
  if (tableId === "cover") renderCoverTable();
  if (tableId === "notes") renderNotesCompareTable();
}

function milestoneMap(noteKey) {
  const rows = state.data.lifecycleMilestones.filter((row) => row.noteKey === noteKey);
  return Object.fromEntries(rows.map((row) => [row.milestone, row]));
}

function milestoneValue(noteKey, milestone, metric) {
  const row = milestoneMap(noteKey)[milestone];
  if (!row) return null;
  return row[`${metric}Status`] === "complete" ? row[metric] : null;
}

function milestoneStatus(noteKey, milestone, metric) {
  return milestoneMap(noteKey)[milestone]?.[`${metric}Status`] || "missing";
}

function milestoneRawValue(noteKey, milestone, metric) {
  return milestoneMap(noteKey)[milestone]?.[`${metric}Raw`] ?? null;
}

function milestoneDisplayValue(noteKey, milestone, metric) {
  const status = milestoneStatus(noteKey, milestone, metric);
  const value = milestoneValue(noteKey, milestone, metric);
  if (status === "complete") return value;
  if (status === "partial") return milestoneRawValue(noteKey, milestone, metric);
  return null;
}

function isCompleteValue(value) {
  return value != null && Number.isFinite(Number(value));
}

function formatLifecycleValue(value, status, formatter = formatNumber, rawValue = null) {
  if (status === "missing") return `<div class="metric-main muted-value">暂无数据</div>`;
  if (status === "partial") {
    if (rawValue == null) return `<div class="metric-main warn-value">数据未完整</div>`;
    return `
      <div class="metric-main warn-value">${formatter(rawValue)}</div>
      <div class="metric-sub warn-sub">数据未完整</div>
    `;
  }
  return `<div class="metric-main">${formatter(value)}</div>`;
}

function lifecycleValues(note) {
  const m24 = milestoneValue(note.noteKey, "24h", "interactions");
  const m7 = milestoneValue(note.noteKey, "7d", "interactions");
  const m14 = milestoneValue(note.noteKey, "14d", "interactions");
  const m24Raw = milestoneRawValue(note.noteKey, "24h", "interactions");
  const m7Raw = milestoneRawValue(note.noteKey, "7d", "interactions");
  const m14Raw = milestoneRawValue(note.noteKey, "14d", "interactions");
  const views14 = milestoneValue(note.noteKey, "14d", "views");
  const impressions14 = milestoneValue(note.noteKey, "14d", "impressions");
  const firstDayViews = milestoneValue(note.noteKey, "24h", "views");
  const firstDayImpressions = milestoneValue(note.noteKey, "24h", "impressions");
  const hasM24 = isCompleteValue(m24);
  const hasM7 = isCompleteValue(m7);
  const hasM14 = isCompleteValue(m14);
  const earlyShare = hasM24 && hasM14 && m14 ? m24 / m14 : null;
  const tailShare = hasM7 && hasM14 && m14 ? Math.max(0, m14 - m7) / m14 : null;
  const firstDayViewRate = isCompleteValue(firstDayViews) && isCompleteValue(firstDayImpressions) && firstDayImpressions ? firstDayViews / firstDayImpressions : null;

  return {
    m24,
    m7,
    m14,
    m24Raw,
    m7Raw,
    m14Raw,
    views14,
    impressions14,
    earlyShare,
    tailShare,
    firstDayViewRate,
    hasM24,
    hasM7,
    hasM14
  };
}

function lifecycleProfile(note) {
  const values = lifecycleValues(note);
  const tags = [];
  if (!values.hasM24 || !values.hasM7 || !values.hasM14) {
    tags.push("数据未完整");
  } else {
    const cohort = ContentDiagnostics.selectPeerCohort(state.data.notes, note);
    const peerValues = cohort.notes.map(lifecycleValues);
    const stats = {
      m24: ContentDiagnostics.metricStats(peerValues.map((item) => item.m24).filter(isCompleteValue)),
      earlyShare: ContentDiagnostics.metricStats(peerValues.map((item) => item.earlyShare).filter(isCompleteValue)),
      tailShare: ContentDiagnostics.metricStats(peerValues.map((item) => item.tailShare).filter(isCompleteValue)),
      firstDayViewRate: ContentDiagnostics.metricStats(peerValues.map((item) => item.firstDayViewRate).filter(isCompleteValue))
    };
    const sufficient = cohort.notes.length >= ContentDiagnostics.BENCHMARK_CONFIG.minimumPeers;
    if (!sufficient) {
      tags.push("基准积累中");
    } else {
      const m24Comparison = ContentDiagnostics.compareMetric(values.m24, stats.m24, "high");
      const earlyComparison = ContentDiagnostics.compareMetric(values.earlyShare, stats.earlyShare, "high");
      const tailComparison = ContentDiagnostics.compareMetric(values.tailShare, stats.tailShare, "high");
      const firstDayComparison = ContentDiagnostics.compareMetric(values.firstDayViewRate, stats.firstDayViewRate, "high");
      if (m24Comparison?.band === "high" || earlyComparison?.band === "high") tags.push("启动速度同类前 25%");
      if (tailComparison?.band === "high") tags.push("后劲同类前 25%");
      if (earlyComparison?.band === "high" && tailComparison?.band === "low") tags.push("前高后低");
      if (tailComparison?.band === "high" && firstDayComparison?.band === "high") tags.push("长尾表现突出");
      if (tags.length === 0) tags.push("处于同类正常区间");
    }
  }

  return {
    tags,
    ...values,
    m24Display: milestoneDisplayValue(note.noteKey, "24h", "interactions"),
    m7Display: milestoneDisplayValue(note.noteKey, "7d", "interactions"),
    m14Display: milestoneDisplayValue(note.noteKey, "14d", "interactions"),
    m24Status: milestoneStatus(note.noteKey, "24h", "interactions"),
    m7Status: milestoneStatus(note.noteKey, "7d", "interactions"),
    m14Status: milestoneStatus(note.noteKey, "14d", "interactions")
  };
}

function noteMatchesFilter(note) {
  const tags = lifecycleProfile(note).tags;
  if (state.filter === "fast") return tags.includes("启动速度同类前 25%");
  if (state.filter === "tail") return tags.includes("后劲同类前 25%");
  if (state.filter === "fade") return tags.includes("前高后低");
  if (state.filter === "search") return tags.includes("长尾表现突出");
  return true;
}

function filteredNotes() {
  const query = state.search.trim().toLowerCase();
  return [...state.data.notes]
    .filter(noteMatchesFilter)
    .filter((note) => {
      if (!query) return true;
      return `${note.title} ${funnelDiagnostics(note).map((item) => item.type).join(" ")} ${lifecycleProfile(note).tags.join(" ")}`.toLowerCase().includes(query);
    })
    .sort((a, b) => Number(b[state.sort] || 0) - Number(a[state.sort] || 0));
}

function chartNotes() {
  const notes = filteredNotes();
  const selected = notes.filter((note) => state.selected.has(note.noteKey));
  return (selected.length > 0 ? selected : notes.slice(0, 4)).slice(0, 4);
}

function shortTitle(title) {
  return title.length > 16 ? `${title.slice(0, 16)}...` : title;
}

function parseBucketDate(bucket) {
  if (!bucket) return null;
  const date = new Date(String(bucket).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

function inferredPublishDate(note) {
  const hourlyBuckets = state.data.hourlyMetrics
    .filter((row) => row.noteKey === note.noteKey)
    .map((row) => row.bucket)
    .sort();
  const date = parseBucketDate(hourlyBuckets[0]);
  if (date) return date;
  return parseBucketDate(`${note.firstMetricDate || ""} 12:00`);
}

function publishMetricValue(note, metric) {
  if (metric === "followRate") return note.followRate || 0;
  return note[metric] || 0;
}

function publishNotes() {
  return state.data.notes
    .map((note) => {
      const publishedAt = inferredPublishDate(note);
      if (!publishedAt) return null;
      return {
        ...note,
        publishedAt,
        publishWeekday: publishedAt.getDay(),
        publishHour: publishedAt.getHours()
      };
    })
    .filter(Boolean);
}

function publishSlots() {
  const slots = new Map();
  for (const note of publishNotes()) {
    const key = `${note.publishWeekday}-${note.publishHour}`;
    const slot = slots.get(key) || {
      key,
      weekday: note.publishWeekday,
      hour: note.publishHour,
      notes: [],
      impressions: 0,
      interactions: 0,
      followRate: 0
    };
    slot.notes.push(note);
    slot.impressions += note.impressions || 0;
    slot.interactions += note.interactions || 0;
    slot.followRate += note.followRate || 0;
    slots.set(key, slot);
  }

  return [...slots.values()].map((slot) => {
    const count = slot.notes.length || 1;
    return {
      ...slot,
      noteCount: slot.notes.length,
      avgImpressions: slot.impressions / count,
      avgInteractions: slot.interactions / count,
      avgFollowRate: slot.followRate / count,
      topNote: [...slot.notes].sort((a, b) => publishMetricValue(b, state.publishMetric) - publishMetricValue(a, state.publishMetric))[0]
    };
  });
}

function slotMetricValue(slot, metric) {
  if (metric === "impressions") return slot.avgImpressions;
  if (metric === "interactions") return slot.avgInteractions;
  return slot.avgFollowRate;
}

function formatPublishSlot(slot) {
  return `${WEEKDAY_LABELS[slot.weekday]} ${String(slot.hour).padStart(2, "0")}:00`;
}

function funnelRates(note) {
  return ContentDiagnostics.contentRates(note);
}

function benchmarkFor(note) {
  if (!state.benchmarkCache.has(note.noteKey)) {
    state.benchmarkCache.set(
      note.noteKey,
      ContentDiagnostics.buildRelativeBenchmark(state.data.notes, note)
    );
  }
  return state.benchmarkCache.get(note.noteKey);
}

function funnelDiagnostics(note) {
  return ContentDiagnostics.contentDiagnostics(note, benchmarkFor(note));
}

function funnelSteps(note) {
  const rates = funnelRates(note);
  return {
    entry: [
      { key: "impressions", name: "曝光", value: rates.impressions, rate: 1 },
      { key: "views", name: "观看", value: rates.views, rate: rates.viewRate }
    ],
    branches: ContentDiagnostics.behaviorBranches(note)
  };
}

function selectedFunnelNote() {
  if (!state.funnelNoteKey && state.data.notes.length > 0) {
    state.funnelNoteKey = state.data.notes[0].noteKey;
  }
  return state.data.notes.find((note) => note.noteKey === state.funnelNoteKey) || state.data.notes[0];
}

function emptyReview() {
  return {
    ...Object.fromEntries(Object.keys(REVIEW_FIELD_META).map((field) => [field, []])),
    videoDurationSeconds: 0,
    seriesName: "",
    firstFiveSecondsNote: "",
    endingCtaNote: "",
    notes: "",
    isTrendTracking: false,
    hasPersonOnCamera: false,
    hasFollowCta: false
  };
}

function reviewLabels(review) {
  if (!review) return [];
  return [
    ...Object.keys(REVIEW_FIELD_META).flatMap((field) => review[field] || []),
    review.seriesName && `系列：${review.seriesName}`,
    review.isTrendTracking && "热点追踪",
    review.hasPersonOnCamera && "真人出镜",
    review.hasFollowCta && "有关注引导"
  ].filter(Boolean);
}

function cesScoreFor(note) {
  return (note.likes || 0)
    + (note.collects || 0)
    + (note.comments || 0) * 4
    + (note.shares || 0) * 4
    + (note.followersGained || 0) * 8;
}

function noteCompareRecord(note) {
  const impressions = note.impressions || 0;
  const views = note.views || 0;
  const likes = note.likes || 0;
  const comments = note.comments || 0;
  const collects = note.collects || 0;
  const shares = note.shares || 0;
  const followersGained = note.followersGained || 0;
  const interactions = likes + comments + collects + shares;
  const publishedAt = inferredPublishDate(note);
  const funnelTags = funnelDiagnostics(note).map((item) => item.type);
  const manualLabels = reviewLabels(note.review);
  const labels = [...new Set([...manualLabels, ...funnelTags])];
  const contentTypes = note.review?.contentTypes || [];

  return {
    note,
    title: note.title || "",
    publishedAt,
    publishedAtText: publishedAt ? publishedAt.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }) : note.firstMetricDate || "-",
    type: contentTypes.length > 0 ? contentTypes.join(" / ") : "未标注",
    labels,
    review: note.review,
    formats: note.review?.formats || [],
    hooks: note.review?.hooks || [],
    coverStyles: note.review?.coverStyles || [],
    firstFiveSecondStructures: note.review?.firstFiveSecondStructures || [],
    targetActions: note.review?.targetActions || [],
    audiences: note.review?.audiences || [],
    impressions,
    views,
    officialCoverClickRate: officialCoverClickRate(note),
    viewRate: impressions ? views / impressions : 0,
    avgWatchSeconds: note.avgWatchSeconds || 0,
    likes,
    comments,
    collects,
    shares,
    followersGained,
    cesScore: note.cesScore ?? cesScoreFor(note),
    interactionRate: views ? interactions / views : 0,
    followRate: views ? followersGained / views : 0,
    collectRate: views ? collects / views : 0,
    spreadRate: views ? shares / views : 0
  };
}

function notesCompareRecords() {
  const query = state.notesCompareSearch.trim().toLowerCase();
  const rows = state.data.notes
    .map(noteCompareRecord)
    .filter((record) => {
      if (state.notesCompareTag !== "all" && !record.labels.includes(state.notesCompareTag)) return false;
      if (!query) return true;
      return `${record.title} ${record.type} ${record.labels.join(" ")}`.toLowerCase().includes(query);
    });
  return sortRows(rows, "notes", {
    labels: (record) => record.labels.join(" ")
  });
}

function allCompareTags() {
  return [...new Set(state.data.notes.flatMap((note) => noteCompareRecord(note).labels))].filter(Boolean).sort();
}

function officialCoverClickRate(note) {
  const hasOfficialValue = note.hasOfficialCoverClickRate || Number(note.coverClickRatePct || 0) > 0;
  if (!hasOfficialValue) return null;
  return normalizeRate(note.coverClickRatePct);
}

function coverRecord(note) {
  const impressions = Math.max(0, note.impressions || 0);
  const views = Math.max(0, note.views || 0);
  const officialRate = officialCoverClickRate(note);
  const viewExposureRate = impressions ? views / impressions : 0;
  const coverClicks = officialRate == null ? null : Math.round(impressions * officialRate);
  const interactionRate = note.interactionRate || 0;
  const collectRate = note.collectRate || 0;
  const benchmark = benchmarkFor(note);
  const rates = funnelRates(note);
  const entryMetric = officialRate != null
    && benchmark.metrics.officialCoverClickRate?.count >= ContentDiagnostics.BENCHMARK_CONFIG.minimumPeers
    ? "officialCoverClickRate"
    : "viewRate";
  const entryComparison = ContentDiagnostics.compareMetric(
    rates[entryMetric],
    benchmark.metrics[entryMetric],
    "high"
  );
  const exposureComparison = ContentDiagnostics.compareMetric(
    impressions,
    benchmark.metrics.impressions,
    "high"
  );
  const interactionComparison = ContentDiagnostics.compareMetric(
    interactionRate,
    benchmark.metrics.interactionRate,
    "high"
  );
  const diagnostics = [];

  if (!benchmark.sufficient) {
    diagnostics.push("基准积累中");
  } else {
    if (entryComparison?.band === "high") diagnostics.push("入口转化同类前 25%");
    if (exposureComparison?.band === "high" && entryComparison?.band === "low") diagnostics.push("分发高但入口偏弱");
    if (entryComparison?.band === "high" && interactionComparison?.band === "low") diagnostics.push("入口强内容承接弱");
    if (entryComparison?.band === "low" && interactionComparison?.band === "high") diagnostics.push("入口偏弱内容潜力高");
    if (officialRate == null) diagnostics.push("缺少官方封面点击率");
  }
  if (diagnostics.length === 0) diagnostics.push("处于同类正常区间");

  return {
    note,
    title: note.title || "",
    coverImageUrl: note.coverImageUrl || "",
    coverAlt: note.coverAlt || note.title || "",
    officialCoverClickRate: officialRate,
    officialCoverClickRatePct: officialRate == null ? null : officialRate * 100,
    viewExposureRate,
    viewExposureRatePct: viewExposureRate * 100,
    coverClicks,
    impressions,
    views,
    interactionRate,
    collectRate,
    benchmark,
    entryMetric,
    entryComparison,
    entryRelative: entryComparison?.relativeToMedian ?? null,
    diagnostics,
    diagnosticsText: diagnostics.join(" ")
  };
}

function coverRecords() {
  return sortRows(state.data.notes.map(coverRecord), "cover", {
    diagnostics: (record) => record.diagnosticsText
  });
}

function coverThumb(record) {
  if (record.coverImageUrl) {
    return `<img src="${escapeHtml(record.coverImageUrl)}" alt="${escapeHtml(record.coverAlt)}" loading="lazy" referrerpolicy="no-referrer" />`;
  }
  return `<div class="cover-placeholder">${escapeHtml(shortTitle(record.title).slice(0, 8))}</div>`;
}

function renderCoverChart() {
  const element = document.getElementById("coverChart");
  if (!element) return;
  if (!state.coverChart) {
    state.coverChart = echarts.init(element, null, { renderer: "canvas" });
    window.addEventListener("resize", () => state.coverChart.resize());
  }

  const rows = coverRecords().filter((row) => row.officialCoverClickRate != null).slice(0, 12).reverse();
  state.coverChart.setOption({
    color: ["#7c5cff", "#4d9cff"],
    grid: { left: 132, right: 30, top: 34, bottom: 36 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params) => {
        const row = rows[params[0].dataIndex];
        return `${escapeHtml(row.title)}<br/>官方封面点击率：${formatOptionalPct(row.officialCoverClickRate)}<br/>观看曝光比：${formatPct(row.viewExposureRate)}<br/>曝光：${formatNumber(row.impressions)}<br/>观看：${formatNumber(row.views)}`;
      }
    },
    xAxis: {
      type: "value",
      axisLabel: { color: "#7b8497", formatter: (value) => `${value}%` },
      splitLine: { lineStyle: { color: "#edf0f7", type: "dashed" } }
    },
    yAxis: {
      type: "category",
      data: rows.map((row) => shortTitle(row.title)),
      axisLabel: { color: "#566074", width: 118, overflow: "truncate" },
      axisLine: { lineStyle: { color: "#e4e8f1" } }
    },
    series: [{
      name: "官方封面点击率",
      type: "bar",
      barWidth: 14,
      data: rows.map((row) => Number(row.officialCoverClickRatePct.toFixed(2))),
      label: {
        show: true,
        position: "right",
        formatter: (params) => `${params.value.toFixed(1)}%`
      },
      itemStyle: { borderRadius: [0, 4, 4, 0] }
    }]
  }, true);
}

function renderCoverInsights() {
  const list = document.getElementById("coverInsightList");
  if (!list) return;
  const rows = coverRecords();
  const rowsWithOfficialRate = rows.filter((row) => row.officialCoverClickRate != null);
  const comparableRows = rows.filter((row) => row.benchmark.sufficient && row.entryRelative != null);
  const best = [...comparableRows].sort((a, b) => b.entryRelative - a.entryRelative)[0];
  const weak = comparableRows.find((row) => row.diagnostics.includes("分发高但入口偏弱"));
  const withImageCount = rows.filter((row) => row.coverImageUrl).length;
  const accumulatingCount = rows.filter((row) => !row.benchmark.sufficient).length;
  const items = [
    best && `相对同类入口表现最好：${shortTitle(best.title)}，${best.entryMetric === "officialCoverClickRate" ? "官方封面点击率" : "观看曝光比"}比其基准中位数高 ${Math.max(0, best.entryRelative * 100).toFixed(0)}%。`,
    weak && `分发高但入口偏弱：${shortTitle(weak.title)}，比${weak.benchmark.label}的入口中位数低 ${Math.abs(weak.entryRelative * 100).toFixed(0)}%，优先复盘封面和标题。`,
    rowsWithOfficialRate.length
      ? "官方封面点击率优先与同系列或同类内容比较；缺少足够同类样本时回退到最近 30 篇。"
      : "当前数据缺少平台原始封面点击率，暂用观看曝光比做账号内相对比较。",
    accumulatingCount > 0 && `${formatNumber(accumulatingCount)} 篇内容的可比历史不足，暂只展示数据，不输出强结论。`,
    withImageCount ? `已匹配到 ${formatNumber(withImageCount)} 张封面图，可直接做视觉对比。` : "当前旧数据还没有封面图；重新运行导出后会尝试从详情页记录封面 URL。"
  ].filter(Boolean);
  list.innerHTML = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderCoverTable() {
  const tbody = document.getElementById("coverBody");
  if (!tbody) return;
  const rows = coverRecords();
  const pageRows = paginatedRows(rows, "cover");
  tbody.innerHTML = pageRows.map((record) => `
    <tr>
      <td>${coverThumb(record)}</td>
      <td><div class="note-title">${escapeHtml(record.title)}</div></td>
      <td><div class="metric-main">${formatOptionalPct(record.officialCoverClickRate)}</div></td>
      <td><div class="metric-main">${formatPct(record.viewExposureRate)}</div><div class="metric-sub">${formatNumber(record.views)} / ${formatNumber(record.impressions)}</div></td>
      <td><div class="metric-main">${formatOptionalNumber(record.coverClicks)}</div></td>
      <td><div class="metric-main">${formatNumber(record.impressions)}</div></td>
      <td><div class="metric-main">${formatNumber(record.views)}</div></td>
      <td><div class="metric-main">${formatPct(record.interactionRate)}</div></td>
      <td><div class="metric-main">${formatPct(record.collectRate)}</div></td>
      <td>
        <div class="tags">
          ${record.diagnostics.map((item) => `<span class="tag ${tagClass(item)}">${escapeHtml(item)}</span>`).join("")}
        </div>
      </td>
    </tr>
  `).join("");
  renderPagination("cover", rows.length);
  updateSortHeaders("cover");
}

function renderCoverAnalysis() {
  renderCoverChart();
  renderCoverInsights();
  renderCoverTable();
}

function renderSummary() {
  const summary = state.data.summary;
  document.getElementById("noteCount").textContent = formatNumber(summary.noteCount);
  document.getElementById("totalImpressions").textContent = formatNumber(summary.totalImpressions);
  document.getElementById("totalViews").textContent = formatNumber(summary.totalViews);
  document.getElementById("totalInteractions").textContent = formatNumber(summary.totalInteractions);
  document.getElementById("syncMeta").textContent = `最近导入 ${new Date(summary.generatedAt).toLocaleString("zh-CN")}，跳过 ${summary.skippedFileCount} 个重复或失败文件`;
}

function renderLifecycleChart() {
  const element = document.getElementById("lifecycleChart");
  if (!state.chart) {
    state.chart = echarts.init(element, null, { renderer: "canvas" });
    window.addEventListener("resize", () => state.chart.resize());
  }

  const notes = chartNotes();
  const metric = state.chartMetric;
  const series = notes.map((note) => ({
    name: shortTitle(note.title),
    type: "line",
    smooth: true,
    symbolSize: 7,
    emphasis: { focus: "series" },
    data: MILESTONES.map((milestone) => {
      const status = milestoneStatus(note.noteKey, milestone, metric);
      const value = milestoneDisplayValue(note.noteKey, milestone, metric);
      if (value == null) return null;
      return {
        value,
        lifecycleStatus: status,
        itemStyle: status === "partial" ? { opacity: 0.45, borderType: "dashed" } : undefined
      };
    })
  }));

  state.chart.setOption({
    color: ["#6c5ce7", "#4d9cff", "#2fc38c", "#ffb347"],
    grid: { left: 54, right: 24, top: 42, bottom: 70 },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const title = params[0]?.axisValueLabel || "";
        const lines = params
          .filter((item) => item.value != null)
          .map((item) => {
            const status = item.data?.lifecycleStatus;
            const suffix = status === "partial" ? "（数据未完整，仅已记录）" : "";
            return `${item.marker}${escapeHtml(item.seriesName)}：${metricFormatter(metric, item.value)}${suffix}`;
          });
        return [title, ...lines].join("<br/>");
      }
    },
    legend: {
      bottom: 14,
      type: "scroll",
      icon: "roundRect",
      itemWidth: 22,
      itemHeight: 4,
      textStyle: { color: "#566074", fontSize: 12 }
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: MILESTONE_LABELS,
      axisLine: { lineStyle: { color: "#e4e8f1" } },
      axisLabel: { color: "#7b8497" }
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: "#7b8497",
        formatter: (value) => metric.endsWith("Rate") ? `${value * 100}%` : formatNumber(value)
      },
      splitLine: { lineStyle: { color: "#edf0f7", type: "dashed" } }
    },
    series
  }, true);
}

function renderInsights() {
  const notes = state.data.notes;
  const completeM24 = notes.filter((note) => isCompleteValue(lifecycleProfile(note).m24));
  const completeTail = notes.filter((note) => isCompleteValue(lifecycleProfile(note).tailShare));
  const fastest = [...completeM24].sort((a, b) => lifecycleProfile(b).m24 - lifecycleProfile(a).m24)[0];
  const strongestTail = [...completeTail].sort((a, b) => lifecycleProfile(b).tailShare - lifecycleProfile(a).tailShare)[0];
  const fastestProfile = fastest ? lifecycleProfile(fastest) : null;
  const tailProfile = strongestTail ? lifecycleProfile(strongestTail) : null;

  const items = [
    fastest && `账号内 24 小时互动最高：${shortTitle(fastest.title)}，${formatNumber(fastestProfile.m24)}。`,
    strongestTail && `账号内长尾增量占比最高：${shortTitle(strongestTail.title)}，7-14 天增量占比 ${formatPct(tailProfile.tailShare)}。`,
    (!fastest || !strongestTail) && "部分笔记的时间序列窗口未完整覆盖，已停止参与生命周期判断。",
    "曝光/观看的 1小时、6小时数据官方导出未提供，早期判断优先看互动、收藏、评论、涨粉。",
    "生命周期标签按同系列、同类内容或最近 30 篇的四分位判断，不使用固定互动数或固定比例。"
  ].filter(Boolean);

  document.getElementById("insightList").innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function lifecycleTableRecords() {
  return filteredNotes().map((note) => {
    const profile = lifecycleProfile(note);
    const uplift = isCompleteValue(profile.m14) && isCompleteValue(profile.m7) ? Math.max(0, profile.m14 - profile.m7) : null;
    return {
      note,
      profile,
      title: note.title || "",
      tagsText: profile.tags.join(" "),
      m24: profile.m24Display,
      m14: profile.m14Display,
      earlyShare: profile.earlyShare,
      uplift,
      tailShare: profile.tailShare,
      impressions: note.impressions || 0,
      views: note.views || 0,
      interactions: note.interactions || 0,
      interactionRate: note.interactionRate || 0,
      collectRate: note.collectRate || 0
    };
  });
}

function renderTable() {
  const tbody = document.getElementById("notesBody");
  if (!tbody) return;
  const rows = sortRows(lifecycleTableRecords(), "lifecycle", {
    tags: (record) => record.tagsText
  });
  const pageRows = paginatedRows(rows, "lifecycle");

  tbody.innerHTML = pageRows.map((record) => {
    const { note, profile, uplift } = record;
    const upliftStatus = isCompleteValue(uplift) ? "complete" : (profile.m7Status === "missing" || profile.m14Status === "missing" ? "missing" : "partial");
    const earlyShareStatus = isCompleteValue(profile.earlyShare) ? "complete" : (profile.m24Status === "missing" || profile.m14Status === "missing" ? "missing" : "partial");
    return `
      <tr>
        <td class="check-col">
          <input type="checkbox" data-note="${note.noteKey}" ${state.selected.has(note.noteKey) ? "checked" : ""} />
        </td>
        <td>
          <div class="note-title">${note.title}</div>
          <div class="note-sub">首个数据日 ${note.firstMetricDate || "-"}</div>
        </td>
        <td>
          <div class="tags">
            ${profile.tags.map((tag) => `<span class="tag ${tagClass(tag)}">${tag}</span>`).join("")}
          </div>
        </td>
        <td>${formatLifecycleValue(profile.m24, profile.m24Status, formatNumber, profile.m24Raw)}</td>
        <td>${formatLifecycleValue(profile.m14, profile.m14Status, formatNumber, profile.m14Raw)}</td>
        <td>${formatLifecycleValue(profile.earlyShare, earlyShareStatus, formatPct)}</td>
        <td>${formatLifecycleValue(uplift, upliftStatus)}<div class="metric-sub">${isCompleteValue(profile.tailShare) ? formatPct(profile.tailShare) : ""}</div></td>
        <td><div class="metric-main">${formatNumber(note.impressions)}</div></td>
        <td><div class="metric-main">${formatNumber(note.views)}</div></td>
        <td><div class="metric-main">${formatPct(note.interactionRate)}</div></td>
        <td><div class="metric-main">${formatPct(note.collectRate)}</div></td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const key = event.currentTarget.dataset.note;
      if (event.currentTarget.checked) {
        if (state.selected.size >= 4) {
          event.currentTarget.checked = false;
          return;
        }
        state.selected.add(key);
      } else {
        state.selected.delete(key);
      }
      renderLifecycleChart();
    });
  });
  renderPagination("lifecycle", rows.length);
  updateSortHeaders("lifecycle");
}

function renderPublishHeatmap() {
  const element = document.getElementById("publishHeatmapChart");
  if (!element) return;
  if (!state.publishChart) {
    state.publishChart = echarts.init(element, null, { renderer: "canvas" });
    window.addEventListener("resize", () => state.publishChart.resize());
  }

  const metric = state.publishMetric;
  const slots = publishSlots();
  const slotByKey = new Map(slots.map((slot) => [slot.key, slot]));
  const values = [];
  for (let day = 0; day < 7; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const slot = slotByKey.get(`${day}-${hour}`);
      values.push([
        hour,
        day,
        slot ? slotMetricValue(slot, metric) : null,
        slot ? slot.noteCount : 0,
        slot ? formatPublishSlot(slot) : `${WEEKDAY_LABELS[day]} ${String(hour).padStart(2, "0")}:00`
      ]);
    }
  }
  const maxValue = Math.max(1, ...values.map((item) => Number(item[2] || 0)));

  state.publishChart.setOption({
    color: ["#735cff"],
    grid: { left: 64, right: 28, top: 30, bottom: 112 },
    tooltip: {
      formatter: (params) => {
        const [hour, day, value, count, label] = params.value;
        const formatted = metric.endsWith("Rate") ? formatPct(value || 0) : formatNumber(value || 0);
        return `${label}<br/>${PUBLISH_METRIC_LABELS[metric]}：${formatted}<br/>笔记数：${count}`;
      }
    },
    xAxis: {
      type: "category",
      data: Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`),
      splitArea: { show: true },
      axisLabel: { color: "#65717e", interval: 1 }
    },
    yAxis: {
      type: "category",
      data: WEEKDAY_LABELS,
      splitArea: { show: true },
      axisLabel: { color: "#65717e" }
    },
    visualMap: {
      min: 0,
      max: maxValue,
      dimension: 2,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 24,
      inRange: { color: ["#f4f2ff", "#d9d1ff", "#a997ff", "#6c5ce7"] },
      formatter: (value) => metric.endsWith("Rate") ? formatPct(value) : formatNumber(value)
    },
    series: [{
      name: PUBLISH_METRIC_LABELS[metric],
      type: "heatmap",
      data: values,
      encode: { x: 0, y: 1, value: 2 },
      label: {
        show: true,
        color: "#26333f",
        formatter: (params) => {
          const value = params.value[2];
          if (value == null) return "";
          return metric.endsWith("Rate") ? formatPct(value) : formatNumber(value);
        }
      },
      emphasis: {
        itemStyle: {
          borderColor: "#17202a",
          borderWidth: 1
        }
      }
    }]
  }, true);
}

function renderPublishInsights() {
  const list = document.getElementById("publishInsightList");
  if (!list) return;
  const metric = state.publishMetric;
  const ranked = publishSlots()
    .filter((slot) => slot.noteCount > 0)
    .sort((a, b) => slotMetricValue(b, metric) - slotMetricValue(a, metric));

  const best = ranked[0];
  const second = ranked[1];
  const items = [
    best && `当前最优时间段：${formatPublishSlot(best)}，${PUBLISH_METRIC_LABELS[metric]} ${metricFormatter(metric, slotMetricValue(best, metric))}，样本 ${best.noteCount} 篇。`,
    second && `备选时间段：${formatPublishSlot(second)}，${PUBLISH_METRIC_LABELS[metric]} ${metricFormatter(metric, slotMetricValue(second, metric))}。`,
    "发布时间按每篇笔记最早出现的小时数据推断；样本少的格子适合做候选，不宜直接定论。",
    "建议把曝光、互动、涨粉效率分开看：曝光看分发入口，互动看内容钩子，涨粉效率看选题和账号匹配度。"
  ].filter(Boolean);

  list.innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function renderPublishTable() {
  const tbody = document.getElementById("publishSlotBody");
  if (!tbody) return;
  const rows = publishSlots()
    .filter((slot) => slot.noteCount > 0)
    .map((slot) => ({
      ...slot,
      slotLabel: formatPublishSlot(slot),
      topNoteTitle: slot.topNote ? slot.topNote.title : ""
    }));
  const sortedRows = sortRows(rows, "publish");
  const pageRows = paginatedRows(sortedRows, "publish");

  tbody.innerHTML = pageRows.map((slot) => `
    <tr>
      <td>${formatPublishSlot(slot)}</td>
      <td><div class="metric-main">${formatNumber(slot.noteCount)}</div></td>
      <td><div class="metric-main">${formatNumber(slot.avgImpressions)}</div></td>
      <td><div class="metric-main">${formatNumber(slot.avgInteractions)}</div></td>
      <td><div class="metric-main">${formatPct(slot.avgFollowRate)}</div></td>
      <td><div class="note-title">${slot.topNote ? shortTitle(slot.topNote.title) : "-"}</div></td>
    </tr>
  `).join("");
  renderPagination("publish", sortedRows.length);
  updateSortHeaders("publish");
}

function renderPublishAnalysis() {
  renderPublishHeatmap();
  renderPublishInsights();
  renderPublishTable();
}

function renderFunnelSelect() {
  const select = document.getElementById("funnelNoteSelect");
  if (!select) return;
  if (!state.funnelNoteKey && state.data.notes.length > 0) {
    state.funnelNoteKey = state.data.notes[0].noteKey;
  }
  select.innerHTML = state.data.notes.map((note) => (
    `<option value="${note.noteKey}" ${note.noteKey === state.funnelNoteKey ? "selected" : ""}>${shortTitle(note.title)}</option>`
  )).join("");
}

function renderFunnelChart() {
  const element = document.getElementById("funnelChart");
  if (!element) return;
  if (!state.funnelChart) {
    state.funnelChart = echarts.init(element, null, { renderer: "canvas" });
    window.addEventListener("resize", () => state.funnelChart.resize());
  }

  const note = selectedFunnelNote();
  if (!note) return;
  const steps = funnelSteps(note);
  const entry = steps.entry;
  const branches = steps.branches;
  const nodeColors = {
    impressions: "#2374d5",
    views: "#4f9f8f",
    likes: "#db6b6b",
    comments: "#8d72c7",
    collects: "#e0a533",
    shares: "#3f94c7",
    followersGained: "#c73535"
  };
  const branchPositions = [90, 255, 420, 585, 750];
  const nodes = [
    {
      ...entry[0],
      x: 420,
      y: 35,
      symbolSize: [150, 64],
      itemStyle: { color: nodeColors.impressions }
    },
    {
      ...entry[1],
      x: 420,
      y: 155,
      symbolSize: [150, 64],
      itemStyle: { color: nodeColors.views }
    },
    ...branches.map((branch, index) => ({
      ...branch,
      x: branchPositions[index],
      y: 320,
      symbolSize: [128, 62],
      itemStyle: { color: nodeColors[branch.key] }
    }))
  ];
  const links = [
    {
      source: "曝光",
      target: "观看",
      rate: entry[1].rate,
      label: `观看曝光比 ${formatPct(entry[1].rate)}`
    },
    ...branches.map((branch) => ({
      source: "观看",
      target: branch.name,
      rate: branch.rate,
      label: formatPct(branch.rate)
    }))
  ];

  state.funnelChart.setOption({
    tooltip: {
      trigger: "item",
      formatter: (params) => {
        if (params.dataType === "edge") {
          const label = params.data.source === "曝光" ? "入口转化" : "观看后行为率";
          return `${params.data.source} → ${params.data.target}<br/>${label}：${formatPct(params.data.rate)}`;
        }
        const node = nodes.find((item) => item.name === params.name);
        const rateText = node.key === "impressions"
          ? "分发入口"
          : node.key === "views"
            ? `观看曝光比：${formatPct(node.rate)}`
            : `占观看数：${formatPct(node.rate)}`;
        return `${params.name}<br/>数量：${formatNumber(node.value)}<br/>${rateText}`;
      }
    },
    series: [{
      type: "graph",
      layout: "none",
      left: "4%",
      right: "4%",
      top: 24,
      bottom: 24,
      roam: false,
      symbol: "roundRect",
      label: {
        show: true,
        color: "#fff",
        fontWeight: 700,
        lineHeight: 19,
        formatter: (params) => {
          const node = params.data;
          const suffix = node.key === "impressions"
            ? `\n${formatNumber(node.value)}`
            : node.key === "views"
              ? `\n${formatNumber(node.value)} · ${formatPct(node.rate)}`
              : `\n${formatNumber(node.value)} · ${formatPct(node.rate)}`;
          return `${node.name}${suffix}`;
        }
      },
      edgeLabel: {
        show: true,
        color: "#697684",
        fontSize: 11,
        formatter: (params) => params.data.label
      },
      lineStyle: {
        color: "#aab7c4",
        width: 2,
        curveness: 0.05
      },
      emphasis: { focus: "adjacency" },
      data: nodes,
      links
    }]
  }, true);
}

function renderFunnelInsights() {
  const list = document.getElementById("funnelInsightList");
  if (!list) return;
  const note = selectedFunnelNote();
  if (!note) {
    list.innerHTML = "<li>暂无笔记数据。</li>";
    return;
  }
  const rates = funnelRates(note);
  const benchmark = benchmarkFor(note);
  const diagnostics = funnelDiagnostics(note);
  const retention = [
    rates.hasTwoSecondExitRate && `2 秒退出率 ${formatPct(rates.twoSecondExitRate)}`,
    rates.hasCompletionRate && `完播率 ${formatPct(rates.completionRate)}`
  ].filter(Boolean);
  const items = [
    `比较基准：${benchmark.label}，可比样本 ${benchmark.peerCount} 篇${benchmark.sufficient ? "" : "（仍在积累）"}。`,
    `入口：观看曝光比 ${formatPct(rates.viewRate)}${rates.officialCoverClickRate == null ? "" : `，官方封面点击率 ${formatPct(rates.officialCoverClickRate)}`}。`,
    `观看后行为：点赞 ${formatPct(rates.likeRate)}，评论 ${formatPct(rates.commentRate)}，收藏 ${formatPct(rates.collectRate)}，分享 ${formatPct(rates.shareRate)}，关注 ${formatPct(rates.followRate)}。`,
    retention.length > 0 && `留存信号：${retention.join("，")}。`,
    ...diagnostics.map((item) => `${item.type}：${item.detail}`)
  ].filter(Boolean);
  list.innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function renderFunnelTable() {
  const tbody = document.getElementById("funnelBody");
  if (!tbody) return;
  const rows = state.data.notes.map((note) => {
    const rates = funnelRates(note);
    const diagnostics = funnelDiagnostics(note);
    return {
      note,
      title: note.title || "",
      diagnostics,
      diagnosisText: diagnostics.map((item) => item.type).join(" "),
      ...rates
    };
  });
  const sortedRows = sortRows(rows, "funnel", {
    diagnosis: (record) => record.diagnosisText
  });
  const pageRows = paginatedRows(sortedRows, "funnel");

  tbody.innerHTML = pageRows.map((record) => {
    const { note, diagnostics } = record;
    return `
      <tr data-note="${note.noteKey}">
        <td><div class="note-title">${note.title}</div></td>
        <td><div class="metric-main">${formatNumber(record.impressions)}</div></td>
        <td><div class="metric-main">${formatPct(record.viewRate)}</div><div class="metric-sub">${formatNumber(record.views)} 观看</div></td>
        <td><div class="metric-main">${formatPct(record.likeRate)}</div><div class="metric-sub">${formatNumber(record.likes)} 点赞</div></td>
        <td><div class="metric-main">${formatPct(record.commentRate)}</div><div class="metric-sub">${formatNumber(record.comments)} 评论</div></td>
        <td><div class="metric-main">${formatPct(record.collectRate)}</div><div class="metric-sub">${formatNumber(record.collects)} 收藏</div></td>
        <td><div class="metric-main">${formatPct(record.shareRate)}</div><div class="metric-sub">${formatNumber(record.shares)} 分享</div></td>
        <td><div class="metric-main">${formatPct(record.followRate)}</div><div class="metric-sub">${formatNumber(record.followersGained)} 关注</div></td>
        <td>
          <div class="tags">
            ${diagnostics.map((item) => `<span class="tag ${tagClass(item.type)}">${item.type}</span>`).join("")}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("tr[data-note]").forEach((row) => {
    row.addEventListener("click", () => {
      state.funnelNoteKey = row.dataset.note;
      renderFunnelAnalysis();
      renderView();
    });
  });
  renderPagination("funnel", sortedRows.length);
  updateSortHeaders("funnel");
}

function renderFunnelAnalysis() {
  renderFunnelSelect();
  renderFunnelChart();
  renderFunnelInsights();
  renderFunnelTable();
}

function selectedReviewNote() {
  if (!state.reviewNoteKey || !state.data.notes.some((note) => note.noteKey === state.reviewNoteKey)) {
    state.reviewNoteKey = state.data.notes[0]?.noteKey || "";
  }
  return state.data.notes.find((note) => note.noteKey === state.reviewNoteKey) || null;
}

function resetReviewDraft() {
  const note = selectedReviewNote();
  state.reviewDraft = {
    ...emptyReview(),
    ...(note?.review || {}),
    ...Object.fromEntries(Object.keys(REVIEW_FIELD_META).map((field) => [
      field,
      [...(note?.review?.[field] || [])]
    ]))
  };
}

function syncReviewDraftFromForm() {
  if (!state.reviewDraft) return;
  const value = (id) => document.getElementById(id)?.value || "";
  state.reviewDraft.videoDurationSeconds = Number(value("reviewVideoDuration")) || 0;
  state.reviewDraft.seriesName = value("reviewSeriesName").trim();
  state.reviewDraft.firstFiveSecondsNote = value("reviewFirstFiveSecondsNote").trim();
  state.reviewDraft.endingCtaNote = value("reviewEndingCtaNote").trim();
  state.reviewDraft.notes = value("reviewNotes").trim();
  state.reviewDraft.isTrendTracking = Boolean(document.getElementById("reviewTrendTracking")?.checked);
  state.reviewDraft.hasPersonOnCamera = Boolean(document.getElementById("reviewPersonOnCamera")?.checked);
  state.reviewDraft.hasFollowCta = Boolean(document.getElementById("reviewFollowCta")?.checked);
}

function reviewOptions(field) {
  const configured = state.data.reviewMetadata?.options?.[field] || [];
  const selected = state.reviewDraft?.[field] || [];
  return [...new Set([...configured, ...selected])];
}

function renderReviewFields() {
  const container = document.getElementById("noteReviewFields");
  if (!container || !state.reviewDraft) return;
  container.innerHTML = Object.entries(REVIEW_FIELD_META).map(([field, label]) => {
    const selected = new Set(state.reviewDraft[field] || []);
    return `
      <section class="review-field-group">
        <h4>${escapeHtml(label)}</h4>
        <div class="review-option-list">
          ${reviewOptions(field).map((option) => `
            <button
              class="review-option ${selected.has(option) ? "selected" : ""}"
              type="button"
              data-review-field="${field}"
              data-review-value="${encodeURIComponent(option)}"
              aria-pressed="${selected.has(option)}"
            >${escapeHtml(option)}</button>
          `).join("")}
        </div>
        <div class="review-custom-row">
          <input class="review-custom-input" data-review-custom-input="${field}" type="text" maxlength="40" placeholder="新增自定义选项" />
          <button class="button" type="button" data-review-add="${field}">添加</button>
        </div>
      </section>
    `;
  }).join("");
}

function renderNoteReviewCard() {
  const select = document.getElementById("reviewNoteSelect");
  if (!select) return;
  state.data.reviewMetadata ||= {
    updatedAt: "",
    reviewCount: 0,
    options: Object.fromEntries(Object.keys(REVIEW_FIELD_META).map((field) => [field, []]))
  };
  const note = selectedReviewNote();
  select.innerHTML = state.data.notes.map((item) => (
    `<option value="${escapeHtml(item.noteKey)}" ${item.noteKey === state.reviewNoteKey ? "selected" : ""}>${escapeHtml(shortTitle(item.title))}</option>`
  )).join("");

  if (!state.reviewDraft) resetReviewDraft();
  renderReviewFields();
  document.getElementById("reviewVideoDuration").value = state.reviewDraft.videoDurationSeconds || "";
  document.getElementById("reviewSeriesName").value = state.reviewDraft.seriesName || "";
  document.getElementById("reviewFirstFiveSecondsNote").value = state.reviewDraft.firstFiveSecondsNote || "";
  document.getElementById("reviewEndingCtaNote").value = state.reviewDraft.endingCtaNote || "";
  document.getElementById("reviewNotes").value = state.reviewDraft.notes || "";
  document.getElementById("reviewTrendTracking").checked = Boolean(state.reviewDraft.isTrendTracking);
  document.getElementById("reviewPersonOnCamera").checked = Boolean(state.reviewDraft.hasPersonOnCamera);
  document.getElementById("reviewFollowCta").checked = Boolean(state.reviewDraft.hasFollowCta);

  const reviewed = state.data.notes.filter((item) => item.review).length;
  document.getElementById("noteReviewProgress").textContent =
    `已复盘 ${reviewed}/${state.data.notes.length} 篇${note?.review?.updatedAt ? `；当前笔记上次保存于 ${new Date(note.review.updatedAt).toLocaleString("zh-CN")}` : "；当前笔记尚未标注"}`;
}

async function saveNoteReview() {
  const note = selectedReviewNote();
  if (!note) return;
  syncReviewDraftFromForm();
  const button = document.getElementById("saveNoteReviewBtn");
  const status = document.getElementById("noteReviewStatus");
  button.disabled = true;
  button.textContent = "保存中...";
  status.textContent = "";
  try {
    const response = await fetch("/api/note-reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noteKey: note.noteKey, review: state.reviewDraft })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "保存失败");
    note.review = result.review;
    state.benchmarkCache = new Map();
    state.data.reviewMetadata = {
      ...(state.data.reviewMetadata || {}),
      updatedAt: result.updatedAt,
      options: result.options,
      reviewCount: state.data.notes.filter((item) => item.review).length
    };
    resetReviewDraft();
    renderNoteReviewCard();
    renderNotesCompareFilters();
    renderNotesCompareTable();
    status.textContent = "已保存到本机";
  } catch (error) {
    status.textContent = `保存失败：${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = "保存复盘";
  }
}

function renderNotesCompareFilters() {
  const select = document.getElementById("notesCompareTag");
  if (!select) return;
  const tags = allCompareTags();
  const current = state.notesCompareTag;
  select.innerHTML = [
    '<option value="all">全部标签</option>',
    ...tags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`)
  ].join("");
  select.value = tags.includes(current) ? current : "all";
  state.notesCompareTag = select.value;
}

function renderNotesCompareTable() {
  const tbody = document.getElementById("notesCompareBody");
  if (!tbody) return;
  const rows = notesCompareRecords();
  const pageRows = paginatedRows(rows, "notes");
  tbody.innerHTML = pageRows.map((record) => `
    <tr>
      <td><div class="note-title">${escapeHtml(record.title)}</div></td>
      <td>${escapeHtml(record.publishedAtText)}</td>
      <td>${escapeHtml(record.type)}</td>
      <td>
        <div class="tags notes-tags">
          ${record.labels.map((label) => `<span class="tag ${tagClass(label)}">${escapeHtml(label)}</span>`).join("")}
        </div>
      </td>
      <td><div class="metric-main">${formatNumber(record.impressions)}</div></td>
      <td><div class="metric-main">${formatNumber(record.views)}</div></td>
      <td><div class="metric-main">${formatOptionalPct(record.officialCoverClickRate)}</div></td>
      <td><div class="metric-main">${formatPct(record.viewRate)}</div></td>
      <td><div class="metric-main">${record.avgWatchSeconds.toFixed(1)}s</div></td>
      <td><div class="metric-main">${formatNumber(record.likes)}</div></td>
      <td><div class="metric-main">${formatNumber(record.comments)}</div></td>
      <td><div class="metric-main">${formatNumber(record.collects)}</div></td>
      <td><div class="metric-main">${formatNumber(record.shares)}</div></td>
      <td><div class="metric-main">${formatNumber(record.followersGained)}</div></td>
      <td><div class="metric-main">${formatNumber(record.cesScore)}</div></td>
      <td><div class="metric-main">${formatPct(record.interactionRate)}</div></td>
      <td><div class="metric-main">${formatPct(record.followRate)}</div></td>
      <td><div class="metric-main">${formatPct(record.collectRate)}</div></td>
      <td><div class="metric-main">${formatPct(record.spreadRate)}</div></td>
      <td><button class="button review-edit-button" type="button" data-review-note="${escapeHtml(record.note.noteKey)}">${record.review ? "编辑" : "补标签"}</button></td>
    </tr>
  `).join("");
  renderPagination("notes", rows.length);
  updateSortHeaders("notes");
}

function renderNotesCompare() {
  renderNoteReviewCard();
  renderNotesCompareFilters();
  renderNotesCompareTable();
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportNotesReport() {
  const headers = [
    "标题", "发布时间", "内容类型", "标签", "形式", "核心钩子", "封面风格", "前5秒结构", "目标动作", "目标人群",
    "系列名称", "热点追踪", "真人出镜", "关注引导", "视频时长(秒)",
    "曝光", "观看", "官方封面点击率", "观看曝光比", "平均观看时长",
    "点赞", "评论", "收藏", "分享", "涨粉", "CES评分", "互动率", "转粉率", "收藏率", "传播率"
  ];
  const rows = notesCompareRecords().map((record) => [
    record.title,
    record.publishedAtText,
    record.type,
    record.labels.join("|"),
    record.formats.join("|"),
    record.hooks.join("|"),
    record.coverStyles.join("|"),
    record.firstFiveSecondStructures.join("|"),
    record.targetActions.join("|"),
    record.audiences.join("|"),
    record.review?.seriesName || "",
    record.review?.isTrendTracking ? "是" : "否",
    record.review?.hasPersonOnCamera ? "是" : "否",
    record.review?.hasFollowCta ? "是" : "否",
    record.review?.videoDurationSeconds || "",
    record.impressions,
    record.views,
    formatOptionalPct(record.officialCoverClickRate),
    formatPct(record.viewRate),
    `${record.avgWatchSeconds.toFixed(1)}s`,
    record.likes,
    record.comments,
    record.collects,
    record.shares,
    record.followersGained,
    record.cesScore,
    formatPct(record.interactionRate),
    formatPct(record.followRate),
    formatPct(record.collectRate),
    formatPct(record.spreadRate)
  ]);
  const csv = "\ufeff" + [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `xhs-notes-compare-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderView() {
  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.panel !== state.view);
  });
  const breadcrumb = document.querySelector(".breadcrumb");
  const heading = document.querySelector(".main-top h1");
  const meta = VIEW_META[state.view] || VIEW_META.lifecycle;
  breadcrumb.textContent = meta[0];
  heading.textContent = meta[1];
  if (state.view === "publish") {
    setTimeout(() => state.publishChart && state.publishChart.resize(), 0);
  } else if (state.view === "funnel") {
    setTimeout(() => state.funnelChart && state.funnelChart.resize(), 0);
  } else if (state.view === "cover") {
    setTimeout(() => state.coverChart && state.coverChart.resize(), 0);
  } else {
    setTimeout(() => state.chart && state.chart.resize(), 0);
  }
}

function render() {
  renderSummary();
  renderLifecycleChart();
  renderInsights();
  renderTable();
  renderPublishAnalysis();
  renderFunnelAnalysis();
  renderCoverAnalysis();
  renderNotesCompare();
  renderView();
}

async function loadData() {
  const response = await fetch("/api/data");
  state.data = await response.json();
  state.reviewDraft = null;
  state.benchmarkCache = new Map();
  render();
}

async function refreshImport() {
  const button = document.getElementById("refreshBtn");
  button.disabled = true;
  button.textContent = "导入中...";
  const response = await fetch("/api/import", { method: "POST" });
  state.data = await response.json();
  state.reviewDraft = null;
  state.benchmarkCache = new Map();
  button.disabled = false;
  button.textContent = "重新导入";
  render();
}

document.getElementById("refreshBtn").addEventListener("click", refreshImport);
document.getElementById("chartMetricSelect").addEventListener("change", (event) => {
  state.chartMetric = event.target.value;
  renderLifecycleChart();
});
document.getElementById("publishMetricSelect").addEventListener("change", (event) => {
  state.publishMetric = event.target.value;
  tableState("publish").sortKey = {
    impressions: "avgImpressions",
    interactions: "avgInteractions",
    followRate: "avgFollowRate"
  }[state.publishMetric] || "avgImpressions";
  tableState("publish").sortDir = "desc";
  resetTablePage("publish");
  renderPublishAnalysis();
});
document.getElementById("funnelNoteSelect").addEventListener("change", (event) => {
  state.funnelNoteKey = event.target.value;
  renderFunnelAnalysis();
});
document.getElementById("coverSortSelect").addEventListener("change", (event) => {
  state.coverSort = event.target.value;
  tableState("cover").sortKey = state.coverSort;
  tableState("cover").sortDir = "desc";
  resetTablePage("cover");
  renderCoverAnalysis();
});
document.getElementById("notesCompareSearch").addEventListener("input", (event) => {
  state.notesCompareSearch = event.target.value;
  resetTablePage("notes");
  renderNotesCompareTable();
});
document.getElementById("notesCompareSort").addEventListener("change", (event) => {
  state.notesCompareSort = event.target.value;
  tableState("notes").sortKey = state.notesCompareSort;
  tableState("notes").sortDir = "desc";
  resetTablePage("notes");
  renderNotesCompareTable();
});
document.getElementById("notesCompareTag").addEventListener("change", (event) => {
  state.notesCompareTag = event.target.value;
  resetTablePage("notes");
  renderNotesCompareTable();
});
document.getElementById("reviewNoteSelect").addEventListener("change", (event) => {
  state.reviewNoteKey = event.target.value;
  resetReviewDraft();
  renderNoteReviewCard();
});
document.getElementById("saveNoteReviewBtn").addEventListener("click", saveNoteReview);
document.getElementById("noteReviewFields").addEventListener("click", (event) => {
  const option = event.target.closest("[data-review-field][data-review-value]");
  if (option) {
    syncReviewDraftFromForm();
    const field = option.dataset.reviewField;
    const value = decodeURIComponent(option.dataset.reviewValue);
    const selected = new Set(state.reviewDraft[field] || []);
    if (selected.has(value)) selected.delete(value);
    else selected.add(value);
    state.reviewDraft[field] = [...selected];
    renderReviewFields();
    return;
  }

  const addButton = event.target.closest("[data-review-add]");
  if (!addButton) return;
  syncReviewDraftFromForm();
  const field = addButton.dataset.reviewAdd;
  const input = document.querySelector(`[data-review-custom-input="${field}"]`);
  const value = input?.value.trim();
  if (!value) return;
  state.reviewDraft[field] = [...new Set([...(state.reviewDraft[field] || []), value])];
  state.data.reviewMetadata.options[field] = [
    ...new Set([...(state.data.reviewMetadata.options[field] || []), value])
  ];
  renderReviewFields();
});
document.getElementById("exportNotesReportBtn").addEventListener("click", exportNotesReport);
document.getElementById("searchInput").addEventListener("input", (event) => {
  state.search = event.target.value;
  resetTablePage("lifecycle");
  renderTable();
  renderLifecycleChart();
});
document.getElementById("sortSelect").addEventListener("change", (event) => {
  state.sort = event.target.value;
  tableState("lifecycle").sortKey = state.sort === "interactions" ? "m14" : state.sort;
  tableState("lifecycle").sortDir = "desc";
  resetTablePage("lifecycle");
  renderTable();
  renderLifecycleChart();
});
document.getElementById("filterTabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  document.querySelectorAll("#filterTabs button").forEach((item) => item.classList.toggle("active", item === button));
  resetTablePage("lifecycle");
  renderTable();
  renderLifecycleChart();
});

document.addEventListener("click", (event) => {
  const reviewButton = event.target.closest("[data-review-note]");
  if (reviewButton) {
    state.reviewNoteKey = reviewButton.dataset.reviewNote;
    resetReviewDraft();
    renderNoteReviewCard();
    document.querySelector(".note-review-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const header = event.target.closest("th[data-table][data-sort-key]");
  if (header) {
    setTableSort(header.dataset.table, header.dataset.sortKey);
    return;
  }

  const pageButton = event.target.closest("[data-page-action]");
  if (!pageButton) return;
  const config = tableState(pageButton.dataset.table);
  if (!config) return;
  config.page += pageButton.dataset.pageAction === "next" ? 1 : -1;
  renderTableById(pageButton.dataset.table);
});

document.addEventListener("change", (event) => {
  const pageSizeSelect = event.target.closest("[data-page-size]");
  if (!pageSizeSelect) return;
  const config = tableState(pageSizeSelect.dataset.table);
  if (!config) return;
  config.pageSize = Number(pageSizeSelect.value) || 10;
  config.page = 1;
  renderTableById(pageSizeSelect.dataset.table);
});

document.querySelectorAll(".menu-item").forEach((item) => {
  item.addEventListener("click", () => {
    document.querySelectorAll(".menu-item").forEach((menu) => menu.classList.remove("active"));
    item.classList.add("active");
    state.view = VIEW_META[item.dataset.view] ? item.dataset.view : "lifecycle";
    renderView();
  });
});

loadData().catch((error) => {
  document.getElementById("syncMeta").textContent = `读取失败：${error.message}`;
});
