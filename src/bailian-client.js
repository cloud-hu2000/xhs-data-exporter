const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

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
  if (!settings.apiKey) throw new Error("未配置 DASHSCOPE_API_KEY");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.25,
        ...(json ? { response_format: { type: "json_object" } } : {})
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.message || `百炼请求失败（${response.status}）`);
    }
    const content = payload?.choices?.[0]?.message?.content;
    return json ? extractJson(content) : content;
  } finally {
    clearTimeout(timer);
  }
}

async function imageInput(url) {
  if (!url) throw new Error("当前笔记没有封面 URL");
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`图片下载失败（${response.status}）`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 10 * 1024 * 1024) throw new Error("封面图片超过 10MB");
    const mime = response.headers.get("content-type") || "image/jpeg";
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return url;
  }
}

async function analyzeCover(note, facts) {
  const settings = config();
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
  return { ...result, model: settings.visionModel, analyzedAt: new Date().toISOString() };
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

function validateRecommendation(result, evidenceCatalog) {
  const evidenceById = new Map(evidenceCatalog.map((item) => [item.id, item]));
  const suggestions = Array.isArray(result?.suggestions) ? result.suggestions.slice(0, 3) : [];
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
    suggestions: suggestions.map((item, index) => {
      const evidence = evidenceText(item?.evidenceIds, evidenceById);
      return {
        label: String(item?.label || `方案 ${String.fromCharCode(65 + index)}`),
        title: String(item?.title || ""),
        whatToDo: String(item?.whatToDo || ""),
        why: String(item?.why || ""),
        ...evidence,
        validationMetric: String(item?.validationMetric || "")
      };
    })
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
  const result = await chatCompletion({
    model: settings.strategyModel,
    messages: [
      {
        role: "system",
        content: [
          "你是内容策略分析师。规则与数据层给出的指标是事实，不得修改或虚构。",
          "你的职责是理解账号语境、提出解释性假设，并设计下一轮可验证实验。",
          "不要把相关性说成因果。证据不足时明确写“假设”。",
          "所有数据判断只能引用 evidenceCatalog 中存在的证据 ID，不得自行计算、估算、错配标题或补充平台不存在的指标。",
          "必须返回 JSON，建议最多三条，每条必须包含做什么、为什么、evidenceIds 和验证指标。"
        ].join("\n")
      },
      {
        role: "user",
        content: `根据以下 JSON 生成内容策略：${JSON.stringify(input)}\n返回 JSON，结构固定为：{"replicablePattern":{"title":"","explanation":"","evidenceIds":["证据ID"]},"priorityProblem":{"title":"","explanation":"","evidenceIds":["证据ID"]},"suggestions":[{"label":"方案 A","title":"","whatToDo":"","why":"","evidenceIds":["证据ID"],"validationMetric":""}]}。evidenceIds 只能从 evidenceCatalog.id 原样选择。`
      }
    ]
  });
  return {
    ...validateRecommendation(result, evidenceCatalog),
    model: settings.strategyModel,
    analyzedAt: new Date().toISOString()
  };
}

module.exports = {
  analyzeCover,
  analyzeStrategy,
  config,
  extractJson
};
