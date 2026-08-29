// runfiles.js — запись данных прогона в JSON для ExtendScript-резчика
// (аналог того, что раньше делал core/jsx_generator.py перед сборкой .jsx).

const fs = require("fs");
const path = require("path");

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

// ExtendScript читает эти файлы через eval("(" + text + ")"). Валидный JSON,
// но U+2028 / U+2029 внутри строк = валидный JSON и НЕвалидный JS -> экранируем.
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

function toJsxSafeJson(value) {
  return JSON.stringify(value)
    .split(LS).join("\\u2028")
    .split(PS).join("\\u2029");
}

// runDir — папка (обычно <extension>/run). Перезаписывается каждый раз,
// никаких «магических» путей в %LOCALAPPDATA%.
function writeRunFiles(runDir, { cuts, flagged, notes, ann }) {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, "af_cuts.json"),
    toJsxSafeJson(cuts.map((c) => [round3(c[0]), round3(c[1])]))
  );
  fs.writeFileSync(path.join(runDir, "af_flagged.json"), toJsxSafeJson(flagged));
  fs.writeFileSync(path.join(runDir, "af_annotations.json"), toJsxSafeJson(ann));
  fs.writeFileSync(path.join(runDir, "af_notes.json"), toJsxSafeJson(notes));
}

module.exports = { writeRunFiles, toJsxSafeJson };
