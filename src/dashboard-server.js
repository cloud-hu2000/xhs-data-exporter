const fs = require("fs");
const path = require("path");
const express = require("express");
const { installConsoleLogger } = require("./console-logger");
const { loadEnv } = require("./env");
const { importData, dataDir } = require("./import-xhs-data");
const { createNoteReviewStore } = require("./note-review-store");
const { createAiAnalysisStore } = require("./ai-analysis-store");
const { createContentExperimentStore } = require("./content-experiment-store");
const { createCreationPlanStore } = require("./creation-plan-store");
const { contentCheckerApiBase } = require("./content-checker-api-config");
const { createProfileTranscriptReader } = require("./profile-transcript");
const {
  buildActionableEvidence,
  buildEvidenceCatalog,
  buildFactDiagnostics,
  buildNextContentStatus,
  compactAccountContext,
  referencesForClient
} = require("./content-strategy");

installConsoleLogger();

loadEnv();
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const dataPath = path.join(dataDir, "xhs-unified-data.json");
const noteReviewPath = path.join(dataDir, "note-reviews.json");
const aiAnalysisPath = path.join(dataDir, "ai-content-analysis.json");
const contentExperimentPath = path.join(dataDir, "content-experiments.json");
const creationPlanPath = path.join(dataDir, "creation-plans.json");
const port = 5178;
const host = "127.0.0.1";
const noteReviewStore = createNoteReviewStore(noteReviewPath);
const aiAnalysisStore = createAiAnalysisStore(aiAnalysisPath);
const contentExperimentStore = createContentExperimentStore(contentExperimentPath);
const creationPlanStore = createCreationPlanStore(creationPlanPath);
const profileTranscriptReader = createProfileTranscriptReader(projectRoot);

function readData() {
  if (!fs.existsSync(dataPath)) {
    return importData();
  }
  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

function decorateRuntimeData(database) {
  return {
    ...database,
    aiAnalysis: aiAnalysisStore.list(),
    contentExperiments: contentExperimentStore.list(),
    creationPlans: creationPlanStore.list(),
    nextContentStatus: buildNextContentStatus(database.notes || [])
  };
}

function historicalContent(database) {
  return (database.notes || []).map((note) => {
    const automatic = profileTranscriptReader.get(note);
    return {
      noteKey: note.noteKey,
      title: note.title || "",
      content: automatic?.transcript || automatic?.caption || note.contentText || note.title || "",
      openingExcerpt: automatic?.openingExcerpts || null,
      review: note.review || null
    };
  });
}

function readDecoratedData() {
  return decorateRuntimeData(noteReviewStore.decorateDatabase(readData()));
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

async function requestAiApi(pathname, body) {
  const apiBase = contentCheckerApiBase();
  const response = await fetch(`${apiBase}/ai/${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `AI 服务请求失败（${response.status}）`);
  return payload;
}

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(express.static(publicDir));
app.use("/vendor/echarts", express.static(path.join(projectRoot, "node_modules", "echarts", "dist")));
app.use("/vendor/easymde", express.static(path.join(projectRoot, "node_modules", "easymde", "dist")));
app.use("/vendor/dompurify", express.static(path.join(projectRoot, "node_modules", "dompurify", "dist")));
app.use("/vendor/flowbite", express.static(path.join(projectRoot, "node_modules", "flowbite", "dist")));
app.get("/api/content-checker-config", (req, res) => {
  try {
    const apiBase = contentCheckerApiBase();
    return res.json({ apiBase });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

app.get("/api/data", (req, res) => {
  res.json(readDecoratedData());
});

app.post("/api/import", (req, res) => {
  res.json(decorateRuntimeData(noteReviewStore.decorateDatabase(importData())));
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
    const automaticContent = profileTranscriptReader.get(context.note);
    res.json({
      note: {
        noteKey: context.note.noteKey,
        title: context.note.title,
        coverImageUrl: context.note.coverImageUrl || ""
      },
      facts: context.facts,
      analysis: context.cached,
      automaticTranscript: automaticContent?.transcript
        ? automaticContent
        : null,
      automaticCaption: automaticContent?.caption
        ? automaticContent
        : null,
      ai: {
        provider: "remote-api"
      }
    });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.post("/api/content-strategy/cover", async (req, res) => {
  try {
    const context = analysisContext(req.body?.noteKey);
    const { analysis: coverAnalysis } = await requestAiApi("cover", {
      note: context.note,
      facts: context.facts
    });
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
    const { analysis: coverAnalysis } = await requestAiApi("cover", {
      note: context.note,
      facts: context.facts
    });
    aiAnalysisStore.merge(context.note.noteKey, {
      title: context.note.title || "",
      coverAnalysis
    });
    const { analysis: strategyAnalysis } = await requestAiApi("strategy", {
      note: context.note,
      facts: context.facts,
      accountContext: compactAccountContext(context.database.notes),
      evidenceCatalog: buildEvidenceCatalog(context.database.notes),
      coverAnalysis,
      caption,
      transcript
    });
    const saved = aiAnalysisStore.merge(context.note.noteKey, {
      title: context.note.title || "",
      coverAnalysis,
      inputs: { caption, transcript },
      strategyAnalysis
    });
    res.json({ facts: context.facts, analysis: saved });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/next-content/status", (req, res) => {
  const database = readDecoratedData();
  res.json(buildNextContentStatus(database.notes || []));
});

app.post("/api/next-content/generate", async (req, res) => {
  try {
    const draft = String(req.body?.draft || "").trim();
    if (!draft) throw new Error("请先填写文案或口播稿");
    const database = readDecoratedData();
    const status = buildNextContentStatus(database.notes || []);
    if (!status.eligible) throw new Error(status.reason || "历史作品数据不足");
    const history = historicalContent(database);
    const { matchedNoteKeys } = await requestAiApi("match-similar", { draft, notes: history });
    const evidence = buildActionableEvidence(database.notes || [], matchedNoteKeys);
    const matched = new Set(evidence.matchedNoteKeys);
    const { analysis: result } = await requestAiApi("next-content", {
      draft,
      evidence,
      historicalContext: history.filter((note) => matched.has(note.noteKey))
    });
    const references = referencesForClient(evidence);
    const plan = creationPlanStore.create({ input: draft, result, references });
    res.json({ plan, status });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/creation-plans", (req, res) => {
  res.json({ plans: creationPlanStore.list() });
});

app.get("/api/creation-plans/:planId", (req, res) => {
  const plan = creationPlanStore.get(req.params.planId);
  if (!plan) return res.status(404).json({ error: "未找到创作计划" });
  return res.json({ plan });
});

app.patch("/api/creation-plans/:planId", (req, res) => {
  try {
    res.json({ plan: creationPlanStore.update(req.params.planId, req.body || {}) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/content-experiments", (req, res) => {
  res.json({ experiments: contentExperimentStore.list() });
});

app.post("/api/content-experiments", (req, res) => {
  try {
    res.json({ experiment: contentExperimentStore.create(req.body || {}) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.patch("/api/content-experiments/:experimentId/match", (req, res) => {
  try {
    const database = readDecoratedData();
    const note = database.notes.find((item) => item.noteKey === req.body?.noteKey);
    if (!note) throw new Error("未找到匹配笔记");
    res.json({ experiment: contentExperimentStore.match(req.params.experimentId, note) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    aiProvider: "remote-api",
    aiApiBase: contentCheckerApiBase()
  });
});

app.listen(port, host, () => {
  console.log(`Xiaohongshu analysis center: http://${host}:${port}`);
});
