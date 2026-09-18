const fs = require("fs");
const path = require("path");

function cleanText(value, maxLength = 20000) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanList(value, maxItems = 8, maxLength = 600) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function cleanImageUrls(value) {
  const source = Array.isArray(value) ? value : [];
  return source
    .map((item) => cleanText(typeof item === "string" ? item : item?.url || item?.dataUrl, 4000))
    .filter((item) => /^https?:\/\//i.test(item))
    .slice(0, 18);
}

function cleanReferences(value) {
  const references = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    ["cover", "opening", "completion"].map((key) => {
      const entry = references[key] || {};
      const cleanNotes = (items) => (Array.isArray(items) ? items : []).slice(0, 3).map((item) => ({
        noteKey: cleanText(item?.noteKey, 240),
        title: cleanText(item?.title, 300),
        coverImageUrl: cleanText(item?.coverImageUrl, 2000)
      }));
      return [key, {
        label: cleanText(entry.label, 80),
        strong: cleanNotes(entry.strong),
        weak: cleanNotes(entry.weak)
      }];
    })
  );
}

function normalizePlan(input = {}, now = new Date().toISOString()) {
  const result = input.result && typeof input.result === "object" ? input.result : {};
  return {
    id: cleanText(input.id, 100),
    status: input.status === "planned" ? "planned" : "draft",
    input: cleanText(input.input),
    inputType: cleanText(result.input_type || input.inputType, 40),
    optimizationFocus: cleanText(result.optimization_focus || input.optimizationFocus, 500),
    primaryTitle: cleanText(result.primary_title || input.primaryTitle, 300),
    alternativeTitles: cleanList(result.alternative_titles || input.alternativeTitles, 2, 300),
    coverPrompt: cleanText(result.cover_prompt || input.coverPrompt, 3000),
    openingHook: cleanText(result.opening_hook || input.openingHook, 1500),
    alternativeHooks: cleanList(result.alternative_hooks || input.alternativeHooks, 2, 800),
    contentStructure: cleanList(result.content_structure || input.contentStructure, 8, 500),
    rewrittenMarkdown: cleanText(result.rewritten_markdown || input.rewrittenMarkdown, 30000),
    validationFocus: cleanText(result.validation_focus || input.validationFocus, 60),
    imageUrls: cleanImageUrls(result.image_urls || input.imageUrls || input.images),
    references: cleanReferences(input.references || result.references),
    model: cleanText(result.model || input.model, 160),
    createdAt: cleanText(input.createdAt, 60) || now,
    updatedAt: cleanText(input.updatedAt, 60) || now
  };
}

function createCreationPlanStore(filePath) {
  function read() {
    if (!fs.existsSync(filePath)) return { version: 1, plans: [] };
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!payload || !Array.isArray(payload.plans)) return { version: 1, plans: [] };
      return { version: 1, plans: payload.plans.map((item) => normalizePlan(item)) };
    } catch {
      return { version: 1, plans: [] };
    }
  }

  function write(database) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(database, null, 2), "utf8");
  }

  function list() {
    return read().plans;
  }

  function get(planId) {
    return read().plans.find((item) => item.id === planId) || null;
  }

  function create(input) {
    const database = read();
    const now = new Date().toISOString();
    const plan = normalizePlan({
      ...input,
      id: `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    }, now);
    if (!plan.input) throw new Error("请先填写文案或口播稿");
    if (!plan.primaryTitle && !plan.rewrittenMarkdown) throw new Error("生成结果为空");
    database.plans.unshift(plan);
    write(database);
    return plan;
  }

  function update(planId, patch = {}) {
    if (!planId) throw new Error("缺少创作计划 ID");
    const database = read();
    const index = database.plans.findIndex((item) => item.id === planId);
    if (index < 0) throw new Error("未找到创作计划");
    const now = new Date().toISOString();
    database.plans[index] = normalizePlan({
      ...database.plans[index],
      ...patch,
      id: database.plans[index].id,
      createdAt: database.plans[index].createdAt,
      updatedAt: now
    }, now);
    write(database);
    return database.plans[index];
  }

  return { create, get, list, update };
}

module.exports = {
  createCreationPlanStore,
  normalizePlan
};
