const fs = require("fs");
const path = require("path");
const express = require("express");
const { importData, dataDir } = require("./import-xhs-data");
const { createNoteReviewStore } = require("./note-review-store");

const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const dataPath = path.join(dataDir, "xhs-unified-data.json");
const noteReviewPath = path.join(dataDir, "note-reviews.json");
const port = Number(process.env.XHS_DASHBOARD_PORT || 5178);
const noteReviewStore = createNoteReviewStore(noteReviewPath);

function readData() {
  if (!fs.existsSync(dataPath)) {
    return importData();
  }
  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

function readDecoratedData() {
  return noteReviewStore.decorateDatabase(readData());
}

const app = express();
app.use(express.json());
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

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Xiaohongshu analysis center: http://localhost:${port}`);
});
