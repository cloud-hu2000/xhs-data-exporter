(function exposeContentDiagnostics(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ContentDiagnostics = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createContentDiagnostics() {
  const BENCHMARK_CONFIG = Object.freeze({
    recentLimit: 30,
    minimumPeers: 3
  });

  const METRIC_META = Object.freeze({
    impressions: { label: "曝光", format: "number", direction: "high" },
    views: { label: "观看", format: "number", direction: "high" },
    viewRate: { label: "观看曝光比", format: "rate", direction: "high" },
    officialCoverClickRate: { label: "官方封面点击率", format: "rate", direction: "high", nullable: true },
    interactionRate: { label: "互动率", format: "rate", direction: "high" },
    likeRate: { label: "点赞率", format: "rate", direction: "high" },
    commentRate: { label: "评论率", format: "rate", direction: "high" },
    collectRate: { label: "收藏率", format: "rate", direction: "high" },
    shareRate: { label: "分享率", format: "rate", direction: "high" },
    followRate: { label: "关注率", format: "rate", direction: "high" },
    completionRate: { label: "完播率", format: "rate", direction: "high", nullable: true },
    twoSecondExitRate: { label: "2 秒退出率", format: "rate", direction: "low", nullable: true }
  });

  function pctValue(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return 0;
    return number > 1 ? number / 100 : number;
  }

  function contentRates(note) {
    const impressions = Number(note.impressions || 0);
    const views = Number(note.views || 0);
    const likes = Number(note.likes || 0);
    const comments = Number(note.comments || 0);
    const collects = Number(note.collects || 0);
    const shares = Number(note.shares || 0);
    const followersGained = Number(note.followersGained || 0);
    const interactions = likes + comments + collects + shares;
    const hasOfficialCoverClickRate = Boolean(note.hasOfficialCoverClickRate || Number(note.coverClickRatePct || 0) > 0);
    const hasCompletionRate = Number(note.completionRatePct || 0) > 0;
    const hasTwoSecondExitRate = Number(note.twoSecondExitRatePct || 0) > 0;

    return {
      impressions,
      views,
      likes,
      comments,
      collects,
      shares,
      followersGained,
      interactions,
      viewRate: impressions ? views / impressions : 0,
      interactionRate: views ? interactions / views : 0,
      likeRate: views ? likes / views : 0,
      commentRate: views ? comments / views : 0,
      collectRate: views ? collects / views : 0,
      shareRate: views ? shares / views : 0,
      followRate: views ? followersGained / views : 0,
      officialCoverClickRate: hasOfficialCoverClickRate ? pctValue(note.coverClickRatePct) : null,
      completionRate: hasCompletionRate ? pctValue(note.completionRatePct) : null,
      twoSecondExitRate: hasTwoSecondExitRate ? pctValue(note.twoSecondExitRatePct) : null,
      hasCompletionRate,
      hasTwoSecondExitRate
    };
  }

  function quantile(sortedValues, percentile) {
    if (sortedValues.length === 0) return null;
    const index = (sortedValues.length - 1) * percentile;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sortedValues[lower];
    const weight = index - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  function metricStats(values) {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    return {
      count: sorted.length,
      q25: quantile(sorted, 0.25),
      median: quantile(sorted, 0.5),
      q75: quantile(sorted, 0.75),
      mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1]
    };
  }

  function normalizedValues(values) {
    return [...new Set((values || []).map((value) => String(value).trim()).filter(Boolean))].sort();
  }

  function sharesValue(left, right) {
    const a = normalizedValues(left);
    const b = normalizedValues(right);
    return a.length > 0 && b.length > 0 && a.some((value) => b.includes(value));
  }

  function noteTimestamp(note) {
    const value = note._benchmarkDate || note.firstMetricDate || "";
    const timestamp = new Date(String(value).replace(" ", "T")).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function cohortCandidates(notes, target) {
    const others = notes.filter((note) => note.noteKey !== target.noteKey);
    const review = target.review || {};
    const cohorts = [];

    if (review.seriesName) {
      cohorts.push({
        kind: "series",
        label: `同系列“${review.seriesName}”`,
        notes: others.filter((note) => note.review?.seriesName === review.seriesName)
      });
    }
    if ((review.contentTypes || []).length > 0 && (review.formats || []).length > 0) {
      cohorts.push({
        kind: "content-format",
        label: `${review.contentTypes.join(" / ")} × ${review.formats.join(" / ")}`,
        notes: others.filter((note) => (
          sharesValue(note.review?.contentTypes, review.contentTypes)
          && sharesValue(note.review?.formats, review.formats)
        ))
      });
    }
    if ((review.contentTypes || []).length > 0) {
      cohorts.push({
        kind: "content-type",
        label: `同类“${review.contentTypes.join(" / ")}”`,
        notes: others.filter((note) => sharesValue(note.review?.contentTypes, review.contentTypes))
      });
    }
    cohorts.push({
      kind: "recent",
      label: `最近 ${Math.min(BENCHMARK_CONFIG.recentLimit, others.length)} 篇账号内容`,
      notes: [...others].sort((a, b) => noteTimestamp(b) - noteTimestamp(a)).slice(0, BENCHMARK_CONFIG.recentLimit)
    });
    return cohorts;
  }

  function selectPeerCohort(notes, target) {
    const cohorts = cohortCandidates(notes, target);
    return cohorts.find((cohort) => cohort.notes.length >= BENCHMARK_CONFIG.minimumPeers)
      || cohorts[cohorts.length - 1];
  }

  function buildRelativeBenchmark(notes, target) {
    const selected = selectPeerCohort(notes, target);
    const peerRates = selected.notes.map(contentRates);
    const metrics = {};

    for (const metric of Object.keys(METRIC_META)) {
      metrics[metric] = metricStats(peerRates.map((rates) => rates[metric]).filter((value) => value != null));
    }

    return {
      kind: selected.kind,
      label: selected.label,
      peerCount: selected.notes.length,
      sufficient: selected.notes.length >= BENCHMARK_CONFIG.minimumPeers,
      metrics
    };
  }

  function compareMetric(value, stats, direction = "high") {
    if (value == null || !stats) return null;
    const relativeToMedian = stats.median === 0
      ? (value === 0 ? 0 : null)
      : (value - stats.median) / Math.abs(stats.median);
    const band = value < stats.q25 ? "low" : value > stats.q75 ? "high" : "normal";
    return {
      value,
      band,
      relativeToMedian,
      favorable: direction === "low" ? band === "low" : band === "high",
      unfavorable: direction === "low" ? band === "high" : band === "low",
      stats
    };
  }

  function formatMetric(metric, value) {
    if (value == null) return "-";
    if (METRIC_META[metric]?.format === "number") return Math.round(value).toLocaleString("zh-CN");
    return `${(value * 100).toFixed(1)}%`;
  }

  function comparisonText(metric, comparison, benchmark) {
    if (!comparison) return "";
    const current = formatMetric(metric, comparison.value);
    const median = formatMetric(metric, comparison.stats.median);
    let difference = "与中位数持平";
    if (comparison.stats.median === 0 && comparison.value > 0) {
      difference = "高于中位数";
    } else if (comparison.relativeToMedian != null && Math.abs(comparison.relativeToMedian) >= 0.005) {
      difference = `比中位数${comparison.relativeToMedian > 0 ? "高" : "低"} ${Math.abs(comparison.relativeToMedian * 100).toFixed(0)}%`;
    }
    return `${METRIC_META[metric].label} ${current}，${difference}（${benchmark.label}中位数 ${median}，样本 ${benchmark.peerCount} 篇）`;
  }

  function contentDiagnostics(note, benchmark) {
    const rates = contentRates(note);
    if (!benchmark?.sufficient) {
      return [{
        type: "基准积累中",
        detail: `当前只有 ${benchmark?.peerCount || 0} 篇可比历史；至少积累 ${BENCHMARK_CONFIG.minimumPeers} 篇后再做相对诊断。`
      }];
    }

    const entryMetric = rates.officialCoverClickRate != null
      && benchmark.metrics.officialCoverClickRate?.count >= BENCHMARK_CONFIG.minimumPeers
      ? "officialCoverClickRate"
      : "viewRate";
    const compare = (metric) => compareMetric(rates[metric], benchmark.metrics[metric], METRIC_META[metric].direction);
    const entry = compare(entryMetric);
    const exposure = compare("impressions");
    const interaction = compare("interactionRate");
    const collect = compare("collectRate");
    const comment = compare("commentRate");
    const share = compare("shareRate");
    const follow = compare("followRate");
    const twoSecondExit = compare("twoSecondExitRate");
    const items = [];

    if (exposure?.band === "high" && entry?.band === "low") {
      items.push({
        type: "分发高但入口偏弱",
        detail: `${comparisonText(entryMetric, entry, benchmark)}。曝光已处于同类前 25%，问题更可能在封面和标题，而不是分发不足。`
      });
    }
    if (twoSecondExit?.band === "high") {
      items.push({
        type: "前段留存偏弱",
        detail: `${comparisonText("twoSecondExitRate", twoSecondExit, benchmark)}。优先检查前 5 秒是否兑现标题承诺。`
      });
    }
    if (entry?.band !== "low" && interaction?.band === "low") {
      items.push({
        type: "入口正常但互动偏弱",
        detail: `${comparisonText("interactionRate", interaction, benchmark)}。入口不弱，问题更可能在内容共鸣、价值密度或行动触发。`
      });
    }
    if (collect?.band === "high" && follow?.band === "low") {
      items.push({
        type: "收藏突出但关注偏弱",
        detail: `${comparisonText("collectRate", collect, benchmark)}；${comparisonText("followRate", follow, benchmark)}。内容有保存价值，但账号承接和持续关注理由偏弱。`
      });
    }
    if (comment?.band === "high" && collect?.band === "low") {
      items.push({
        type: "讨论突出但沉淀偏弱",
        detail: `${comparisonText("commentRate", comment, benchmark)}；${comparisonText("collectRate", collect, benchmark)}。话题性强，若目标是沉淀可补充清单、步骤或结论卡。`
      });
    }
    if (share?.band === "high" && follow?.band === "low") {
      items.push({
        type: "传播突出但关注偏弱",
        detail: `${comparisonText("shareRate", share, benchmark)}；${comparisonText("followRate", follow, benchmark)}。内容值得转发，但人设或系列承接未同步转化。`
      });
    }
    if (follow?.band === "high") {
      items.push({
        type: "关注转化位于同类前列",
        detail: `${comparisonText("followRate", follow, benchmark)}。值得复刻选题角度、表达方式和关注承接。`
      });
    }
    if (items.length === 0) {
      items.push({
        type: "处于同类正常区间",
        detail: `核心指标大多位于${benchmark.label}的中间 50% 区间，暂未发现明显异常。`
      });
    }
    return items;
  }

  function behaviorBranches(note) {
    const rates = contentRates(note);
    return [
      { key: "likes", name: "点赞", value: rates.likes, rate: rates.likeRate },
      { key: "comments", name: "评论", value: rates.comments, rate: rates.commentRate },
      { key: "collects", name: "收藏", value: rates.collects, rate: rates.collectRate },
      { key: "shares", name: "分享", value: rates.shares, rate: rates.shareRate },
      { key: "followersGained", name: "关注", value: rates.followersGained, rate: rates.followRate }
    ];
  }

  return {
    BENCHMARK_CONFIG,
    METRIC_META,
    behaviorBranches,
    buildRelativeBenchmark,
    compareMetric,
    comparisonText,
    contentDiagnostics,
    contentRates,
    metricStats,
    selectPeerCohort
  };
}));
