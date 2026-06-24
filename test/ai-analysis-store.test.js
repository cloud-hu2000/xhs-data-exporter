const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createAiAnalysisStore, hasCurrentStrategyAnalysis } = require("../src/ai-analysis-store");

assert.equal(hasCurrentStrategyAnalysis({
  suggestions: [{ title: "旧标题", whatToDo: "旧动作" }]
}), false);

assert.equal(hasCurrentStrategyAnalysis({
  suggestions: [{ delivery_title: "新版标题", recommended_actions: "新版动作" }]
}), true);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-ai-analysis-"));
const filePath = path.join(tempDir, "ai-content-analysis.json");
fs.writeFileSync(filePath, JSON.stringify({
  version: 1,
  notes: {
    "note-a": {
      title: "旧缓存",
      coverAnalysis: { summary: "保留封面分析" },
      strategyAnalysis: {
        suggestions: [{ title: "旧标题", whatToDo: "旧动作" }]
      }
    },
    "note-b": {
      title: "新缓存",
      strategyAnalysis: {
        suggestions: [{ delivery_title: "新版标题", recommended_actions: "新版动作" }]
      }
    }
  }
}), "utf8");

const store = createAiAnalysisStore(filePath);
assert.equal(store.get("note-a").coverAnalysis.summary, "保留封面分析");
assert.equal(store.get("note-a").strategyAnalysis, undefined);
assert.equal(store.get("note-b").strategyAnalysis.suggestions[0].delivery_title, "新版标题");

fs.rmSync(tempDir, { recursive: true, force: true });
console.log("ai-analysis-store tests passed");
