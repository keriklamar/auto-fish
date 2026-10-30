// reorderSpike.js — проверки перестановки: buildPieces / mapTimeReordered / runParse.pieces
const path = require("path");
const assert = require("assert");
const { buildPieces, subtractCuts } = require("../core/reorder");
const { mapTimeReordered } = require("../core/markers");
const { parseDocxFile } = require("../core/parseDocx");
const { loadTranscriptFile } = require("../core/parseTranscript");
const { runParse } = require("../core/analyze");

const sum = (ps) => ps.reduce((a, [s, e]) => a + (e - s), 0);

// --- синтетика ---
assert.deepStrictEqual(subtractCuts(0, 10, [[2, 3], [5, 7]]), [[0, 2], [3, 5], [7, 10]]);

// 3 блока в исходнике: A[0,10] B[10,20] C[20,30]; док: C, A, B; в A вырез [4,6]
const blocks = [
  { start: 20, end: 30 },
  { start: 0, end: 10 },
  { start: 10, end: 20 },
];
let r = buildPieces(blocks, [[], [[4, 6]], []], { fps: 25 });
assert.deepStrictEqual(r.pieces, [[20, 30], [0, 4], [6, 20]]); // A-хвост и B смежны -> склеены
assert.strictEqual(r.reordered, true);
assert.strictEqual(r.jumps, 1);
assert.strictEqual(sum(r.pieces), 30 - 2);

// монотонный док даёт кусок = исходник минус вырезы
r = buildPieces([{ start: 0, end: 10 }, { start: 10, end: 20 }], [[[4, 6]], []], { fps: 25 });
assert.deepStrictEqual(r.pieces, [[0, 4], [6, 20]]);
assert.strictEqual(r.reordered, false);

// маркеры
const P = [[20, 30], [0, 4], [6, 20]];
assert.strictEqual(mapTimeReordered(25, P), 5);
assert.strictEqual(mapTimeReordered(1, P), 11);
assert.strictEqual(mapTimeReordered(7, P), 15);
assert.strictEqual(mapTimeReordered(5, P), 14); // внутри выреза -> к началу следующего куска
const { remapMarkersReordered } = require("../core/markers");
assert.deepStrictEqual(remapMarkersReordered([{ start: 25 }, { start: 1 }], P).map((m) => m.start), [5, 11]);
// крупные блоки: док C,A,B -> run склеивает смежные A+B; дубль отбрасывается
const { buildRuns } = require("../core/reorder");
const { runsAfterCuts, remapMarkersFull } = require("../core/markers");
let rr = buildRuns([{ start: 20, end: 30 }, { start: 0, end: 10 }, { start: 10, end: 20 }], { fps: 25 });
assert.deepStrictEqual(rr.runs, [[20, 30], [0, 20]]);
rr = buildRuns([{ start: 0, end: 10 }, { start: 10, end: 20 }, { start: 0, end: 10 }], { fps: 25 });
assert.deepStrictEqual(rr.runs, [[0, 20]]);
assert.strictEqual(rr.droppedDuplicates, 1);
// вырез [4,6] внутри первого блока: в координатах порезанного таймлайна
const post = runsAfterCuts([[20, 30], [0, 20]], [[4, 6]]);
assert.deepStrictEqual(post, [[18, 28], [0, 18]]);
// маркер на исходной 25с: после порезки 23, после перестановки 5
assert.strictEqual(remapMarkersFull([{ start: 25 }], [[4, 6]], post)[0].start, 5);
assert.strictEqual(remapMarkersFull([{ start: 1 }], [[4, 6]], post)[0].start, 11);
const { cutsToReordered } = require("../core/reorder");
const { remapMarkersReorderFirst } = require("../core/markers");
// блоки [20,30],[0,20]; вырез [4,6] (в исходных) -> после перестановки [14,16]; вырез на границе блоков делится
assert.deepStrictEqual(cutsToReordered([[4, 6]], [[20, 30], [0, 20]]), [[14, 16]]);
assert.deepStrictEqual(cutsToReordered([[19, 21]], [[20, 30], [0, 20]]), [[0, 1], [29, 30]]);
// маркер на исходной 25с: после перестановки 5, вырезов раньше нет -> 5; маркер на 1с: 11 -> после выреза [14,16] остаётся 11
assert.strictEqual(remapMarkersReorderFirst([{ start: 25 }], [[20, 30], [0, 20]], [[14, 16]])[0].start, 5);
assert.strictEqual(remapMarkersReorderFirst([{ start: 17 }], [[20, 30], [0, 20]], [[14, 16]])[0].start, 25);
console.log("синтетика: OK");

// --- реальная фикстура ---
(async () => {
  const FIX = path.join(__dirname, "fixtures");
  const d = await parseDocxFile(path.join(FIX, "sample.docx"), 25);
  const w = loadTranscriptFile(path.join(FIX, "sample.json"));
  const res = runParse(d, w, { fps: 25, minTranscriptHit: 0, alignTimecodes: false });
  assert.ok(res.reordered, "в фикстуре есть перестановки");
  assert.ok(res.reorder_warnings.duplicates > 0, "дубли должны попасть в warnings");

  // без дублей: сумма кусков = покрытие исходника минус вырезы, куски не перекрываются в исходнике
  const seen = new Set();
  const uniqBlocks = d.blocks.filter((b) => {
    const k = Math.round(b.start * 1000) + "-" + Math.round(b.end * 1000);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const r2 = runParse({ blocks: uniqBlocks, notes: d.notes }, w, { fps: 25, minTranscriptHit: 0, alignTimecodes: false });
  const bySrc = r2.pieces.slice().sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < bySrc.length; i++) {
    assert.ok(bySrc[i][0] >= bySrc[i - 1][1] - 1e-6, "перекрытие кусков в исходнике");
  }
  const last = uniqBlocks.reduce((m, b) => Math.max(m, b.end), 0);
  const expected = last - r2.stats.total_cut_seconds;
  const got = sum(r2.pieces);
  console.log(`кусков ${r2.pieces.length}, перестановок (разрывов порядка) ${r2.reorder_jumps}, итог ${got.toFixed(1)}s, ожидалось ≈${expected.toFixed(1)}s; в полном доке дублей: ${res.reorder_warnings.duplicates}`);
  assert.ok(Math.abs(got - expected) < 2, "сумма длин не сходится");
  console.log("✅ reorderSpike OK");
})().catch((e) => { console.error("❌", e.message); process.exit(1); });
