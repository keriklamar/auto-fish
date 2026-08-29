// parseDocxSpike.js — сверка JS-парсера .docx с зафиксированным эталоном.
// usage: node parseDocxSpike.js [docx] [ref_parseDocx.json]  (по умолчанию — sample.*)

const fs = require("fs");
const path = require("path");
const { parseDocxFile: parseDocx } = require("../core/parseDocx");

const FIX = path.join(__dirname, "fixtures");
const docxPath = process.argv[2] || path.join(FIX, "sample.docx");
const refPath = process.argv[3] || path.join(FIX, "ref_parseDocx.json");

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

(async () => {
  const { blocks, notes } = await parseDocx(docxPath, 25);

  const totalWords = blocks.reduce((a, b) => a + b.words.length, 0);
  const totalMarked = blocks.reduce(
    (a, b) => a + b.words.filter((w) => w[1]).length,
    0
  );
  console.log(
    `JS:  blocks=${blocks.length} words=${totalWords} marked=${totalMarked} notes=${notes.length}`
  );

  if (!refPath || !fs.existsSync(refPath)) {
    console.log("(нет эталона — только вывод JS)");
    console.log("first block:", JSON.stringify(blocks[0], null, 1).slice(0, 800));
    return;
  }

  const ref = JSON.parse(fs.readFileSync(refPath, "utf-8"));
  const rb = ref.blocks;
  const rWords = rb.reduce((a, b) => a + b.words.length, 0);
  const rMarked = rb.reduce(
    (a, b) => a + b.words.filter((w) => w[1]).length,
    0
  );
  console.log(
    `PY:  blocks=${rb.length} words=${rWords} marked=${rMarked} notes=${ref.notes.length}`
  );

  let mismatches = 0;
  const nb = Math.min(blocks.length, rb.length);
  for (let bi = 0; bi < nb; bi++) {
    const a = blocks[bi];
    const b = rb[bi];
    const problems = [];
    if (round3(a.start) !== b.start) problems.push(`start ${round3(a.start)}≠${b.start}`);
    if (round3(a.end) !== b.end) problems.push(`end ${round3(a.end)}≠${b.end}`);
    if ((a.speaker || null) !== (b.speaker || null))
      problems.push(`speaker ${JSON.stringify(a.speaker)}≠${JSON.stringify(b.speaker)}`);
    if (a.words.length !== b.words.length)
      problems.push(`nwords ${a.words.length}≠${b.words.length}`);
    else {
      for (let wi = 0; wi < a.words.length; wi++) {
        if (a.words[wi][0] !== b.words[wi][0]) {
          problems.push(`word[${wi}] "${a.words[wi][0]}"≠"${b.words[wi][0]}"`);
          break;
        }
        if (Boolean(a.words[wi][1]) !== Boolean(b.words[wi][1])) {
          problems.push(
            `mark[${wi}] "${a.words[wi][0]}" ${a.words[wi][1]}≠${b.words[wi][1]}`
          );
          break;
        }
      }
    }
    if (problems.length) {
      mismatches++;
      if (mismatches <= 15)
        console.log(`  block ${bi}: ${problems.join("; ")}`);
    }
  }
  if (blocks.length !== rb.length)
    console.log(`  ! разное число блоков: JS ${blocks.length} vs PY ${rb.length}`);

  // notes
  let noteMiss = 0;
  const nn = Math.min(notes.length, ref.notes.length);
  for (let i = 0; i < nn; i++) {
    if (
      notes[i].text !== ref.notes[i].text ||
      round3(notes[i].start) !== round3(ref.notes[i].start)
    ) {
      noteMiss++;
      if (noteMiss <= 10)
        console.log(
          `  note ${i}: JS ${JSON.stringify(notes[i])} vs PY ${JSON.stringify(
            ref.notes[i]
          )}`
        );
    }
  }
  if (notes.length !== ref.notes.length)
    console.log(`  ! разное число заметок: JS ${notes.length} vs PY ${ref.notes.length}`);

  console.log(
    `\nИТОГ: блоков с расхождениями ${mismatches}/${nb}, заметок ${noteMiss}/${nn}`
  );
  if (mismatches === 0 && noteMiss === 0 && blocks.length === rb.length && notes.length === ref.notes.length) {
    console.log("✅ ПОЛНОЕ СОВПАДЕНИЕ");
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
