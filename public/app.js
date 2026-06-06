const state = {
  data: null,
  sort: "interactions",
  filter: "all",
  search: "",
  selected: new Set(),
  chartMetric: "interactions",
  publishMetric: "impressions",
  funnelNoteKey: "",
  notesCompareSearch: "",
  notesCompareSort: "impressions",
  notesCompareTag: "all",
  view: "lifecycle",
  chart: null,
  publishChart: null,
  funnelChart: null
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

const VIEW_META = {
  lifecycle: ["数据看板 / 生命周期对比", "笔记生命周期对比"],
  publish: ["数据看板 / 发布时间分析", "发布时间分析"],
  funnel: ["数据看板 / 漏斗分析", "漏斗分析"],
  notes: ["数据看板 / 笔记横向对比", "笔记横向对比"]
};

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Math.round(value || 0));
}

function formatPct(value) {
  return `${((value || 0) * 100).toFixed(1)}%`;
}

function metricFormatter(metric, value) {
  if (metric.endsWith("Rate")) return formatPct(value);
  return formatNumber(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function milestoneMap(noteKey) {
  const rows = state.data.lifecycleMilestones.filter((row) => row.noteKey === noteKey);
  return Object.fromEntries(rows.map((row) => [row.milestone, row]));
}

function milestoneValue(noteKey, milestone, metric) {
  return milestoneMap(noteKey)[milestone]?.[metric] || 0;
}

function lifecycleProfile(note) {
  const m24 = milestoneValue(note.noteKey, "24h", "interactions");
  const m7 = milestoneValue(note.noteKey, "7d", "interactions");
  const m14 = milestoneValue(note.noteKey, "14d", "interactions") || note.interactions || 0;
  const views14 = milestoneValue(note.noteKey, "14d", "views") || note.views || 0;
  const impressions14 = milestoneValue(note.noteKey, "14d", "impressions") || note.impressions || 0;
  const firstDayViews = milestoneValue(note.noteKey, "24h", "views");
  const firstDayImpressions = milestoneValue(note.noteKey, "24h", "impressions");
  const earlyShare = m14 ? m24 / m14 : 0;
  const tailShare = m14 ? Math.max(0, m14 - m7) / m14 : 0;
  const firstDayViewRate = firstDayImpressions ? firstDayViews / firstDayImpressions : 0;

  const tags = [];
  if (m24 >= 20 || earlyShare >= 0.45) tags.push("启动快");
  if (tailShare >= 0.18) tags.push("后劲强");
  if (earlyShare >= 0.72 && tailShare <= 0.08) tags.push("衰减快");
  if (tailShare >= 0.12 && firstDayViewRate >= 0.12) tags.push("长尾流量");
  if (tags.length === 0) tags.push("待观察");

  return {
    tags,
    m24,
    m7,
    m14,
    views14,
    impressions14,
    earlyShare,
    tailShare,
    firstDayViewRate
  };
}

function noteMatchesFilter(note) {
  const tags = lifecycleProfile(note).tags;
  if (state.filter === "fast") return tags.includes("启动快");
  if (state.filter === "tail") return tags.includes("后劲强");
  if (state.filter === "fade") return tags.includes("衰减快");
  if (state.filter === "search") return tags.includes("长尾流量");
  return true;
}

function filteredNotes() {
  const query = state.search.trim().toLowerCase();
  return [...state.data.notes]
    .filter(noteMatchesFilter)
    .filter((note) => {
      if (!query) return true;
      return `${note.title} ${note.diagnosis.join(" ")} ${lifecycleProfile(note).tags.join(" ")}`.toLowerCase().includes(query);
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
  const impressions = note.impressions || 0;
  const views = note.views || 0;
  const interactions = note.interactions || 0;
  const collects = note.collects || 0;
  const followersGained = note.followersGained || 0;
  return {
    viewRate: impressions ? views / impressions : 0,
    interactionRate: views ? interactions / views : 0,
    collectRate: interactions ? collects / interactions : 0,
    followRate: views ? followersGained / views : 0,
    collectToFollowRate: collects ? followersGained / collects : 0,
    commentToCollectRate: collects ? (note.comments || 0) / collects : (note.comments || 0),
    impressions,
    views,
    interactions,
    collects,
    followersGained
  };
}

function funnelDiagnostics(note) {
  const rates = funnelRates(note);
  const comments = note.comments || 0;
  const items = [];

  if (rates.impressions >= 800 && rates.viewRate < 0.1) {
    items.push({
      type: "高曝光低点击",
      detail: "封面/标题可能弱，建议优先测试标题钩子和封面信息密度。"
    });
  }
  if (rates.viewRate >= 0.12 && rates.interactionRate < 0.04) {
    items.push({
      type: "高观看低互动",
      detail: "内容有吸引力但共鸣不足，可以增加观点、问题或行动引导。"
    });
  }
  if (rates.collectRate >= 0.35 && rates.collectToFollowRate < 0.08 && rates.collects >= 3) {
    items.push({
      type: "高收藏低涨粉",
      detail: "工具性强，但账号人设承接弱，结尾可以强化账号价值和关注理由。"
    });
  }
  if (comments >= 2 && rates.collectRate < 0.25 && comments >= rates.collects) {
    items.push({
      type: "高评论低收藏",
      detail: "话题争议强，但实用价值不足，适合补清单、步骤或可保存结论。"
    });
  }
  if (rates.viewRate >= 0.12 && rates.followRate >= 0.004 && rates.followersGained > 0) {
    items.push({
      type: "高观看高涨粉",
      detail: "值得复刻，优先保留选题角度、开头结构和承接方式。"
    });
  }
  if (items.length === 0) {
    items.push({
      type: "待观察",
      detail: "当前漏斗没有明显断点，可以继续积累样本后再判断。"
    });
  }
  return items;
}

function funnelSteps(note) {
  const rates = funnelRates(note);
  return [
    { name: "曝光", value: rates.impressions, rate: 1 },
    { name: "观看", value: rates.views, rate: rates.viewRate },
    { name: "互动", value: rates.interactions, rate: rates.views ? rates.interactions / rates.views : 0 },
    { name: "收藏", value: rates.collects, rate: rates.interactions ? rates.collects / rates.interactions : 0 },
    { name: "涨粉", value: rates.followersGained, rate: rates.views ? rates.followersGained / rates.views : 0 }
  ];
}

function selectedFunnelNote() {
  if (!state.funnelNoteKey && state.data.notes.length > 0) {
    state.funnelNoteKey = state.data.notes[0].noteKey;
  }
  return state.data.notes.find((note) => note.noteKey === state.funnelNoteKey) || state.data.notes[0];
}

function noteContentType(note) {
  if ((note.collectRate || 0) >= 0.04 || (note.collects || 0) >= 20) return "工具/资料";
  if ((note.commentRate || 0) >= 0.01 || (note.comments || 0) >= 2) return "观点/讨论";
  if ((note.followRate || 0) >= 0.004 || (note.followersGained || 0) > 0) return "涨粉型";
  if ((note.viewRate || 0) >= 0.15) return "点击型";
  return "常规笔记";
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
  const labels = [...new Set([...(note.diagnosis || []), ...funnelTags])];

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
    type: noteContentType(note),
    labels,
    impressions,
    views,
    viewRate: impressions ? views / impressions : 0,
    avgWatchSeconds: note.avgWatchSeconds || 0,
    likes,
    comments,
    collects,
    shares,
    followersGained,
    interactionRate: views ? interactions / views : 0,
    followRate: views ? followersGained / views : 0,
    collectRate: views ? collects / views : 0,
    spreadRate: views ? shares / views : 0
  };
}

function notesCompareRecords() {
  const query = state.notesCompareSearch.trim().toLowerCase();
  return state.data.notes
    .map(noteCompareRecord)
    .filter((record) => {
      if (state.notesCompareTag !== "all" && !record.labels.includes(state.notesCompareTag)) return false;
      if (!query) return true;
      return `${record.title} ${record.type} ${record.labels.join(" ")}`.toLowerCase().includes(query);
    })
    .sort((a, b) => {
      if (state.notesCompareSort === "publishedAt") {
        return (b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0);
      }
      return Number(b[state.notesCompareSort] || 0) - Number(a[state.notesCompareSort] || 0);
    });
}

function allCompareTags() {
  return [...new Set(state.data.notes.flatMap((note) => noteCompareRecord(note).labels))].filter(Boolean).sort();
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
    data: MILESTONES.map((milestone) => milestoneValue(note.noteKey, milestone, metric))
  }));

  state.chart.setOption({
    color: ["#2f6fa9", "#c43d3d", "#87a84b", "#7358a6"],
    grid: { left: 54, right: 24, top: 42, bottom: 70 },
    tooltip: {
      trigger: "axis",
      valueFormatter: (value) => metricFormatter(metric, value)
    },
    legend: {
      bottom: 14,
      type: "scroll",
      icon: "roundRect",
      itemWidth: 22,
      itemHeight: 4,
      textStyle: { color: "#4c5a66", fontSize: 12 }
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: MILESTONE_LABELS,
      axisLine: { lineStyle: { color: "#dbe2e8" } },
      axisLabel: { color: "#65717e" }
    },
    yAxis: {
      type: "value",
      axisLabel: {
        color: "#65717e",
        formatter: (value) => metric.endsWith("Rate") ? `${value * 100}%` : formatNumber(value)
      },
      splitLine: { lineStyle: { color: "#edf1f4" } }
    },
    series
  }, true);
}

