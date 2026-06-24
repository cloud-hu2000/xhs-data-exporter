const assert = require("assert");
const { humanizeStrategyResult, validateRecommendation } = require("../src/bailian-client");

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

const readableEvidenceCatalog = [
  {
    id: "note-0.avgWatchSeconds",
    title: "做了一个自动化外链插件帮我省时间",
    text: "placeholder"
  },
  {
    id: "note-1.commentRate",
    title: "短标题",
    text: "placeholder"
  },
  {
    id: "note-1.collectRate",
    title: "短标题",
    text: "placeholder"
  }
];

const readable = validateRecommendation({
  replicablePattern: {
    title: "note-0.avgWatchSeconds 表现好",
    explanation: "参考 note-1.commentRate"
  },
  priorityProblem: {
    title: "commentRate 仍需验证",
    explanation: "note-0 和 note-1.collectRate 可对比"
  },
  suggestions: [
    {
      delivery_title: "字段替换测试",
      cover_prompt: "",
      opening_hook: "",
      content_structure: "",
      publish_time: "",
      success_metrics: "avgWatchSeconds > 12.0秒, completionRate > 15%",
      recommended_actions: "对比 note-0 和 note-1.commentRate",
      rationale: "commentRate、collectRate 决定互动",
      data_basis: "note-0.avgWatchSeconds, 【note-1.commentRate】"
    }
  ]
}, readableEvidenceCatalog);

const longTitle = "做了一个自动化外链插件帮我省时间".slice(0, 10) + "....";
assert.equal(readable.replicablePattern.title, `【${longTitle}】的【平均观看时长】 表现好`);
assert.equal(readable.replicablePattern.explanation, "参考 【短标题】的【评论率】");
assert.equal(readable.priorityProblem.title, "【评论率】 仍需验证");
assert.equal(readable.priorityProblem.explanation, `【${longTitle}】 和 【短标题】的【收藏率】 可对比`);
assert.equal(readable.suggestions[0].success_metrics, "【平均观看时长】 > 12.0秒, 【完播率】 > 15%");
assert.equal(readable.suggestions[0].recommended_actions, `对比 【${longTitle}】 和 【短标题】的【评论率】`);
assert.equal(readable.suggestions[0].rationale, "【评论率】、【收藏率】 决定互动");
assert.equal(readable.suggestions[0].data_basis, `【${longTitle}】的【平均观看时长】, 【短标题】的【评论率】`);

const humanizedRaw = humanizeStrategyResult({
  replicablePattern: {
    title: "参考 note-0.avgWatchSeconds",
    evidenceIds: ["note-0.avgWatchSeconds"]
  },
  suggestions: [
    {
      delivery_title: "raw result 字段替换",
      success_metrics: "avgWatchSeconds > 12秒",
      recommended_actions: ["复用 note-1.commentRate", "补齐 collectRate"],
      data_basis: "note-0.avgWatchSeconds: '表现高'; note-1.commentRate: '评论率高'"
    }
  ]
}, readableEvidenceCatalog);

assert.equal(humanizedRaw.replicablePattern.title, `参考 【${longTitle}】的【平均观看时长】`);
assert.deepEqual(humanizedRaw.replicablePattern.evidenceIds, ["note-0.avgWatchSeconds"]);
assert.equal(humanizedRaw.suggestions[0].success_metrics, "【平均观看时长】 > 12秒");
assert.deepEqual(humanizedRaw.suggestions[0].recommended_actions, ["复用 【短标题】的【评论率】", "补齐 【收藏率】"]);
assert.equal(
  humanizedRaw.suggestions[0].data_basis,
  `【${longTitle}】的【平均观看时长】: '表现高'; 【短标题】的【评论率】: '评论率高'`
);

const latestLogShape = humanizeStrategyResult({
  suggestions: [
    {
      data_basis: "note-3.officialCoverClickRate（3.7%，低于中位数6.9%）、note-3.completionRate（1.9%，低于中位数7.0%）、coverAnalysis.risks（'视觉元素过多过杂'）"
    }
  ]
}, [
  {
    id: "note-3.officialCoverClickRate",
    title: "Fable 5被封禁，这是我发现的三个问题",
    text: "placeholder"
  },
  {
    id: "note-3.completionRate",
    title: "Fable 5被封禁，这是我发现的三个问题",
    text: "placeholder"
  }
]);

assert(!latestLogShape.suggestions[0].data_basis.includes("note-3"));
assert(!latestLogShape.suggestions[0].data_basis.includes("coverAnalysis"));
assert(latestLogShape.suggestions[0].data_basis.includes("的【封面点击率】"));
assert(latestLogShape.suggestions[0].data_basis.includes("的【完播率】"));
assert(latestLogShape.suggestions[0].data_basis.includes("【封面风险】"));

console.log("bailian-client tests passed");
