const express = require("express");
const Bailian = require("./bailian-client");

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}不能为空。`);
  }
  return value;
}

function list(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组。`);
  return value;
}

function text(value, label, maxLength) {
  const result = String(value || "").trim();
  if (!result) throw new Error(`${label}不能为空。`);
  return result.slice(0, maxLength);
}

function createContentCheckerAiRouter({ aiClient = Bailian } = {}) {
  const router = express.Router();

  router.get("/health", (req, res) => {
    void req;
    res.json({ ok: true, modelConfigured: Boolean(aiClient.config().apiKey) });
  });

  router.post("/cover", async (req, res, next) => {
    try {
      const note = object(req.body?.note, "笔记");
      const facts = object(req.body?.facts, "数据事实");
      if (!String(note.coverImageUrl || "").trim()) throw new Error("当前笔记没有封面 URL");
      res.json({ analysis: await aiClient.analyzeCover(note, facts) });
    } catch (error) { next(error); }
  });

  router.post("/strategy", async (req, res, next) => {
    try {
      const note = object(req.body?.note, "笔记");
      const facts = object(req.body?.facts, "数据事实");
      res.json({ analysis: await aiClient.analyzeStrategy({
        note,
        facts,
        accountContext: object(req.body?.accountContext, "账号上下文"),
        evidenceCatalog: list(req.body?.evidenceCatalog, "证据目录"),
        coverAnalysis: req.body?.coverAnalysis || null,
        caption: String(req.body?.caption || "").slice(0, 20000),
        transcript: String(req.body?.transcript || "").slice(0, 30000)
      }) });
    } catch (error) { next(error); }
  });

  router.post("/match-similar", async (req, res, next) => {
    try {
      res.json({ matchedNoteKeys: await aiClient.matchSimilarNotes({
        draft: text(req.body?.draft, "文案", 20000),
        notes: list(req.body?.notes, "历史内容")
      }) });
    } catch (error) { next(error); }
  });

  router.post("/next-content", async (req, res, next) => {
    try {
      res.json({ analysis: await aiClient.analyzeNextContent({
        draft: text(req.body?.draft, "文案", 20000),
        evidence: object(req.body?.evidence, "数据证据"),
        historicalContext: list(req.body?.historicalContext, "历史内容")
      }) });
    } catch (error) { next(error); }
  });

  router.use((error, req, res, next) => {
    void req;
    void next;
    res.status(400).json({ error: error instanceof Error ? error.message : "AI 服务暂时不可用。" });
  });
  return router;
}

module.exports = { createContentCheckerAiRouter };
