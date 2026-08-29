// difflib.js — точный порт CPython difflib.SequenceMatcher
// (только то, что нужно core/parser.py: autojunk=False, без isjunk,
// метод get_matching_blocks()).
//
// Сверено 1:1 с CPython Lib/difflib.py: __chain_b без удаления "popular"
// (autojunk=False), find_longest_match, get_matching_blocks.

class SequenceMatcher {
  constructor(a, b) {
    this.a = a;
    this.b = b;
    this._chainB();
    this.matchingBlocks = null;
  }

  _chainB() {
    const b = this.b;
    const b2j = new Map();
    for (let i = 0; i < b.length; i++) {
      const elt = b[i];
      let arr = b2j.get(elt);
      if (arr === undefined) {
        arr = [];
        b2j.set(elt, arr);
      }
      arr.push(i);
    }
    // autojunk=False, isjunk=None -> ни junk, ни popular не удаляем
    this.b2j = b2j;
  }

  findLongestMatch(alo, ahi, blo, bhi) {
    const a = this.a;
    const b = this.b;
    const b2j = this.b2j;
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;

    let j2len = new Map();
    const EMPTY = [];
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map();
      const js = b2j.get(a[i]) || EMPTY;
      for (let x = 0; x < js.length; x++) {
        const j = js[x];
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = newj2len;
    }

    // расширение по совпадающим не-junk элементам (junk пуст -> всегда сюда)
    while (
      besti > alo &&
      bestj > blo &&
      a[besti - 1] === b[bestj - 1]
    ) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (
      besti + bestsize < ahi &&
      bestj + bestsize < bhi &&
      a[besti + bestsize] === b[bestj + bestsize]
    ) {
      bestsize += 1;
    }

    return [besti, bestj, bestsize];
  }

  getMatchingBlocks() {
    if (this.matchingBlocks !== null) return this.matchingBlocks;
    const la = this.a.length;
    const lb = this.b.length;

    const queue = [[0, la, 0, lb]];
    const blocks = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const [i, j, k] = this.findLongestMatch(alo, ahi, blo, bhi);
      if (k) {
        blocks.push([i, j, k]);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }

    blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);

    let i1 = 0;
    let j1 = 0;
    let k1 = 0;
    const nonAdjacent = [];
    for (const [i2, j2, k2] of blocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2;
      } else {
        if (k1) nonAdjacent.push([i1, j1, k1]);
        i1 = i2;
        j1 = j2;
        k1 = k2;
      }
    }
    if (k1) nonAdjacent.push([i1, j1, k1]);
    nonAdjacent.push([la, lb, 0]);

    this.matchingBlocks = nonAdjacent.map(([a, b, size]) => ({ a, b, size }));
    return this.matchingBlocks;
  }
}

module.exports = { SequenceMatcher };
