const assert = require("assert");
const { safeFilename } = require("../src/playwright-utils");

assert.strictEqual(safeFilename("普通标题-数据明细表.xlsx"), "普通标题-数据明细表.xlsx");

const longTitle = "很长的标题".repeat(80);
for (const ext of [".xlsx", ".json"]) {
  const result = safeFilename(`${longTitle}-数据明细表${ext}`);
  assert(result.length <= 160);
  assert(result.endsWith(`-数据明细表${ext}`));
}

console.log("playwright-utils tests passed");
