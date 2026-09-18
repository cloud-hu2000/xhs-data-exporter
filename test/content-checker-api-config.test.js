const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_CONTENT_CHECKER_API_BASE, contentCheckerApiBase } = require("../src/content-checker-api-config");

test("dashboard uses the deployed API", () => {
  assert.equal(DEFAULT_CONTENT_CHECKER_API_BASE, "http://101.37.116.48:5178/api/content-checker");
  assert.equal(contentCheckerApiBase({}), DEFAULT_CONTENT_CHECKER_API_BASE);
});

test("the local dashboard never imports database or model clients", () => {
  const dashboard = fs.readFileSync(path.resolve(__dirname, "../src/dashboard-server.js"), "utf8");
  assert.doesNotMatch(dashboard, /content-checker-router|mysql2|DATABASE_URL|bailian-client|DASHSCOPE_API_KEY/);
});
