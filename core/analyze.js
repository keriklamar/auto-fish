// analyze.js — порт ядра core/parser.py:
//   find_annotations, find_red_spans, map_idx, resolve_partial_block,
//   merge_close_cuts, run_parse.

const { SequenceMatcher } = require("./difflib");
const { snapToFrame, secToTc } = require("./timecode");
const { isMarker, norm, blockFullText } = require("./parseDocx");

const DEFAULTS = {
  fps: 25,
  gapMergeFrames: 5,
  matchWindowMargin: 3.0,
};

// ---- 3. заметки внутри блока (ЗАГЛАВНЫЕ слова) ----

function findAnnotations(block) {
  const words = block.words;
  const n = words.length;
  if (n === 0) return [];
  const dur = block.end - block.start;
  const out = [];
  let i = 0;
  while (i < n) {
    if (isMarker(words[i][0])) {
      let j = i;
      const parts = [];
      while (j < n && isMarker(words[j][0])) {
        parts.push(words[j][0]);
        j++;
      }
      const approxTime = block.start + (i / n) * dur;
      out.push({ start: approxTime, text: parts.join(" ") });
      i = j;
    } else {
      i++;
    }
  }
  return out;
}

// ---- 4. fuzzy-сопоставление частично-красных блоков ----

function findRedSpans(cleanWords) {
  const spans = [];
  let start = null;
  for (let i = 0; i < cleanWords.length; i++) {
    const red = cleanWords[i][1];
    if (red && start === null) {
      start = i;
    } else if (!red && start !== null) {
      spans.push([start, i - 1]);
      start = null;
    }
  }
  if (start !== null) spans.push([start, cleanWords.length - 1]);
  return spans;
}

function mapIdx(docxIdx, matchingBlocks, direction = 0) {
  for (const b of matchingBlocks) {
    if (b.size === 0) continue;
    if (b.a <= docxIdx && docxIdx < b.a + b.size) {
      return b.b + (docxIdx - b.a);
    }
  }
  if (direction !== 0) {
    const candidates = [];
    for (const b of matchingBlocks) {
      if (b.size === 0) continue;
      for (let off = 0; off < b.size; off++) {
        candidates.push([b.a + off, b.b + off]);
      }
    }
    candidates.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    if (direction === -1) {
      const prior = candidates.filter((c) => c[0] <= docxIdx);
      if (prior.length) return prior[prior.length - 1][1];
    } else {
      const later = candidates.filter((c) => c[0] >= docxIdx);
      if (later.length) return later[0][1];
    }
  }
  return null;
}

function resolvePartialBlock(block, allJsonWords, margin) {
  const cleanWords = block.words.filter((w) => !isMarker(w[0]));
  const redSpans = findRedSpans(cleanWords);
  if (redSpans.length === 0) return [];

  const lo = block.start - margin;
  const hi = block.end + margin;
  const local = allJsonWords.filter((w) => lo <= w.start && w.start <= hi);
  if (local.length === 0) {
    return [{ cut: null, reason: "no_json_words_in_window", red_text: null }];
  }

  const docxNorm = cleanWords.map((w) => norm(w[0]));
  const jsonNorm = local.map((w) => norm(w.text));
  const sm = new SequenceMatcher(docxNorm, jsonNorm);
  const matchingBlocks = sm.getMatchingBlocks();

  const results = [];
  for (const [sIdx, eIdx] of redSpans) {
    const jStart = mapIdx(sIdx, matchingBlocks, +1);
    const jEnd = mapIdx(eIdx, matchingBlocks, -1);
    const redParts = [];
    for (let i = sIdx; i <= eIdx; i++) redParts.push(cleanWords[i][0]);
    const redText = redParts.join(" ");
    if (jStart === null || jEnd === null || jStart > jEnd) {
      results.push({ cut: null, reason: "match_failed", red_text: redText });
    } else {
      results.push({
        cut: [local[jStart].start, local[jEnd].end],
        reason: "matched",
        red_text: redText,
      });
    }
  }
  return results;
}

// ---- 5. сборка финального cut-листа ----

function mergeCloseCuts(cuts, gapMergeSec) {
  if (cuts.length === 0) return [];
  const sorted = cuts.slice().sort((a, b) => a[0] - b[0]);
  const merged = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    const last = merged[merged.length - 1];
    if (s - last[1] < gapMergeSec) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }
  return merged;
}

// ---- 6. главная функция ----

function runParse(docxResult, jsonWords, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const blocks = docxResult.blocks;
  const standaloneNotes = docxResult.notes;

  const cuts = [];
  const flagged = [];
  const annotations = [];
  let nFull = 0;
  let nPartialOk = 0;
  let nPartialFail = 0;
  let nClean = 0;

  for (const b of blocks) {
    for (const a of findAnnotations(b)) annotations.push(a);
  }

  for (const b of blocks) {
    const cleanWords = b.words.filter((w) => !isMarker(w[0]));
    if (cleanWords.length === 0) continue;
    const allRed = cleanWords.every((w) => w[1]);
    const anyRed = cleanWords.some((w) => w[1]);

    if (allRed) {
      cuts.push([b.start, b.end]);
      nFull++;
    } else if (anyRed) {
      const results = resolvePartialBlock(b, jsonWords, cfg.matchWindowMargin);
      for (const r of results) {
        if (r.cut !== null) {
          cuts.push(r.cut);
          nPartialOk++;
        } else {
          nPartialFail++;
          flagged.push({
            start: b.start,
            end: b.end,
            red_text: r.red_text || "?",
            speaker: b.speaker || "",
            block_text: blockFullText(b),
            block_tc: `${secToTc(b.start, cfg.fps)} - ${secToTc(b.end, cfg.fps)}`,
          });
        }
      }
    } else {
      nClean++;
    }
  }

  const gapMergeSec = cfg.gapMergeFrames / cfg.fps;
  let merged = mergeCloseCuts(cuts, gapMergeSec);
  merged = merged.map(([s, e]) => [
    snapToFrame(s, cfg.fps),
    snapToFrame(e, cfg.fps),
  ]);
  merged = mergeCloseCuts(merged, gapMergeSec);

  const totalDur = merged.reduce((acc, [s, e]) => acc + (e - s), 0);

  const stats = {
    n_blocks: blocks.length,
    n_full_red: nFull,
    n_partial_matched: nPartialOk,
    n_partial_failed: nPartialFail,
    n_clean: nClean,
    n_raw_cuts: cuts.length,
    n_final_cuts: merged.length,
    total_cut_seconds: totalDur,
    n_annotations: annotations.length,
    n_standalone_notes: standaloneNotes.length,
  };

  return {
    cuts: merged,
    flagged,
    annotations,
    standalone_notes: standaloneNotes,
    stats,
  };
}

module.exports = {
  DEFAULTS,
  findAnnotations,
  findRedSpans,
  mapIdx,
  resolvePartialBlock,
  mergeCloseCuts,
  runParse,
};
