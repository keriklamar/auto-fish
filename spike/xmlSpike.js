// xmlSpike.js — проверки пересборки xmeml (core/xmlrebuild.js): синтетика + реальный экспорт (если лежит на диске).
const fs = require("fs");
const assert = require("assert");
const { rebuildXmeml } = require("../core/xmlrebuild");

const T = "\t";
function clip(id, name, fileId, fileDef, s, e, i, o, linksXml) {
  const tpf = 10160640000;
  return `\n${T.repeat(5)}<clipitem id="${id}">
${T.repeat(6)}<masterclipid>masterclip-1</masterclipid>
${T.repeat(6)}<name>${name}</name>
${T.repeat(6)}<enabled>TRUE</enabled>
${T.repeat(6)}<duration>1000</duration>
${T.repeat(6)}<rate>
${T.repeat(7)}<timebase>25</timebase>
${T.repeat(7)}<ntsc>FALSE</ntsc>
${T.repeat(6)}</rate>
${T.repeat(6)}<start>${s}</start>
${T.repeat(6)}<end>${e}</end>
${T.repeat(6)}<in>${i}</in>
${T.repeat(6)}<out>${o}</out>
${T.repeat(6)}<pproTicksIn>${i * tpf}</pproTicksIn>
${T.repeat(6)}<pproTicksOut>${o * tpf}</pproTicksOut>${fileDef
    ? `\n${T.repeat(6)}<file id="${fileId}">\n${T.repeat(7)}<name>${name}</name>\n${T.repeat(7)}<pathurl>file://localhost/X/${name}</pathurl>\n${T.repeat(6)}</file>`
    : `\n${T.repeat(6)}<file id="${fileId}"/>`}${linksXml || ""}
${T.repeat(6)}<logginginfo>
${T.repeat(7)}<description></description>
${T.repeat(6)}</logginginfo>
${T.repeat(5)}</clipitem>`;
}
const link = (ref, mt, ti, ci) =>
  `\n${T.repeat(6)}<link>\n${T.repeat(7)}<linkclipref>${ref}</linkclipref>\n${T.repeat(7)}<mediatype>${mt}</mediatype>\n${T.repeat(7)}<trackindex>${ti}</trackindex>\n${T.repeat(7)}<clipindex>${ci}</clipindex>\n${T.repeat(6)}</link>`;

function doc() {
  const links = (a) => link("clipitem-1", "video", 1, 1) + link("clipitem-2", "audio", 1, 1);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
\t<sequence id="sequence-1" MZ.EditLine="999" MZ.WorkOutPoint="1016064000000" MZ.WorkInPoint="0" Monitor.ProgramZoomOut="1016064000000">
\t\t<uuid>old-uuid</uuid>
\t\t<duration>100</duration>
\t\t<rate>
\t\t\t<timebase>25</timebase>
\t\t\t<ntsc>FALSE</ntsc>
\t\t</rate>
\t\t<name>T</name>
\t\t<media>
\t\t\t<video>
\t\t\t\t<format>
\t\t\t\t\t<samplecharacteristics>
\t\t\t\t\t\t<width>1920</width>
\t\t\t\t\t</samplecharacteristics>
\t\t\t\t</format>
\t\t\t\t<track TL.SQTrackShy="0">${clip("clipitem-1", "V.mxf", "file-1", true, 0, 100, 0, 100, links())}
\t\t\t\t\t<enabled>TRUE</enabled>
\t\t\t\t\t<locked>FALSE</locked>
\t\t\t\t</track>
\t\t\t</video>
\t\t\t<audio>
\t\t\t\t<track>${clip("clipitem-2", "A.wav", "file-2", true, 0, 100, 0, 100, links())}
\t\t\t\t\t<enabled>TRUE</enabled>
\t\t\t\t\t<outputchannelindex>1</outputchannelindex>
\t\t\t\t</track>
\t\t\t</audio>
\t\t</media>
\t\t<timecode>
\t\t\t<string>00:00:00:00</string>
\t\t</timecode>
\t\t<labels>
\t\t\t<label2>Forest</label2>
\t\t</labels>
\t</sequence>
</xmeml>
`;
}

