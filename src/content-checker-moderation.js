const crypto = require("crypto");

const RULES = [
  ["站外引流", "HIGH", /(?:加\s*(?:微|薇|威)\s*信|微信|薇信|威信|微\s*信|加\s*[vV](?:信)?|[vV][xX]|[wW][xX]|扣\s*扣|[qQ][qQ]|[qQ]\s*群|加我|私我)/gi, "删除站外联系方式，改为平台内的合规互动表达。"],
  ["联系方式或外链", "HIGH", /(?:1[3-9](?:[\s-]?\d){9}|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|https?:\/\/[^\s，。；！？、]+|www\.[^\s，。；！？、]+|(?:[a-z0-9-]+\.)+(?:com|cn|net|org|io)(?:\/[^\s，。；！？、]+)?)/gi, "删除手机号、网址等站外联系方式。"],
  ["极限或绝对化宣传", "HIGH", /(?:国家级|世界级|最高级|(?:全网|全国|全球)?第[一1]|唯一|顶级|独家|销量冠军|[Nn]o\.?\s*1|[Tt]op\s*1|100%|百分百|绝对|最[好快强优])/gi, "改为可验证、具体且保守的描述，避免绝对化表述。"],
  ["效果承诺", "HIGH", /(?:保证(?:有效|见效|瘦|赚)|无效退款|全额退款|立刻见效|马上见效|当天见效|一周(?:瘦|见效)|特效|永不反弹|包瘦)/gi, "删除保证性结果描述，改为客观体验或可核验事实。"],
  ["医疗功效", "HIGH", /(?:治愈|根治|药到病除|包治|包好|减肥神药|神医|神药)/gi, "删除治疗、治愈或保证性效果承诺，并补充必要资质说明。"],
  ["医疗或医美措辞", "TIP", /(?:医生|医院|手术|注射|医美|整形|美白|祛痘|减肥|排毒|抗癌|防癌|增强免疫力)/gi, "确认表达有合法依据，避免暗示医疗功效。"],
  ["金融收益承诺", "HIGH", /(?:稳赚不赔|稳赚|保本(?:保息)?|内部消息|低风险高收益|免费领牛股)/gi, "删除收益保证或内幕信息暗示。"],
  ["金融投资推广", "MEDIUM", /(?:荐股|翻倍|带单|跟投|涨停|年化收益(?:率)?|投资建议)/gi, "改用客观信息，并补充风险提示。"],
  ["催购或点击诱导", "MEDIUM", /(?:秒杀|清仓|跳楼价|最后一天|仅限今日|再不买就没了|必买|必看|领取奖品|点击获取)/gi, "改为真实、可验证的活动信息，避免制造紧迫感。"],
  ["平台或导流线索", "TIP", /(?:淘宝|天猫|京东|拼多多|抖音|快手|[bB]站|微博|外链|跳转|二维码|扫(?:码|一?扫))/gi, "确认不存在站外导流或未披露的商业推广。"]
];
const WEIGHTS = { TIP: 0, LOW: 7, MEDIUM: 18, HIGH: 35 };

function normalize(value) {
  return String(value || "").normalize("NFKC").replace(/[\s·._-]+/g, "");
}

function ruleIssues(text, source) {
  const original = String(text || "");
  const variants = [original, normalize(original)];
  const seen = new Set();
  return RULES.flatMap(([category, severity, pattern, suggestion]) => variants.flatMap((value) => {
    pattern.lastIndex = 0;
    return [...value.matchAll(pattern)].flatMap((match) => {
      const evidence = match[0];
      const key = `${category}:${evidence}`;
      if (!evidence || seen.has(key)) return [];
      seen.add(key);
      return [{
        id: crypto.randomUUID(), source, category, severity, evidence,
        reason: "规则引擎发现可能触发平台审核的表达，请结合完整语境复核。",
        suggestion, rulePath: ["shared-v1", category], evidenceRefs: [category], confidence: 0.8
      }];
    });
  }));
}

