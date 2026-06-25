const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const { writeDebugLog } = require("./debug-logger");

function config() {
  return {
    apiKey: process.env.DASHSCOPE_API_KEY || "",
    baseUrl: (process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ""),
    visionModel: process.env.DASHSCOPE_VISION_MODEL || "qwen3.6-flash",
    strategyModel: process.env.DASHSCOPE_STRATEGY_MODEL || "qwen-plus",
    asrModel: process.env.DASHSCOPE_ASR_MODEL || "qwen3-asr-flash"
  };
}

function extractJson(text) {
  const source = String(text || "").trim();
  try {
    return JSON.parse(source);
  } catch {
    const match = source.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("模型未返回有效 JSON");
    return JSON.parse(match[0]);
  }
}

async function chatCompletion({ model, messages, json = true, timeoutMs = 90000 }) {
  const settings = config();
  if (!settings.apiKey) {
    writeDebugLog("bailian", "chatCompletion.missingApiKey", { model, json, timeoutMs });
    throw new Error("未配置 DASHSCOPE_API_KEY");
  }
  const endpoint = `${settings.baseUrl}/chat/completions`;
  const requestBody = {
    model,
    messages,
    temperature: 0.25,
    ...(json ? { response_format: { type: "json_object" } } : {})
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    writeDebugLog("bailian", "chatCompletion.request", {
      endpoint,
      model,
      json,
      timeoutMs,
      body: requestBody
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    writeDebugLog("bailian", "chatCompletion.response", {
      endpoint,
      model,
      status: response.status,
      ok: response.ok,
      durationMs: Date.now() - startedAt,
      payload
    });
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || `AI请求失败（${response.status}）`);
    }
    const content = payload?.choices?.[0]?.message?.content;
    const result = json ? extractJson(content) : content;
    writeDebugLog("bailian", "chatCompletion.result", {
      model,
      durationMs: Date.now() - startedAt,
      content,
      result
    });
    return result;
  } catch (error) {
    writeDebugLog("bailian", "chatCompletion.error", {
      endpoint,
      model,
      durationMs: Date.now() - startedAt,
      error
    });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function imageInput(url) {
  if (!url) throw new Error("当前笔记没有封面 URL");
  try {
    writeDebugLog("bailian", "imageInput.request", { url });
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`图片下载失败（${response.status}）`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 10 * 1024 * 1024) throw new Error("封面图片超过 10MB");
    const mime = response.headers.get("content-type") || "image/jpeg";
    writeDebugLog("bailian", "imageInput.response", {
      url,
      status: response.status,
      mime,
      bytes: bytes.length,
      mode: "data-url"
    });
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch (error) {
    writeDebugLog("bailian", "imageInput.fallback", { url, error, mode: "remote-url" });
    return url;
  }
}

async function analyzeCover(note, facts) {
  const settings = config();
  writeDebugLog("bailian", "analyzeCover.start", {
    noteKey: note.noteKey,
    title: note.title || "",
    coverImageUrl: note.coverImageUrl || "",
    facts
  });
  const imageUrl = await imageInput(note.coverImageUrl);
  const result = await chatCompletion({
    model: settings.visionModel,
    messages: [
      {
        role: "system",
        content: "你是短视频与图文封面分析师。只分析画面中可观察到的事实，并结合提供的数据提出可验证假设。必须返回 JSON。"
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `分析这张小红书封面。标题：${note.title || ""}\n数据事实：${JSON.stringify(facts.facts)}\n返回 JSON，字段固定为：summary（string）、visualElements（string[]）、textAndPromise（string）、strengths（string[]）、risks（string[]）、hypotheses（string[]）、suggestedTests（string[]）。`
          },
          { type: "image_url", image_url: { url: imageUrl } }
        ]
      }
    ]
  });
  const analysis = { ...result, model: settings.visionModel, analyzedAt: new Date().toISOString() };
  writeDebugLog("bailian", "analyzeCover.done", {
    noteKey: note.noteKey,
    model: settings.visionModel,
    analysis
  });
  return analysis;
}

function evidenceText(ids, evidenceById) {
  const validIds = [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => evidenceById.has(id));
  return {
    evidenceIds: validIds,
    evidence: validIds.map((id) => evidenceById.get(id).text),
    dataBasis: validIds.length > 0
      ? validIds.map((id) => evidenceById.get(id).text).join("；")
      : "模型未提供可验证的数据依据"
  };
}

