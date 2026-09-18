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

const NEXT_CONTENT_METRICS = {
  cover: {
    key: "officialCoverClickRate",
    label: "封面点击",
    lowerIsBetter: false,
    value(note) {
      const available = Boolean(note.hasOfficialCoverClickRate) || Number(note.coverClickRatePct || 0) > 0;
      return available ? rate(note.coverClickRatePct) : null;
    }
  },
  completion: {
    key: "completionRate",
    label: "内容完播",
    lowerIsBetter: false,
    value(note) {
      const available = Boolean(note.hasCompletionRate) || Number(note.completionRatePct || 0) > 0;
      return available ? rate(note.completionRatePct) : null;
    }
  }
};

const EXIT_RATE_DEFINITIONS = [
  {
    seconds: 5,
    key: "fiveSecondExitRate",
    field: "fiveSecondExitRatePct",
    flag: "hasFiveSecondExitRate"
  },
  {
    seconds: 3,
    key: "threeSecondExitRate",
    field: "threeSecondExitRatePct",
    flag: "hasThreeSecondExitRate"
  },
  {
    seconds: 2,
    key: "twoSecondExitRate",
    field: "twoSecondExitRatePct",
    flag: "hasTwoSecondExitRate"
  }
];

function hasMetricValue(note, field, flag) {
  return Boolean(note?.[flag]) || Number(note?.[field] || 0) > 0;
}

function selectExitRateMetric(notes, minimumCount = 3) {
  for (const definition of EXIT_RATE_DEFINITIONS) {
    const count = notes.filter((note) => hasMetricValue(note, definition.field, definition.flag)).length;
    if (count >= minimumCount) {
      return {
        ...definition,
        label: "开头留存",
        lowerIsBetter: true,
        count,
        value(note) {
          return hasMetricValue(note, definition.field, definition.flag)
            ? rate(note[definition.field])
            : null;
        }
      };
    }
  }
  return null;
}

function nextContentMetricDefinitions(notes) {
  const definitions = { ...NEXT_CONTENT_METRICS };
  const opening = selectExitRateMetric(notes);
  if (opening) definitions.opening = opening;
  return definitions;
}

function buildNextContentStatus(notes = []) {
  const totalNotes = notes.length;
  const opening = selectExitRateMetric(notes);
  const metricCounts = {
    cover: notes.filter((note) => NEXT_CONTENT_METRICS.cover.value(note) != null).length,
    opening: opening?.count || 0,
    completion: notes.filter((note) => NEXT_CONTENT_METRICS.completion.value(note) != null).length
  };
  const hasComparableMetric = Object.values(metricCounts).some((count) => count >= 3);
  const eligible = totalNotes >= 3 && hasComparableMetric;
  let reason = "";
  if (totalNotes < 3) reason = `还差 ${3 - totalNotes} 篇作品数据`;
  else if (!hasComparableMetric) reason = "暂时没有足够的点击率、退出率或完播率数据";
  return {
    eligible,
    totalNotes,
    minimumNotes: 3,
    remainingNotes: Math.max(0, 3 - totalNotes),
    reason,
    metricCounts,
    exitRateSeconds: opening?.seconds || null
  };
}

function noteReference(note) {
  return {
    noteKey: note.noteKey,
    title: note.title || "未命名作品",
    coverImageUrl: note.coverImageUrl || ""
  };
}

function rankedMetricGroup(notes, definition) {
  const rows = notes
    .map((note) => ({ note, value: definition.value(note) }))
    .filter((item) => item.value != null && Number.isFinite(item.value))
    .sort((left, right) => left.value - right.value);
  if (rows.length < 3) return null;
  const low = rows.slice(0, 3);
  const high = rows.slice(-3).reverse();
  const strong = definition.lowerIsBetter ? low : high;
  const weak = definition.lowerIsBetter ? high : low;
  const serialize = (items) => items.map(({ note, value }) => ({
    ...noteReference(note),
    value,
    review: note.review || null
  }));
  return {
    key: definition.key,
    label: definition.label,
    lowerIsBetter: Boolean(definition.lowerIsBetter),
    sampleSize: rows.length,
    strong: serialize(strong),
    weak: serialize(weak)
  };
}

function buildActionableEvidence(notes = [], matchedNoteKeys = []) {
  const matched = new Set(matchedNoteKeys || []);
  const selectedNotes = matched.size >= 3
    ? notes.filter((note) => matched.has(note.noteKey))
    : notes;
  const candidates = selectedNotes.length >= 3 ? selectedNotes : notes;
  const definitions = nextContentMetricDefinitions(candidates);
  const groups = Object.fromEntries(
    Object.entries(definitions)
      .map(([name, definition]) => [name, rankedMetricGroup(candidates, definition)])
      .filter(([, group]) => Boolean(group))
  );
  return {
    matchedNoteKeys: candidates.map((note) => note.noteKey),
    exitRateSeconds: definitions.opening?.seconds || null,
    groups
  };
}

function referencesForClient(evidence = {}) {
  return Object.fromEntries(
    ["cover", "opening", "completion"].map((name) => {
      const group = evidence.groups?.[name];
      const strip = (items) => (items || []).map(({ noteKey, title, coverImageUrl }) => ({ noteKey, title, coverImageUrl }));
      return [name, {
        label: group?.label || ({ cover: "封面参考", opening: "开头参考", completion: "内容结构参考" }[name]),
        strong: strip(group?.strong),
        weak: strip(group?.weak)
      }];
    })
  );
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
  buildActionableEvidence,
  buildFactDiagnostics,
  buildEvidenceCatalog,
  buildNextContentStatus,
  compactAccountContext,
  noteMetrics,
  quantile,
  referencesForClient,
  selectExitRateMetric
};
