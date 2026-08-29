// parseTranscript.js — порт core/parser.py: load_transcript_words()
// JSON из Text-панели Premiere: { segments: [ { words: [ {start,duration,text} ] } ] }

const fs = require("fs");

function wordsFromData(data) {
  if (!data || !Array.isArray(data.segments)) {
    throw new Error(
      "Файл не похож на транскрипт Premiere: нет массива segments. " +
        "Нужен экспорт Text-панели: «•••» → Export → JSON."
    );
  }
  const words = [];
  for (const seg of data.segments) {
    if (!seg || !Array.isArray(seg.words)) continue;
    for (const w of seg.words) {
      words.push({
        start: w.start,
        end: w.start + w.duration,
        text: w.text,
      });
    }
  }
  if (words.length === 0) {
    throw new Error("В транскрипте нет ни одного слова с таймингами.");
  }
  words.sort((a, b) => a.start - b.start); // стабильная сортировка (Node ≥12)
  return words;
}

function parseJson(str, srcLabel) {
  try {
    return JSON.parse(str);
  } catch (e) {
    throw new Error("Не удалось прочитать JSON" + (srcLabel ? " (" + srcLabel + ")" : "") + ": " + e.message);
  }
}

function loadTranscriptString(str) {
  return wordsFromData(parseJson(str));
}

function loadTranscriptFile(jsonPath) {
  return wordsFromData(parseJson(fs.readFileSync(jsonPath, "utf-8"), jsonPath));
}

module.exports = { wordsFromData, loadTranscriptString, loadTranscriptFile };
