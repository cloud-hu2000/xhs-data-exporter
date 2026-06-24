const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createContentExperimentStore } = require("../src/content-experiment-store");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-content-experiment-"));
const filePath = path.join(tempDir, "content-experiments.json");
const store = createContentExperimentStore(filePath);

const created = store.create({
  sourceNoteKey: "note-a",
  sourceTitle: "旧笔记",
  suggestion: {
    label: "方案 A",
    deliveryTitle: "AI 工具避坑清单",
    coverPrompt: "大字标题，突出避坑",
    firstFiveSecondsOpening: "先抛出反常识结论",
    contentStructure: ["问题", "错误做法", "正确动作"],
    publishTime: "周二 20:00",
    validationMetrics: ["官方封面点击率高于账号中位数", "收藏率进入同类前 25%"],
    evidenceIds: ["note-0.views"],
    dataBasis: "历史同类内容收藏率更高"
  }
});

assert(created.id);
assert.equal(created.status, "planned");
assert.equal(created.deliveryTitle, "AI 工具避坑清单");
assert.deepEqual(created.contentStructure, ["问题", "错误做法", "正确动作"]);
assert.equal(store.list().length, 1);

const matched = store.match(created.id, {
  noteKey: "note-b",
  title: "AI 工具避坑清单发布版",
  impressions: 1000,
  views: 420,
  officialCoverClickRate: 0.12,
  viewRate: 0.42,
  interactionRate: 0.08,
  collectRate: 0.05
});

assert.equal(matched.status, "verified");
assert.equal(matched.matchedNoteKey, "note-b");
assert.equal(matched.verificationSnapshot.views, 420);
assert.equal(matched.verificationSnapshot.collectRate, 0.05);

fs.rmSync(tempDir, { recursive: true, force: true });
console.log("content-experiment-store tests passed");
