// peakAnalyze.js — поиск участков громче заданного порога на отдельной
// аудиодорожке (напр. A6 — микрофон громкой связи режиссёра, лежит у колонки
// на площадке, поэтому даже "в тишине" слышны остальные) и перевод их в
// диапазоны реза af_cuts.json. В отличие от analyze.js (транскрипт-реза), тут
// вход — не текст, а сам звук: декодируем через ffmpeg нужный диапазон
// медиафайла, считаем RMS-огибающую в дБ и режем буквально по порогу.
//
// Два шага НАРОЧНО разделены (decode() / threshold()):
//   decode()    — один раз гоняет ffmpeg, дорого (секунды на весь клип),
//                 возвращает готовую огибающую в дБ по каждому клипу.
//   threshold() — чистая функция без ffmpeg, доли миллисекунды: пересчитывает
//                 диапазоны реза под конкретный порог дБ.
// Так UI даёт пользователю график громкости с перетаскиваемой линией порога —
// без повторного обращения к Premiere/ffmpeg на каждое движение мыши.
//
// ВАЖНО (после живой обратной связи, две поправки подряд): здесь НЕТ попытки
// угадать "умный" порог — порог выставляет сам пользователь глазами по
// графику. Склейка внутри одной фразы работает как ПОИСК, а не безусловное
// удаление: "влево" — это радиус, в пределах которого ищем ЕЩЁ ОДИН момент
// громче порога; нашли — считаем это той же фразой и удаляем весь промежуток
// целиком (включая паузу); НЕ нашли — там настоящая тишина/фон, её не
// трогаем, граница реза остаётся на своём естественном месте. Технически это
// обычная склейка соседних диапазонов по разрыву (mergeGapSec), просто со
// смысловым, а не техническим значением. "Вправо" — наоборот, без всякого
// поиска: всегда добавляется фиксированный маленький хвост (rightPadSec),
// без условий — не потому что там что-то нашли, а просто чтобы не резать
// ровно по семплу окончания громкого места.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// ---------------------------------------------------------------------------
const DEFAULTS = {
  sampleRate: 8000, // Гц, для анализа хватает — не нужна полная полоса речи
  windowSec: 0.05, // окно RMS-огибающей, 50 мс
  minPeakSec: 0.1, // короче одного-двух окон — считаем дребезгом на границе, отбрасываем
  // Радиус ПОИСКА соседнего пика (не безусловный запас!). Если сосед в
  // пределах этого времени найден — вся фраза (включая паузу между кусками)
  // сливается в один диапазон. Если не найден — тишина между ними остаётся
  // нетронутой. Обоснование пользователя: пауза внутри одной фразы дольше
  // секунды не бывает.
  mergeGapSec: 1.0,
  // Фиксированный хвост ТОЛЬКО вправо, без условий и без поиска — "без
  // выбора" (цитата пользователя): просто не резать ровно по семплу конца
  // громкого места. Не путать с mergeGapSec — это не про склейку фраз.
  rightPadSec: 0.33,
};

function findFfmpeg() {
  var candidates = [];
  if (process.env.FFMPEG_PATH) candidates.push(process.env.FFMPEG_PATH);
  // WinGet (Gyan.FFmpeg): ссылка в Links и распакованные пакеты
  var local = process.env.LOCALAPPDATA;
  if (local) {
    candidates.push(path.join(local, "Microsoft", "WinGet", "Links", "ffmpeg.exe"));
    try {
      var pk = path.join(local, "Microsoft", "WinGet", "Packages");
      fs.readdirSync(pk).filter(function (d) { return /ffmpeg/i.test(d); }).forEach(function (d) {
        try {
          fs.readdirSync(path.join(pk, d)).forEach(function (sub) {
            candidates.push(path.join(pk, d, sub, "bin", "ffmpeg.exe"));
          });
        } catch (e1) {}
      });
    } catch (e2) {}
  }
  candidates.push("C:\Program Files\Red Giant\PluralEyes 4\ffmpeg.exe", "ffmpeg.exe", "ffmpeg");
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    try {
      if (path.isAbsolute(c)) {
        if (fs.existsSync(c)) return c;
      } else {
        execFileSync(c, ["-version"], { stdio: "ignore" });
        return c;
      }
    } catch (e) {}
  }
  return null;
}

function toDb(x) { return 20 * Math.log10(Math.max(x, 1e-9)); }
function round1(x) { return Math.round(x * 10) / 10; }

