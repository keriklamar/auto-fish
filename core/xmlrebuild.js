// xmlrebuild.js — пересборка секвенции из FCP7 XML (xmeml) по списку кусков.
//
// Вместо тысяч правок на таймлайне Premiere (extract/razor/перенос клипов) секвенция экспортируется в xmeml,
// здесь текстом пересчитываются клипы (вырезы + перестановка за один проход), результат импортируется как
// новая секвенция. Разбор — по отступам (так экспортирует Premiere: табы; video/audio — 3, track — 4, clipitem — 5).
//
//   pieces — [[srcStartSec, srcEndSec], …] в ЦЕЛЕВОМ порядке (core/reorder.js buildPieces): что осталось и в каком порядке.
//   markers — [{start (исходные сек), name, comment}] — ставятся как sequence-marker на итоговом времени.

const TICKS_PER_SEC = 254016000000;

const RE_VIDEO_OPEN = /\n\t\t\t<video>/;
const RE_VIDEO_CLOSE = /\n\t\t\t<\/video>/;
const RE_AUDIO_OPEN = /\n\t\t\t<audio>/;
const RE_AUDIO_CLOSE = /\n\t\t\t<\/audio>/;
const RE_TRACK = /\n\t\t\t\t<track[ >][\s\S]*?\n\t\t\t\t<\/track>/g;
const RE_CLIP = /\n\t\t\t\t\t<clipitem [\s\S]*?\n\t\t\t\t\t<\/clipitem>/g;
const RE_TRANS = /\n\t\t\t\t\t<transitionitem>[\s\S]*?\n\t\t\t\t\t<\/transitionitem>/g;

function num(s, tag) {
  const m = new RegExp("<" + tag + ">(-?\\d+)</" + tag + ">").exec(s);
  return m ? parseInt(m[1], 10) : null;
}

function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function randomUuid() {
  const h = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `${h()}${h()}-${h()}-4${h().slice(1)}-a${h().slice(1)}-${h()}${h()}${h()}`;
}

// разбор одного <clipitem> в шаблон с подстановками
function parseClip(clipStr, fileDefs) {
  const idM = /<clipitem id="([^"]+)"/.exec(clipStr);
  if (!idM) throw new Error("clipitem без id");
  let start = num(clipStr, "start");
  let end = num(clipStr, "end");
  const inn = num(clipStr, "in");
  const out = num(clipStr, "out");
  if (start === null || end === null || inn === null || out === null) throw new Error("clipitem " + idM[1] + ": нет start/end/in/out");
  // start/end = -1: границу клипа определял переход (FCP7). Переходы мы отбрасываем, поэтому границу берём из in/out.
  if (end < 0 && start >= 0) end = start + (out - inn);
  else if (start < 0 && end >= 0) start = end - (out - inn);
  else if (start < 0 && end < 0) throw new Error("clipitem " + idM[1] + ": неизвестны start и end");

  let tpl = clipStr;
  // файл: полное описание запоминаем (первое вхождение), в шаблоне — маркер
  let fileId = null;
  const fFull = /\n\t\t\t\t\t\t<file id="([^"]+)">[\s\S]*?\n\t\t\t\t\t\t<\/file>/.exec(tpl);
  if (fFull) {
    fileId = fFull[1];
    if (!fileDefs.has(fileId)) fileDefs.set(fileId, fFull[0]);
    tpl = tpl.replace(fFull[0], "\n\t\t\t\t\t\t@@FILE@@");
  } else {
    const fRef = /\n\t\t\t\t\t\t<file id="([^"]+)"\s*\/>/.exec(tpl);
    if (fRef) { fileId = fRef[1]; tpl = tpl.replace(fRef[0], "\n\t\t\t\t\t\t@@FILE@@"); }
  }

  // ссылки: вынимаем в список, на их место — маркер
  const links = [];
  let firstLinkAt = -1;
  tpl = tpl.replace(/\n\t\t\t\t\t\t<link>[\s\S]*?<\/link>/g, (m) => {
    const ref = /<linkclipref>([^<]+)<\/linkclipref>/.exec(m);
    const mt = /<mediatype>([^<]+)<\/mediatype>/.exec(m);
    const ti = /<trackindex>(\d+)<\/trackindex>/.exec(m);
    if (ref && mt && ti) links.push({ ref: ref[1], mediatype: mt[1], trackindex: +ti[1] });
    if (firstLinkAt < 0) { firstLinkAt = 1; return "\n\t\t\t\t\t\t@@LINKS@@"; }
    return "";
  });

  // подстановки чисел (первые вхождения)
  const sub = (tag, ph) => {
    tpl = tpl.replace(new RegExp("<" + tag + ">-?\\d+</" + tag + ">"), `<${tag}>${ph}</${tag}>`);
  };
  sub("start", "@@START@@");
  sub("end", "@@END@@");
  sub("in", "@@IN@@");
  sub("out", "@@OUT@@");
  const ticksIn = num(clipStr, "pproTicksIn");
  const ticksOut = num(clipStr, "pproTicksOut");
  if (ticksIn !== null) sub("pproTicksIn", "@@TIN@@");
  if (ticksOut !== null) sub("pproTicksOut", "@@TOUT@@");
  tpl = tpl.replace(/<clipitem id="[^"]+"/, '<clipitem id="@@ID@@"');

  return {
    origId: idM[1], start, end, inn, out, ticksIn, ticksOut, fileId, links, tpl,
    hasKeyframes: /<keyframe>/.test(clipStr),
    hasTimeRemap: /timeremap|<speed>/i.test(clipStr),
  };
}

