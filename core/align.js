// align.js — привязка блоков сценария к транскрипту секвенции по ТЕКСТУ, а не по таймкоду.
//
// Таймкоды .docx — это время в той секвенции, с которой редактор получил транскрипт. Если монтажёр потом
// собрал «часть сценария» в другую секвенцию (например, пять семей из середины программы), время в
// секвенции и TC в сценарии расходятся на константу (например, −36:10). Резать по TC сценария в таком
// случае нельзя: попадёшь не туда. Здесь для каждого блока ищется его место в JSON-транскрипте
// (по 4-граммам слов), смещение считается по якорям, блоки, которых в секвенции нет (подводки, соседние
// семьи), отбрасываются.
//
// Транскрипт секвенции — «до резки», поэтому в нём есть ВСЕ слова блока, красные тоже.

const { norm, isMarker, blockFullText } = require("./parseDocx");
const { secToTc } = require("./timecode");

const N = 4; // длина n-граммы

const DEFAULTS = {
  alignTimecodes: true,
  minAnchorWords: 6, // блок короче якорем не служит
  minAnchors: 3, // меньше якорей — выравнивание не доверяем
  jitter: 1.0, // скачок смещения между соседними якорями больше этого начинает новый кусок
  window: 7, // окно скользящей медианы по якорям
  minTranscriptHit: 0.3, // блок, слов которого почти нет в транскрипте, — вставка/подводка
  minHitEdge: 0.5, // строже на краях (рядом с границей куска)
  minWordsForHit: 3,
  hitMargin: 1.5,
};

function cleanWords(block) {
  return block.words.filter((w) => !isMarker(w[0])).map((w) => norm(w[0])).filter(Boolean);
}

function buildIndex(jsonWords) {
  const jn = jsonWords.map((w) => norm(w.text));
  const idx = new Map();
  for (let i = 0; i + N <= jn.length; i++) {
    const k = jn[i] + "|" + jn[i + 1] + "|" + jn[i + 2] + "|" + jn[i + 3];
    let l = idx.get(k);
    if (!l) idx.set(k, (l = []));
    l.push(i);
  }
  return { jn, idx };
}

// позиция блока (индекс слова в JSON) по голосованию 4-грамм
function locateBlock(words, index) {
  if (words.length < N) return null;
  const votes = new Map();
  for (let i = 0; i + N <= words.length; i++) {
    const l = index.idx.get(words[i] + "|" + words[i + 1] + "|" + words[i + 2] + "|" + words[i + 3]);
    if (!l || l.length > 2) continue; // частые фразы (вроде «я думаю что») не опора
    for (const p of l) votes.set(p - i, (votes.get(p - i) || 0) + 1);
  }
  let best = null;
  let bv = 0;
  for (const [p, v] of votes) if (v > bv) { bv = v; best = p; }
  if (best === null || bv < Math.max(2, Math.floor((words.length - N + 1) / 4))) return null;
  return { pos: best, votes: bv, n: words.length };
}

// доля слов блока, найденных среди слов JSON в окне вокруг блока (jsonWords отсортированы по start)
function transcriptHit(block, jsonWords, margin = 1.5) {
  const dw = cleanWords(block);
  if (dw.length === 0) return { hit: 1, n: 0 };
  const lo = block.start - margin;
  const hi = block.end + margin;
  let a = 0;
  let b = jsonWords.length;
  while (a < b) {
    const m = (a + b) >> 1;
    if (jsonWords[m].start < lo) a = m + 1;
    else b = m;
  }
  const set = new Set();
  for (let i = a; i < jsonWords.length && jsonWords[i].start <= hi; i++) {
    const t = norm(jsonWords[i].text);
    if (t) set.add(t);
  }
  let found = 0;
  for (const x of dw) if (set.has(x)) found++;
  return { hit: found / dw.length, n: dw.length };
}