// ---- синтетика: перестановка 2 кусков (src 2–3 с и 0–1 с), маркер на 2.5 с ----
let r = rebuildXmeml(doc(), [[2, 3], [0, 1]], { name: "T_AF", markers: [{ start: 2.5, name: "M", comment: "c" }] });
const x = r.xml;
const clipsOf = (s) => (s.match(/\n\t\t\t\t\t<clipitem [\s\S]*?\n\t\t\t\t\t<\/clipitem>/g) || []).join("");
const starts = [...clipsOf(x).matchAll(/<start>(\d+)<\/start>/g)].map((m) => +m[1]);
const ins = [...clipsOf(x).matchAll(/<in>(\d+)<\/in>/g)].map((m) => +m[1]);
assert.deepStrictEqual(starts, [0, 25, 0, 25], "позиции на итоговой");
assert.deepStrictEqual(ins, [50, 0, 50, 0], "точки in берутся из исходных мест");
assert.strictEqual(r.stats.outClips, 4);
assert.strictEqual((x.match(/<duration>50<\/duration>/g) || []).length, 1, "длительность секвенции 50 кадров");
assert.ok(x.includes("<name>T_AF</name>"));
assert.ok(!x.includes("old-uuid"));
assert.ok(x.includes('MZ.WorkOutPoint="' + 50 * 10160640000 + '"'));
// файлы: определение один раз, дальше ссылки
assert.strictEqual((x.match(/<file id="file-1">/g) || []).length, 1);
assert.strictEqual((x.match(/<file id="file-1"\/>/g) || []).length, 1);
// тики
assert.ok(x.includes("<pproTicksIn>" + 50 * 10160640000 + "</pproTicksIn>"));
// ссылки ведут на экземпляры того же куска и существующие id
const ids = new Set([...x.matchAll(/<clipitem id="([^"]+)"/g)].map((m) => m[1]));
for (const m of x.matchAll(/<linkclipref>([^<]+)<\/linkclipref>/g)) assert.ok(ids.has(m[1]), "ссылка на несуществующий " + m[1]);
assert.strictEqual(ids.size, 4);
// маркер: 2.5 с лежит в первом куске (src 2–3) -> 0.5 с итога = кадр 12/13
const mk = /<marker>[\s\S]*?<in>(\d+)<\/in>/.exec(x);
assert.ok(mk && Math.abs(+mk[1] - 13) <= 1, "маркер: " + (mk && mk[1]));
// служебное в дорожке сохранилось
assert.ok(x.includes("<outputchannelindex>1</outputchannelindex>"));
console.log("синтетика: перестановка OK");

// ---- вырез внутри клипа: кусок 0–1 и 2–4 (между ними вырезана секунда) ----
r = rebuildXmeml(doc(), [[0, 1], [2, 4]]);
const s2 = [...clipsOf(r.xml).matchAll(/<start>(\d+)<\/start>/g)].map((m) => +m[1]);
const e2 = [...clipsOf(r.xml).matchAll(/<end>(\d+)<\/end>/g)].map((m) => +m[1]);
assert.deepStrictEqual(s2, [0, 25, 0, 25]);
assert.deepStrictEqual(e2, [25, 75, 25, 75]);
assert.strictEqual(r.stats.totalFrames, 75);
console.log("синтетика: вырез OK");

// ---- дубль куска (повторное использование) ----
r = rebuildXmeml(doc(), [[0, 1], [0, 1]]);
assert.strictEqual(r.stats.outClips, 4);
console.log("синтетика: дубль куска OK");

// ---- существующие маркеры сдвигаются вместе с кусками ----
{
  const marker = "\n\t\t<marker>\n\t\t\t<name>X</name>\n\t\t\t<in>60</in>\n\t\t\t<out>-1</out>\n\t\t</marker>";
  const withMarker = doc().replace("</timecode>", "</timecode>" + marker);
  // куски: [2,3] c, потом [0,1] c; маркер на 60 кадре (2.4 c) лежит в первом куске -> 0.4 c = кадр 10
  const rm = rebuildXmeml(withMarker, [[2, 3], [0, 1]], { remapExistingMarkers: true });
  const mm = /<marker>[\s\S]*?<in>(\d+)<\/in>/.exec(rm.xml);
  assert.ok(mm && +mm[1] === 10, "маркер после перестановки: " + (mm && mm[1]));
  assert.strictEqual(rm.stats.markersRemapped, 1);
  console.log("синтетика: сдвиг маркеров OK");
}
console.log("✅ xmlSpike OK");
