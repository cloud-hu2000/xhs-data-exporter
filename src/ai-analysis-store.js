const fs = require("fs");
const path = require("path");

function createAiAnalysisStore(filePath) {
  function read() {
    if (!fs.existsSync(filePath)) return { version: 1, notes: {} };
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return payload && payload.notes ? payload : { version: 1, notes: {} };
    } catch {
      return { version: 1, notes: {} };
    }
  }

  function write(database) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(database, null, 2), "utf8");
  }

  function get(noteKey) {
    return read().notes[noteKey] || null;
  }

  function list() {
    return read().notes;
  }

  function merge(noteKey, patch) {
    if (!noteKey) throw new Error("缺少 noteKey");
    const database = read();
    database.notes[noteKey] = {
      ...(database.notes[noteKey] || {}),
      ...patch,
      noteKey,
      updatedAt: new Date().toISOString()
    };
    write(database);
    return database.notes[noteKey];
  }

  return { get, list, merge };
}

module.exports = { createAiAnalysisStore };
