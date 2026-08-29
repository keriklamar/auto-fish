// host/cut.jsx — ExtendScript-хост Auto Fish. Авто-загружается панелью
// (ScriptPath в manifest.xml). Вызывается из панели через evalScript:
//   afSeqInfo()               -> JSON {hasSeq, fps, name}
//   autoFishCut(runDir, fps)  -> резка + маркеры, вернёт "OK:вырезано:маркеров" или "ERROR: …"
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
    return eval("(" + content + ")");
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

function autoFishCut(runDir, fps) {
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
        var count = 0;
        for (var i = 0; i < cuts.length; i++) {
            seq.setInPoint(snap(cuts[i][0]));
            seq.setOutPoint(snap(cuts[i][1]));
            qeSeq.extract();
            count++;
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

        return "OK:" + count + ":" + markersAdded;
    } catch (e) {
        return "ERROR: " + e.toString();
    }
}
