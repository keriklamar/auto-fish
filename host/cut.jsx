// host/cut.jsx — ExtendScript-хост Auto Fish. Авто-загружается панелью
// (ScriptPath в manifest.xml). Вызывается из панели через evalScript:
//   afSeqInfo()               -> JSON {hasSeq, fps, name}
//   autoFishCut(runDir, fps, doReorder) -> резка (+ перестановка блоков) + маркеры, вернёт "OK:вырезано:маркеров:блоков" или "ERROR: …"
// Выбор файлов — на стороне панели (<input type=file>), не здесь.

// ---------------------------------------------------------------------------

function afReadJSON(path) {
    var file = new File(path);
    if (!file.exists) return null;
    file.encoding = "UTF-8";
    file.open("r");
    var content = file.read();
    file.close();
    if (!content) return null;
    // JSON.parse в движке есть; eval на больших литералах даёт «Stack overrun» — оставлен только как запасной путь
    if (typeof JSON === "object" && JSON && typeof JSON.parse === "function") return JSON.parse(content);
    return eval("(" + content + ")");
}

// журнал хода работы: run/af_log.txt — по нему видно, на каком шаге оборвалось
function afLog(runDir, msg) {
    try {
        var f = new File(runDir + "af_log.txt");
        f.encoding = "UTF-8";
        f.open("a");
        var d = new Date();
        function p2(n) { return (n < 10 ? "0" : "") + n; }
        function p3(n) { return (n < 10 ? "00" : (n < 100 ? "0" : "")) + n; }
        f.writeln(p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()) + "." + p3(d.getMilliseconds()) + " " + msg);
        f.close();
    } catch (e) {}
}

function afSeqInfo() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return '{"hasSeq":false}';
        var fps = 25;
        try {
            // seq.timebase — тиков на кадр; 254016000000 тиков в секунде.
            // Отдаём полную точность (важно для snap на длинном таймлайне),
            // округление — только для показа в панели.
            var tb = parseFloat(seq.timebase);
            if (tb > 0) fps = 254016000000 / tb;
        } catch (e) {}
        return '{"hasSeq":true,"fps":' + fps + ',"name":' + toJSONString(seq.name) + "}";
    } catch (e) {
        return '{"hasSeq":false,"error":' + toJSONString(String(e)) + "}";
    }
}

function toJSONString(s) {
    s = String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]/g, " ");
    return '"' + s + '"';
}

function afClip(s, max) {
    s = String(s);
    return s.length > max ? s.substr(0, max - 1) + "…" : s;
}

// ---------------------------------------------------------------------------
// ВАЖНО: маркеры Premiere НЕ двигаются при ripple/extract. Поэтому:
//   1) сначала все extract()
//   2) потом маркеры — на позициях, которые панель УЖЕ пересчитала
//      (core/markers.js) под порезанную секвенцию.

