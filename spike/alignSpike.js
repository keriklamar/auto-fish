// alignSpike.js — привязка сценария к транскрипту секвенции по тексту (core/align.js) + runParse со сдвигом таймкодов.
const fs = require("fs");
const assert = require("assert");
const { runParse } = require("../core/analyze");
const { alignBlocks } = require("../core/align");

// ---- синтетика ----
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
const rnd = rng(7);
const vocab = Array.from({ length: 4000 }, (_, i) => "слово" + i.toString(36) + "ъ");
const pick = () => vocab[Math.floor(rnd() * vocab.length)];

// блок: 12 слов за 5 секунд, подряд
function makeDoc(n, redFn) {
  const blocks = [];
  for (let i = 0; i < n; i++) {
    const words = Array.from({ length: 12 }, () => pick());
    blocks.push({ start: i * 5, end: i * 5 + 5, speaker: "Speaker 1", words: words.map((w, k) => [w, redFn(i, k)]) });
  }
  return blocks;
}
// транскрипт секвенции: нужные блоки дока, поставленные на времена t0 + …; extra — вставки (подводки), которых нет в доке
function makeJson(blocks, ids, offsetFn, extra = []) {
  const out = [];
  for (const i of ids) {
    const b = blocks[i];
    const off = offsetFn(i);
    b.words.forEach((w, k) => out.push({ start: b.start + off + k * (5 / 12), end: b.start + off + (k + 0.9) * (5 / 12), text: w[0] }));
  }
  for (const e of extra) e.words.forEach((w, k) => out.push({ start: e.t + k * 0.4, end: e.t + k * 0.4 + 0.35, text: w }));
  out.sort((a, b) => a.start - b.start);
  return out;
}
const red = (i, k) => i === 25 || (i === 30 && k >= 8) || i === 12 || i === 45;

// 1) один сдвинутый кусок: блоки 20..40 лежат в секвенции с нуля (сдвиг −100)
{
  const blocks = makeDoc(60, red);
  const ids = []; for (let i = 20; i <= 40; i++) ids.push(i);
  const json = makeJson(blocks, ids, () => -100);
  const r = runParse({ blocks, notes: [] }, json, { fps: 25 });
  assert.strictEqual(r.alignment.mode, "aligned");
  assert.strictEqual(r.alignment.pieces.length, 1, "один кусок");
  assert.ok(Math.abs(r.alignment.pieces[0].offset + 100) < 0.2, "сдвиг −100, получили " + r.alignment.pieces[0].offset);
  assert.strictEqual(r.stats.n_blocks, 21, "в работе 21 блок (20..40)");
  assert.strictEqual(r.stats.n_skipped_blocks, 39, "остальные 39 блоков вне секвенции");
  // блок 25 красный целиком: он в секвенции на 25*5−100 = 25..30
  assert.ok(r.cuts.some((c) => Math.abs(c[0] - 25) < 0.1 && Math.abs(c[1] - 30) < 0.1), "вырез блока 25 со сдвигом: " + JSON.stringify(r.cuts));
  // красные блоки 12 и 45 — вне секвенции: их вырезов быть не должно
  assert.ok(r.cuts.every((c) => c[0] >= -0.001 && c[1] <= 105.1), "вырезы внутри секвенции");
  assert.ok(!r.cuts.some((c) => c[0] < 0), "нет вырезов в отрицательном времени (это блок 12 без сдвига)");
  // блок 30: красная только хвостовая часть -> один вырез внутри 50..55
  assert.ok(r.cuts.some((c) => c[0] >= 50 - 0.2 && c[1] <= 50 + 5.1 && c[1] - c[0] < 3), "частичный вырез блока 30");
  console.log("синтетика 1 (один сдвинутый кусок): OK");
}

