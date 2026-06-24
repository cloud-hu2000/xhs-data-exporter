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
  if (Array.isArray(value)) return normalizeTextList(value).join("；");
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

function hasNewSuggestionShape(item) {
  return Boolean(item && SUGGESTION_FIELDS.some((key) => item[key] != null));
}

function legacySuggestionKeys(item) {
  if (!item) return [];
  return LEGACY_SUGGESTION_FIELDS.filter((key) => item[key] != null);
}

function normalizeSuggestion(item) {
  return {
    delivery_title: String(item?.delivery_title || "").trim(),
    cover_prompt: String(item?.cover_prompt || "").trim(),
    opening_hook: String(item?.opening_hook || "").trim(),
    content_structure: normalizeTextBlock(item?.content_structure),
    publish_time: String(item?.publish_time || "").trim(),
    success_metrics: normalizeTextBlock(item?.success_metrics),
    recommended_actions: normalizeTextBlock(item?.recommended_actions),
    rationale: String(item?.rationale || "").trim(),
    data_basis: String(item?.data_basis || "").trim()
  };
}

function validateRecommendation(result, evidenceCatalog) {
  const evidenceById = new Map(evidenceCatalog.map((item) => [item.id, item]));
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
  const suggestions = rawSuggestions.slice(0, 3).map(normalizeSuggestion);
  const patternEvidence = evidenceText(result?.replicablePattern?.evidenceIds, evidenceById);
  const problemEvidence = evidenceText(result?.priorityProblem?.evidenceIds, evidenceById);
  return {
    replicablePattern: {
      title: String(result?.replicablePattern?.title || ""),
      explanation: String(result?.replicablePattern?.explanation || ""),
      ...patternEvidence
    },
    priorityProblem: {
      title: String(result?.priorityProblem?.title || ""),
      explanation: String(result?.priorityProblem?.explanation || ""),
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
          "禁止在 suggestions 里输出 title、whatToDo、why、validationMetric、evidenceIds、evidence、label 或其他字段。",
          "data_basis 必须写清引用了哪些 evidenceCatalog 事实。"
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
          "content_structure 必须是字符串，例如“问题-方案-案例-总结”。success_metrics 必须写清具体指标和判断口径。data_basis 只能引用 evidenceCatalog 中已给出的事实。"
        ].join("\n")
      }
    ]
  });
  const analysis = {
    ...validateRecommendation(result, evidenceCatalog),
    model: settings.strategyModel,
    analyzedAt: new Date().toISOString()
  };
  writeDebugLog("bailian", "analyzeStrategy.done", {
    noteKey: note.noteKey,
    model: settings.strategyModel,
    rawResult: result,
    analysis
  });
  return analysis;
}

module.exports = {
  analyzeCover,
  analyzeStrategy,
  config,
  extractJson,
  validateRecommendation
};
