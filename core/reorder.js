// reorder.js — сборка «кусков» (pieces) в порядке дока редактора.
//
// Док составлен по хронологии итогового видео: порядок блоков в нём = порядок на
// итоговом таймлайне, а таймкод блока = положение в ИСХОДНОЙ секвенции.
// Для каждого блока считаем его «экстент» в исходнике (от начала блока до начала
// следующего по времени блока — так паузы между репликами едут вместе с
// предыдущей репликой и исходник покрывается без дыр и без перекрытий),
// вычитаем красные вырезы блока и выстраиваем остаток в порядке дока.

const { snapToFrame } = require("./timecode");

const EPS = 1e-6;

// вычесть из [s,e] список вырезов (отсортированный, непересекающийся) -> оставшиеся куски
function subtractCuts(s, e, cuts) {
  const out = [];
  let cur = s;
  for (const [cs, ce] of cuts) {
    if (ce <= cur + EPS) continue;
    if (cs >= e - EPS) break;
    if (cs > cur + EPS) out.push([cur, Math.min(cs, e)]);
    cur = Math.max(cur, ce);
    if (cur >= e - EPS) break;
  }
  if (cur < e - EPS) out.push([cur, e]);
  return out;
}

// экстент блока в исходнике: от его начала до начала следующего по времени блока (паузы едут с репликой)
function computeExtents(blocks, opts, warnings) {
  const n = blocks.length;
  // уникальные диапазоны исходника (дубли — блоки с тем же таймкодом, редактор использовал участок повторно:
  // каждый экземпляр получает свой полный кусок, как в доке; число дублей идёт в warnings)
  const key = (x) => Math.round(x.start * 1000) + "-" + Math.round(x.end * 1000);
  const groups = new Map();
  blocks.forEach((b, i) => {
    const k = key(b);
    if (!groups.has(k)) groups.set(k, { start: b.start, end: b.end, idx: [] });
    groups.get(k).idx.push(i);
  });
  const uniq = Array.from(groups.values()).sort((x, y) => x.start - y.start || x.end - y.end);

  const extent = new Array(n);
  for (let k = 0; k < uniq.length; k++) {
    const cur = uniq[k];
    const next = uniq[k + 1];
    let s = cur.start;
    let e = cur.end;
    if (k === 0) s = 0; // материал до первой реплики едет с первой по времени репликой
    if (cur.idx.length > 1) warnings.duplicates += cur.idx.length - 1;
    if (next) {
      if (next.start < cur.end - EPS) warnings.overlaps++;
      e = Math.max(next.start, s);
    } else if (opts.totalDur && opts.totalDur > e) {
      e = opts.totalDur;
    }
    for (const i of cur.idx) extent[i] = [s, e];
  }

  return { extent, uniq };
}

// Крупные блоки в порядке дока БЕЗ вычитания красного: куски, смежные в исходнике и подряд в доке, склеены.
// Повторно использованный участок (дубль) оставляем только первым вхождением — клип нельзя «переставить» дважды.
function buildRuns(blocks, opts = {}) {
  const warnings = { overlaps: 0, duplicates: 0 };
  if (blocks.length === 0) return { runs: [], droppedDuplicates: 0, warnings };
  const { extent } = computeExtents(blocks, opts, warnings);
  const seen = new Set();
  const runs = [];
  let dropped = 0;
  for (let i = 0; i < blocks.length; i++) {
    const [s, e] = extent[i];
    if (e - s < EPS) continue;
    const key = Math.round(s * 1000) + '-' + Math.round(e * 1000);
    if (seen.has(key)) { dropped++; continue; }
    seen.add(key);
    const last = runs[runs.length - 1];
    if (last && Math.abs(last[1] - s) < EPS) last[1] = e;
    else runs.push([s, e]);
  }
  return { runs, droppedDuplicates: dropped, warnings };
}

