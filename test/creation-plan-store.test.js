const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCreationPlanStore } = require("../src/creation-plan-store");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-creation-plan-"));
const filePath = path.join(tempDir, "creation-plans.json");
const store = createCreationPlanStore(filePath);

const created = store.create({
  input: "原始口播稿",
  result: {
    input_type: "script",
    optimization_focus: "开头先给结果",
    primary_title: "三个方法排完一周选题",
    alternative_titles: ["备选一", "备选二", "多余备选"],
    cover_prompt: "竖版封面",
    opening_hook: "如果你每天不知道拍什么",
    alternative_hooks: ["钩子一", "钩子二"],
    content_structure: ["痛点", "方法", "总结"],
    image_urls: ["https://example.com/cover.jpg"],
    rewritten_markdown: "## 标题\n\n正文",
    validation_focus: "opening_retention"
  },
  references: {
    cover: {
      label: "封面点击",
      strong: [{ noteKey: "a", title: "A", coverImageUrl: "https://example.com/a.jpg" }],
      weak: []
    }
  }
});

assert(created.id);
assert.equal(created.status, "draft");
assert.equal(created.alternativeTitles.length, 2);
assert.deepEqual(created.imageUrls, ["https://example.com/cover.jpg"]);
assert.equal(store.list().length, 1);

const updated = store.update(created.id, {
  rewrittenMarkdown: "## 修改后\n\n正文",
  status: "planned"
});
assert.equal(updated.status, "planned");
assert.equal(updated.rewrittenMarkdown, "## 修改后\n\n正文");
assert.equal(store.get(created.id).primaryTitle, "三个方法排完一周选题");

fs.rmSync(tempDir, { recursive: true, force: true });
console.log("creation-plan-store tests passed");
