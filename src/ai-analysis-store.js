const fs = require("fs");
const path = require("path");

const STRATEGY_SUGGESTION_FIELDS = [
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

function hasCurrentSuggestionShape(item) {
  return Boolean(item && STRATEGY_SUGGESTION_FIELDS.some((key) => item[key] != null));
}

function hasCurrentStrategyAnalysis(analysis) {
  return Array.isArray(analysis?.suggestions) && analysis.suggestions.some(hasCurrentSuggestionShape);
}

function normalizeAnalysisRecord(record) {
  const normalized = { ...(record || {}) };
  if (normalized.strategyAnalysis && !hasCurrentStrategyAnalysis(normalized.strategyAnalysis)) {
    delete normalized.strategyAnalysis;
  }
  return normalized;
}

function normalizeDatabase(payload) {
  if (!payload || !payload.notes) return { version: 1, notes: {} };
  return {
    version: payload.version || 1,
    notes: Object.fromEntries(
      Object.entries(payload.notes).map(([noteKey, record]) => [noteKey, normalizeAnalysisRecord(record)])
    )
  };
}

function createAiAnalysisStore(filePath) {
  function read() {
    if (!fs.existsSync(filePath)) return { version: 1, notes: {} };
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return normalizeDatabase(payload);
    } catch {
      return { version: 1, notes: {} };
    }
  }

  function write(database) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(database, null, 2), "utf8");
  }

  function get(noteKey) {
    return read().notes[noteKey] || null;
  }

  function list() {
    return read().notes;
  }

  function merge(noteKey, patch) {
    if (!noteKey) throw new Error("缺少 noteKey");
    const database = read();
    database.notes[noteKey] = {
      ...(database.notes[noteKey] || {}),
      ...patch,
      noteKey,
      updatedAt: new Date().toISOString()
    };
    write(database);
    return database.notes[noteKey];
  }

  return { get, list, merge };
}

module.exports = {
  createAiAnalysisStore,
  hasCurrentStrategyAnalysis,
  normalizeAnalysisRecord
};