function normalizeTextList(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/\n|；|;/);
  return source.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeTextBlock(value) {
  if (Array.isArray(value)) return normalizeTextList(value).join("\uFF1B");
  if (value && typeof value === "object") {
    return Object.entries(value)
      .map(([key, entry]) => `${key}: ${typeof entry === "string" ? entry : JSON.stringify(entry)}`)
      .join("\uFF1B");
  }
  return String(value || "").trim();
}

const SUGGESTION_FIELDS = [
  "delivery_title",
  "cover_prompt",
  "opening_hook",
  "content_structure",
  "publish_time",
  "success_metrics",
  "recommended_actions",
  "rationale",
  "data_basis"
];

const LEGACY_SUGGESTION_FIELDS = [
  "label",
  "title",
  "deliveryTitle",
  "coverPrompt",
  "firstFiveSecondsOpening",
  "firstFiveSeconds",
  "contentStructure",
  "publishTime",
  "validationMetrics",
  "validationMetric",
  "whatToDo",
  "why",
  "dataBasis",
  "evidenceIds",
  "evidence"
];

const READABLE_METRIC_LABELS = {
  impressions: "曝光",
  views: "观看",
  viewRate: "观看曝光比",
  officialCoverClickRate: "封面点击率",
  coverClickRatePct: "封面点击率",
  twoSecondExitRate: "2秒退出率",
  twoSecondExitRatePct: "2秒退出率",
  completionRate: "完播率",
  completionRatePct: "完播率",
  avgWatchSeconds: "平均观看时长",
  likes: "点赞数",
  likeRate: "点赞率",
  collects: "收藏数",
  collectRate: "收藏率",
  comments: "评论数",
  commentRate: "评论率",
  shares: "分享数",
  shareRate: "分享率",
  followersGained: "新增粉丝数",
  followRate: "转粉率"
};

const READABLE_FIELD_REFERENCES = {
  "coverAnalysis.summary": "封面总结",
  "coverAnalysis.visualElements": "封面视觉元素",
  "coverAnalysis.textAndPromise": "封面文字承诺",
  "coverAnalysis.strengths": "封面优势",
  "coverAnalysis.risks": "封面风险",
  "coverAnalysis.hypotheses": "封面假设",
  "coverAnalysis.suggestedTests": "封面测试建议",
  "selectedNote.caption": "笔记正文",
  "selectedNote.transcript": "视频转写",
  "selectedNote.review": "人工复盘",
  "ruleFacts.facts": "规则事实",
  "accountContext": "账号上下文"
};

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readableNoteTitle(title) {
  const source = String(title || "").trim() || "未命名笔记";
  return source.length > 10 ? `${source.slice(0, 10)}....` : source;
}

function buildReadableNoteTitles(evidenceCatalog) {
  const titles = new Map();
  for (const item of evidenceCatalog || []) {
    const match = String(item?.id || "").match(/^note-(\d+)\./);
    if (match && !titles.has(match[1])) {
      titles.set(match[1], readableNoteTitle(item.title));
    }
  }
  return titles;
}

function buildReadableEvidenceReferences(evidenceCatalog) {
  const references = new Map();
  for (const item of evidenceCatalog || []) {
    const id = String(item?.id || "");
    const match = id.match(/^note-(\d+)\.([A-Za-z][A-Za-z0-9_]*)$/);
    if (!match) continue;
    const [, noteIndex, metric] = match;
    const title = readableNoteTitle(item.title || `第${Number(noteIndex) + 1}篇笔记`);
    references.set(id, `${bracket(title)}的${bracket(readableMetricLabel(metric))}`);
  }
  return references;
}

function readableMetricLabel(metric) {
  return READABLE_METRIC_LABELS[metric] || metric;
}

function bracket(value) {
  return `【${value}】`;
}

function replaceEvidenceReferences(value, readableContext) {
  let output = String(value || "");
  for (const [id, label] of [...readableContext.evidenceReferences.entries()].sort((a, b) => b[0].length - a[0].length)) {
    output = output.replace(new RegExp(`【?${escapeRegExp(id)}】?`, "g"), label);
  }
  output = output.replace(/【?\bnote-(\d+)\.([A-Za-z][A-Za-z0-9_]*)\b】?/g, (match, noteIndex, metric) => {
    const title = readableContext.noteTitles.get(noteIndex) || `第${Number(noteIndex) + 1}篇笔记`;
    return `${bracket(title)}的${bracket(readableMetricLabel(metric))}`;
  });
  output = output.replace(/【?\bnote-(\d+)\b】?/g, (match, noteIndex) => {
    const title = readableContext.noteTitles.get(noteIndex) || `第${Number(noteIndex) + 1}篇笔记`;
    return bracket(title);
  });
  return output;
}