function renderInsights() {
  const notes = state.data.notes;
  const fastest = [...notes].sort((a, b) => lifecycleProfile(b).m24 - lifecycleProfile(a).m24)[0];
  const strongestTail = [...notes].sort((a, b) => lifecycleProfile(b).tailShare - lifecycleProfile(a).tailShare)[0];
  const fastestProfile = fastest ? lifecycleProfile(fastest) : null;
  const tailProfile = strongestTail ? lifecycleProfile(strongestTail) : null;

  const items = [
    fastest && `启动最快：${shortTitle(fastest.title)}，24小时互动 ${formatNumber(fastestProfile.m24)}。`,
    strongestTail && `后劲最强：${shortTitle(strongestTail.title)}，7-14天互动增量占比 ${formatPct(tailProfile.tailShare)}。`,
    "曝光/观看的 1小时、6小时数据官方导出未提供，早期判断优先看互动、收藏、评论、涨粉。",
    "曲线前段陡说明启动快；后段继续上扬说明有长尾搜索或持续推荐。"
  ].filter(Boolean);

  document.getElementById("insightList").innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function renderTable() {
  const tbody = document.getElementById("notesBody");
  const rows = filteredNotes();

  tbody.innerHTML = rows.map((note) => {
    const profile = lifecycleProfile(note);
    const uplift = Math.max(0, profile.m14 - profile.m7);
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
            ${profile.tags.map((tag) => `<span class="tag ${tag === "待观察" ? "" : "strong"}">${tag}</span>`).join("")}
          </div>
        </td>
        <td><div class="metric-main">${formatNumber(profile.m24)}</div></td>
        <td><div class="metric-main">${formatNumber(profile.m14)}</div></td>
        <td><div class="metric-main">${formatPct(profile.earlyShare)}</div></td>
        <td><div class="metric-main">${formatNumber(uplift)}</div><div class="metric-sub">${formatPct(profile.tailShare)}</div></td>
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
    color: ["#2374d5"],
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
      inRange: { color: ["#eef4f8", "#8fc3a6", "#f2c45b", "#c73535"] },
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
    .sort((a, b) => slotMetricValue(b, state.publishMetric) - slotMetricValue(a, state.publishMetric));

  tbody.innerHTML = rows.map((slot) => `
    <tr>
      <td>${formatPublishSlot(slot)}</td>
      <td><div class="metric-main">${formatNumber(slot.noteCount)}</div></td>
      <td><div class="metric-main">${formatNumber(slot.avgImpressions)}</div></td>
      <td><div class="metric-main">${formatNumber(slot.avgInteractions)}</div></td>
      <td><div class="metric-main">${formatPct(slot.avgFollowRate)}</div></td>
      <td><div class="note-title">${slot.topNote ? shortTitle(slot.topNote.title) : "-"}</div></td>
    </tr>
  `).join("");
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
  const max = Math.max(1, steps[0].value || 0);

  state.funnelChart.setOption({
    color: ["#2374d5", "#4f9f8f", "#f2c45b", "#c96f3d", "#c73535"],
    tooltip: {
      trigger: "item",
      formatter: (params) => {
        const step = steps.find((item) => item.name === params.name);
        const rateText = step.name === "曝光" ? "起点" : `上一步转化：${formatPct(step.rate)}`;
        return `${params.name}<br/>数量：${formatNumber(step.value)}<br/>${rateText}`;
      }
    },
    series: [{
      type: "funnel",
      left: "8%",
      top: 28,
      bottom: 28,
      width: "84%",
      min: 0,
      max,
      sort: "none",
      gap: 4,
      label: {
        show: true,
        position: "inside",
        formatter: (params) => `${params.name}\n${formatNumber(params.data.rawValue)}`
      },
      labelLine: { show: false },
      itemStyle: {
        borderColor: "#fff",
        borderWidth: 1
      },
      data: steps.map((step) => ({
        name: step.name,
        value: Math.max(step.value, max * 0.015),
        rawValue: step.value
      }))
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
  const diagnostics = funnelDiagnostics(note);
  const items = [
    `观看率 ${formatPct(rates.viewRate)}，互动率 ${formatPct(rates.interactionRate)}，收藏/互动 ${formatPct(rates.collectRate)}，涨粉效率 ${formatPct(rates.followRate)}。`,
    ...diagnostics.map((item) => `${item.type}：${item.detail}`)
  ];
  list.innerHTML = items.map((item) => `<li>${item}</li>`).join("");
}

function renderFunnelTable() {
  const tbody = document.getElementById("funnelBody");
  if (!tbody) return;
  const rows = [...state.data.notes].sort((a, b) => (b.impressions || 0) - (a.impressions || 0));
  tbody.innerHTML = rows.map((note) => {
    const rates = funnelRates(note);
    const diagnostics = funnelDiagnostics(note);
    return `
      <tr data-note="${note.noteKey}">
        <td><div class="note-title">${note.title}</div></td>
        <td><div class="metric-main">${formatNumber(rates.impressions)}</div></td>
        <td><div class="metric-main">${formatPct(rates.viewRate)}</div><div class="metric-sub">${formatNumber(rates.views)} 观看</div></td>
        <td><div class="metric-main">${formatPct(rates.interactionRate)}</div><div class="metric-sub">${formatNumber(rates.interactions)} 互动</div></td>
        <td><div class="metric-main">${formatPct(rates.collectRate)}</div><div class="metric-sub">${formatNumber(rates.collects)} 收藏</div></td>
        <td><div class="metric-main">${formatPct(rates.followRate)}</div><div class="metric-sub">${formatNumber(rates.followersGained)} 涨粉</div></td>
        <td>
          <div class="tags">
            ${diagnostics.map((item) => `<span class="tag ${item.type === "待观察" ? "" : "strong"}">${item.type}</span>`).join("")}
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
}

function renderFunnelAnalysis() {
  renderFunnelSelect();
  renderFunnelChart();
  renderFunnelInsights();
  renderFunnelTable();
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
  tbody.innerHTML = rows.map((record) => `
    <tr>
      <td><div class="note-title">${escapeHtml(record.title)}</div></td>
      <td>${escapeHtml(record.publishedAtText)}</td>
      <td>${escapeHtml(record.type)}</td>
      <td>
        <div class="tags notes-tags">
          ${record.labels.map((label) => `<span class="tag">${escapeHtml(label)}</span>`).join("")}
        </div>
      </td>
      <td><div class="metric-main">${formatNumber(record.impressions)}</div></td>
      <td><div class="metric-main">${formatNumber(record.views)}</div></td>
      <td><div class="metric-main">${formatPct(record.viewRate)}</div></td>
      <td><div class="metric-main">${record.avgWatchSeconds.toFixed(1)}s</div></td>
      <td><div class="metric-main">${formatNumber(record.likes)}</div></td>
      <td><div class="metric-main">${formatNumber(record.comments)}</div></td>
      <td><div class="metric-main">${formatNumber(record.collects)}</div></td>
      <td><div class="metric-main">${formatNumber(record.shares)}</div></td>
      <td><div class="metric-main">${formatNumber(record.followersGained)}</div></td>
      <td><div class="metric-main">${formatPct(record.interactionRate)}</div></td>
      <td><div class="metric-main">${formatPct(record.followRate)}</div></td>
      <td><div class="metric-main">${formatPct(record.collectRate)}</div></td>
      <td><div class="metric-main">${formatPct(record.spreadRate)}</div></td>
    </tr>
  `).join("");
}

function renderNotesCompare() {
  renderNotesCompareFilters();
  renderNotesCompareTable();
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportNotesReport() {
  const headers = [
    "标题", "发布时间", "类型", "标签", "曝光", "观看", "点击率", "平均观看时长",
    "点赞", "评论", "收藏", "分享", "涨粉", "互动率", "转粉率", "收藏率", "传播率"
  ];
  const rows = notesCompareRecords().map((record) => [
    record.title,
    record.publishedAtText,
    record.type,
    record.labels.join("|"),
    record.impressions,
    record.views,
    formatPct(record.viewRate),
    `${record.avgWatchSeconds.toFixed(1)}s`,
    record.likes,
    record.comments,
    record.collects,
    record.shares,
    record.followersGained,
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
  renderNotesCompare();
  renderView();
}

async function loadData() {
  const response = await fetch("/api/data");
  state.data = await response.json();
  render();
}

async function refreshImport() {
  const button = document.getElementById("refreshBtn");
  button.disabled = true;
  button.textContent = "导入中...";
  const response = await fetch("/api/import", { method: "POST" });
  state.data = await response.json();
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
  renderPublishAnalysis();
});
document.getElementById("funnelNoteSelect").addEventListener("change", (event) => {
  state.funnelNoteKey = event.target.value;
  renderFunnelAnalysis();
});
document.getElementById("notesCompareSearch").addEventListener("input", (event) => {
  state.notesCompareSearch = event.target.value;
  renderNotesCompareTable();
});
document.getElementById("notesCompareSort").addEventListener("change", (event) => {
  state.notesCompareSort = event.target.value;
  renderNotesCompareTable();
});
document.getElementById("notesCompareTag").addEventListener("change", (event) => {
  state.notesCompareTag = event.target.value;
  renderNotesCompareTable();
});
document.getElementById("exportNotesReportBtn").addEventListener("click", exportNotesReport);
document.getElementById("searchInput").addEventListener("input", (event) => {
  state.search = event.target.value;
  renderTable();
  renderLifecycleChart();
});
document.getElementById("sortSelect").addEventListener("change", (event) => {
  state.sort = event.target.value;
  renderTable();
  renderLifecycleChart();
});
document.getElementById("filterTabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  state.filter = button.dataset.filter;
  document.querySelectorAll("#filterTabs button").forEach((item) => item.classList.toggle("active", item === button));
  renderTable();
  renderLifecycleChart();
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