// blocks: в порядке дока; blockCuts[i]: вырезы блока i (уже склеенные и отсортированные)
// opts: { fps, totalDur? } — totalDur (сек) продлевает хвост последнего по времени блока до конца секвенции
function buildPieces(blocks, blockCuts, opts = {}) {
  const fps = opts.fps || 25;
  const n = blocks.length;
  const warnings = { overlaps: 0, duplicates: 0 };
  if (n === 0) return { pieces: [], reordered: false, jumps: 0, warnings };

  const { extent, uniq } = computeExtents(blocks, opts, warnings);

  // вырез блока может выйти за его экстент (границы слов в JSON шире таймкода блока) —
  // тогда выступающая часть применяется и к соседнему экстенту (только к первому экземпляру при дублях)
  const cutsFor = blockCuts.map((c) => (c || []).slice());
  for (let i = 0; i < n; i++) {
    for (const [cs, ce] of blockCuts[i] || []) {
      for (const [os, oe] of subtractCuts(cs, ce, [extent[i]])) {
        for (const g of uniq) {
          const gs = extent[g.idx[0]][0];
          const ge = extent[g.idx[0]][1];
          if (g.idx.includes(i) || ge <= os + EPS || gs >= oe - EPS) continue;
          cutsFor[g.idx[0]].push([Math.max(os, gs), Math.min(oe, ge)]);
        }
      }
    }
  }
  const normCuts = (list) => {
    const sorted = list.slice().sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const c of sorted) {
      const last = out[out.length - 1];
      if (last && c[0] <= last[1] + EPS) last[1] = Math.max(last[1], c[1]);
      else out.push([c[0], c[1]]);
    }
    return out;
  };

  const raw = [];
  for (let i = 0; i < n; i++) {
    const [s, e] = extent[i];
    if (e - s < EPS) continue;
    for (const [ps, pe] of subtractCuts(s, e, normCuts(cutsFor[i]))) {
      const a = snapToFrame(ps, fps);
      const b = snapToFrame(pe, fps);
      if (b - a > EPS) raw.push([a, b]);
    }
  }

  // склеиваем куски, смежные в исходнике и идущие подряд в целевом порядке
  const merged = [];
  for (const p of raw) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last[1] - p[0]) < EPS) last[1] = p[1];
    else merged.push([p[0], p[1]]);
  }

  // как в старом режиме (mergeCloseCuts): остаток короче gapMergeSec, зажатый вырезами с обеих
  // сторон (в исходнике рядом нет других кусков), считается частью выреза и отбрасывается
  const gap = opts.gapMergeSec || 0;
  const pieces = gap > 0 ? merged.filter((p, ix) => {
    if (p[1] - p[0] >= gap) return true;
    let left = false;
    let right = false;
    for (let j = 0; j < merged.length; j++) {
      if (j === ix) continue;
      const q = merged[j];
      if (q[0] < p[0] - EPS && q[1] >= p[0] - EPS) left = true;
      if (q[0] > p[0] + EPS && q[0] <= p[1] + EPS) right = true;
      if (left && right) return true;
    }
    // зажат с обеих сторон вырезами, только если слева и справа вообще что-то было
    const hasBefore = merged.some((q) => q[1] <= p[0] + EPS);
    const hasAfter = merged.some((q) => q[0] >= p[1] - EPS);
    return !(hasBefore && hasAfter && !left && !right);
  }) : merged;

  let jumps = 0;
  for (let i = 1; i < pieces.length; i++) {
    if (pieces[i][0] < pieces[i - 1][0] - EPS) jumps++;
  }

  return { pieces, reordered: jumps > 0, jumps, warnings };
}

// Вырезы (исходные секунды) -> секунды ПОСЛЕ перестановки блоков (до резки).
// runs — крупные блоки в порядке дока (исходные координаты). Вырез, пересекающий границу блока, режется по блокам.
function cutsToReordered(cuts, runs) {
  const outStart = [];
  let acc = 0;
  for (const [s, e] of runs) { outStart.push(acc); acc += e - s; }
  const out = [];
  for (const [cs, ce] of cuts) {
    for (let i = 0; i < runs.length; i++) {
      const a = Math.max(cs, runs[i][0]);
      const b = Math.min(ce, runs[i][1]);
      if (b - a > EPS) out.push([outStart[i] + (a - runs[i][0]), outStart[i] + (b - runs[i][0])]);
    }
  }
  out.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const c of out) {
    const last = merged[merged.length - 1];
    if (last && c[0] <= last[1] + EPS) last[1] = Math.max(last[1], c[1]);
    else merged.push([c[0], c[1]]);
  }
  return merged;
}

module.exports = { buildPieces, buildRuns, subtractCuts, cutsToReordered };
