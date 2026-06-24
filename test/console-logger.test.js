const assert = require("assert");
const { formatConsoleMessage } = require("../src/console-logger");

assert.strictEqual(
  formatConsoleMessage("log", ["hello", "world"]),
  "[普通日志] 内容: hello world"
);

assert.strictEqual(
  formatConsoleMessage("error", ["failed: %s", "network"]),
  "[错误日志] 内容: failed: network"
);

console.log("console-logger tests passed");
