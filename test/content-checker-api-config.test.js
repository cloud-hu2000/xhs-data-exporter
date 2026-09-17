const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { contentCheckerApiBase } = require("../src/content-checker-api-config");

test("dashboard content checker requires a separately configured API", () => {
  assert.equal(contentCheckerApiBase({}), null);
  assert.equal(
    contentCheckerApiBase({ XHS_CONTENT_CHECKER_API_BASE: "https://api.example.com/api/content-checker/" }),
    "https://api.example.com/api/content-checker"
  );
});

test("dashboard rejects unsafe or credential-bearing content checker API bases", () => {
  assert.throws(() => contentCheckerApiBase({ XHS_CONTENT_CHECKER_API_BASE: "http://api.example.com/api/content-checker" }), /HTTPS/);
  assert.throws(() => contentCheckerApiBase({ XHS_CONTENT_CHECKER_API_BASE: "https://user:secret@api.example.com/api/content-checker" }), /凭据/);
  assert.throws(() => contentCheckerApiBase({ XHS_CONTENT_CHECKER_API_BASE: "https://api.example.com/api/content-checker?token=secret" }), /查询参数/);
  assert.equal(
    contentCheckerApiBase({ XHS_CONTENT_CHECKER_API_BASE: "http://127.0.0.1:5179/api/content-checker" }),
    "http://127.0.0.1:5179/api/content-checker"
  );
});

test("the local dashboard never imports the database router", () => {
  const dashboard = fs.readFileSync(path.resolve(__dirname, "../src/dashboard-server.js"), "utf8");
  assert.doesNotMatch(dashboard, /content-checker-router|mysql2|DATABASE_URL/);
});
