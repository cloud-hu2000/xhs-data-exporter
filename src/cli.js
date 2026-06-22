const fs = require("fs");
const http = require("http");
const path = require("path");
const readline = require("readline");
const { spawn, spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const logsDir = path.join(projectRoot, "logs");
const dashboardPort = Number(process.env.XHS_DASHBOARD_PORT || 5178);
const dashboardUrl = `http://localhost:${dashboardPort}`;

function printTitle() {
  console.log("");
  console.log("========================================");
  console.log(" 小红书数据导出与分析工具");
  console.log("========================================");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: options.env || process.env
  });

  if (result.error) {
    console.error(`启动失败: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function runNode(script, env = process.env) {
  return run(process.execPath, [path.join(projectRoot, "src", script)], { env });
}

function missingDependencies() {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")
  );
  return Object.keys(packageJson.dependencies || {}).filter(
    (name) => !fs.existsSync(path.join(projectRoot, "node_modules", name, "package.json"))
  );
}

function ensureDependencies() {
  const missing = missingDependencies();
  if (missing.length === 0) return true;

  console.log(`检测到依赖未安装或不完整: ${missing.join(", ")}`);
  console.log("正在自动安装依赖...");
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  return run(npmCommand, ["install"]) === 0;
}

function request(url, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.setTimeout(timeoutMs, () => req.destroy());
    req.on("error", () => resolve(false));
  });
}

function loadDebugPort() {
  const configPath = path.join(projectRoot, "config.json");
  if (!fs.existsSync(configPath)) return 9222;
  try {
    return Number(JSON.parse(fs.readFileSync(configPath, "utf8")).debugPort || 9222);
  } catch {
    return 9222;
  }
}

async function browserIsRunning() {
  return request(`http://127.0.0.1:${loadDebugPort()}/json/version`);
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function prepareBrowser({ alwaysConfirm = true } = {}) {
  if (!(await browserIsRunning())) {
    console.log("未检测到专用浏览器，正在打开...");
    if (runNode("open-browser.js") !== 0) return false;
  } else {
    console.log("已检测到专用浏览器。");
  }

  if (alwaysConfirm) {
    console.log("");
    console.log("请在专用浏览器中登录小红书，并进入“数据分析”页面。");
    await ask("准备好后按 Enter 继续...");
  }
  return true;
}

function importData() {
  console.log("");
  console.log("正在导入下载文件并生成统一数据表...");
  return runNode("import-xhs-data.js");
}

async function exportData(maxNotes) {
  if (!(await prepareBrowser())) return 1;

  console.log("");
  console.log(maxNotes === 1 ? "开始测试导出 1 条笔记..." : "开始全量导出...");
  const env = { ...process.env };
  if (maxNotes === 1) {
    env.XHS_MAX_NOTES = "1";
  } else {
    delete env.XHS_MAX_NOTES;
  }
  return runNode("export-xhs.js", env);
}

function openUrl(url) {
  let command;
  let args;
  if (process.platform === "win32") {
    command = "explorer.exe";
    args = [url];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  const child = spawn(command, args, {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

async function waitForUrl(url, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    if (await request(`${url}/health`, 500)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function openDashboard() {
  if (!(await request(`${dashboardUrl}/health`))) {
    fs.mkdirSync(logsDir, { recursive: true });
    const output = fs.openSync(path.join(logsDir, "dashboard.log"), "a");
    const child = spawn(process.execPath, [path.join(__dirname, "dashboard-server.js")], {
      cwd: projectRoot,
      detached: true,
      stdio: ["ignore", output, output],
      env: process.env
    });
    child.unref();
    fs.closeSync(output);

    if (!(await waitForUrl(dashboardUrl))) {
      console.error(`分析中心启动失败，请查看 ${path.join(logsDir, "dashboard.log")}`);
      return 1;
    }
  }

  console.log(`正在打开分析中心: ${dashboardUrl}`);
  openUrl(dashboardUrl);
  return 0;
}

async function fullWorkflow({ test = false } = {}) {
  const exportCode = await exportData(test ? 1 : undefined);
  if (exportCode !== 0) {
    console.error("导出失败，已停止后续导入。");
    return exportCode;
  }

  const importCode = importData();
  if (importCode !== 0) {
    console.error("数据导入失败，未打开分析中心。");
    return importCode;
  }

  return openDashboard();
}

function printMenu() {
  console.log("");
  console.log("请选择要执行的操作：");
  console.log("  1. 一键完整流程（登录确认 → 全量导出 → 导入 → 分析中心）");
  console.log("  2. 测试流程（只导出 1 条 → 导入 → 分析中心）");
  console.log("  3. 打开登录浏览器");
  console.log("  4. 仅全量导出并导入");
  console.log("  5. 仅导入已有下载文件");
  console.log("  6. 打开分析中心");
  console.log("  7. 检查当前页面按钮");
  console.log("  0. 退出");
  console.log("");
}

function printHelp() {
  console.log("用法: run.bat [命令]");
  console.log("");
  console.log("命令:");
  console.log("  full       全量导出、导入并打开分析中心");
  console.log("  test       测试导出 1 条、导入并打开分析中心");
  console.log("  browser    打开登录浏览器");
  console.log("  export     全量导出并导入");
  console.log("  import     仅导入已有文件");
  console.log("  dashboard  打开分析中心");
  console.log("  inspect    检查当前页面按钮");
}

async function execute(command) {
  if (!ensureDependencies()) return 1;

  switch (command) {
    case "full":
    case "1":
      return fullWorkflow();
    case "test":
    case "2":
      return fullWorkflow({ test: true });
    case "browser":
    case "3":
      return runNode("open-browser.js");
    case "export":
    case "4": {
      const code = await exportData();
      return code === 0 ? importData() : code;
    }
    case "import":
    case "5":
      return importData();
    case "dashboard":
    case "6":
      return openDashboard();
    case "inspect":
    case "7":
      if (!(await prepareBrowser())) return 1;
      return runNode("inspect-page.js");
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return 0;
    case "0":
    case "exit":
      return 0;
    default:
      console.error(`未知命令: ${command}`);
      printHelp();
      return 1;
  }
}

async function main() {
  printTitle();
  const command = process.argv[2];
  if (command) return execute(command.toLowerCase());

  if (!ensureDependencies()) return 1;
  printMenu();
  return execute(await ask("请输入序号: "));
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
