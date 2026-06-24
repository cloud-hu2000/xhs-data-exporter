const fs = require("fs");
const path = require("path");
const { loadConfig, projectRoot } = require("./config");

const SECRET_KEYS = new Set([
  "apikey",
  "api_key",
  "authorization",
  "dashscope_api_key"
]);

function isDebugEnabled() {
  return Boolean(loadConfig().debug);
}

function sanitizeString(value) {
  const text = value.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]");
  if (/^data:[^;]+;base64,/.test(text)) {
    const prefix = text.slice(0, text.indexOf(",") + 1);
    return `${prefix}[base64 omitted, ${text.length} chars]`;
  }
  if (text.length > 20000) {
    return `${text.slice(0, 20000)}...[truncated, ${text.length} chars total]`;
  }
  return text;
}

function sanitizeForDebug(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }
  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForDebug(item, seen));
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (SECRET_KEYS.has(key.toLowerCase())) return [key, "[REDACTED]"];
      return [key, sanitizeForDebug(item, seen)];
    }));
  }
  return String(value);
}

function writeDebugLog(scope, event, details = {}) {
  if (!isDebugEnabled()) return;
  const logsDir = path.join(projectRoot, "logs");
  const date = new Date();
  const logPath = path.join(logsDir, `debug-${date.toISOString().slice(0, 10)}.log`);
  const entry = {
    timestamp: date.toISOString(),
    scope,
    event,
    details: sanitizeForDebug(details)
  };
  fs.mkdirSync(logsDir, { recursive: true });
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
}

module.exports = {
  isDebugEnabled,
  sanitizeForDebug,
  writeDebugLog
};