function fpsOf(xml) {
  const tb = /<rate>\s*<timebase>(\d+)<\/timebase>\s*<ntsc>(TRUE|FALSE)<\/ntsc>/.exec(xml);
  if (!tb) throw new Error("не найден rate секвенции");
  const base = parseInt(tb[1], 10);
  return tb[2] === "TRUE" ? (base * 1000) / 1001 : base;
}

function rebuildXmeml(xml, pieces, opts = {}) {
  const warnings = [];
  if ((xml.match(/<sequence[ >]/g) || []).length !== 1) {
    throw new Error("в XML больше одной секвенции (вложенные секвенции не поддерживаются)");
  }
  const fps = opts.fps || fpsOf(xml);
  const tpf = TICKS_PER_SEC / fps; // тиков на кадр

  // границы видео/аудио секций верхнего уровня
  const vo = RE_VIDEO_OPEN.exec(xml);
  const vc = RE_VIDEO_CLOSE.exec(xml);
  const ao = RE_AUDIO_OPEN.exec(xml);
  const ac = RE_AUDIO_CLOSE.exec(xml);
  if (!vo || !vc || !ao || !ac) throw new Error("не найдены секции video/audio (ожидается экспорт Premiere с отступами-табами)");

  // куски в кадрах + выходные позиции
  const P = [];
  let acc = 0;
  for (const [s, e] of pieces) {
    const a = Math.round(s * fps);
    const b = Math.round(e * fps);
    if (b - a < 1) continue;
    P.push({ a, b, outStart: acc });
    acc += b - a;
  }
  const totalFrames = acc;

  // 1) собрать треки: [{type, text, index, prefix, suffix, clips[]}]
  const fileDefs = new Map();
  const tracks = [];
  const scanSection = (type, from, to) => {
    const sec = xml.slice(from, to);
    RE_TRACK.lastIndex = 0;
    let m;
    let idx = 0;
    while ((m = RE_TRACK.exec(sec))) {
      idx++;
      const text = m[0];
      const absStart = from + m.index;
      RE_CLIP.lastIndex = 0;
      const clips = [];
      let firstAt = -1;
      let lastEnd = 0;
      let cm;
      while ((cm = RE_CLIP.exec(text))) {
        if (firstAt < 0) firstAt = cm.index;
        lastEnd = cm.index + cm[0].length;
        clips.push(parseClip(cm[0], fileDefs));
      }
      const openEnd = text.indexOf(">") + 1; // конец открывающего тега
      const prefix = firstAt < 0 ? text.slice(0, openEnd) : text.slice(0, firstAt);
      const suffix = firstAt < 0 ? text.slice(openEnd) : text.slice(lastEnd);
      tracks.push({ type, index: idx, absStart, absEnd: absStart + text.length, prefix, suffix, clips });
    }
  };
  scanSection("video", vo.index, vc.index);
  scanSection("audio", ao.index, ac.index);
  if (tracks.length === 0) throw new Error("в XML нет дорожек");

  // переходы: теряются (между кусками после монтажа они не имеют смысла)
  const transCount = (xml.match(RE_TRANS) || []).length;
  if (transCount) warnings.push(`переходов отброшено: ${transCount}`);

  // 2) экземпляры клипов: по куску на пересечение
  const instByKey = new Map(); // origId|pieceIdx -> inst
  const trackInst = tracks.map(() => []);
  let inClips = 0;
  let outClips = 0;
  let kfWarn = 0;
  let remapWarn = 0;
  tracks.forEach((tr, ti) => {
    for (const c of tr.clips) {
      inClips++;
      if (c.hasKeyframes) kfWarn++;
      if (c.hasTimeRemap) remapWarn++;
      const len = c.end - c.start;
      const ratio = len > 0 ? (c.out - c.inn) / len : 1;
      for (let pi = 0; pi < P.length; pi++) {
        const p = P[pi];
        const a = Math.max(c.start, p.a);
        const b = Math.min(c.end, p.b);
        if (b - a < 1) continue;
        const inst = {
          c, ti, pi,
          start: p.outStart + (a - p.a),
          end: p.outStart + (b - p.a),
          inn: Math.round(c.inn + (a - c.start) * ratio),
          out: Math.round(c.inn + (b - c.start) * ratio),
          id: null,
          clipIndex: 0,
        };
        inst.ticksIn = c.ticksIn === null ? null : Math.round(c.ticksIn + (a - c.start) * ratio * tpf);
        inst.ticksOut = c.ticksOut === null ? null : Math.round(c.ticksIn + (b - c.start) * ratio * tpf);
        trackInst[ti].push(inst);
        instByKey.set(c.origId + "|" + pi, inst);
        outClips++;
      }
    }
  });
  if (kfWarn) warnings.push(`клипов с ключевыми кадрами эффектов: ${kfWarn} (кадры могут сместиться)`);
  if (remapWarn) warnings.push(`клипов с изменением скорости: ${remapWarn} (проверь вручную)`);

  // 3) порядок внутри дорожки, ID и индексы
  let nextId = 1;
  trackInst.forEach((list) => {
    list.sort((x, y) => x.start - y.start || x.pi - y.pi);
    list.forEach((inst, i) => { inst.id = "clipitem-" + nextId++; inst.clipIndex = i + 1; });
  });

  // 4) рендер дорожек
  const emittedFiles = new Set();
  const renderInst = (inst) => {
    let s = inst.c.tpl
      .replace("@@ID@@", inst.id)
      .replace("@@START@@", String(inst.start))
      .replace("@@END@@", String(inst.end))
      .replace("@@IN@@", String(inst.inn))
      .replace("@@OUT@@", String(inst.out));
    if (inst.ticksIn !== null) s = s.replace("@@TIN@@", String(inst.ticksIn));
    if (inst.ticksOut !== null) s = s.replace("@@TOUT@@", String(inst.ticksOut));
    if (s.includes("@@FILE@@")) {
      const fid = inst.c.fileId;
      let fileXml;
      if (fid && !emittedFiles.has(fid) && fileDefs.has(fid)) {
        fileXml = fileDefs.get(fid).replace(/^\n\t\t\t\t\t\t/, "");
        emittedFiles.add(fid);
      } else {
        fileXml = `<file id="${fid}"/>`;
      }
      s = s.replace("@@FILE@@", () => fileXml);
    }
    if (s.includes("@@LINKS@@")) {
      const parts = [];
      for (const l of inst.c.links) {
        const target = instByKey.get(l.ref + "|" + inst.pi);
        if (!target) continue;
        parts.push(
          `<link>\n\t\t\t\t\t\t\t<linkclipref>${target.id}</linkclipref>\n\t\t\t\t\t\t\t<mediatype>${l.mediatype}</mediatype>\n` +
          `\t\t\t\t\t\t\t<trackindex>${l.trackindex}</trackindex>\n\t\t\t\t\t\t\t<clipindex>${target.clipIndex}</clipindex>\n\t\t\t\t\t\t</link>`
        );
      }
      s = s.replace("\n\t\t\t\t\t\t@@LINKS@@", () => (parts.length ? "\n\t\t\t\t\t\t" + parts.join("\n\t\t\t\t\t\t") : ""));
    }
    return s;
  };

  let out = "";
  let cursor = 0;
  tracks.forEach((tr, ti) => {
    out += xml.slice(cursor, tr.absStart);
    out += tr.prefix + trackInst[ti].map(renderInst).join("") + tr.suffix;
    cursor = tr.absEnd;
  });
  out += xml.slice(cursor);

  // 5) заголовок секвенции: имя, uuid, длительность, рабочая область
  const newName = opts.name || null;
  if (newName) out = out.replace(/(<\/duration>\s*<rate>[\s\S]*?<\/rate>\s*<name>)[^<]*(<\/name>)/, (m, a, b) => a + xmlEscape(newName) + b);
  out = out.replace(/<uuid>[^<]*<\/uuid>/, `<uuid>${randomUuid()}</uuid>`);
  out = out.replace(/(<sequence [^>]*?)>/, (m, a) => m); // атрибуты ниже
  out = out.replace(/<duration>\d+<\/duration>/, `<duration>${totalFrames}</duration>`);
  const totalTicks = Math.round(totalFrames * tpf);
  out = out
    .replace(/MZ\.WorkOutPoint="\d+"/, `MZ.WorkOutPoint="${totalTicks}"`)
    .replace(/MZ\.WorkInPoint="\d+"/, `MZ.WorkInPoint="0"`)
    .replace(/MZ\.EditLine="\d+"/, `MZ.EditLine="0"`)
    .replace(/Monitor\.ProgramZoomOut="\d+"/, `Monitor.ProgramZoomOut="${totalTicks}"`);

  // 6) маркеры секвенции
  let markersAdded = 0;
  if (opts.markers && opts.markers.length) {
    const mapT = (t) => {
      // исходное время -> итоговое по кускам; внутри выреза — к началу ближайшего следующего куска
      let best = null;
      for (let i = 0; i < P.length; i++) {
        const sA = P[i].a / fps;
        const sB = P[i].b / fps;
        if (t >= sA && t < sB) return P[i].outStart / fps + (t - sA);
        if (sA >= t && (best === null || sA < best.sA)) best = { sA, o: P[i].outStart / fps };
      }
      return best ? best.o : totalFrames / fps;
    };
    const mk = opts.markers
      .map((m) => {
        const f = Math.round(mapT(m.start) * fps);
        markersAdded++;
        return `\n\t\t<marker>\n\t\t\t<comment>${xmlEscape(m.comment || "")}</comment>\n\t\t\t<name>${xmlEscape(m.name || "")}</name>\n\t\t\t<in>${f}</in>\n\t\t\t<out>-1</out>\n\t\t</marker>`;
      })
      .join("");
    out = out.replace(/(<\/timecode>)(\s*(?:<labels>|<logginginfo>|<\/sequence>))/, (m, a, b) => a + mk + b);
  }

  // 7) уже существующие маркеры секвенции (режим «поменять местами» на готовой секвенции) — сдвинуть вместе с кусками
  let markersRemapped = 0;
  if (opts.remapExistingMarkers) {
    const mapFrame = (f) => {
      let best = null;
      for (let i = 0; i < P.length; i++) {
        if (f >= P[i].a && f < P[i].b) return P[i].outStart + (f - P[i].a);
        if (P[i].a >= f && (best === null || P[i].a < best.a)) best = { a: P[i].a, o: P[i].outStart };
      }
      return best ? best.o : totalFrames;
    };
    const mediaEnd = out.lastIndexOf("</media>");
    if (mediaEnd >= 0) {
      const head = out.slice(0, mediaEnd);
      const tail = out.slice(mediaEnd).replace(/<marker>[\s\S]*?<\/marker>/g, (blk) => {
        markersRemapped++;
        return blk
          .replace(/<in>(-?\d+)<\/in>/, (m, v) => (+v >= 0 ? `<in>${mapFrame(+v)}</in>` : m))
          .replace(/<out>(-?\d+)<\/out>/, (m, v) => (+v >= 0 ? `<out>${mapFrame(+v)}</out>` : m));
      });
      out = head + tail;
    }
  }

  return {
    xml: out,
    stats: {
      fps, tracks: tracks.length, inClips, outClips, pieces: P.length, totalFrames,
      totalSeconds: totalFrames / fps, filesDefined: emittedFiles.size, markersAdded, markersRemapped, warnings,
    },
  };
}

// fps и длительность секвенции из XML (секунды)
function sequenceInfo(xml) {
  const fps = fpsOf(xml);
  const d = /<duration>(\d+)<\/duration>/.exec(xml);
  return { fps, durationSec: d ? parseInt(d[1], 10) / fps : 0 };
}

// куски в исходном порядке = всё, кроме вырезов (режим «только резка, без перестановки»)
function piecesFromCuts(cuts, totalSec) {
  const out = [];
  let cur = 0;
  const sorted = cuts.slice().sort((a, b) => a[0] - b[0]);
  for (const [s, e] of sorted) {
    if (s > cur + 1e-6) out.push([cur, Math.min(s, totalSec)]);
    cur = Math.max(cur, e);
  }
  if (cur < totalSec - 1e-6) out.push([cur, totalSec]);
  return out.filter((p) => p[1] - p[0] > 1e-6);
}

module.exports = { rebuildXmeml, sequenceInfo, piecesFromCuts, TICKS_PER_SEC };
