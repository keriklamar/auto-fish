// parseSpike.js — сверка JS-ядра (runParse) с зафиксированным эталоном.
// Эталон снят при доказанном байт-в-байт паритете с исходным Python-ядром.
// usage: node parseSpike.js [docx] [json] [ref_runParse.json]  (по умолчанию — sample.*)

const fs = require("fs");
const path = require("path");
const { parseDocxFile } = require("../core/parseDocx");
const { loadTranscriptFile } = require("../core/parseTranscript");
const { runParse } = require("../core/analyze");

const FIX = path.join(__dirname, "fixtures");
const docxPath = process.argv[2] || path.join(FIX, "sample.docx");
const jsonPath = process.argv[3] || path.join(FIX, "sample.json");
const refPath = process.argv[4] || path.join(FIX, "ref_runParse.json");

function r3(x) {
  return Math.round(x * 1000) / 1000;
}

function cmpArr(name, a, b, fmt) {
  if (a.length !== b.length) {
    console.log(`  ${name}: длина JS ${a.length} ≠ PY ${b.length}`);
  }
  let miss = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const sa = JSON.stringify(fmt(a[i]));
    const sb = JSON.stringify(fmt(b[i]));
    if (sa !== sb) {
      miss++;
      if (miss <= 8) console.log(`  ${name}[${i}]:\n    JS ${sa}\n    PY ${sb}`);
    }
  }
  console.log(`  ${name}: расхождений ${miss}/${n}` + (miss === 0 && a.length === b.length ? "  ✅" : ""));
  return miss === 0 && a.length === b.length;
}

(async () => {
  const docxResult = await parseDocxFile(docxPath, 25);
  const jsonWords = loadTranscriptFile(jsonPath);
  const res = runParse(docxResult, jsonWords);
  const ref = JSON.parse(fs.readFileSync(refPath, "utf-8"));

  console.log("STATS JS:", JSON.stringify(res.stats));
  console.log("STATS PY:", JSON.stringify(ref.stats));
  const statsOk =
    JSON.stringify({ ...res.stats, total_cut_seconds: r3(res.stats.total_cut_seconds) }) ===
    JSON.stringify({ ...ref.stats, total_cut_seconds: r3(ref.stats.total_cut_seconds) });
  console.log("stats:", statsOk ? "✅ совпадают" : "❌ РАЗЛИЧАЮТСЯ");

  console.log("\ncuts:");
  const cutsOk = cmpArr(
    "cuts",
    res.cuts,
    ref.cuts,
    (c) => [r3(c[0]), r3(c[1])]
  );

  console.log("\nflagged:");
  const flOk = cmpArr("flagged", res.flagged, ref.flagged, (f) => ({
    red_text: f.red_text,
    speaker: f.speaker,
    block_tc: f.block_tc,
    block_text: f.block_text,
  }));

  console.log("\nannotations:");
  const annOk = cmpArr("annotations", res.annotations, ref.annotations, (a) => ({
    start: r3(a.start),
    text: a.text,
  }));

  console.log("\nstandalone_notes:");
  const ntOk = cmpArr(
    "standalone_notes",
    res.standalone_notes,
    ref.standalone_notes,
    (nt) => ({ start: r3(nt.start), text: nt.text })
  );

  console.log(
    "\n=== ИТОГ:",
    statsOk && cutsOk && flOk && annOk && ntOk ? "✅ ПОЛНЫЙ ПАРИТЕТ" : "❌ есть расхождения"
  );
  process.exit(statsOk && cutsOk && flOk && annOk && ntOk ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
