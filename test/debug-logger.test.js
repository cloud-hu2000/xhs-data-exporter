const assert = require("assert");
const { sanitizeForDebug } = require("../src/debug-logger");

const sanitized = sanitizeForDebug({
  headers: {
    Authorization: "Bearer real-secret-token"
  },
  apiKey: "real-api-key",
  image: "data:image/png;base64,abcdefg",
  nested: {
    text: "ok"
  },
  error: new Error("boom")
});

assert.equal(sanitized.headers.Authorization, "[REDACTED]");
assert.equal(sanitized.apiKey, "[REDACTED]");
assert.equal(sanitized.image, "data:image/png;base64,[base64 omitted, 29 chars]");
assert.equal(sanitized.nested.text, "ok");
assert.equal(sanitized.error.message, "boom");

console.log("debug-logger tests passed");
