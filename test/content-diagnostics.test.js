const assert = require("assert");
const {
  DIAGNOSTIC_THRESHOLDS,
  behaviorBranches,
  contentDiagnostics,
  contentRates
} = require("../public/content-diagnostics");

assert.equal(DIAGNOSTIC_THRESHOLDS.minViews, 100);

const note = {
  impressions: 1000,
  views: 200,
  likes: 20,
  comments: 4,
  collects: 10,
  shares: 2,
  followersGained: 0
};
const rates = contentRates(note);
assert.equal(rates.likeRate, 0.1);
assert.equal(rates.commentRate, 0.02);
assert.equal(rates.collectRate, 0.05);
assert.equal(rates.shareRate, 0.01);
assert.equal(rates.followRate, 0);
assert.deepEqual(behaviorBranches(note).map((item) => item.name), ["点赞", "评论", "收藏", "分享", "关注"]);
assert(contentDiagnostics(note).some((item) => item.type === "高收藏低关注"));

const discussionNote = {
  impressions: 1000,
  views: 200,
  likes: 3,
  comments: 8,
  collects: 1,
  shares: 0,
  followersGained: 0
};
assert(contentDiagnostics(discussionNote).some((item) => item.type === "讨论强沉淀弱"));

console.log("content-diagnostics tests passed");