// Декодирует [inPoint, inPoint+durationSec) из mediaPath в моно PCM float32LE
// и возвращает Float32Array огибающей RMS (шаг = windowSec). streamIndex —
// если задан, явно берёт этот аудиопоток (`-map 0:N`), см. pickBestAudioStream.
function decodeEnvelope(ffmpegPath, mediaPath, inPointSec, durationSec, opts, streamIndex) {
  if (durationSec <= 0) return new Float32Array(0);
  var args = [
    "-hide_banner", "-loglevel", "error",
    "-ss", String(Math.max(0, inPointSec)),
    "-t", String(durationSec),
    "-i", mediaPath,
  ];
  if (streamIndex != null) args.push("-map", "0:" + streamIndex);
  args.push("-ac", "1", "-ar", String(opts.sampleRate), "-f", "f32le", "pipe:1");
  var buf = execFileSync(ffmpegPath, args, { maxBuffer: 1024 * 1024 * 512 });
  var samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));

  var windowLen = Math.max(1, Math.round(opts.sampleRate * opts.windowSec));
  var nWindows = Math.ceil(samples.length / windowLen) || 1;
  var env = new Float32Array(nWindows);
  for (var w = 0; w < nWindows; w++) {
    var start = w * windowLen;
    var end = Math.min(samples.length, start + windowLen);
    var sum = 0;
    for (var i = start; i < end; i++) sum += samples[i] * samples[i];
    env[w] = Math.sqrt(sum / Math.max(1, end - start));
  }
  return env;
}

// ---------------------------------------------------------------------------
// Многие камерные MXF несут НЕСКОЛЬКО отдельных моно-аудиопотоков (не каналов
// в одном потоке, а именно Stream #0:1..#0:N — обычная схема для XDCAM/4-кан.
// камер). Без явного -map ffmpeg сам выбирает один "по умолчанию", и это
// может оказаться неиспользуемый/тихий поток, а не тот, что Premiere
// подставляет на нужную дорожку. Поэтому сами находим "живой" поток —
// пробуем декодировать короткие сэмплы из каждого и берём самый громкий
// (не считая полностью мёртвых — макс. громкость ниже DEAD_STREAM_DB).

var DEAD_STREAM_DB = -85; // тише этого — считаем поток неиспользуемым/пустым

function listAudioStreams(ffmpegPath, mediaPath) {
  var out = "";
  try {
    execFileSync(ffmpegPath, ["-hide_banner", "-i", mediaPath], { stdio: "pipe" });
  } catch (e) {
    // ffmpeg без -f/выхода всегда завершается с ошибкой — это ожидаемо,
    // нужный вывод (список стримов) идёт в stderr независимо от кода выхода.
    out = (e.stderr && e.stderr.toString()) || "";
  }
  var indices = [];
  var re = /Stream #0:(\d+)(?:\(\w+\))?: Audio/g;
  var m;
  while ((m = re.exec(out))) indices.push(parseInt(m[1], 10));
  return indices;
}

function sampleWindowsFor(inPointSec, durationSec) {
  var win = Math.min(20, durationSec);
  if (win <= 0) return [];
  var fractions = [0.1, 0.5, 0.85];
  var seen = {};
  var windows = [];
  fractions.forEach(function (f) {
    var off = Math.max(0, Math.min(durationSec - win, durationSec * f));
    var key = Math.round(off);
    if (seen[key]) return;
    seen[key] = true;
    windows.push([inPointSec + off, win]);
  });
  return windows;
}

// Возвращает {streamIndex|null, candidates:[{stream,maxDb}]} — null = не
// нашли несколько потоков или все "мёртвые", используем выбор ffmpeg по
// умолчанию (без -map).
function pickBestAudioStream(ffmpegPath, mediaPath, inPointSec, durationSec, opts) {
  var streams = listAudioStreams(ffmpegPath, mediaPath);
  if (streams.length <= 1) return { streamIndex: null, candidates: [] };

  var windows = sampleWindowsFor(inPointSec, durationSec);
  var candidates = streams.map(function (idx) {
    var maxDb = -180;
    for (var w = 0; w < windows.length; w++) {
      try {
        var env = decodeEnvelope(ffmpegPath, mediaPath, windows[w][0], windows[w][1], opts, idx);
        for (var i = 0; i < env.length; i++) maxDb = Math.max(maxDb, toDb(env[i]));
      } catch (e) {}
    }
    return { stream: idx, maxDb: round1(maxDb) };
  });

  var alive = candidates.filter(function (c) { return c.maxDb >= DEAD_STREAM_DB; });
  var pool = alive.length ? alive : candidates;
  var best = pool.reduce(function (a, b) { return b.maxDb > a.maxDb ? b : a; });
  return { streamIndex: best.stream, candidates: candidates };
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return -90;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p))];
}

