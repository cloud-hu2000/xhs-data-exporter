const assert = require("assert");
const {
  buildActionableEvidence,
  buildEvidenceCatalog,
  buildFactDiagnostics,
  buildNextContentStatus,
  quantile,
  referencesForClient,
  selectExitRateMetric
} = require("../src/content-strategy");

assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);

const notes = [
  { noteKey: "a", title: "A", impressions: 100, views: 10, coverClickRatePct: 9, hasOfficialCoverClickRate: true, twoSecondExitRatePct: 70, hasTwoSecondExitRate: true, completionRatePct: 10, hasCompletionRate: true, collects: 0, comments: 0 },
  { noteKey: "b", title: "B", impressions: 200, views: 80, coverClickRatePct: 5, hasOfficialCoverClickRate: true, twoSecondExitRatePct: 40, hasTwoSecondExitRate: true, completionRatePct: 20, hasCompletionRate: true, collects: 8, comments: 4 },
  { noteKey: "c", title: "C", impressions: 300, views: 180, coverClickRatePct: 3, hasOfficialCoverClickRate: true, twoSecondExitRatePct: 20, hasTwoSecondExitRate: true, completionRatePct: 30, hasCompletionRate: true, collects: 30, comments: 12 },
  { noteKey: "d", title: "D", impressions: 400, views: 300, coverClickRatePct: 1, hasOfficialCoverClickRate: true, twoSecondExitRatePct: 10, hasTwoSecondExitRate: true, completionRatePct: 40, hasCompletionRate: true, collects: 60, comments: 30 }
];

const result = buildFactDiagnostics(notes, notes[0]);
assert.equal(result.metrics.impressions.band, "low");
assert.equal(result.metrics.officialCoverClickRate.band, "high");
assert.equal(result.metrics.twoSecondExitRate.band, "high");
assert.equal(result.metrics.collectRate.band, "low");
assert(result.facts.some((item) => item.conclusion.includes("账号内前 25%")));
const evidence = buildEvidenceCatalog(notes);
assert(evidence.some((item) => item.id === "note-0.officialCoverClickRate"));
assert(evidence.every((item) => item.text.includes("账号中位数")));

assert.equal(buildNextContentStatus(notes).eligible, true);
assert.equal(buildNextContentStatus(notes.slice(0, 2)).eligible, false);
assert.equal(selectExitRateMetric(notes).seconds, 2);

const fiveSecondNotes = notes.map((note, index) => ({
  ...note,
  fiveSecondExitRatePct: 10 + index,
  hasFiveSecondExitRate: true
}));
assert.equal(selectExitRateMetric(fiveSecondNotes).seconds, 5);

const actionable = buildActionableEvidence(notes, ["a", "b", "c", "d"]);
assert.equal(actionable.groups.cover.strong[0].noteKey, "a");
assert.equal(actionable.groups.opening.strong[0].noteKey, "d");
assert.equal(actionable.groups.completion.strong[0].noteKey, "d");
const references = referencesForClient(actionable);
assert.equal(references.cover.strong[0].value, undefined);
assert.equal(references.cover.strong.length, 3);

console.log("content-strategy tests passed");