async function modelIssues(input, candidates) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return { status: "skipped", issues: [], model: undefined, message: "未配置 DASHSCOPE_API_KEY，未调用多模态模型。" };
  const model = "qwen3.8-flash";
  const endpoint = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
  const content = [{ type: "text", text: `审核发布前内容。平台：${input.platform}。标题：${input.title}。正文：${input.body}。规则线索：${JSON.stringify(candidates.map(({ category, severity, evidence }) => ({ category, severity, evidence })))}。只返回 JSON：{"issues":[{"source":"title|body|image","imageIndex":1,"category":"分类","severity":"LOW|MEDIUM|HIGH","evidence":"可见证据","reason":"简短原因","suggestion":"可执行建议","bbox":{"x":0,"y":0,"width":0,"height":0}}]}。不得宣称官方审核结论。` }];
  input.images.forEach((image, index) => content.push({ type: "text", text: `图片 ${index + 1}` }, { type: "image_url", image_url: { url: image.dataUrl } }));
  try {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, enable_thinking: false, temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "system", content: "你是谨慎的发布前风险审核员，只依据输入证据。" }, { role: "user", content }] }), signal: AbortSignal.timeout(60000) });
    if (!response.ok) return { status: "error", issues: [], model, message: `模型返回 HTTP ${response.status}` };
    const body = await response.json();
    const parsed = JSON.parse(body?.choices?.[0]?.message?.content || "{}");
    const issues = (Array.isArray(parsed.issues) ? parsed.issues : []).flatMap((item) => {
      if (!item || !["LOW", "MEDIUM", "HIGH"].includes(item.severity)) return [];
      const source = ["title", "body", "image"].includes(item.source) ? item.source : "body";
      const box = item.bbox && ["x", "y", "width", "height"].every((key) => Number.isFinite(Number(item.bbox[key]))) ? Object.fromEntries(["x", "y", "width", "height"].map((key) => [key, Math.max(0, Math.min(1000, Number(item.bbox[key])))])) : undefined;
      return [{ id: crypto.randomUUID(), source, imageIndex: source === "image" ? Math.max(1, Number(item.imageIndex) || 1) : undefined, category: String(item.category || "图片或语境风险").slice(0, 100), severity: item.severity, evidence: String(item.evidence || "模型可见证据").slice(0, 80), reason: String(item.reason || "需要结合上下文复核。"), suggestion: String(item.suggestion || "调整为客观、中性的表达。"), bbox: box, rulePath: ["model", "visual-review"], confidence: 0.65 }];
    });
    return { status: "success", issues, model };
  } catch (error) { return { status: "error", issues: [], model, message: error instanceof Error ? error.message : "模型调用失败。" }; }
}

async function audit(input) {
  const candidates = [...ruleIssues(input.title, "title"), ...ruleIssues(input.body, "body")];
  const vision = await modelIssues(input, candidates);
  const unique = new Map();
  [...candidates, ...vision.issues].forEach((issue) => unique.set(`${issue.category}:${issue.evidence}:${issue.imageIndex || 0}`, issue));
  const issues = [...unique.values()];
  const summary = { high: issues.filter((item) => item.severity === "HIGH").length, medium: issues.filter((item) => item.severity === "MEDIUM").length, low: issues.filter((item) => item.severity === "LOW").length, tip: issues.filter((item) => item.severity === "TIP").length };
  const score = Math.min(100, issues.reduce((total, item) => total + WEIGHTS[item.severity], 0));
  const overallRisk = summary.high ? "HIGH" : summary.medium ? "MEDIUM" : "LOW";
  return { id: crypto.randomUUID(), platform: input.platform, overallRisk, score, recommendation: overallRisk === "HIGH" ? "高风险，建议调整后发布" : overallRisk === "MEDIUM" ? "建议修改" : "可发布", issues, summary, disclaimer: "本结果是基于公开规则与模型推理的发布前风险提示，不代表任何平台的官方审核结论；平台规则会动态变化。", engine: { ruleEngine: true, visualReasoning: vision.status === "success", model: vision.model }, policyVersions: ["shared-v1"], modelResponse: { status: vision.status, model: vision.model, message: vision.message } };
}

module.exports = { audit };
