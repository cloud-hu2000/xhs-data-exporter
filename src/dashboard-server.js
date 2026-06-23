const fs = require("fs");
const path = require("path");
const express = require("express");
const { loadEnv } = require("./env");
const { importData, dataDir } = require("./import-xhs-data");
const { createNoteReviewStore } = require("./note-review-store");
const { createAiAnalysisStore } = require("./ai-analysis-store");
const { buildEvidenceCatalog, buildFactDiagnostics, compactAccountContext } = require("./content-strategy");
const Bailian = require("./bailian-client");

loadEnv();
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const dataPath = path.join(dataDir, "xhs-unified-data.json");
const noteReviewPath = path.join(dataDir, "note-reviews.json");
const aiAnalysisPath = path.join(dataDir, "ai-content-analysis.json");
const port = Number(process.env.XHS_DASHBOARD_PORT || 5178);
const noteReviewStore = createNoteReviewStore(noteReviewPath);
const aiAnalysisStore = createAiAnalysisStore(aiAnalysisPath);

function readData() {
  if (!fs.existsSync(dataPath)) {
    return importData();
  }
  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

function readDecoratedData() {
  return {
    ...noteReviewStore.decorateDatabase(readData()),
    aiAnalysis: aiAnalysisStore.list()
  };
}

function analysisContext(noteKey) {
  const database = readDecoratedData();
  const note = database.notes.find((item) => item.noteKey === noteKey);
  if (!note) throw new Error("未找到对应笔记");
  return {
    database,
    note,
    facts: buildFactDiagnostics(database.notes, note),
    cached: aiAnalysisStore.get(noteKey)
  };
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(publicDir));
app.use("/vendor/echarts", express.static(path.join(projectRoot, "node_modules", "echarts", "dist")));

app.get("/api/data", (req, res) => {
  res.json(readDecoratedData());
});

app.post("/api/import", (req, res) => {
  res.json(noteReviewStore.decorateDatabase(importData()));
});

app.post("/api/note-reviews", (req, res) => {
  try {
    const result = noteReviewStore.saveReview(req.body?.noteKey, req.body?.review);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/content-strategy/:noteKey", (req, res) => {
  try {
    const context = analysisContext(req.params.noteKey);
    const settings = Bailian.config();
    res.json({
      note: {
        noteKey: context.note.noteKey,
        title: context.note.title,
        coverImageUrl: context.note.coverImageUrl || ""
      },
      facts: context.facts,
      analysis: context.cached,
      ai: {
        configured: Boolean(settings.apiKey),
        visionModel: settings.visionModel,
        strategyModel: settings.strategyModel,
        asrModel: settings.asrModel,
        mediaPipeline: "deferred"
      }
    });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.post("/api/content-strategy/cover", async (req, res) => {
  try {
    const context = analysisContext(req.body?.noteKey);
    const coverAnalysis = await Bailian.analyzeCover(context.note, context.facts);
    const saved = aiAnalysisStore.merge(context.note.noteKey, {
      title: context.note.title || "",
      coverAnalysis
    });
    res.json({ facts: context.facts, analysis: saved });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/content-strategy/recommend", async (req, res) => {
  try {
    const context = analysisContext(req.body?.noteKey);
    const caption = String(req.body?.caption || "").trim();
    const transcript = String(req.body?.transcript || "").trim();
    const strategyAnalysis = await Bailian.analyzeStrategy({
      note: context.note,
      facts: context.facts,
      accountContext: compactAccountContext(context.database.notes),
      evidenceCatalog: buildEvidenceCatalog(context.database.notes),
      coverAnalysis: context.cached?.coverAnalysis || null,
      caption,
      transcript
    });
    const saved = aiAnalysisStore.merge(context.note.noteKey, {
      title: context.note.title || "",
      inputs: { caption, transcript },
      strategyAnalysis
    });
    res.json({ facts: context.facts, analysis: saved });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/health", (req, res) => {
  const settings = Bailian.config();
  res.json({
    ok: true,
    aiConfigured: Boolean(settings.apiKey),
    visionModel: settings.visionModel,
    strategyModel: settings.strategyModel
  });
});

app.listen(port, () => {
  console.log(`Xiaohongshu analysis center: http://localhost:${port}`);
});
