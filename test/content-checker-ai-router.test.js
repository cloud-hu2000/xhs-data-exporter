const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createContentCheckerAiRouter } = require("../src/content-checker-ai-router");

function start(router) {
  const app = express();
  app.use(express.json());
  app.use("/ai", router);
  const server = http.createServer(app);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

test("AI API invokes the server-side model client without accepting a client key", async (t) => {
  const calls = [];
  const server = await start(createContentCheckerAiRouter({
    aiClient: {
      config: () => ({ apiKey: "server-only-key" }),
      analyzeCover: async (note, facts) => {
        calls.push({ note, facts });
        return { markdown: "## 优势\n- 清晰" };
      },
      analyzeStrategy: async () => ({}),
      matchSimilarNotes: async () => [],
      analyzeNextContent: async () => ({})
    }
  }));
  t.after(() => server.close());
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/ai/cover`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      note: { noteKey: "note-1", coverImageUrl: "https://example.com/cover.jpg" },
      facts: { facts: [] }
    })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { analysis: { markdown: "## 优势\n- 清晰" } });
  assert.deepEqual(calls, [{
    note: { noteKey: "note-1", coverImageUrl: "https://example.com/cover.jpg" },
    facts: { facts: [] }
  }]);
});
