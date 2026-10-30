// all.js — прогнать все проверки ядра разом:  node spike/all.js
const { execFileSync } = require("child_process");
const path = require("path");

const HERE = __dirname;
const FIX = path.join(HERE, "fixtures");
const docx = path.join(FIX, "sample.docx");
const json = path.join(FIX, "sample.json");

const jobs = [
  ["tcSpike.js", []],
  ["parseDocxSpike.js", [docx, path.join(FIX, "ref_parseDocx.json")]],
  ["parseSpike.js", [docx, json, path.join(FIX, "ref_runParse.json")]],
  ["markersSpike.js", []],
  ["reorderSpike.js", []],
  ["xmlSpike.js", []],
  ["alignSpike.js", []],
  ["peakSpike.js", []],
];

// локальные проверки на реальных файлах (spike/local/, в Git не входит)
try {
  const lf = require("path").join(HERE, "local");
  for (const f of require("fs").readdirSync(lf)) if (/.js$/.test(f)) jobs.push([require("path").join("local", f), []]);
} catch (e) {}

let failed = 0;
for (const [script, args] of jobs) {
  process.stdout.write(`\n=== ${script} ===\n`);
  try {
    execFileSync(process.execPath, [path.join(HERE, script), ...args], {
      stdio: "inherit",
    });
  } catch (e) {
    failed++;
  }
}
process.stdout.write(failed ? `\n❌ провалено проверок: ${failed}\n` : "\n✅ все проверки зелёные\n");
process.exit(failed ? 1 : 0);