function replaceFieldReferences(value) {
  let output = String(value || "");
  for (const [key, label] of Object.entries(READABLE_FIELD_REFERENCES)) {
    output = output.replace(new RegExp(`【?${escapeRegExp(key)}】?`, "g"), bracket(label));
  }
  return output;
}

function replaceMetricReferences(value) {
  let output = String(value || "");
  for (const [key, label] of Object.entries(READABLE_METRIC_LABELS)) {
    output = output.replace(new RegExp(`【${escapeRegExp(key)}】`, "g"), bracket(label));
    output = output.replace(new RegExp(`\\[${escapeRegExp(key)}\\]`, "g"), bracket(label));
    output = output.replace(
      new RegExp(`(^|[^A-Za-z0-9_【])${escapeRegExp(key)}(?![A-Za-z0-9_】])`, "g"),
      `$1${bracket(label)}`
    );
  }
  return output;
}

function humanizeRecommendationText(value, readableContext) {
  const withReadableNotes = replaceEvidenceReferences(value, readableContext);
  const withReadableFields = replaceFieldReferences(withReadableNotes);
  return replaceMetricReferences(withReadableFields);
}

function readableContextFromEvidence(evidenceCatalog) {
  return {
    noteTitles: buildReadableNoteTitles(evidenceCatalog),
    evidenceReferences: buildReadableEvidenceReferences(evidenceCatalog)
  };
}

function humanizeStrategyValue(value, readableContext, key = "") {
  if (typeof value === "string") {
    return key === "evidenceIds" ? value : humanizeRecommendationText(value, readableContext);
  }
  if (Array.isArray(value)) {
    return key === "evidenceIds"
      ? value.slice()
      : value.map((item) => humanizeStrategyValue(item, readableContext, key));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        humanizeStrategyValue(entryValue, readableContext, entryKey)
      ])
    );
  }
  return value;
}

function humanizeStrategyResult(result, evidenceCatalog) {
  return humanizeStrategyValue(result, readableContextFromEvidence(evidenceCatalog));
}

function hasNewSuggestionShape(item) {
  return Boolean(item && SUGGESTION_FIELDS.some((key) => item[key] != null));
}

function legacySuggestionKeys(item) {
  if (!item) return [];
  return LEGACY_SUGGESTION_FIELDS.filter((key) => item[key] != null);
}

function normalizeSuggestion(item, readableContext) {
  return {
    delivery_title: humanizeRecommendationText(String(item?.delivery_title || "").trim(), readableContext),
    cover_prompt: humanizeRecommendationText(String(item?.cover_prompt || "").trim(), readableContext),
    opening_hook: humanizeRecommendationText(String(item?.opening_hook || "").trim(), readableContext),
    content_structure: humanizeRecommendationText(normalizeTextBlock(item?.content_structure), readableContext),
    publish_time: humanizeRecommendationText(String(item?.publish_time || "").trim(), readableContext),
    success_metrics: humanizeRecommendationText(normalizeTextBlock(item?.success_metrics), readableContext),
    recommended_actions: humanizeRecommendationText(normalizeTextBlock(item?.recommended_actions), readableContext),
    rationale: humanizeRecommendationText(String(item?.rationale || "").trim(), readableContext),
    data_basis: humanizeRecommendationText(String(item?.data_basis || "").trim(), readableContext)
  };
}

function validateRecommendation(result, evidenceCatalog) {
  const evidenceById = new Map(evidenceCatalog.map((item) => [item.id, item]));
  const readableContext = readableContextFromEvidence(evidenceCatalog);
  const rawSuggestions = Array.isArray(result?.suggestions)
    ? result.suggestions
    : hasNewSuggestionShape(result)
      ? [result]
      : [];
  const legacyKeys = rawSuggestions.flatMap(legacySuggestionKeys);
  if (legacyKeys.length > 0) {
    throw new Error(`模型返回了旧版 suggestions 字段：${[...new Set(legacyKeys)].join("、")}`);
  }
  if (rawSuggestions.some((item) => !hasNewSuggestionShape(item))) {
    throw new Error("模型未按新版 suggestions 字段返回内容实验方案");
  }
  const suggestions = rawSuggestions.slice(0, 3).map((item) => normalizeSuggestion(item, readableContext));
  const patternEvidence = evidenceText(result?.replicablePattern?.evidenceIds, evidenceById);
  const problemEvidence = evidenceText(result?.priorityProblem?.evidenceIds, evidenceById);
  return {
    replicablePattern: {
      title: humanizeRecommendationText(String(result?.replicablePattern?.title || ""), readableContext),
      explanation: humanizeRecommendationText(String(result?.replicablePattern?.explanation || ""), readableContext),
      ...patternEvidence
    },
    priorityProblem: {
      title: humanizeRecommendationText(String(result?.priorityProblem?.title || ""), readableContext),
      explanation: humanizeRecommendationText(String(result?.priorityProblem?.explanation || ""), readableContext),
      ...problemEvidence
    },
    suggestions
  };
}

