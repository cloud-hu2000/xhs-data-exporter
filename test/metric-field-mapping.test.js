const assert = require("assert");
const XLSX = require("xlsx");
const { mergeInteraction, parseOverview, parseSeries } = require("../src/import-xhs-data");
const { resolveMetricField } = require("../src/metric-field-mapping");

for (const source of ["分享数", "笔记分享数", "转发数", "转发量", "分享量"]) {
  const result = resolveMetricField(source);
  assert.equal(result.recognized, true, `${source} should be recognized`);
  assert.equal(result.canonical, "分享数");
  assert.equal(result.id, "shares");
}

assert.equal(resolveMetricField("封面点击率(%)").canonical, "封面点击率");
assert.equal(resolveMetricField("平均观看时长（s）").canonical, "平均观看时长");
assert.equal(resolveMetricField(" 2s退出率(%) ").canonical, "2秒退出率");
assert.equal(resolveMetricField("分享数粉丝占比(%)").canonical, "分享数粉丝占比");
assert.equal(resolveMetricField("平台新增指标").recognized, false);

const overviewRows = [["指标", "数值"], ["转发数", "7"]];
const recognition = { recognized: [], unrecognized: [] };
const overview = parseOverview(overviewRows, recognition);
const note = {};
mergeInteraction(note, overview);
assert.equal(note.shares, 7, "overview aliases should populate the summary share field");

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ["日期", "笔记分享数"],
  ["2026年06月01日", "2"],
  ["2026年06月02日", "3"]
]), "分享数（天）");
const series = parseSeries(workbook, {
  noteKey: "note-1",
  title: "测试笔记",
  fileName: "interaction.xlsx"
}, "day", recognition);
assert.deepEqual(series.map((row) => row.metric), ["分享数", "分享数"]);
assert.deepEqual(series.map((row) => row.value), [2, 3]);

console.log("metric-field-mapping tests passed");
