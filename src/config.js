const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

const defaults = {
  debug: false,
  debugPort: 9222,
  targetUrl: "https://creator.xiaohongshu.com/statistics/data-analysis",
  downloadDir: "./downloads",
  // 小红书目前的入口文案为“分析详情”，旧版页面使用“详情数据”。
  detailTexts: ["分析详情", "详情数据"],
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

  if (process.env.XHS_DEBUG) {
    config.debug = ["1", "true", "yes", "on"].includes(process.env.XHS_DEBUG.toLowerCase());
  }
  config.downloadDir = path.resolve(projectRoot, config.downloadDir);
  fs.mkdirSync(config.downloadDir, { recursive: true });

  return config;
}

module.exports = {
  loadConfig,
  projectRoot
};
