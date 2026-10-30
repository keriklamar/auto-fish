// markersSpike.js — юнит-тест mapTimeAfterCuts + прогон на реальных cuts.
const assert = require("assert");
const path = require("path");
const { parseDocxFile } = require("../core/parseDocx");
const { loadTranscriptFile } = require("../core/parseTranscript");
const { runParse } = require("../core/analyze");
const { mapTimeAfterCuts, remapMarkers } = require("../core/markers");

function almost(a, b, eps = 1e-9) {
  assert(Math.abs(a - b) < eps, `${a} ≈ ${b}?`);
}

// синтетика: вырезы [10,20] и [40,45]
const cuts = [
  [10, 20],
  [40, 45],
];
almost(mapTimeAfterCuts(5, cuts), 5); // до всех вырезов — не двигается
almost(mapTimeAfterCuts(25, cuts), 15); // после первого выреза (-10)
almost(mapTimeAfterCuts(50, cuts), 35); // после обоих (-10-5)
almost(mapTimeAfterCuts(15, cuts), 10); // внутри первого — в точку склейки (10)
almost(mapTimeAfterCuts(10, cuts), 10); // ровно на границе начала
almost(mapTimeAfterCuts(20, cuts), 10); // ровно на границе конца (вырезан) -> склейка
almost(mapTimeAfterCuts(42, cuts), 30); // внутри второго: 42-10-(42-40)=30
console.log("синтетика: OK");

// на реальных данных
(async () => {
  const dir = path.join(__dirname, "fixtures");
  const dr = await parseDocxFile(path.join(dir, "sample.docx"), 25);
  const words = loadTranscriptFile(path.join(dir, "sample.json"));
  const res = runParse(dr, words, { fps: 25, minTranscriptHit: 0, alignTimecodes: false });

  const totalCut = res.cuts.reduce((a, [s, e]) => a + (e - s), 0);
  const seqEnd = res.cuts[res.cuts.length - 1][1];

  // маркер в самом конце должен сдвинуться примерно на totalCut
  almost(mapTimeAfterCuts(seqEnd + 100, res.cuts), seqEnd + 100 - totalCut, 1e-6);

  // монотонность: отображение неубывающее
  let prev = -1;
  for (let t = 0; t < seqEnd; t += 3.7) {
    const m = mapTimeAfterCuts(t, res.cuts);
    assert(m >= prev - 1e-9, `не монотонно при t=${t}: ${m} < ${prev}`);
    assert(m <= t + 1e-9, `сдвиг вперёд при t=${t}`);
    prev = m;
  }

  const rf = remapMarkers(res.flagged, res.cuts);
  const rn = remapMarkers(res.standalone_notes, res.cuts);
  console.log(
    `реальные: flagged ${rf.length}, notes ${rn.length}; ` +
      `первый flagged ${res.flagged[0].start.toFixed(2)}s -> ${rf[0].start.toFixed(2)}s; ` +
      `суммарный вырез ${totalCut.toFixed(1)}s`
  );
  console.log("✅ markersSpike OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