function median(arr) {
  const s = arr.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function shiftBlock(b, off) {
  return Object.assign({}, b, { start: b.start + off, end: b.end + off, docStart: b.start, docEnd: b.end, offset: off });
}

function skippedEntry(b, hit, fps, reason) {
  return {
    start: b.start,
    end: b.end,
    speaker: b.speaker || "",
    hit,
    reason,
    text: blockFullText(b).slice(0, 120),
    block_tc: `${secToTc(b.start, fps)} - ${secToTc(b.end, fps)}`,
  };
}

function alignBlocks(docxResult, jsonWords, opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  const fps = cfg.fps || 25;
  const blocks = docxResult.blocks;
  const notes = docxResult.notes || [];
  const jsonEnd = jsonWords.length ? jsonWords[jsonWords.length - 1].end : 0;
  const skipped = [];

  // режим без выравнивания по тексту: TC как есть + (необязательно) фильтр блоков, которых нет в транскрипте
  const noAlign = (mode) => {
    const out = [];
    for (const b of blocks) {
      if (cfg.minTranscriptHit > 0) {
        const t = transcriptHit(b, jsonWords, cfg.hitMargin);
        if (t.n >= cfg.minWordsForHit && t.hit < cfg.minTranscriptHit) { skipped.push(skippedEntry(b, t.hit, fps, "not_in_transcript")); continue; }
      }
      out.push(shiftBlock(b, 0));
    }
    const keep = new Set(out.map((b) => b.docEnd.toFixed(3)));
    const nn = notes.filter((x) => keep.has(x.start.toFixed(3)));
    return { blocks: out, notes: nn, skipped, info: { mode, pieces: [], mainOffset: 0, anchored: 0, accepted: out.length, total: blocks.length } };
  };
  if (!cfg.alignTimecodes) return noAlign("off");

  // 1) якоря: блоки, найденные в транскрипте по тексту
  const index = buildIndex(jsonWords);
  const anchors = [];
  blocks.forEach((b, bi) => {
    const w = cleanWords(b);
    if (w.length < cfg.minAnchorWords) return;
    const loc = locateBlock(w, index);
    if (!loc || loc.pos < 0 || loc.pos >= jsonWords.length) return;
    anchors.push({ bi, off: jsonWords[loc.pos].start - b.start, votes: loc.votes, n: loc.n });
  });
  if (anchors.length < cfg.minAnchors) return noAlign("none");

  // 2) куски с постоянным смещением: скользящая медиана гасит одиночные выбросы (TC блока ≠ началу первого слова)
  const half = cfg.window >> 1;
  const local = anchors.map((_, k) => median(anchors.slice(Math.max(0, k - half), Math.min(anchors.length, k + half + 1)).map((a) => a.off)));
  let pieces = [];
  anchors.forEach((a, k) => {
    const last = pieces[pieces.length - 1];
    if (last && Math.abs(local[k] - local[k - 1]) <= cfg.jitter) last.items.push(k);
    else pieces.push({ items: [k] });
  });
  pieces.forEach((p) => {
    p.off = median(p.items.map((k) => anchors[k].off));
    p.first = anchors[p.items[0]].bi;
    p.last = anchors[p.items[p.items.length - 1]].bi;
  });
  // одиночный якорь — кусок только если он сильный (длинный блок, много голосов)
  pieces = pieces.filter((p) => p.items.length >= 2 || (anchors[p.items[0]].n >= 12 && anchors[p.items[0]].votes >= 4));
  if (pieces.length === 0) return noAlign("none");

  // 3) каждый якорный блок принадлежит своему куску; соседей между якорями размечаем по ближайшим кускам
  const pieceOfBlock = new Map();
  for (const p of pieces) for (const k of p.items) pieceOfBlock.set(anchors[k].bi, p);
  const anchoredIdx = Array.from(pieceOfBlock.keys()).sort((x, y) => x - y);
  const prevA = new Array(blocks.length).fill(-1);
  const nextA = new Array(blocks.length).fill(-1);
  {
    let p = -1;
    for (let i = 0; i < blocks.length; i++) { if (pieceOfBlock.has(i)) p = i; prevA[i] = p; }
    let q = -1;
    for (let i = blocks.length - 1; i >= 0; i--) { if (pieceOfBlock.has(i)) q = i; nextA[i] = q; }
  }

  const out = [];
  const accepted = new Map(); // docEnd -> смещение, для привязки заметок
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    let off = null;
    if (pieceOfBlock.has(i)) {
      off = pieceOfBlock.get(i).off;
    } else {
      const P = prevA[i] >= 0 ? pieceOfBlock.get(prevA[i]) : null;
      const Q = nextA[i] >= 0 ? pieceOfBlock.get(nextA[i]) : null;
      const inside = !!P && P === Q;
      const cands = [];
      if (P) cands.push({ off: P.off, anchor: prevA[i] });
      if (Q && Q !== P) cands.push({ off: Q.off, anchor: nextA[i] });
      const words = cleanWords(b).length;
      if (words >= cfg.minWordsForHit) {
        let best = null;
        for (const c of cands) {
          const t = transcriptHit(shiftBlock(b, c.off), jsonWords, cfg.hitMargin);
          if (!best || t.hit > best.hit) best = { off: c.off, hit: t.hit };
        }
        if (best && best.hit >= (inside ? cfg.minTranscriptHit : cfg.minHitEdge)) off = best.off;
        else skipped.push(skippedEntry(b, best ? best.hit : 0, fps, "not_in_transcript"));
      } else if (inside) {
        off = P.off; // совсем короткий блок посреди куска («Да.», «Ага.»)
      } else {
        // короткий блок на стыке кусков: берём ближайший по сценарию якорь, если он рядом
        let bestC = null;
        for (const c of cands) {
          const ab = blocks[c.anchor];
          const dist = c.anchor < i ? b.start - ab.end : ab.start - b.end;
          if (!bestC || dist < bestC.dist) bestC = { off: c.off, dist };
        }
        if (bestC && bestC.dist <= 6) off = bestC.off;
        else skipped.push(skippedEntry(b, 0, fps, "not_in_transcript"));
      }
    }
    if (off === null) continue;
    const sb = shiftBlock(b, off);
    if (sb.end < -1 || sb.start > jsonEnd + 5) { skipped.push(skippedEntry(b, 0, fps, "outside")); continue; }
    out.push(sb);
    accepted.set(b.end.toFixed(3), off);
  }

  // 4) заметки редактора стоят сразу после блока (start = конец блока) — сдвигаем вместе с ним
  const outNotes = [];
  for (const nt of notes) {
    const off = accepted.get(nt.start.toFixed(3));
    if (off === undefined) continue;
    outNotes.push(Object.assign({}, nt, { start: nt.start + off, docStart: nt.start, offset: off }));
  }

  const info = {
    mode: "aligned",
    pieces: pieces
      .map((p) => {
        const dS = blocks[p.first].start;
        const dE = blocks[p.last].end;
        return { docStart: dS, docEnd: dE, seqStart: dS + p.off, seqEnd: dE + p.off, offset: p.off, anchors: p.items.length };
      })
      .sort((a, b) => a.docStart - b.docStart),
    anchored: anchoredIdx.length,
    accepted: out.length,
    total: blocks.length,
  };
  info.mainOffset = info.pieces.reduce((m, p) => (p.anchors > (m ? m.anchors : -1) ? p : m), null).offset;
  return { blocks: out, notes: outNotes, skipped, info };
}

module.exports = { alignBlocks, transcriptHit, locateBlock, buildIndex, cleanWords, DEFAULTS };
