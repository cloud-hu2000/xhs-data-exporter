const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { installConsoleLogger } = require("./console-logger");
const { loadConfig, projectRoot } = require("./config");
const { findBrowserExecutable } = require("./browser-path");

installConsoleLogger();

const config = loadConfig();
const browserPath = findBrowserExecutable();
// 始终使用专用 profile，避免占用或修改用户平时使用的 Chrome profile。
// 需要把 profile 放到其他磁盘时，可设置 XHS_BROWSER_PROFILE_DIR。
const profileDir = path.resolve(
  process.env.XHS_BROWSER_PROFILE_DIR || path.join(projectRoot, `.chrome-profile-${config.debugPort}`)
);

fs.mkdirSync(profileDir, { recursive: true });

const args = [
  `--remote-debugging-port=${config.debugPort}`,
  `--user-data-dir=${profileDir}`,
  "--disable-extensions",
  "--no-first-run",
  "--no-default-browser-check",
  "--new-window",
  config.targetUrl
];

const child = spawn(browserPath, args, {
  detached: true,
  stdio: "ignore"
});

child.unref();

console.log(`已打开浏览器: ${browserPath}`);
console.log(`调试端口: ${config.debugPort}`);
console.log(`专用浏览器配置目录: ${profileDir}`);
console.log("请在打开的浏览器里登录小红书创作者中心，并保持窗口开启。");
