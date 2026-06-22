const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createNoteReviewStore } = require("../src/note-review-store");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-note-review-"));
const filePath = path.join(tempDir, "note-reviews.json");
const store = createNoteReviewStore(filePath);

const saved = store.saveReview("note-1", {
  contentTypes: ["教程", "自定义拆解"],
  formats: ["口播"],
  hooks: ["反差"],
  coverStyles: ["大字冲突"],
  firstFiveSecondStructures: ["结果前置"],
  targetActions: ["收藏"],
  audiences: ["小白"],
  seriesName: "AI 小白课",
  isTrendTracking: true
});

assert.equal(saved.review.seriesName, "AI 小白课");
assert(saved.options.contentTypes.includes("自定义拆解"));

const decorated = store.decorateDatabase({
  notes: [{ noteKey: "note-1", title: "测试" }, { noteKey: "note-2", title: "未标注" }]
});
assert.equal(decorated.reviewMetadata.reviewCount, 1);
assert.deepEqual(decorated.notes[0].review.contentTypes, ["教程", "自定义拆解"]);
assert.equal(decorated.notes[1].review, null);

const reloadedStore = createNoteReviewStore(filePath);
const afterReimport = reloadedStore.decorateDatabase({
  notes: [{ noteKey: "note-1", title: "重新导入后的测试" }]
});
assert(afterReimport.reviewMetadata.options.contentTypes.includes("自定义拆解"));
assert.equal(afterReimport.notes[0].review.seriesName, "AI 小白课");

fs.rmSync(tempDir, { recursive: true, force: true });
console.log("note-review-store tests passed");
