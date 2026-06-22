const assert = require("assert");
const {
  BENCHMARK_CONFIG,
  behaviorBranches,
  buildRelativeBenchmark,
  contentDiagnostics,
  contentRates,
  metricStats
} = require("../public/content-diagnostics");

assert.equal(BENCHMARK_CONFIG.recentLimit, 30);
assert.deepEqual(metricStats([1, 2, 3, 4]), {
  count: 4,
  q25: 1.75,
  median: 2.5,
  q75: 3.25,
  mean: 2.5,
  min: 1,
  max: 4
});

const peer = (key, overrides = {}) => ({
  noteKey: key,
  impressions: 1000,
  views: 120,
  likes: 8,
  comments: 2,
  collects: 5,
  shares: 2,
  followersGained: 2,
  review: {
    contentTypes: ["AI 观点"],
    formats: ["口播"],
    seriesName: "AI 周报"
  },
  ...overrides
});

const target = peer("target", {
  impressions: 3000,
  views: 150,
  likes: 4,
  comments: 2,
  collects: 12,
  shares: 2,
  followersGained: 0
});
const notes = [
  target,
  peer("p1", { views: 150 }),
  peer("p2", { views: 180 }),
  peer("p3", { views: 210 }),
  peer("other", {
    review: { contentTypes: ["教程"], formats: ["演示"], seriesName: "别的系列" }
  })
];

const rates = contentRates(target);
assert.equal(rates.collectRate, 0.08);
assert.deepEqual(behaviorBranches(target).map((item) => item.name), ["点赞", "评论", "收藏", "分享", "关注"]);

const benchmark = buildRelativeBenchmark(notes, target);
assert.equal(benchmark.kind, "series");
assert.equal(benchmark.peerCount, 3);
const diagnoses = contentDiagnostics(target, benchmark);
assert(diagnoses.some((item) => item.type === "分发高但入口偏弱"));
assert(diagnoses.some((item) => item.type === "收藏突出但关注偏弱"));
assert(diagnoses.some((item) => item.detail.includes("中位数")));

const contentFormatTarget = peer("content-format-target", {
  review: { contentTypes: ["教程", "AI 观点"], formats: ["口播"], seriesName: "" }
});
const contentFormatPeers = [
  peer("cf1", { review: { contentTypes: ["AI 观点"], formats: ["口播"], seriesName: "" } }),
  peer("cf2", { review: { contentTypes: ["AI 观点"], formats: ["口播"], seriesName: "" } }),
  peer("cf3", { review: { contentTypes: ["AI 观点"], formats: ["口播"], seriesName: "" } })
];
assert.equal(buildRelativeBenchmark([contentFormatTarget, ...contentFormatPeers], contentFormatTarget).kind, "content-format");

const sparseTarget = peer("sparse", {
  review: { contentTypes: ["仅一篇"], formats: ["口播"], seriesName: "孤立系列" }
});
const sparseBenchmark = buildRelativeBenchmark([sparseTarget, peer("only-other")], sparseTarget);
assert.equal(sparseBenchmark.sufficient, false);
assert.equal(contentDiagnostics(sparseTarget, sparseBenchmark)[0].type, "基准积累中");

console.log("content-diagnostics tests passed");
