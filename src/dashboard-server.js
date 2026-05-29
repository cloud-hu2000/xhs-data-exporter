const fs = require("fs");
const path = require("path");
const express = require("express");
const { importData, dataDir } = require("./import-xhs-data");

const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const dataPath = path.join(dataDir, "xhs-unified-data.json");
const port = Number(process.env.XHS_DASHBOARD_PORT || 5178);

function readData() {
  if (!fs.existsSync(dataPath)) {
    return importData();
  }
  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

const app = express();
app.use(express.json());
app.use(express.static(publicDir));
app.use("/vendor/echarts", express.static(path.join(projectRoot, "node_modules", "echarts", "dist")));

app.get("/api/data", (req, res) => {
  res.json(readData());
});

app.post("/api/import", (req, res) => {
  res.json(importData());
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Xiaohongshu analysis center: http://localhost:${port}`);
});
