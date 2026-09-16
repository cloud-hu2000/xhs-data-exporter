const test = require("node:test");
const assert = require("node:assert/strict");
const { audit } = require("../src/content-checker-moderation");

test("deterministic checks flag diversion, contacts and guarantees without a model key", async () => {
  const previous = process.env.DASHSCOPE_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
  const report = await audit({
    title: "全网第一减脂方法",
    body: "加薇信 13800138000，30 天包瘦",
    platform: "XIAOHONGSHU",
    images: []
  });
  if (previous) process.env.DASHSCOPE_API_KEY = previous;
  assert.equal(report.overallRisk, "HIGH");
  assert.equal(report.score, 100);
  assert.deepEqual(
    report.issues.map((issue) => issue.category).sort(),
    ["站外引流", "联系方式或外链", "效果承诺", "极限或绝对化宣传"].sort()
  );
  assert.equal(report.modelResponse.status, "skipped");
});

test("an empty draft stays invalid at the HTTP boundary, while neutral text remains publishable", async () => {
  const previous = process.env.DASHSCOPE_API_KEY;
  delete process.env.DASHSCOPE_API_KEY;
  const report = await audit({ title: "我的周末做饭记录", body: "分享今天的番茄意面做法和备菜心得。", platform: "XIAOHONGSHU", images: [] });
  if (previous) process.env.DASHSCOPE_API_KEY = previous;
  assert.equal(report.overallRisk, "LOW");
  assert.equal(report.issues.length, 0);
});
