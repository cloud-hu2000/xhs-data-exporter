const assert = require("assert");
const { loadConfig } = require("../src/config");

const config = loadConfig();
assert(config.detailTexts.includes("分析详情"));
assert(config.detailTexts.includes("详情数据"));

console.log("config tests passed");
