const fs = require("fs");
const path = require("path");

function cleanText(value, maxLength = 2000) {
  return String(value || "").trim().slice(0, maxLength);
}

function cleanList(value, maxItems = 6, maxLength = 240) {
  const source = Array.isArray(value) ? value : String(value || "").split(/\n|；|;/);
  return source
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function noteSnapshot(note) {
  if (!note) return null;
  return {
    noteKey: note.noteKey,
    title: note.title || "",
    publishedAt: note.publishedAt || "",
    impressions: note.impressions || 0,
    views: note.views || 0,
    officialCoverClickRate: note.officialCoverClickRate ?? null,
    viewRate: note.viewRate || 0,
    interactionRate: note.interactionRate || 0,
    collectRate: note.collectRate || 0,
    commentRate: note.commentRate || 0,
    shareRate: note.shareRate || 0,
    followRate: note.followRate || 0,
    likes: note.likes || 0,
    collects: note.collects || 0,
    comments: note.comments || 0,
    shares: note.shares || 0,
    followersGained: note.followersGained || 0
  };
}

function normalizeExperiment(input = {}, now = new Date().toISOString()) {
  const suggestion = input.suggestion || {};
  return {
    id: cleanText(input.id, 80),
    sourceNoteKey: cleanText(input.sourceNoteKey, 200),
    sourceTitle: cleanText(input.sourceTitle, 300),
    delivery_title: cleanText(suggestion.delivery_title || input.delivery_title, 160),
    cover_prompt: cleanText(suggestion.cover_prompt || input.cover_prompt, 1200),
    opening_hook: cleanText(suggestion.opening_hook || input.opening_hook, 800),
    content_structure: cleanList(suggestion.content_structure || input.content_structure, 8, 360),
    publish_time: cleanText(suggestion.publish_time || input.publish_time, 160),
    success_metrics: cleanList(suggestion.success_metrics || input.success_metrics, 8, 260),
    recommended_actions: cleanText(suggestion.recommended_actions || input.recommended_actions, 1000),
    rationale: cleanText(suggestion.rationale || input.rationale, 1000),
    data_basis: cleanText(suggestion.data_basis || input.data_basis, 1400),
    matchedNoteKey: cleanText(input.matchedNoteKey, 200),
    matchedAt: cleanText(input.matchedAt, 60),
    verificationSnapshot: input.verificationSnapshot || null,
    status: input.matchedNoteKey ? "verified" : "planned",
    createdAt: cleanText(input.createdAt, 60) || now,
    updatedAt: cleanText(input.updatedAt, 60) || now
  };
}

function createContentExperimentStore(filePath) {
  function read() {
    if (!fs.existsSync(filePath)) return { version: 1, experiments: [] };
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!payload || !Array.isArray(payload.experiments)) return { version: 1, experiments: [] };
      return {
        version: 1,
        experiments: payload.experiments.map((item) => normalizeExperiment(item))
      };
    } catch {
      return { version: 1, experiments: [] };
    }
  }

  function write(database) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(database, null, 2), "utf8");
  }

  function list() {
    return read().experiments;
  }

  function create(input) {
    const database = read();
    const now = new Date().toISOString();
    const experiment = normalizeExperiment({
      ...input,
      id: `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    }, now);
    if (!experiment.delivery_title) throw new Error("缺少交付标题");
    database.experiments.unshift(experiment);
    write(database);
    return experiment;
  }

  function match(experimentId, note) {
    if (!experimentId) throw new Error("缺少实验 ID");
    if (!note?.noteKey) throw new Error("缺少匹配笔记");
    const database = read();
    const index = database.experiments.findIndex((item) => item.id === experimentId);
    if (index < 0) throw new Error("未找到实验卡片");
    const now = new Date().toISOString();
    database.experiments[index] = normalizeExperiment({
      ...database.experiments[index],
      matchedNoteKey: note.noteKey,
      matchedAt: now,
      verificationSnapshot: noteSnapshot(note),
      updatedAt: now
    });
    write(database);
    return database.experiments[index];
  }

  return { create, list, match };
}

module.exports = {
  createContentExperimentStore,
  normalizeExperiment,
  noteSnapshot
};
