const fs = require("fs");
const path = require("path");

function normalizeTitle(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseSrt(text) {
  const cues = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) return false;
        if (/^\d+$/.test(line)) return false;
        return !/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[,.]\d{3}/.test(line);
      })
      .join("")
    )
    .filter(Boolean);

  return cues.reduce((result, cue) => {
    if (!result) return cue;
    const separator = /[，。！？；：,.!?;:]$/.test(result) ? "" : "，";
    return `${result}${separator}${cue}`;
  }, "");
}

function readDescription(filePath) {
  try {
    const metadata = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return String(metadata?.description || "").trim();
  } catch {
    return "";
  }
}

function recordDirectory(exportDir, projectRoot, record) {
  for (const relativePath of record?.mediaFiles || []) {
    const resolved = path.resolve(projectRoot, relativePath);
    const relative = path.relative(exportDir, resolved);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
      return path.dirname(resolved);
    }
  }

  if (!fs.existsSync(exportDir)) return null;
  const matchingDirectory = fs.readdirSync(exportDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.includes(record?.noteId || ""));
  return matchingDirectory ? path.join(exportDir, matchingDirectory.name) : null;
}

function createProfileTranscriptReader(projectRoot) {
  const exportDir = path.join(projectRoot, "profile-exports");
  const manifestPath = path.join(exportDir, "manifest.json");

  function readManifest() {
    if (!fs.existsSync(manifestPath)) return [];
    try {
      const payload = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      return Array.isArray(payload) ? payload : [];
    } catch {
      return [];
    }
  }

  function safeExportPath(relativePath) {
    const resolved = path.resolve(projectRoot, relativePath);
    const relative = path.relative(exportDir, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return resolved;
  }

  function findChineseSubtitle(record) {
    const candidates = (record?.mediaFiles || [])
      .filter((file) => /^subtitle-zh-cn-\d+\.srt$/i.test(path.basename(file)))
      .sort((left, right) => left.localeCompare(right, "zh-CN"));
    for (const candidate of candidates) {
      const filePath = safeExportPath(candidate);
      if (filePath && fs.existsSync(filePath)) return filePath;
    }
    return null;
  }

  function get(note) {
    const targetKeys = new Set(
      [note?.noteKey, note?.title].map(normalizeTitle).filter(Boolean)
    );
    const record = readManifest().find((item) =>
      targetKeys.has(normalizeTitle(item.title))
    );
    if (!record) return null;

    const subtitlePath = findChineseSubtitle(record);
    if (subtitlePath) {
      const transcript = parseSrt(fs.readFileSync(subtitlePath, "utf8"));
      if (transcript) {
        return {
          transcript,
          source: "profile-srt",
          noteId: record.noteId || "",
          subtitleFile: path.relative(projectRoot, subtitlePath)
        };
      }
    }

    const directory = recordDirectory(exportDir, projectRoot, record);
    const metadataPath = directory && path.join(directory, "metadata.json");
    const caption = metadataPath && fs.existsSync(metadataPath)
      ? readDescription(metadataPath)
      : "";
    if (!caption) return null;
    return {
      caption,
      source: "profile-metadata",
      noteId: record.noteId || "",
      metadataFile: path.relative(projectRoot, metadataPath)
    };
  }

  return { get };
}

module.exports = {
  createProfileTranscriptReader,
  normalizeTitle,
  parseSrt
};
