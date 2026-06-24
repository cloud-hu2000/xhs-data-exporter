const util = require("util");

const INSTALLED = Symbol.for("xhs-data-exporter.console-logger.installed");
const ORIGINALS = Symbol.for("xhs-data-exporter.console-logger.originals");

const LABELS = {
  debug: "调试日志",
  error: "错误日志",
  info: "信息日志",
  log: "普通日志",
  warn: "警告日志"
};

function isBlankLine(args) {
  return args.length === 0 || (args.length === 1 && args[0] === "");
}

function formatConsoleMessage(level, args) {
  const label = LABELS[level] || "日志";
  return `[${label}] 内容: ${util.format(...args)}`;
}

function installConsoleLogger() {
  if (console[INSTALLED]) return console[ORIGINALS];

  const originals = {};
  for (const level of Object.keys(LABELS)) {
    if (typeof console[level] !== "function") continue;
    originals[level] = console[level].bind(console);
    console[level] = (...args) => {
      if (isBlankLine(args)) {
        originals[level]("");
        return;
      }
      originals[level]("");
      originals[level](formatConsoleMessage(level, args));
      originals[level]("");
    };
  }

  console[ORIGINALS] = originals;
  console[INSTALLED] = true;
  return originals;
}

module.exports = {
  formatConsoleMessage,
  installConsoleLogger
};
