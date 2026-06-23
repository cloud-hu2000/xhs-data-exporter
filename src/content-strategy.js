const METRICS = [
  { key: "impressions", label: "曝光", format: "number" },
  { key: "views", label: "观看", format: "number" },
  { key: "viewRate", label: "观看曝光比", format: "rate" },
  { key: "officialCoverClickRate", label: "封面点击率", format: "rate", nullable: true },
  { key: "twoSecondExitRate", label: "2 秒退出率", format: "rate", nullable: true, lowerIsBetter: true },
  { key: "completionRate", label: "完播率", format: "rate", nullable: true },
  { key: "avgWatchSeconds", label: "平均观看时长", format: "seconds", nullable: true },
  { key: "likeRate", label: "点赞率", format: "rate" },
  { key: "collectRate", label: "收藏率", format: "rate" },
  { key: "commentRate", label: "评论率", format: "rate" },
  { key: "shareRate", label: "分享率", format: "rate" },
  { key: "followRate", label: "转粉率", format: "rate" }
];

function rate(value) {
  const number = Number(value || 0);
  return number / 100;
}

function noteMetrics(note) {
  const impressions = Number(note.impressions || 0);
  const views = Number(note.views || 0);
  return {
    impressions,
    views,
    viewRate: impressions ? views / impressions : 0,
    officialCoverClickRate: note.hasOfficialCoverClickRate || Number(note.coverClickRatePct || 0) > 0
      ? rate(note.coverClickRatePct)
      : null,
    twoSecondExitRate: Number(note.twoSecondExitRatePct || 0) > 0 ? rate(note.twoSecondExitRatePct) : null,
    completionRate: Number(note.completionRatePct || 0) > 0 ? rate(note.completionRatePct) : null,
    avgWatchSeconds: Number(note.avgWatchSeconds || 0) > 0 ? Number(note.avgWatchSeconds) : null,
    likeRate: views ? Number(note.likes || 0) / views : 0,
    collectRate: views ? Number(note.collects || 0) / views : 0,
    commentRate: views ? Number(note.comments || 0) / views : 0,
    shareRate: views ? Number(note.shares || 0) / views : 0,
    followRate: views ? Number(note.followersGained || 0) / views : 0
  };
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function formatValue(value, format) {
  if (value == null) return "-";
  if (format === "rate") return `${(value * 100).toFixed(1)}%`;
  if (format === "seconds") return `${value.toFixed(1)} 秒`;
  return new Intl.NumberFormat("zh-CN").format(Math.round(value));
}

function bandFor(value, stats) {
  if (value == null || stats.count < 2) return "unknown";
  if (value >= stats.q3) return "high";
  if (value <= stats.q1) return "low";
  return "normal";
}

function percentileRank(values, value) {
  if (value == null || values.length === 0) return null;
  const belowOrEqual = values.filter((item) => item <= value).length;
  return Math.round((belowOrEqual / values.length) * 100);
}

function buildFactDiagnostics(notes, targetNote) {
  const rows = notes.map((note) => ({ note, metrics: noteMetrics(note) }));
  const target = noteMetrics(targetNote);
  const metrics = {};
  const facts = [];

  for (const definition of METRICS) {
    const values = rows
      .map((row) => row.metrics[definition.key])
      .filter((value) => value != null && Number.isFinite(value))
      .sort((a, b) => a - b);
    const stats = {
      count: values.length,
      q1: quantile(values, 0.25),
      median: quantile(values, 0.5),
      q3: quantile(values, 0.75)
    };
    const value = target[definition.key];
    const band = bandFor(value, stats);
    const percentile = percentileRank(values, value);
    const rankLabel = band === "high"
      ? "账号内前 25%"
      : band === "low"
        ? "账号内后 25%"
        : band === "normal"
          ? "账号内中间区间"
          : "样本不足";
    const conclusion = band === "unknown"
      ? `${definition.label}暂无可比数据`
      : `${definition.label}${band === "high" ? "高" : band === "low" ? "低" : "一般"}（${rankLabel}）`;

    metrics[definition.key] = {
      key: definition.key,
      label: definition.label,
      value,
      valueText: formatValue(value, definition.format),
      median: stats.median,
      medianText: formatValue(stats.median, definition.format),
      q1: stats.q1,
      q3: stats.q3,
      band,
      percentile,
      rankLabel,
      lowerIsBetter: Boolean(definition.lowerIsBetter),
      conclusion
    };
    if (band !== "unknown") facts.push(metrics[definition.key]);
  }

  return {
    noteKey: targetNote.noteKey,
    title: targetNote.title || "",
    sampleSize: notes.length,
    generatedAt: new Date().toISOString(),
    metrics,
    facts: facts.map((item) => ({
      metric: item.key,
      label: item.label,
      conclusion: item.conclusion,
      value: item.value,
      valueText: item.valueText,
      median: item.median,
      medianText: item.medianText,
      percentile: item.percentile,
      band: item.band,
      lowerIsBetter: item.lowerIsBetter
    }))
  };
}

function compactAccountContext(notes) {
  return notes.map((note) => {
    const metrics = noteMetrics(note);
    return {
      noteKey: note.noteKey,
      title: note.title || "",
      contentTypes: note.review?.contentTypes || [],
      formats: note.review?.formats || [],
      hooks: note.review?.hooks || [],
      seriesName: note.review?.seriesName || "",
      metrics
    };
  });
}

function buildEvidenceCatalog(notes) {
  return notes.flatMap((note, noteIndex) => {
    const diagnostics = buildFactDiagnostics(notes, note);
    return diagnostics.facts.map((fact) => ({
      id: `note-${noteIndex}.${fact.metric}`,
      noteKey: note.noteKey,
      title: note.title || "",
      metric: fact.metric,
      text: `${note.title || "未命名笔记"}：${fact.conclusion}，当前值 ${fact.valueText}，账号中位数 ${fact.medianText}`
    }));
  });
}

module.exports = {
  METRICS,
  buildFactDiagnostics,
  buildEvidenceCatalog,
  compactAccountContext,
  noteMetrics,
  quantile
};