function statsOf(dbs) {
  var sorted = dbs.slice().sort(function (a, b) { return a - b; });
  var mean = dbs.length ? dbs.reduce(function (s, x) { return s + x; }, 0) / dbs.length : -90;
  return {
    nWindows: dbs.length,
    floorDb: round1(percentile(sorted, 0.10)),
    meanDb: round1(mean),
    p90Db: round1(percentile(sorted, 0.90)),
    p95Db: round1(percentile(sorted, 0.95)),
    p98Db: round1(percentile(sorted, 0.98)),
    p99Db: round1(percentile(sorted, 0.99)),
    maxDb: round1(sorted.length ? sorted[sorted.length - 1] : -90),
  };
}

// ---------------------------------------------------------------------------
// ШАГ 1 (дорогой, ffmpeg): clips: [{start,end,inPoint,mediaPath}, ...] из
// afTrackClips (секунды секвенции). Возвращает {clipEnvelopes, suggestedThresholdDb, error?}
function decode(clips, userOpts) {
  var opts = Object.assign({}, DEFAULTS, userOpts || {});
  var ffmpegPath = findFfmpeg();
  if (!ffmpegPath) {
    return { clipEnvelopes: [], error: "ffmpeg не найден (искали WinGet, переменную FFMPEG_PATH, PATH, PluralEyes 4). Установи: winget install Gyan.FFmpeg" };
  }

  var clipEnvelopes = [];
  var streamCache = {}; // mediaPath -> streamIndex|null (считаем один раз на файл)
  for (var i = 0; i < clips.length; i++) {
    var c = clips[i];
    var duration = c.end - c.start;
    if (!c.mediaPath || duration <= 0) continue;

    var streamIndex, candidates;
    if (Object.prototype.hasOwnProperty.call(streamCache, c.mediaPath)) {
      streamIndex = streamCache[c.mediaPath];
      candidates = null;
    } else {
      var picked;
      try {
        picked = pickBestAudioStream(ffmpegPath, c.mediaPath, c.inPoint, duration, opts);
      } catch (ePick) {
        picked = { streamIndex: null, candidates: [] };
      }
      streamIndex = picked.streamIndex;
      candidates = picked.candidates;
      streamCache[c.mediaPath] = streamIndex;
    }

    var env;
    try {
      env = decodeEnvelope(ffmpegPath, c.mediaPath, c.inPoint, duration, opts, streamIndex);
    } catch (e) {
      clipEnvelopes.push({ mediaPath: c.mediaPath, error: "ffmpeg: " + (e.message || e) });
      continue; // один битый клип не должен обрушивать анализ всей дорожки
    }
    var dbs = new Array(env.length);
    for (var d = 0; d < env.length; d++) dbs[d] = toDb(env[d]);
    var stats = statsOf(dbs);

    clipEnvelopes.push({
      mediaPath: c.mediaPath,
      clipStart: c.start,
      clipEnd: c.end,
      inPoint: c.inPoint,
      windowSec: opts.windowSec,
      usedAudioStream: streamIndex == null ? "(по умолчанию ffmpeg)" : "0:" + streamIndex,
      audioStreamCandidates: candidates,
      dbs: dbs,
      stats: stats,
    });
  }

  var ok = clipEnvelopes.filter(function (c) { return !c.error; });
  if (!ok.length) {
    return {
      clipEnvelopes: clipEnvelopes,
      error: clipEnvelopes.length ? clipEnvelopes[0].error : "На дорожке нет клипов",
    };
  }

  // Порог по умолчанию — ТОЛЬКО стартовая позиция линии на графике, не более
  // того: сам пользователь тут же двигает её глазами по форме волны. Никакой
  // попытки угадать "правильный" порог алгоритмом здесь больше нет.
  var loudest = ok.reduce(function (a, b) { return b.stats.maxDb > a.stats.maxDb ? b : a; });
  var suggestedThresholdDb = Math.max(
    loudest.stats.floorDb + 15, // не начинать совсем в шуме на плоских записях
    loudest.stats.p90Db
  );

  return { clipEnvelopes: clipEnvelopes, suggestedThresholdDb: round1(suggestedThresholdDb), opts: opts };
}