function autoFishCut(runDir, fps, doReorder) {
    try {
        if (runDir.charAt(runDir.length - 1) !== "/" &&
            runDir.charAt(runDir.length - 1) !== "\\") {
            runDir += "/";
        }
        var FPS = fps || 25;
        function snap(s) { return Math.round(s * FPS) / FPS; }

        app.enableQE();
        var seq = app.project.activeSequence;
        var qeSeq = qe.project.getActiveSequence();
        if (!seq || !qeSeq) return "ERROR: нет активной секвенции";

        // ---- 1. резка ----
        var cuts = afReadJSON(runDir + "af_cuts.json");
        if (!cuts || cuts.length === 0) return "ERROR: cut-лист пуст или не найден";

        cuts.sort(function (x, y) { return y[0] - x[0]; }); // с конца в начало
        afLog(runDir, "cut: вырезов " + cuts.length);
        var count = 0;
        for (var i = 0; i < cuts.length; i++) {
            var step = "setInPoint";
            try {
                seq.setInPoint(snap(cuts[i][0]));
                step = "setOutPoint";
                seq.setOutPoint(snap(cuts[i][1]));
                step = "extract";
                qeSeq.extract();
            } catch (eCut) {
                afLog(runDir, "cut: ОШИБКА на вырезе " + (i + 1) + " [" + cuts[i][0] + "," + cuts[i][1] + "] шаг " + step + ": " + eCut);
                throw eCut;
            }
            count++;
            if (count <= 3) afLog(runDir, "cut: вырез " + count + " ok [" + cuts[i][0] + "," + cuts[i][1] + "]");
            if (count % 25 === 0) afLog(runDir, "cut: выполнено " + count + " из " + cuts.length);
        }
        afLog(runDir, "cut: резка завершена, " + count);

        // ---- 1б. перестановка крупных блоков по порядку дока (если включена) ----
        var moved = 0;
        if (doReorder) {
            var runs = afReadJSON(runDir + "af_runs.json") || [];
            if (runs.length > 1) moved = afReorderRuns(seq, qeSeq, runDir, runs, FPS);
        }

        // ---- 2. маркеры (позиции уже под порезанную секвенцию) ----
        var markersAdded = 0;

        var flagged = afReadJSON(runDir + "af_flagged.json") || [];
        for (var f = 0; f < flagged.length; f++) {
            var m = seq.markers.createMarker(snap(flagged[f].start));
            if (m) {
                m.name = afClip("ПРОВЕРИТЬ: " + flagged[f].red_text, 120);
                m.comments = flagged[f].block_tc + "\n" + flagged[f].speaker + "\n" + flagged[f].block_text;
                try { m.setColorByIndex(1); } catch (e) {}
                markersAdded++;
            }
        }

        var anns = afReadJSON(runDir + "af_annotations.json") || [];
        for (var a = 0; a < anns.length; a++) {
            var m2 = seq.markers.createMarker(snap(anns[a].start));
            if (m2) {
                m2.name = afClip("ПРОЧЕЕ: " + anns[a].text, 120);
                m2.comments = "Слово ЗАГЛАВНЫМИ внутри реплики";
                try { m2.setColorByIndex(3); } catch (e) {}
                markersAdded++;
            }
        }

        var notes = afReadJSON(runDir + "af_notes.json") || [];
        for (var nI = 0; nI < notes.length; nI++) {
            var m3 = seq.markers.createMarker(snap(notes[nI].start));
            if (m3) {
                m3.name = afClip("КОММЕНТАРИЙ: " + notes[nI].text, 120);
                m3.comments = notes[nI].text;
                try { m3.setColorByIndex(2); } catch (e) {}
                markersAdded++;
            }
        }

        return "OK:" + count + ":" + markersAdded + ":" + moved;
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}

// ---------------------------------------------------------------------------
// Перестановка КРУПНЫХ блоков в порядке дока (core/reorder.js buildRuns + markers.runsAfterCuts).
// Вызывается ПОСЛЕ обычной резки (extract), поэтому работает с уже порезанным таймлайном.
// af_runs.json — [[s,e],…] в координатах порезанного таймлайна, в целевом порядке (≈десятки блоков, не сотни кусков).
//   1) razor по границам блоков на дорожках, где есть клипы;
//   2) клипы — в «стейджинг» за конец секвенции с сохранением порядка блоков;
//   3) из стейджинга — на финальные места (исходная зона уже пуста, ripple не нужен).

var AF_TICKS = 254016000000;

function afTc(sec, fps, zeroSec) {
    var total = Math.round((sec + zeroSec) * fps);
    var ifps = Math.round(fps);
    var f = total % ifps;
    var s = Math.floor(total / ifps);
    function p2(n) { return (n < 10 ? "0" : "") + n; }
    return p2(Math.floor(s / 3600)) + ":" + p2(Math.floor((s % 3600) / 60)) + ":" + p2(s % 60) + ":" + p2(f);
}

function afSetStart(clip, sec) {
    var dur = clip.end.seconds - clip.start.seconds;
    var t = new Time();
    t.seconds = sec;
    try {
        clip.start = t;
    } catch (e) {
        clip.move(t);
        return;
    }
    // если API сдвинул только начало (укоротил клип) — вернуть длительность
    if (Math.abs((clip.end.seconds - clip.start.seconds) - dur) > 0.001) {
        var te = new Time();
        te.seconds = sec + dur;
        clip.end = te;
    }
}

function afRunIndex(runs, t) {
    for (var i = 0; i < runs.length; i++) {
        if (t >= runs[i][0] - 0.0005 && t < runs[i][1] - 0.0005) return i;
    }
    return -1;
}

// возвращает число перенесённых блоков или бросает исключение
function afReorderRuns(seq, qeSeq, runDir, runs, FPS) {
    function snap(s) { return Math.round(s * FPS) / FPS; }
    var zero = 0;
    try { zero = parseFloat(seq.zeroPoint) / AF_TICKS; } catch (e0) {}

    var bounds = [];
    var i;
    for (i = 0; i < runs.length; i++) { bounds.push(snap(runs[i][0])); bounds.push(snap(runs[i][1])); }
    bounds.sort(function (x, y) { return x - y; });
    var uniq = [];
    for (i = 0; i < bounds.length; i++) if (i === 0 || bounds[i] - uniq[uniq.length - 1] > 0.0005) uniq.push(bounds[i]);

    var vUsed = [];
    var aUsed = [];
    for (i = 0; i < seq.videoTracks.numTracks; i++) if (seq.videoTracks[i].clips.numItems > 0) vUsed.push(i);
    for (i = 0; i < seq.audioTracks.numTracks; i++) if (seq.audioTracks[i].clips.numItems > 0) aUsed.push(i);
    afLog(runDir, "reorder: блоков " + runs.length + ", границ " + uniq.length + ", дорожек V" + vUsed.length + "/A" + aUsed.length);

    // 1) razor с конца в начало (границу 0 и конец секвенции резать незачем — клипы там и так кончаются)
    for (var b = uniq.length - 1; b >= 0; b--) {
        if (uniq[b] <= 0.0005) continue;
        var tc = afTc(uniq[b], FPS, zero);
        for (var v = 0; v < vUsed.length; v++) qeSeq.getVideoTrackAt(vUsed[v]).razor(tc);
        for (var a = 0; a < aUsed.length; a++) qeSeq.getAudioTrackAt(aUsed[a]).razor(tc);
    }
    afLog(runDir, "reorder: razor завершён");

    var outStart = [];
    var acc = 0;
    for (i = 0; i < runs.length; i++) { outStart.push(acc); acc += runs[i][1] - runs[i][0]; }

    // 2) какой клип к какому блоку относится (после razor клип целиком лежит в одном блоке)
    var plan = [];
    var unassigned = [];
    var maxEnd = 0;
    function scan(tracks, used) {
        for (var u = 0; u < used.length; u++) {
            var clips = tracks[used[u]].clips;
            for (var c = 0; c < clips.numItems; c++) {
                var cl = clips[c];
                var cs = cl.start.seconds;
                if (cl.end.seconds > maxEnd) maxEnd = cl.end.seconds;
                var ri = afRunIndex(runs, snap(cs) + 0.0005);
                if (ri < 0) unassigned.push(cl);
                else plan.push({ clip: cl, run: ri, off: cs - runs[ri][0] });
            }
        }
    }
    scan(seq.videoTracks, vUsed);
    scan(seq.audioTracks, aUsed);
    afLog(runDir, "reorder: клипов к переносу " + plan.length + ", вне блоков " + unassigned.length);

    var base = maxEnd + 60;
    for (i = 0; i < plan.length; i++) afSetStart(plan[i].clip, base + outStart[plan[i].run] + plan[i].off);
    // клипы вне блоков не удаляем — уводим за конец, чтобы не мешали, и сообщаем
    for (i = 0; i < unassigned.length; i++) afSetStart(unassigned[i], base + acc + 60 + i);
    afLog(runDir, "reorder: стейджинг завершён");
    for (i = 0; i < plan.length; i++) afSetStart(plan[i].clip, outStart[plan[i].run] + plan[i].off);
    afLog(runDir, "reorder: перенос завершён");
    return runs.length;
}

// те же три вида маркеров, что и в autoFishCut
function afAddMarkers(seq, runDir, snap) {
    var n = 0;
    var flagged = afReadJSON(runDir + "af_flagged.json") || [];
    for (var f = 0; f < flagged.length; f++) {
        var m = seq.markers.createMarker(snap(flagged[f].start));
        if (m) {
            m.name = afClip("ПРОВЕРИТЬ: " + flagged[f].red_text, 120);
            m.comments = flagged[f].block_tc + "\n" + flagged[f].speaker + "\n" + flagged[f].block_text;
            try { m.setColorByIndex(1); } catch (e1) {}
            n++;
        }
    }
    var anns = afReadJSON(runDir + "af_annotations.json") || [];
    for (var a = 0; a < anns.length; a++) {
        var m2 = seq.markers.createMarker(snap(anns[a].start));
        if (m2) {
            m2.name = afClip("ПРОЧЕЕ: " + anns[a].text, 120);
            m2.comments = "Слово ЗАГЛАВНЫМИ внутри реплики";
            try { m2.setColorByIndex(3); } catch (e2) {}
            n++;
        }
    }
    var notes = afReadJSON(runDir + "af_notes.json") || [];
    for (var k = 0; k < notes.length; k++) {
        var m3 = seq.markers.createMarker(snap(notes[k].start));
        if (m3) {
            m3.name = afClip("КОММЕНТАРИЙ: " + notes[k].text, 120);
            m3.comments = notes[k].text;
            try { m3.setColorByIndex(2); } catch (e3) {}
            n++;
        }
    }
    return n;
}

// Резервная копия: сохранить проект, вернуть путь .prproj. Копирование файла делает панель (node fs).
function afBackupInfo() {
    try {
        var p = app.project.path;
        if (!p) return '{"ok":false,"error":"проект ещё не сохранён — сначала сохрани его в Premiere"}';
        try { app.project.save(); } catch (e) {}
        return '{"ok":true,"path":' + toJSONString(p) + "}";
    } catch (e2) {
        return '{"ok":false,"error":' + toJSONString(String(e2)) + "}";
    }
}

// ---------------------------------------------------------------------------
// ПОШАГОВЫЙ РЕЖИМ. Каждый вызов из панели = отдельный стек движка. Один длинный вызов с сотнями
// qe-операций падает с «Stack overrun» (на 94 дорожках — уже примерно на 12-м extract).
// Поэтому панель зовёт эти функции пачками и по очереди; каждая возвращает "OK:…" или "ERROR:выполнено:текст".

function afPrep(runDir) {
    if (runDir.charAt(runDir.length - 1) !== "/" && runDir.charAt(runDir.length - 1) !== "\\") runDir += "/";
    return runDir;
}

function afReadProgress(runDir) {
    try {
        var f = new File(runDir + "af_progress.txt");
        if (!f.exists) return 0;
        f.open("r");
        var t = f.read();
        f.close();
        var v = parseInt(t, 10);
        return isNaN(v) ? 0 : v;
    } catch (e) {
        return 0;
    }
}

function afWriteProgress(runDir, n) {
    try {
        var f = new File(runDir + "af_progress.txt");
        f.open("w");
        f.write(String(n));
        f.close();
    } catch (e) {}
}

// пачка вырезов [from, from+n); вернёт "OK:следующий_индекс:всего"
function afCutStep(runDir, fps, from, n) {
    var done = from;
    try {
        runDir = afPrep(runDir);
        var FPS = fps || 25;
        function snap(s) { return Math.round(s * FPS) / FPS; }
        app.enableQE();
        var seq = app.project.activeSequence;
        var qeSeq = qe.project.getActiveSequence();
        if (!seq || !qeSeq) return "ERROR:" + done + ":нет активной секвенции";
        var cuts = afReadJSON(runDir + "af_cuts.json");
        if (!cuts || cuts.length === 0) return "ERROR:" + done + ":cut-лист пуст или не найден";
        cuts.sort(function (x, y) { return y[0] - x[0]; }); // с конца в начало
        // прогресс в файле: если вызов повторили после сбоя/занятости Premiere, уже сделанные вырезы не повторяем
        var start = Math.max(from, afReadProgress(runDir));
        done = start;
        var to = Math.min(cuts.length, start + n);
        for (var i = start; i < to; i++) {
            seq.setInPoint(snap(cuts[i][0]));
            seq.setOutPoint(snap(cuts[i][1]));
            qeSeq.extract();
            done = i + 1;
            afWriteProgress(runDir, done);
        }
        afLog(runDir, "cut: " + done + " из " + cuts.length);
        return "OK:" + done + ":" + cuts.length;
    } catch (e) {
        afLog(runDir, "cut: ОШИБКА после " + done + ": " + e);
        return "ERROR:" + done + ":" + e;
    }
}

function afRunBounds(runs, FPS) {
    function snap(s) { return Math.round(s * FPS) / FPS; }
    var b = [];
    for (var i = 0; i < runs.length; i++) { b.push(snap(runs[i][0])); b.push(snap(runs[i][1])); }
    b.sort(function (x, y) { return y - x; }); // с конца в начало
    var u = [];
    for (var k = 0; k < b.length; k++) {
        if (b[k] <= 0.0005) continue;
        if (u.length === 0 || u[u.length - 1] - b[k] > 0.0005) u.push(b[k]);
    }
    return u;
}

function afUsedTracks(seq) {
    var v = [];
    var a = [];
    var i;
    for (i = 0; i < seq.videoTracks.numTracks; i++) if (seq.videoTracks[i].clips.numItems > 0) v.push(i);
    for (i = 0; i < seq.audioTracks.numTracks; i++) if (seq.audioTracks[i].clips.numItems > 0) a.push(i);
    return { v: v, a: a };
}

// пачка разрезов по границам блоков; вернёт "OK:следующий:всего"
function afRazorStep(runDir, fps, from, n) {
    var done = from;
    try {
        runDir = afPrep(runDir);
        var FPS = fps || 25;
        app.enableQE();
        var seq = app.project.activeSequence;
        var qeSeq = qe.project.getActiveSequence();
        var runs = afReadJSON(runDir + "af_runs.json") || [];
        var bounds = afRunBounds(runs, FPS);
        var zero = 0;
        try { zero = parseFloat(seq.zeroPoint) / AF_TICKS; } catch (e0) {}
        var used = afUsedTracks(seq);
        var to = Math.min(bounds.length, from + n);
        for (var b = from; b < to; b++) {
            var tc = afTc(bounds[b], FPS, zero);
            var v;
            var a;
            for (v = 0; v < used.v.length; v++) qeSeq.getVideoTrackAt(used.v[v]).razor(tc);
            for (a = 0; a < used.a.length; a++) qeSeq.getAudioTrackAt(used.a[a]).razor(tc);
            done = b + 1;
        }
        afLog(runDir, "razor: " + done + " из " + bounds.length);
        return "OK:" + done + ":" + bounds.length;
    } catch (e) {
        afLog(runDir, "razor: ОШИБКА после " + done + ": " + e);
        return "ERROR:" + done + ":" + e;
    }
}

// база стейджинга (за концом всех клипов); вернёт "OK:база:длина_итога:клипов"
function afReorderInit(runDir, fps) {
    try {
        runDir = afPrep(runDir);
        var seq = app.project.activeSequence;
        var runs = afReadJSON(runDir + "af_runs.json") || [];
        var total = 0;
        for (var i = 0; i < runs.length; i++) total += runs[i][1] - runs[i][0];
        var used = afUsedTracks(seq);
        var maxEnd = 0;
        var n = 0;
        function scan(tracks, idx) {
            for (var u = 0; u < idx.length; u++) {
                var clips = tracks[idx[u]].clips;
                for (var c = 0; c < clips.numItems; c++) { n++; if (clips[c].end.seconds > maxEnd) maxEnd = clips[c].end.seconds; }
            }
        }
        scan(seq.videoTracks, used.v);
        scan(seq.audioTracks, used.a);
        var base = Math.ceil(maxEnd + 60);
        afLog(runDir, "reorder: блоков " + runs.length + ", клипов " + n + ", база " + base + ", итоговая длина " + total);
        return "OK:" + base + ":" + total + ":" + n;
    } catch (e) {
        return "ERROR:0:" + e;
    }
}

// пачка переносов. phase "stage": клипы блоков -> за базу; "final": из-за базы на итоговые места.
// вернёт "OK:осталось:перенесено"
function afMoveStep(runDir, fps, phase, base, n) {
    try {
        runDir = afPrep(runDir);
        var FPS = fps || 25;
        function snap(s) { return Math.round(s * FPS) / FPS; }
        app.enableQE();
        var seq = app.project.activeSequence;
        var runs = afReadJSON(runDir + "af_runs.json") || [];
        var outStart = [];
        var total = 0;
        var i;
        for (i = 0; i < runs.length; i++) { outStart.push(total); total += runs[i][1] - runs[i][0]; }
        var used = afUsedTracks(seq);
        var items = [];
        function collect(tracks, idx) {
            for (var u = 0; u < idx.length; u++) {
                var clips = tracks[idx[u]].clips;
                for (var c = 0; c < clips.numItems; c++) items.push(clips[c]);
            }
        }
        collect(seq.videoTracks, used.v);
        collect(seq.audioTracks, used.a);

        var moved = 0;
        var remaining = 0;
        for (i = 0; i < items.length; i++) {
            var cl = items[i];
            var cs = cl.start.seconds;
            var target = null;
            if (phase === "stage") {
                if (cs >= base - 0.5) continue; // уже в стейджинге
                var ri = afRunIndex(runs, snap(cs) + 0.0005);
                if (ri < 0) {
                    // клип вне блоков дока (хвост после последней реплики) — в итог не входит, удаляем без ripple
                    if (moved < n) { try { cl.remove(false, false); } catch (eRm) {} moved++; } else { remaining++; }
                    continue;
                }
                target = base + outStart[ri] + (cs - runs[ri][0]);
            } else {
                if (cs < base - 0.5 || cs >= base + total + 30) continue;
                target = cs - base;
            }
            if (moved < n) { afSetStart(cl, target); moved++; } else { remaining++; }
        }
        afLog(runDir, "move(" + phase + "): перенесено " + moved + ", осталось " + remaining);
        return "OK:" + remaining + ":" + moved;
    } catch (e) {
        afLog(runDir, "move(" + phase + "): ОШИБКА: " + e);
        return "ERROR:0:" + e;
    }
}

// маркеры в конце; вернёт "OK:число"
function afMarkersStep(runDir, fps) {
    try {
        runDir = afPrep(runDir);
        var FPS = fps || 25;
        function snap(s) { return Math.round(s * FPS) / FPS; }
        var seq = app.project.activeSequence;
        var n = afAddMarkers(seq, runDir, snap);
        afLog(runDir, "markers: " + n);
        return "OK:" + n;
    } catch (e) {
        return "ERROR:0:" + e;
    }
}

// Плейхед в пустую область за концом: после каждой правки Premiere перерисовывает кадр под плейхедом,
// на тяжёлых дорожках это заметная часть времени. Прежнюю позицию запоминаем в файл и возвращаем в конце.
function afParkPlayhead(runDir) {
    try {
        runDir = afPrep(runDir);
        var seq = app.project.activeSequence;
        var pos = seq.getPlayerPosition().seconds;
        var f = new File(runDir + "af_playhead.txt");
        f.open("w");
        f.write(String(pos));
        f.close();
        seq.setPlayerPosition(String(Math.round(43200 * AF_TICKS)));
        return "OK:" + pos;
    } catch (e) {
        return "OK:parkfail"; // не критично: просто будет медленнее
    }
}

function afRestorePlayhead(runDir) {
    try {
        runDir = afPrep(runDir);
        var f = new File(runDir + "af_playhead.txt");
        if (!f.exists) return "OK:none";
        f.open("r");
        var pos = parseFloat(f.read());
        f.close();
        var seq = app.project.activeSequence;
        seq.setPlayerPosition(String(Math.round(pos * AF_TICKS)));
        return "OK:" + pos;
    } catch (e) {
        return "OK:restorefail";
    }
}

// ---------------------------------------------------------------------------
// Быстрая сборка через FCP7 XML (см. core/xmlrebuild.js): экспорт активной секвенции, импорт готового XML как новой секвенции.

// папка проекта; вернёт "OK:путь"
function afProjectDir() {
    try {
        var p = app.project.path;
        if (!p) return "ERROR:0:проект ещё не сохранён — сначала сохрани его в Premiere";
        var f = new File(p);
        return "OK:" + f.parent.fsName;
    } catch (e) {
        return "ERROR:0:" + e;
    }
}

// экспорт активной секвенции; вернёт "OK:размер:имя"
function afWinPath(p) {
    return String(p).split("/").join("\\"); // exportAsFinalCutProXML/importFiles принимают только пути с обратными слэшами
}

function afExportXml(outPath) {
    try {
        outPath = afWinPath(outPath);
        var seq = app.project.activeSequence;
        if (!seq) return "ERROR:0:нет активной секвенции";
        var old = new File(outPath);
        if (old.exists) old.remove();
        var ok = false;
        try {
            ok = seq.exportAsFinalCutProXML(outPath, 1); // 1 = без диалогов
        } catch (e1) {
            ok = false;
        }
        var f = new File(outPath);
        if (!f.exists) return "ERROR:0:XML не создан (exportAsFinalCutProXML вернул " + ok + "; проверь путь: только латиница, обратные слэши)";
        return "OK:" + f.length + ":" + seq.name;
    } catch (e) {
        return "ERROR:0:экспорт XML: " + e;
    }
}

// импорт XML; новая секвенция = та, которой не было до импорта; вернёт "OK:имя:id"
function afImportXml(xmlPath) {
    try {
        var before = {};
        var i;
        for (i = 0; i < app.project.sequences.numSequences; i++) before[app.project.sequences[i].sequenceID] = 1;
        app.project.importFiles([afWinPath(xmlPath)], true, app.project.getInsertionBin(), false);
        var found = null;
        for (i = 0; i < app.project.sequences.numSequences; i++) {
            var s = app.project.sequences[i];
            if (!before[s.sequenceID]) found = s;
        }
        if (!found) return "ERROR:0:после импорта новая секвенция не появилась (Premiere мог отклонить XML)";
        try { app.project.openSequence(found.sequenceID); } catch (e2) {}
        return "OK:" + found.name + ":" + found.sequenceID;
    } catch (e) {
        return "ERROR:0:импорт XML: " + e;
    }
}

// ---------------------------------------------------------------------------
// Резка по звуку (по пикам громкости): клипы аудиодорожки с путями к медиа.
// trackIndex1based — как в интерфейсе Premiere (A6 = 6). Вернёт JSON {hasTrack, clips:[{start,end,inPoint,mediaPath}]}.
function afTrackClips(trackIndex1based) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return '{"hasTrack":false}';
        var idx = trackIndex1based - 1;
        if (idx < 0 || idx >= seq.audioTracks.numTracks) {
            return '{"hasTrack":false,"error":' + toJSONString("Нет аудиодорожки номер " + trackIndex1based) + "}";
        }
        var track = seq.audioTracks[idx];
        var out = [];
        for (var i = 0; i < track.clips.numItems; i++) {
            var c = track.clips[i];
            var mediaPath = "";
            try {
                if (c.projectItem) mediaPath = c.projectItem.getMediaPath();
            } catch (eMp) {}
            out.push(
                '{"start":' + c.start.seconds +
                ',"end":' + c.end.seconds +
                ',"inPoint":' + c.inPoint.seconds +
                ',"mediaPath":' + toJSONString(mediaPath) + "}"
            );
        }
        return '{"hasTrack":true,"clips":[' + out.join(",") + "]}";
    } catch (e) {
        return '{"hasTrack":false,"error":' + toJSONString(String(e)) + "}";
    }
}
