const state = {
  data: null,
  sort: "interactions",
  filter: "all",
  search: "",
  selected: new Set(),
  chartMetric: "interactions",
  chart: null
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

function render() {
  renderSummary();
  renderLifecycleChart();
  renderInsights();
  renderTable();
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
  });
});

loadData().catch((error) => {
  document.getElementById("syncMeta").textContent = `读取失败：${error.message}`;
});
