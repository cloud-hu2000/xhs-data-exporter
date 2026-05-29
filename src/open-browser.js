const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { loadConfig, projectRoot } = require("./config");
const { findBrowserExecutable } = require("./browser-path");

const config = loadConfig();
const browserPath = findBrowserExecutable();
const profileDir = path.join(projectRoot, `.chrome-profile-${config.debugPort}`);

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
console.log("请在打开的浏览器里登录小红书创作者中心。登录完成后运行：");
console.log("npm.cmd run export");