// ---------------------------------------------------------------------------
// ШАГ 2 (дешёвый, чистый JS): пересчитывает диапазоны реза под конкретный
// thresholdDb по уже готовым clipEnvelopes из decode(). Никакого ffmpeg.
function threshold(clipEnvelopes, thresholdDb, userOpts) {
  var opts = Object.assign({}, DEFAULTS, userOpts || {});
  var allRanges = [];
  var perClip = [];

  clipEnvelopes.forEach(function (c) {
    if (c.error) return;
    var dbs = c.dbs;
    var windowSec = c.windowSec;

    var raw = [];
    var curStart = -1;
    var nAbove = 0;
    for (var w = 0; w < dbs.length; w++) {
      var above = dbs[w] >= thresholdDb;
      if (above) nAbove++;
      if (above && curStart < 0) curStart = w;
      else if (!above && curStart >= 0) { raw.push([curStart * windowSec, w * windowSec]); curStart = -1; }
    }
    if (curStart >= 0) raw.push([curStart * windowSec, dbs.length * windowSec]);

    // 1) СКЛЕЙКА-ПОИСК: если следующий сырой всплеск начинается не дальше
    // mergeGapSec от конца предыдущего — считаем это той же фразой и сливаем
    // целиком (промежуток/пауза между ними уходит под нож). Если дальше —
    // не нашли соседний пик, оставляем раздельно, промежуток НЕ трогаем
    // (это и есть «поиск», а не безусловный запас — см. комментарий у
    // DEFAULTS.mergeGapSec).
    // 2) отсев коротких дребезгов по длительности уже слитого диапазона.
    // 3) фиксированный хвост ТОЛЬКО вправо (rightPadSec) — без условий,
    // левый край не трогаем вообще (если пик изолирован — начало диапазона
    // остаётся ровно на его собственном начале, никакого запаса в тишину).
    var merged = [];
    raw.forEach(function (r) {
      if (merged.length && r[0] - merged[merged.length - 1][1] <= opts.mergeGapSec) {
        merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]);
      } else {
        merged.push(r.slice());
      }
    });
    var kept = merged
      .filter(function (r) { return r[1] - r[0] >= opts.minPeakSec; })
      .map(function (r) { return [r[0], r[1] + opts.rightPadSec]; });

    kept.forEach(function (r) {
      var a = c.clipStart + r[0];
      var b = c.clipStart + r[1];
      allRanges.push([Math.max(c.clipStart, a), Math.min(c.clipEnd, b)]);
    });

    perClip.push({ mediaPath: c.mediaPath, nWindowsAboveThreshold: nAbove, nEvents: kept.length });
  });

  allRanges.sort(function (x, y) { return x[0] - y[0]; });
  var cuts = [];
  for (var k = 0; k < allRanges.length; k++) {
    if (cuts.length && allRanges[k][0] <= cuts[cuts.length - 1][1]) {
      cuts[cuts.length - 1][1] = Math.max(cuts[cuts.length - 1][1], allRanges[k][1]);
    } else {
      cuts.push(allRanges[k].slice());
    }
  }

  var total = cuts.reduce(function (s, r) { return s + (r[1] - r[0]); }, 0);
  return { cuts: cuts, totalSeconds: total, thresholdDb: thresholdDb, perClip: perClip };
}

// Удобная обёртка decode()+threshold() для простых сценариев/тестов —
// разово, с порогом по умолчанию.
function build(clips, userOpts) {
  var d = decode(clips, userOpts);
  if (d.error && !d.clipEnvelopes.some(function (c) { return !c.error; })) {
    return { cuts: [], totalSeconds: 0, error: d.error };
  }
  var t = threshold(d.clipEnvelopes, d.suggestedThresholdDb, userOpts);
  return {
    cuts: t.cuts,
    totalSeconds: t.totalSeconds,
    suggestedThresholdDb: d.suggestedThresholdDb,
    diagnostics: d.clipEnvelopes.map(function (c) {
      return c.error
        ? { mediaPath: c.mediaPath, error: c.error }
        : Object.assign({
            mediaPath: c.mediaPath, clipStart: c.clipStart, clipEnd: c.clipEnd, inPoint: c.inPoint,
            usedAudioStream: c.usedAudioStream, audioStreamCandidates: c.audioStreamCandidates,
          }, c.stats);
    }),
  };
}

module.exports = { decode, threshold, build, DEFAULTS, findFfmpeg, statsOf };