// 2) два куска с разными сдвигами + подводка внутри первого
{
  const blocks = makeDoc(70, red);
  const idsA = []; for (let i = 8; i <= 18; i++) idsA.push(i); // сдвиг −20  -> секвенция 20..75
  const idsB = []; for (let i = 40; i <= 50; i++) idsB.push(i); // сдвиг −40 + 55 = стыкуем сразу после первого
  // первая часть: блоки 8..18 на времени (i*5 − 20); вторая: блоки 40..50 на времени (i*5 − 145) -> сдвиг −145
  const json = makeJson(blocks, [...idsA, ...idsB], (i) => (i <= 18 ? -20 : -145), [{ t: 36.2, words: ["подводка", "про", "партнёра", "Том", "Пушка", "очень", "вкусно", "и", "сытно"] }]);
  const r = runParse({ blocks, notes: [] }, json, { fps: 25 });
  assert.strictEqual(r.alignment.mode, "aligned");
  assert.strictEqual(r.alignment.pieces.length, 2, "два куска: " + JSON.stringify(r.alignment.pieces));
  const offs = r.alignment.pieces.map((p) => Math.round(p.offset)).sort((a, b) => a - b);
  assert.deepStrictEqual(offs, [-145, -20]);
  // красный блок 12 (в первом куске): время в секвенции 12*5−20 = 40..45
  assert.ok(r.cuts.some((c) => Math.abs(c[0] - 40) < 0.1 && Math.abs(c[1] - 45) < 0.1), "вырез блока 12 в первом куске");
  // красный блок 45 (во втором): 45*5−145 = 80..85
  assert.ok(r.cuts.some((c) => Math.abs(c[0] - 80) < 0.1 && Math.abs(c[1] - 85) < 0.1), "вырез блока 45 во втором куске");
  console.log("синтетика 2 (два куска с разным сдвигом): OK");
}

// 3) подводка в доке внутри диапазона, которой нет в транскрипте, не режется
{
  const blocks = makeDoc(40, red);
  // «подводка» в доке: блок 22 заменён чужим текстом (в секвенции его нет)
  blocks[22].words = Array.from({ length: 12 }, () => [pick() + "x", true]);
  const ids = []; for (let i = 5; i <= 35; i++) if (i !== 22) ids.push(i);
  const json = makeJson(blocks, ids, () => -10);
  const r = runParse({ blocks, notes: [] }, json, { fps: 25 });
  assert.strictEqual(r.alignment.mode, "aligned");
  assert.ok(r.skipped_blocks.some((s) => Math.abs(s.start - 110) < 0.01), "блок 22 исключён как отсутствующий в секвенции");
  assert.ok(!r.cuts.some((c) => c[0] <= 100 + 0.1 && c[1] >= 105 - 0.1), "вырез подводки (красный блок 22) не создан");
  console.log("синтетика 3 (подводка в доке, которой нет в секвенции): OK");
}

// 4) без сдвига результат совпадает со старым (по TC)
{
  const blocks = makeDoc(40, red);
  const ids = []; for (let i = 0; i < 40; i++) ids.push(i);
  const json = makeJson(blocks, ids, () => 0);
  const a = runParse({ blocks, notes: [] }, json, { fps: 25 });
  const b = runParse({ blocks, notes: [] }, json, { fps: 25, alignTimecodes: false });
  assert.strictEqual(a.alignment.mode, "aligned");
  assert.ok(Math.abs(a.alignment.pieces[0].offset) < 0.2);
  assert.deepStrictEqual(a.cuts, b.cuts, "при нулевом сдвиге вырезы совпадают со старым способом");
  console.log("синтетика 4 (нулевой сдвиг = как раньше): OK");
}

// 5) транскрипт не имеет ничего общего со сценарием -> режим «none», без падений
{
  const blocks = makeDoc(30, red);
  const json = Array.from({ length: 200 }, (_, i) => ({ start: i * 0.4, end: i * 0.4 + 0.3, text: "чужое" + i }));
  const r = runParse({ blocks, notes: [] }, json, { fps: 25 });
  assert.strictEqual(r.alignment.mode, "none");
  console.log("синтетика 5 (нет совпадений): режим none, без падений OK");
}

console.log("✅ alignSpike OK");
