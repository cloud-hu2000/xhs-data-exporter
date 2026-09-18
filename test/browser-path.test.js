const assert = require("assert");
const path = require("path");
const { browserCandidates, findBrowserExecutable } = require("../src/browser-path");

const macCandidates = browserCandidates({
  platform: "darwin",
  homeDir: "/Users/tester"
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

assert.throws(
  () => findBrowserExecutable({ platform: "win32" }),
  /Chrome、Chromium 或 Edge/
);

console.log("browser-path tests passed");
