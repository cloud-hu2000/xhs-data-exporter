const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

const defaults = {
  debugPort: 9222,
  targetUrl: "https://creator.xiaohongshu.com/statistics/data-analysis",
  downloadDir: "./downloads",
  detailTexts: ["详情数据"],
  exportTexts: ["导出数据", "导出", "下载"],
  exportAllButtonsInDetail: true,
  closeTexts: ["关闭", "返回"],
  nextPageTexts: ["下一页", "下一页 >"],
  maxPages: 50,
  maxNotes: 500,
  slowMoMs: 600,
  pageReadyTimeoutMs: 30000,
  downloadTimeoutMs: 30000,
  afterExportWaitMs: 2500,
  exportRetryCount: 2,
  exportRetryWaitMs: 5000,
  headless: false
};

function loadConfig() {
  const configPath = path.join(projectRoot, "config.json");
  const userConfig = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8"))
    : {};
  const config = { ...defaults, ...userConfig };

  if (process.env.XHS_DEBUG_PORT) {
    config.debugPort = Number(process.env.XHS_DEBUG_PORT);
  }
  if (process.env.XHS_MAX_PAGES) {
    config.maxPages = Number(process.env.XHS_MAX_PAGES);
  }
  if (process.env.XHS_MAX_NOTES) {
    config.maxNotes = Number(process.env.XHS_MAX_NOTES);
  }
  if (process.env.XHS_EXPORT_ALL_BUTTONS) {
    config.exportAllButtonsInDetail = process.env.XHS_EXPORT_ALL_BUTTONS !== "false";
  }
  if (process.env.XHS_EXPORT_RETRY_COUNT) {
    config.exportRetryCount = Number(process.env.XHS_EXPORT_RETRY_COUNT);
  }
  if (process.env.XHS_EXPORT_RETRY_WAIT_MS) {
    config.exportRetryWaitMs = Number(process.env.XHS_EXPORT_RETRY_WAIT_MS);
  }

  config.downloadDir = path.resolve(projectRoot, config.downloadDir);
  fs.mkdirSync(config.downloadDir, { recursive: true });

  return config;
}

module.exports = {
  loadConfig,
  projectRoot
};
