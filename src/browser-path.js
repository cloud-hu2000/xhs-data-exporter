const fs = require("fs");
const path = require("path");

function browserCandidates({
  platform = process.platform,
  homeDir = process.env.HOME
} = {}) {
  const candidates = [];

  if (platform === "win32") {
    const roots = [
      process.env.LOCALAPPDATA,
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"]
    ].filter(Boolean);

    for (const root of roots) {
      candidates.push(path.join(root, "Google", "Chrome", "Application", "chrome.exe"));
      candidates.push(path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
    }
  } else if (platform === "darwin") {
    const appRoots = ["/Applications", homeDir && path.join(homeDir, "Applications")].filter(Boolean);
    const appNames = [
      "Google Chrome.app",
      "Google Chrome for Testing.app",
      "Google Chrome Canary.app",
      "Chromium.app",
      "Microsoft Edge.app"
    ];

    for (const root of appRoots) {
      for (const appName of appNames) {
        const executable = appName.replace(/\.app$/, "");
        candidates.push(path.join(root, appName, "Contents", "MacOS", executable));
      }
    }
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge"
    );
  }

  return candidates;
}

function findBrowserExecutable(options) {
  const found = browserCandidates(options).find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      "找不到可用的 Chrome、Chromium 或 Edge。请安装受支持的浏览器后再运行。"
    );
  }
  return found;
}

module.exports = {
  browserCandidates,
  findBrowserExecutable
};
