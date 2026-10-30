// peakSpike.js — резка по звуку (core/peakAnalyze.js): синтетический звук с известными всплесками -> ожидаемые вырезы.
// Нужен ffmpeg (WinGet/PATH); без него проверка пропускается.
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { execFileSync } = require("child_process");
const peak = require("../core/peakAnalyze");

const ff = peak.findFfmpeg();
if (!ff) { console.log("ffmpeg не найден — резка по звуку не проверялась (пропуск)"); console.log("✅ peakSpike OK (пропуск)"); process.exit(0); }

const dir = path.join(__dirname, ".tmp");
fs.mkdirSync(dir, { recursive: true });
const wav = path.join(dir, "peaks.wav");
// 20 с тона; громко (≈ −21 дБ) на отрезках [2,3], [5,5.5], [5.8,6.4], [12,13]; между ними тихо (−54 дБ)
const loud = "between(t,2,3)+between(t,5,5.5)+between(t,5.8,6.4)+between(t,12,13)";
execFileSync(ff, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=8000:duration=20",
  "-af", `volume='if(${loud},1,0.002)':eval=frame`, wav]);

const clips = [{ start: 100, end: 120, inPoint: 0, mediaPath: wav }]; // клип стоит в секвенции на 100–120 с
const d = peak.decode(clips);
assert.ok(!d.error, "decode: " + d.error);

const near = (a, b, tol) => Math.abs(a - b) <= tol;
// порог −30 дБ, склейка 1 с: [2,3] -> [2,3.33]; [5,5.5]+[5.8,6.4] склеены (зазор 0.3) -> [5,6.73]; [12,13] -> [12,13.33]
const t = peak.threshold(d.clipEnvelopes, -30, { mergeGapSec: 1.0 });
assert.strictEqual(t.cuts.length, 3, "три диапазона: " + JSON.stringify(t.cuts));
const exp = [[102, 103.33], [105, 106.73], [112, 113.33]];
t.cuts.forEach((c, i) => {
  assert.ok(near(c[0], exp[i][0], 0.15) && near(c[1], exp[i][1], 0.15), `диапазон ${i}: ${c} ожидался ${exp[i]}`);
});
// без склейки (0 с): 4 раздельных пика
const t0 = peak.threshold(d.clipEnvelopes, -30, { mergeGapSec: 0 });
assert.strictEqual(t0.cuts.length, 4, "без склейки четыре диапазона: " + JSON.stringify(t0.cuts));
// слишком высокий порог: ничего не громче линии
const tHigh = peak.threshold(d.clipEnvelopes, 5, { mergeGapSec: 1.0 });
assert.strictEqual(tHigh.cuts.length, 0);
console.log("синтетический звук: вырезы", JSON.stringify(t.cuts.map((c) => c.map((x) => +x.toFixed(2)))), "OK");

try { fs.unlinkSync(wav); fs.rmdirSync(dir); } catch (e) {}
console.log("✅ peakSpike OK");
