const assert = require("assert");
const path = require("path");
const { browserCandidates, findBrowserExecutable } = require("../src/browser-path");

const macCandidates = browserCandidates({
  platform: "darwin",
  env: { HOME: "/Users/tester" }
});

assert(macCandidates.includes(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
));
assert(macCandidates.includes(
  "/Users/tester/Applications/Chromium.app/Contents/MacOS/Chromium"
));
assert(macCandidates.includes(
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
));

const customPath = process.execPath;
assert.strictEqual(
  findBrowserExecutable({ env: { CHROME_PATH: customPath }, platform: "darwin" }),
  customPath
);

assert.throws(
  () => findBrowserExecutable({ env: {}, platform: "win32" }),
  /Chrome、Chromium 或 Edge/
);

console.log("browser-path tests passed");
