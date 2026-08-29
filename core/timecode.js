// timecode.js — таймкоды и Python-совместимое округление.
//
// Форматы TC-заголовков блоков, которые понимаем:
//   Premiere-экспорт:  HH:MM:SS:FF - HH:MM:SS:FF   (режим "smpte", есть кадры)
//   рукописные:        MM:SS / M:SS / HH:MM:SS / H:MM:SS  (режим "clock", без кадров)
// Режим определяется по документу один раз (detectTcMode): если хоть одна строка
// содержит 4-групповой TC (d:dd:dd:dd) — весь документ smpte, иначе clock.

// Python3 round(): half-to-even. Math.round() в JS — half-up.
function pyRound(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

function tcToSec(h, m, s, f, fps = 25) {
  return h * 3600 + m * 60 + s + f / fps;
}

function secToTc(sec, fps = 25) {
  sec = Math.max(0, sec);
  let h = Math.floor(sec / 3600);
  let m = Math.floor((sec % 3600) / 60);
  let s = Math.floor(sec % 60);
  let f = pyRound((sec % 1) * fps);
  if (f >= fps) {
    f = 0;
    s += 1;
  }
  const p2 = (n) => String(n).padStart(2, "0");
  return `${p2(h)}:${p2(m)}:${p2(s)}:${p2(f)}`;
}

function snapToFrame(sec, fps) {
  return pyRound(sec * fps) / fps;
}

// ---- разбор TC-заголовков ----

// один TC-токен: 2..4 группы 1-2 цифр через ":" или ";"
const TC_TOKEN = "\\d{1,2}(?:[:;]\\d{1,2}){1,3}";
const DASH = "[-\\u2012\\u2013\\u2014\\u2212\\u2010\\u2011]";
const RANGE_RE = new RegExp(
  "^\\s*(" + TC_TOKEN + ")\\s*" + DASH + "\\s*(" + TC_TOKEN + ")"
);
// строка целиком похожа на 4-групповой TC где-нибудь
const HAS_SMPTE_RE = /\d{1,2}[:;]\d{1,2}[:;]\d{1,2}[:;]\d{1,2}/;

function detectTcMode(texts) {
  for (const t of texts) if (HAS_SMPTE_RE.test(t)) return "smpte";
  return "clock";
}

function tcTokenToSec(tok, mode, fps) {
  const rev = tok.split(/[:;]/).map(Number).reverse();
  if (mode === "smpte") {
    const f = rev[0] || 0;
    const s = rev[1] || 0;
    const m = rev[2] || 0;
    const h = rev[3] || 0;
    return h * 3600 + m * 60 + s + f / fps;
  }
  const s = rev[0] || 0;
  const m = rev[1] || 0;
  const h = rev[2] || 0;
  return h * 3600 + m * 60 + s;
}

// -> {start, end} в секундах, либо null если строка не TC-заголовок блока
function parseTcRange(text, mode, fps = 25) {
  const m = RANGE_RE.exec(text);
  if (!m) return null;
  const start = tcTokenToSec(m[1], mode, fps);
  const end = tcTokenToSec(m[2], mode, fps);
  // защита от ложных срабатываний на прозе ("12:30 - 13:45 обед")
  if (!(end >= start) || end - start > 1800) return null;
  return { start: start, end: end };
}

function isTcHeader(text, mode, fps) {
  return parseTcRange(text, mode, fps) !== null;
}

module.exports = {
  pyRound,
  tcToSec,
  secToTc,
  snapToFrame,
  detectTcMode,
  parseTcRange,
  isTcHeader,
};
