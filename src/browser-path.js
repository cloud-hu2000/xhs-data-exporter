const fs = require("fs");
const path = require("path");

function browserCandidates() {
  const env = process.env;
  const candidates = [];

  if (env.CHROME_PATH) candidates.push(env.CHROME_PATH);

  const roots = [
    env.LOCALAPPDATA,
    env.PROGRAMFILES,
    env["PROGRAMFILES(X86)"]
  ].filter(Boolean);

  for (const root of roots) {
    candidates.push(path.join(root, "Google", "Chrome", "Application", "chrome.exe"));
    candidates.push(path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
  }

  return candidates;
}

function findBrowserExecutable() {
  const found = browserCandidates().find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      "找不到 Chrome 或 Edge。可以设置环境变量 CHROME_PATH 指向 chrome.exe 后再运行。"
    );
  }
  return found;
}

module.exports = {
  findBrowserExecutable
};
