// tcSpike.js — проверка parseTcRange / detectTcMode на разных форматах.
const assert = require("assert");
const { detectTcMode, parseTcRange } = require("../core/timecode");

function check(name, text, mode, fps, expStart, expEnd) {
  const r = parseTcRange(text, mode, fps);
  assert(r, `${name}: не распознано`);
  assert(Math.abs(r.start - expStart) < 1e-9, `${name}: start ${r.start} ≠ ${expStart}`);
  assert(Math.abs(r.end - expEnd) < 1e-9, `${name}: end ${r.end} ≠ ${expEnd}`);
  console.log(`  ok  ${name.padEnd(28)} ${text}  ->  ${r.start} .. ${r.end}`);
}

// режим
assert.strictEqual(detectTcMode(["Speaker 1", "00:00:01:12 - 00:00:02:00", "текст"]), "smpte");
assert.strictEqual(detectTcMode(["Speaker 1", "01:28 - 01:35", "текст"]), "clock");
assert.strictEqual(detectTcMode(["просто текст без таймкодов"]), "clock");
console.log("detectTcMode: ok");

// SMPTE (Premiere-экспорт), fps 25
check("smpte HH:MM:SS:FF", "00:00:01:12 - 00:00:02:00", "smpte", 25, 1 + 12 / 25, 2);
check("smpte без ведущих 0", "1:2:3:4 - 1:2:5:0", "smpte", 25, 3723 + 4 / 25, 3725);
check("smpte 3 группы = M:S:F", "01:28:14 - 01:30:00", "smpte", 25, 88 + 14 / 25, 90);
check("smpte drop-frame ;", "00:00:01:12 - 00:00:02;00", "smpte", 25, 1 + 12 / 25, 2);
check("smpte en-dash", "00:01:00:00 – 00:01:02:00", "smpte", 25, 60, 62);
check("smpte fps 30", "00:00:00:15 - 00:00:01:00", "smpte", 30, 15 / 30, 1);

// clock (рукописные), fps не важен
check("clock MM:SS", "01:28 - 01:35", "clock", 25, 88, 95);
check("clock M:SS", "1:28 - 1:35", "clock", 25, 88, 95);
check("clock HH:MM:SS", "01:02:03 - 01:02:10", "clock", 25, 3723, 3730);
check("clock H:MM:SS", "1:02:03 - 1:02:10", "clock", 25, 3723, 3730);
check("clock em-dash пробелы", "2:00  —  2:05", "clock", 25, 120, 125);

// НЕ заголовки
assert.strictEqual(parseTcRange("встретимся в 12:30 - 13:45 обед", "clock", 25), null, "проза с TC не в начале");
assert.strictEqual(parseTcRange("00:05:00 - 00:01:00", "clock", 25), null, "end < start");
assert.strictEqual(parseTcRange("00:00:00 - 01:00:00", "clock", 25), null, "блок > 30 мин");
assert.strictEqual(parseTcRange("обычный текст реплики", "clock", 25), null, "просто текст");
console.log("не-заголовки: ok");

console.log("\n✅ tcSpike OK");