async function analyzeStrategy({ note, facts, accountContext, evidenceCatalog, coverAnalysis, caption, transcript }) {
  const settings = config();
  const input = {
    selectedNote: {
      noteKey: note.noteKey,
      title: note.title || "",
      caption: caption || note.contentText || "",
      transcript: transcript || "",
      review: note.review || null
    },
    ruleFacts: facts,
    coverAnalysis: coverAnalysis || null,
    accountContext,
    evidenceCatalog
  };
  writeDebugLog("bailian", "analyzeStrategy.start", {
    noteKey: note.noteKey,
    title: note.title || "",
    model: settings.strategyModel,
    input
  });
  const result = await chatCompletion({
    model: settings.strategyModel,
    messages: [
      {
        role: "system",
        content: [
          "你是内容策略分析师。规则与数据层给出的指标是事实，不得修改或虚构。",
          "你的职责是理解账号语境、提出解释性假设，并设计下一轮可验证实验。",
          "不要把相关性说成因果。证据不足时明确写“假设”。",
          "所有数据判断只能引用 evidenceCatalog 中存在的事实，不得自行计算、估算、错配标题或补充平台不存在的指标。",
          "必须返回 JSON，建议最多三条。",
          "每条 suggestions 建议必须是可直接执行的内容实验方案，并且只使用固定 snake_case 字段：delivery_title、cover_prompt、opening_hook、content_structure、publish_time、success_metrics、recommended_actions、rationale、data_basis。",
          "禁止在 suggestions 里输出 title、whatToDo、why、validationMetric、evidenceIds、evidence、label 或其他字段。"
        ].join("\n")
      },
      {
        role: "user",
        content: [
          `根据以下 JSON 生成内容策略：${JSON.stringify(input)}`,
          "返回 JSON，结构固定为：",
          '{"replicablePattern":{"title":"","explanation":"","evidenceIds":["证据ID"]},"priorityProblem":{"title":"","explanation":"","evidenceIds":["证据ID"]},"suggestions":[{"delivery_title":"","cover_prompt":"","opening_hook":"","content_structure":"","publish_time":"","success_metrics":"","recommended_actions":"","rationale":"","data_basis":""}]}',
          "suggestions 数组里的每一个方案必须严格对应下面这个字段说明示例；字段名必须一字不差，字段值必须换成你的真实建议，不要照抄 string 或注释：",
          JSON.stringify({
            delivery_title: "string // 交付标题，如：'Q2增长实操指南'",
            cover_prompt: "string // 封面提示词，用于生成视觉封面的关键词或指令",
            opening_hook: "string // 前5秒开头文案，用于抓住观众注意力的钩子",
            content_structure: "string // 内容结构，如：'问题-方案-案例-总结'",
            publish_time: "string // 建议发布时间，如：'2026-07-01 10:00'",
            success_metrics: "string // 验证指标，如：'CTR>5%, 完播率>40%'",
            recommended_actions: "string // 建议执行的具体动作列表",
            rationale: "string // 为什么建议这样做的原因说明",
            data_basis: "string // 决策所基于的数据来源或关键数据点"
          }),
          "content_structure 必须是字符串，例如“问题-方案-案例-总结”。success_metrics 必须写清具体指标和判断口径。"
        ].join("\n")
      }
    ]
  });
  const humanizedResult = humanizeStrategyResult(result, evidenceCatalog);
  const analysis = {
    ...validateRecommendation(humanizedResult, evidenceCatalog),
    model: settings.strategyModel,
    analyzedAt: new Date().toISOString()
  };
  writeDebugLog("bailian", "analyzeStrategy.done", {
    noteKey: note.noteKey,
    model: settings.strategyModel,
    rawResult: result,
    humanizedResult,
    analysis
  });
  return analysis;
}

module.exports = {
  analyzeCover,
  analyzeStrategy,
  config,
  extractJson,
  humanizeStrategyResult,
  validateRecommendation
};
