const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createProfileTranscriptReader, parseSrt } = require("../src/profile-transcript");

const sample = `1
00:00:00,060 --> 00:00:05,210
很多人都觉得gpt deepseek豆包都大差不差不都是一问一答

2
00:00:05,640 --> 00:00:08,352
接下来我将用二游的方式跟你讲解
`;

assert.equal(
  parseSrt(sample),
  "很多人都觉得gpt deepseek豆包都大差不差不都是一问一答，接下来我将用二游的方式跟你讲解"
);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "xhs-profile-transcript-"));
const noteDir = path.join(root, "profile-exports", "0001-note");
fs.mkdirSync(noteDir, { recursive: true });
fs.writeFileSync(path.join(noteDir, "subtitle-zh-CN-1.srt"), sample, "utf8");
fs.writeFileSync(
  path.join(root, "profile-exports", "manifest.json"),
  JSON.stringify([
    {
      noteId: "note-1",
      title: "如何选择AI模型？我用二游来告诉你答案！",
      mediaFiles: [
        "profile-exports/0001-note/subtitle-zh-CN-1.srt"
      ]
    },
    {
      noteId: "note-2",
      title: "一篇没有字幕的图文",
      mediaFiles: [
        "profile-exports/0002-note/image-01.webp"
      ]
    }
  ]),
  "utf8"
);
const imageNoteDir = path.join(root, "profile-exports", "0002-note");
fs.mkdirSync(imageNoteDir, { recursive: true });
fs.writeFileSync(
  path.join(imageNoteDir, "metadata.json"),
  JSON.stringify({ description: "这是 metadata 中的图文正文。" }),
  "utf8"
);

const reader = createProfileTranscriptReader(root);
const result = reader.get({
  noteKey: "如何选择ai模型？我用二游来告诉你答案！",
  title: "如何选择AI模型？我用二游来告诉你答案！"
});
assert(result);
assert.equal(result.source, "profile-srt");
assert(result.transcript.startsWith("很多人都觉得gpt deepseek豆包"));
assert(result.transcript.includes("一问一答，接下来"));
const captionResult = reader.get({
  noteKey: "一篇没有字幕的图文",
  title: "一篇没有字幕的图文"
});
assert.equal(captionResult.source, "profile-metadata");
assert.equal(captionResult.caption, "这是 metadata 中的图文正文。");
assert.equal(reader.get({ noteKey: "不存在", title: "不存在" }), null);

fs.rmSync(root, { recursive: true, force: true });
console.log("profile-transcript tests passed");
