// parseDocx.js — JS-порт core/parser.py: parse_docx() + мелкие хелперы
// (is_marker, norm, block_full_text).
//
// Соответствие python-docx:
//   paragraph.text = конкатенация текста всех runs (+ hyperlink-текст)
//   paragraph.runs = только прямые w:r (внутри w:hyperlink НЕ считаются)
//   run.font.highlight_color is not None  <=>  есть <w:highlight> с val != "none"

const fs = require("fs");
const JSZip = require("jszip");
const { XMLParser } = require("fast-xml-parser");
const { detectTcMode, parseTcRange } = require("./timecode");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  trimValues: false,
  processEntities: true,
  htmlEntities: false,
});

function tagName(node) {
  for (const k of Object.keys(node)) if (k !== ":@") return k;
  return null;
}

function runText(rChildren) {
  let out = "";
  for (const child of rChildren) {
    const t = tagName(child);
    if (t === "w:t") {
      for (const x of child["w:t"]) if ("#text" in x) out += String(x["#text"]);
    } else if (t === "w:tab") {
      out += "\t";
    } else if (t === "w:br" || t === "w:cr") {
      out += "\n";
    }
  }
  return out;
}

function runHighlighted(rChildren) {
  for (const child of rChildren) {
    if (tagName(child) !== "w:rPr") continue;
    for (const pr of child["w:rPr"]) {
      if (tagName(pr) !== "w:highlight") continue;
      const val = (pr[":@"] || {})["@_w:val"];
      if (val === undefined) return true;
      return val !== "none";
    }
  }
  return false;
}

function findChild(children, name) {
  for (const c of children) if (tagName(c) === name) return c[name];
  return null;
}

function extractParagraphs(documentXml) {
  const root = parser.parse(documentXml);
  const doc = findChild(root, "w:document");
  if (!doc) throw new Error("no w:document");
  const body = findChild(doc, "w:body");
  if (!body) throw new Error("no w:body");

  const paras = [];
  for (const node of body) {
    if (tagName(node) !== "w:p") continue;
    const pChildren = node["w:p"];
    const runs = [];
    let text = "";
    for (const c of pChildren) {
      const t = tagName(c);
      if (t === "w:r") {
        const rt = runText(c["w:r"]);
        runs.push({ text: rt, highlight: runHighlighted(c["w:r"]) });
        text += rt;
      } else if (t === "w:hyperlink") {
        for (const hc of c["w:hyperlink"]) {
          if (tagName(hc) === "w:r") text += runText(hc["w:r"]);
        }
      }
    }
    paras.push({ text, runs });
  }
  return paras;
}

// ---- порт parse_docx ----

const MARKER_RE = /^[А-ЯЁ]{3,}[.,!?…:;]*$/;

function isMarker(word) {
  return MARKER_RE.test(word.trim());
}

function norm(word) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}_]/gu, "");
}

function isSpeakerLine(t) {
  const s = t.trim();
  return s.startsWith("Speaker") || s === "Unknown";
}

function blockFullText(block) {
  return block.words.map((w) => w[0]).join(" ");
}

function splitWords(s) {
  return s.split(/\s+/).filter(Boolean);
}

function parseDocxParas(paras, fps = 25) {
  const blocks = [];
  const notes = [];
  let i = 0;
  const n = paras.length;

  // режим таймкода определяем один раз по всему документу
  const mode = detectTcMode(paras.map((p) => p.text));

  while (i < n) {
    const range = parseTcRange(paras[i].text.trim(), mode, fps);
    if (!range) {
      i++;
      continue;
    }
    const start = range.start;
    const end = range.end;
    i++;

    let speaker = null;
    if (i < n && isSpeakerLine(paras[i].text)) {
      speaker = paras[i].text.trim();
      i++;
    }

    const textParas = [];
    while (i < n) {
      const t = paras[i].text.trim();
      if (t === "" || parseTcRange(t, mode, fps)) break;
      textParas.push(paras[i]);
      i++;
    }

    const words = [];
    for (const p of textParas) {
      for (const r of p.runs) {
        for (const w of splitWords(r.text)) words.push([w, r.highlight]);
      }
    }

    blocks.push({ start, end, speaker, words });

    while (i < n) {
      const t = paras[i].text.trim();
      if (t === "") {
        i++;
        continue;
      }
      if (parseTcRange(t, mode, fps)) break;
      notes.push({ start: end, text: t });
      i++;
    }
  }

  return { blocks, notes };
}

async function parseDocxBuffer(buf, fps = 25) {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file("word/document.xml");
  if (!entry) throw new Error("word/document.xml не найден в .docx");
  const xml = await entry.async("string");
  return parseDocxParas(extractParagraphs(xml), fps);
}

async function parseDocxFile(docxPath, fps = 25) {
  return parseDocxBuffer(fs.readFileSync(docxPath), fps);
}

module.exports = {
  parseDocxFile,
  parseDocxBuffer,
  parseDocxParas,
  extractParagraphs,
  isMarker,
  norm,
  blockFullText,
};
