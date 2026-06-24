const assert = require("assert");
const { validateRecommendation } = require("../src/bailian-client");

const evidenceCatalog = [
  { id: "note-1.views", text: "测试笔记：观看高，当前值 100，账号中位数 50" }
];

assert.throws(() => validateRecommendation({
  suggestions: [
    {
      title: "旧标题字段",
      whatToDo: "旧动作字段",
      why: "旧原因字段",
      validationMetric: "旧验证指标",
      evidenceIds: ["note-1.views"]
    }
  ]
}, evidenceCatalog), /旧版 suggestions 字段/);

assert.throws(() => validateRecommendation({
  suggestions: [
    {
      delivery_title: "新版标题字段",
      title: "不允许混入旧标题字段"
    }
  ]
}, evidenceCatalog), /旧版 suggestions 字段/);

const normalized = validateRecommendation({
  suggestions: [
    {
      delivery_title: "新版标题字段",
      cover_prompt: "新版封面字段",
      opening_hook: "新版开头字段",
      content_structure: "问题-方案-案例-总结",
      publish_time: "2026-07-01 10:00",
      success_metrics: "CTR>5%",
      recommended_actions: "新版动作字段",
      rationale: "新版原因字段",
      data_basis: "显式数据依据"
    }
  ]
}, evidenceCatalog);

assert.equal(normalized.suggestions[0].delivery_title, "新版标题字段");
assert.equal(normalized.suggestions[0].recommended_actions, "新版动作字段");
assert.equal(normalized.suggestions[0].rationale, "新版原因字段");
assert.equal(normalized.suggestions[0].success_metrics, "CTR>5%");
assert.equal(normalized.suggestions[0].data_basis, "显式数据依据");

const singleSuggestion = validateRecommendation({
  delivery_title: "单对象方案",
  cover_prompt: "封面关键词",
  opening_hook: "前5秒钩子",
  content_structure: "问题-方案-案例-总结",
  publish_time: "2026-07-01 10:00",
  success_metrics: "CTR>5%",
  recommended_actions: "拍摄并发布",
  rationale: "因为封面点击率低",
  data_basis: "封面点击率低于账号中位数"
}, evidenceCatalog);

assert.equal(singleSuggestion.suggestions.length, 1);
assert.equal(singleSuggestion.suggestions[0].delivery_title, "单对象方案");
assert.equal(singleSuggestion.suggestions[0].data_basis, "封面点击率低于账号中位数");

console.log("bailian-client tests passed");
