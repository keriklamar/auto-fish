/* app.js — Auto Fish CEP-панель. Мастер по шагам внутри Premiere:
   Шаг 1 (файлы) -> Разобрать -> Шаг 2 (проверка, аккордеон) -> Порезать. */

(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var csi = new CSInterface();

  var nodeRequire =
    (window.cep_node && window.cep_node.require) ||
    (typeof require === "function" ? require : null);

  function setStatus(el, text, kind) {
    el.textContent = text || "";
    el.className = "status" + (kind ? " " + kind : "");
  }
  var status1 = $("status");
  var status2 = $("status2");

  if (!nodeRequire) {
    setStatus(status1,
      "Node.js в панели не включён. Переустанови через install.bat и перезапусти Premiere.",
      "err");
    return;
  }

  var nfs = nodeRequire("fs");
  var npath = nodeRequire("path");

  function extDir() {
    var p = csi.getSystemPath("extension");
    if (p) return p;
    var here = decodeURIComponent(window.location.pathname).replace(/^\/([A-Za-z]:)/, "$1");
    return npath.resolve(npath.dirname(here), "..");
  }
  var EXT = extDir();
  var CORE = npath.join(EXT, "core");
  var RUN_DIR = npath.join(EXT, "run");

  var mods = {};
  try {
    ["parseDocx", "parseTranscript", "analyze", "timecode", "runfiles", "markers", "xmlrebuild", "peakAnalyze"].forEach(function (n) {
      mods[n] = nodeRequire(npath.join(CORE, n + ".js"));
    });
  } catch (e) {
    setStatus(status1, "Не удалось загрузить ядро:\n" + e.message + "\nEXT=" + EXT, "err");
    return;
  }
  var secToTc = mods.timecode.secToTc;

  // ---------- состояние ----------
  var st = { docxPath: "", jsonPath: "", fps: 25, hasSeq: false, result: null };

  // подстраховка: если ScriptPath не подхватил cut.jsx — грузим явно
  csi.evalScript(
    '(typeof afMarkersStep === "function") ? "ok" : $.evalFile(' +
      JSON.stringify(npath.join(EXT, "host", "cut.jsx").replace(/\\/g, "/")) +
      ")",
    function () {}
  );

  // ---------- инфо о секвенции ----------
  function clampFps(f) {
    return isFinite(f) && f >= 1 && f <= 1000 ? f : 25;
  }
  csi.getSeqInfo(function (info) {
    st.hasSeq = !!info.hasSeq;
    if (info.hasSeq) {
      st.fps = clampFps(info.fps);
      var shown = Math.round(st.fps * 1000) / 1000;
      $("seq-line").textContent = "Секвенция: " + (info.name || "?") + " · " + shown + " fps";
    } else {
      $("seq-line").textContent = "⚠ Нет активной секвенции — открой её, потом переоткрой панель.";
    }
    refreshCutBtn();
  });

  // ---------- выбор файлов ----------
  // имя · размер · дата изменения: чтобы видеть, что взят именно свежий файл (имена у старого и нового бывают одинаковые)
  function fileInfo(p) {
    if (!p) return "не выбран";
    try {
      var s = nfs.statSync(p);
      var d = new Date(s.mtimeMs);
      var pad = function (n) { return (n < 10 ? "0" : "") + n; };
      return npath.basename(p) + " · " + Math.round(s.size / 1024) + " КБ · изменён " +
        pad(d.getDate()) + "." + pad(d.getMonth() + 1) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    } catch (e) {
      return p;
    }
  }
  function setDocx(p) {
    st.docxPath = p;
    var el = $("path-docx");
    el.textContent = fileInfo(p);
    el.title = p || "";
    el.classList.toggle("set", !!p);
    refreshParseBtn();
  }
  function setJson(p) {
    st.jsonPath = p;
    var el = $("path-json");
    el.textContent = fileInfo(p);
    el.title = p || "";
    el.classList.toggle("set", !!p);
    refreshParseBtn();
  }
  function refreshParseBtn() {
    $("btn-parse").disabled = !(st.docxPath && st.jsonPath);
  }

  $("pick-docx").addEventListener("click", function () { $("file-docx").click(); });
  $("pick-json").addEventListener("click", function () { $("file-json").click(); });
  $("file-docx").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    if (f && f.path) setDocx(f.path);
    e.target.value = ""; // чтобы повторный выбор того же файла тоже сработал
  });
  $("file-json").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    if (f && f.path) setJson(f.path);
    e.target.value = "";
  });

  // ---------- drag & drop ----------
  var dz = $("dropzone");
  ["dragenter", "dragover"].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add("drag"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove("drag"); });
  });
  dz.addEventListener("drop", function (e) {
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files) return;
    for (var i = 0; i < files.length; i++) {
      var p = files[i].path || "";
      if (/\.docx$/i.test(p)) setDocx(p);
      else if (/\.json$/i.test(p)) setJson(p);
    }
  });

  // ---------- разбор ----------
  $("btn-parse").addEventListener("click", function () {
    if (!st.docxPath || !st.jsonPath) return;
    var btn = $("btn-parse");
    btn.disabled = true;
    btn.textContent = "Разбираю…";
    setStatus(status1, "");

    Promise.resolve()
      .then(function () { return mods.parseDocx.parseDocxFile(st.docxPath, st.fps); })
      .then(function (docxResult) {
        if (!docxResult.blocks.length) {
          throw new Error(
            "В доке не найдено ни одного таймкод-блока (формат «ЧЧ:ММ:СС:КК — ЧЧ:ММ:СС:КК» " +
              "или «ММ:СС — ММ:СС»). Проверь, что это транскрипт-экспорт из Premiere, " +
              "а не пустой/переформатированный файл."
          );
        }
        var words = mods.parseTranscript.loadTranscriptFile(st.jsonPath);
        st.result = mods.analyze.runParse(docxResult, words, { fps: st.fps });
        renderStep2(st.result);
        goStep(2);
      })
      .catch(function (e) {
        setStatus(status1, "" + (e && e.message ? e.message : e), "err");
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = "Разобрать";
      });
  });

  // ---------- шаги ----------
  function goStep(n) {
    $("step1").hidden = n !== 1;
    $("step2").hidden = n !== 2;
    $("step3").hidden = n !== 3;
    Array.prototype.forEach.call(document.querySelectorAll("#steps .step"), function (s) {
      s.classList.toggle("active", s.getAttribute("data-step") === String(n));
    });
  }
  $("btn-back").addEventListener("click", function () { goStep(1); });

  // ---------- аккордеон ----------
  Array.prototype.forEach.call(document.querySelectorAll(".acc"), function (acc) {
    var head = acc.querySelector(".acc-head");
    var body = acc.querySelector(".acc-body");
    head.addEventListener("click", function () {
      if (acc.classList.contains("empty")) return;
      var willOpen = body.hidden;
      body.hidden = !willOpen;
      head.classList.toggle("open", willOpen);
    });
  });

  // ---------- рендер шага 2 ----------
  var STAT_LABELS = [
    ["n_blocks", "Блоков (реплик)"],
    ["n_skipped_blocks", "Не в секвенции (подводки, чужие семьи, отрезанное)"],
    ["n_full_red", "Полностью красных"],
    ["n_partial_matched", "Частично красных — сматчено"],
    ["n_partial_failed", "Частично красных — НЕ сматчено"],
    ["n_final_cuts", "Итоговых диапазонов реза"],
    ["total_cut_seconds", "Суммарно вырежется"],
  ];

  function renderStep2(r) {
    var rows = $("stats-rows");
    rows.innerHTML = "";
    STAT_LABELS.forEach(function (pair) {
      var v = r.stats[pair[0]];
      if (pair[0] === "total_cut_seconds") v = v.toFixed(1) + " с (" + (v / 60).toFixed(1) + " мин)";
      var tr = document.createElement("tr");
      tr.innerHTML = "<td></td><td></td>";
      tr.children[0].textContent = pair[1];
      tr.children[1].textContent = v;
      rows.appendChild(tr);
    });

    // сведения о привязке сценария к секвенции по тексту
    var al = r.alignment || {};
    var hms = function (s) { return secToTc(Math.max(0, s), st.fps).slice(0, 8); };
    var addRow = function (a, b) {
      var tr = document.createElement("tr");
      tr.innerHTML = "<td></td><td></td>";
      tr.children[0].textContent = a;
      tr.children[1].textContent = b;
      rows.appendChild(tr);
    };
    if (al.mode === "aligned") {
      (al.pieces || []).forEach(function (p, i) {
        addRow("Привязка " + (al.pieces.length > 1 ? (i + 1) + ": " : "") + "сценарий → секвенция",
          hms(p.docStart) + "–" + hms(p.docEnd) + " → " + hms(p.seqStart) + "–" + hms(p.seqEnd) +
          " (сдвиг " + (p.offset >= 0 ? "+" : "−") + Math.abs(p.offset).toFixed(1) + " с)");
      });
    } else if (al.mode === "none") {
      addRow("⚠ Привязка по тексту", "не удалась — режу по таймкодам сценария как есть");
    }

    renderRows("flagged", r.flagged, true);
    renderRows("notes", r.standalone_notes, false);
    renderRows("ann", r.annotations, false);

    var rb = $("reorder-box");
    rb.hidden = !r.reordered;
    if (r.reordered) {
      var w = r.reorder_warnings || {};
      $("reorder-desc").textContent =
        "Сначала нажми «Порезать секвенцию», потом на порезанной секвенции — «Поменять местами». " +
        "Крупных блоков: " + r.runs.length + ", разрывов порядка: " + r.run_jumps + "." +
        (r.run_duplicates_dropped ? " Повторно использованных участков (оставлено первое вхождение): " + r.run_duplicates_dropped + "." : "") +
        (w.overlaps ? " Перекрывающихся блоков: " + w.overlaps + "." : "");
    }
    $("chk-backup").checked = false; // по умолчанию выключено
    $("chk-inplace").checked = true; // основной способ — резка на месте, как раньше

    setStatus(status2, "");
    var btn = $("btn-cut");
    btn.textContent = "Порезать секвенцию";
    btn.onclick = doCut;
    var br = $("btn-reorder");
    br.hidden = true; // перестановка — экспериментальная, в основной сценарий не входит
    rb.hidden = true;
    br.disabled = !r.reordered || !st.hasSeq;
    br.title = r.reordered ? "" : "Порядок блоков в доке совпадает с порядком в секвенции";
    br.onclick = function () {
      if (!st.result || !st.hasSeq) return;
      if (!window.confirm(
        "Активная секвенция должна быть уже ПОРЕЗАНА по этому доку (кнопка «Порезать секвенцию»).\n" +
        "Будет создана НОВАЯ секвенция, где блоки стоят в порядке дока. Исходная не изменится.\n" +
        "Мультикам и вложенные секвенции через XML не переносятся.\n\nПоменять местами?"
      )) return;
      doRebuild("reorder");
    };
    refreshCutBtn();

    Array.prototype.forEach.call(document.querySelectorAll(".acc"), function (acc) {
      acc.querySelector(".acc-body").hidden = true;
      acc.querySelector(".acc-head").classList.remove("open");
    });
  }

  function refreshCutBtn() {
    var btn = $("btn-cut");
    if (!btn) return;
    if (!st.hasSeq) {
      btn.disabled = true;
      btn.title = "Нет активной секвенции";
      if (!$("status2").textContent) setStatus($("status2"), "Открой секвенцию в Premiere и переоткрой панель.", "err");
    } else if (st.result) {
      btn.disabled = false;
      btn.title = "";
    }
  }

  function markAcc(key, count) {
    var acc = document.querySelector('.acc[data-key="' + key + '"]');
    if (!acc) return;
    var cnt = acc.querySelector(".ac-cnt");
    if (cnt) cnt.textContent = count;
    acc.classList.toggle("has", count > 0);
    acc.classList.toggle("empty", count === 0);
  }

  function renderRows(cat, items, isFlagged) {
    var host = $("rows-" + cat);
    host.innerHTML = "";
    var bulk = $("bulk-" + cat);

    items.forEach(function (it) {
      var row = document.createElement("div");
      row.className = "row";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = bulk.checked;

      var tc = document.createElement("span");
      tc.className = "tc";
      tc.textContent = secToTc(it.start, st.fps).slice(0, 8);

      var inp = document.createElement("input");
      inp.className = "marker";
      inp.type = "text";
      inp.value = isFlagged ? it.red_text : it.text;

      row.appendChild(cb);
      row.appendChild(tc);
      row.appendChild(inp);

      if (isFlagged) {
        var sub = document.createElement("div");
        sub.className = "sub";
        sub.textContent = it.block_tc + "  ·  " + (it.speaker || "—") + "\n" + it.block_text;
        row.appendChild(sub);
      }

      row._item = it;
      row._cb = cb;
      row._inp = inp;
      host.appendChild(row);
    });

    bulk.onchange = function () {
      Array.prototype.forEach.call(host.querySelectorAll(".row"), function (row) {
        row._cb.checked = bulk.checked;
      });
    };

    markAcc(cat, items.length);
  }

  function collectRows(cat, isFlagged) {
    var out = [];
    Array.prototype.forEach.call($("rows-" + cat).querySelectorAll(".row"), function (row) {
      if (!row._cb.checked) return;
      var patch = isFlagged ? { red_text: row._inp.value } : { text: row._inp.value };
      out.push(Object.assign({}, row._item, patch));
    });
    return out;
  }

  // ---------- быстрая сборка через XML ----------
  // Экспорт активной секвенции в FCP7 XML -> пересчёт клипов в Node (core/xmlrebuild.js) -> импорт как НОВАЯ секвенция.
  // Исходная секвенция не меняется. mode: "cut" — вырезать красное; "reorder" — поменять местами блоки по доку
  // (на уже порезанной секвенции: куски = st.result.runs_post).
  function doRebuild(mode) {
    var btn = $("btn-cut");
    var btnR = $("btn-reorder");
    var stopBtn = $("btn-stop");
    var t0 = Date.now();
    function lap(msg) { setStatus(status2, msg + "  (" + Math.round((Date.now() - t0) / 1000) + " с)"); }
    function idle() {
      btn.disabled = false;
      btnR.disabled = !st.result || !st.result.reordered;
      btn.textContent = "Порезать секвенцию";
    }
    function fail(msg) {
      stopBtn.hidden = true;
      setStatus(status2, msg, "err");
      idle();
    }
    function call(expr, onOk) {
      csi.evalScript(expr, function (res) {
        res = String(res || "");
        if (res.indexOf("OK:") === 0) { onOk(res.split(":")); return; }
        var p = res.split(":");
        fail("Сборка не выполнена: " + (p[0] === "ERROR" ? p.slice(2).join(":") : res));
      });
    }

    btn.disabled = true;
    btnR.disabled = true;
    stopBtn.hidden = true; // операции короткие, исходную секвенцию мы не трогаем
    var isReorder = mode === "reorder";
    var suffix = isReorder ? "_порядок" : "_AF";

    lap("1/3 Экспорт секвенции в XML…");
    call("afProjectDir()", function (pd) {
      var projDir = pd.slice(1).join(":");
      var dir = npath.join(projDir, "AutoFish_xml");
      if (/[^\x00-\x7F]/.test(dir)) {
        fail("Путь к папке проекта содержит не латинские символы:\n" + dir + "\nExtendScript не умеет экспортировать XML в такой путь. Перенеси проект в папку с латинским путём.");
        return;
      }
      try { nfs.mkdirSync(dir, { recursive: true }); } catch (e) { fail("Не удалось создать папку " + dir + ": " + e.message); return; }
      var d = new Date();
      var pad = function (n) { return (n < 10 ? "0" : "") + n; };
      var stamp = pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
      var srcXml = npath.join(dir, "src_" + stamp + ".xml");
      var outXml = npath.join(dir, "out_" + stamp + ".xml");
      var exportedAt = Date.now() - 2000;

      call("afExportXml(" + JSON.stringify(srcXml) + ")", function (ex) {
        var seqName = ex.slice(2).join(":");

        // отчёт Premiere о том, что не попало в XML (мультикам и вложенные секвенции FCP XML не поддерживает)
        var skipped = 0;
        try {
          nfs.readdirSync(dir).forEach(function (fn) {
            if (!/^FCP Translation Results/.test(fn)) return;
            var full = npath.join(dir, fn);
            if (nfs.statSync(full).mtimeMs < exportedAt) return;
            var txt = nfs.readFileSync(full, "utf8");
            skipped += (txt.match(/was skipped/g) || []).length;
          });
        } catch (e) {}
        if (skipped > 0 && !window.confirm(
          "Premiere не смог положить в XML " + skipped + " элемент(ов) (мультикам или вложенные секвенции): " +
          "в новой секвенции их не будет.\n\nПродолжить?"
        )) { fail("Остановлено: часть элементов не поддерживается обменом через XML."); return; }

        lap("2/3 Пересчитываю клипы…");
        setTimeout(function () {
          var res;
          try {
            var xml = nfs.readFileSync(srcXml, "utf8");
            var info = mods.xmlrebuild.sequenceInfo(xml);
            var pieces;
            var opts = { name: seqName + suffix };
            if (isReorder) {
              pieces = st.result.runs_post || [];
              if (pieces.length < 2) throw new Error("В доке нет блоков для перестановки.");
              var lastEnd = pieces[pieces.length - 1][1];
              opts.remapExistingMarkers = true;
              // порезанная секвенция должна быть заметно короче исходного дока, иначе, скорее всего, она ещё не порезана
              var total = pieces.reduce(function (a, p) { return a + (p[1] - p[0]); }, 0);
              if (Math.abs(info.durationSec - total) > Math.max(5, total * 0.02)) {
                if (!window.confirm(
                  "Длина активной секвенции (" + Math.round(info.durationSec) + " с) заметно отличается от ожидаемой после резки (" +
                  Math.round(total) + " с).\nВозможно, это не та секвенция или она ещё не порезана.\n\nВсё равно переставить?"
                )) throw new Error("Остановлено: длина секвенции не совпала с ожидаемой.");
              }
            } else {
              pieces = mods.xmlrebuild.piecesFromCuts(st.result.cuts, info.durationSec);
              var markers = [];
              collectRows("flagged", true).forEach(function (m) {
                markers.push({ start: m.start, name: "ПРОВЕРИТЬ: " + String(m.red_text).slice(0, 100), comment: m.block_tc + "\n" + m.speaker + "\n" + m.block_text });
              });
              collectRows("ann", false).forEach(function (m) {
                markers.push({ start: m.start, name: "ПРОЧЕЕ: " + String(m.text).slice(0, 100), comment: "Слово ЗАГЛАВНЫМИ внутри реплики" });
              });
              collectRows("notes", false).forEach(function (m) {
                markers.push({ start: m.start, name: "КОММЕНТАРИЙ: " + String(m.text).slice(0, 100), comment: m.text });
              });
              opts.markers = markers;
            }
            res = mods.xmlrebuild.rebuildXmeml(xml, pieces, opts);
            nfs.writeFileSync(outXml, res.xml);
          } catch (e) {
            fail("Ошибка пересчёта XML:\n" + e.message);
            return;
          }
          lap("3/3 Импорт новой секвенции в Premiere…");
          call("afImportXml(" + JSON.stringify(outXml) + ")", function (im) {
            var warn = res.stats.warnings.length ? "\nПредупреждения: " + res.stats.warnings.join("; ") : "";
            var skipNote = skipped ? "\n⚠ Не вошло в XML элементов: " + skipped : "";
            setStatus(status2,
              "Готово за " + Math.round((Date.now() - t0) / 1000) + " с. Новая секвенция: " + im.slice(1, im.length - 1).join(":") +
                ". Клипов: " + res.stats.inClips + " → " + res.stats.outClips + ", итог " + Math.round(res.stats.totalSeconds / 60) + " мин." +
                "\nИсходная секвенция не менялась. XML лежит в " + dir + warn + skipNote, "ok");
            idle();
          });
        }, 50);
      });
    });
  }

  // ---------- резка ----------
  function doCut() {
    if (!st.result) return;
    if (!st.hasSeq) { refreshCutBtn(); return; }
    if (!$("chk-inplace").checked) {
      if (!window.confirm(
        "Будет создана НОВАЯ секвенция с вырезами красного.\n" +
        "Исходная секвенция останется нетронутой (должна быть активной и в исходном, не порезанном виде).\n\nСобрать?"
      )) return;
      doRebuild("cut");
      return;
    }
    if (!window.confirm(
      "Секвенция должна быть в ИСХОДНОМ, ещё не порезанном виде.\n" +
      "Резка не отменяется одной Ctrl+Z (много шагов) — если не уверен, сделай дубль секвенции.\n\nПорезать сейчас?"
    )) return;

    var btn = $("btn-cut");
    btn.disabled = true;
    btn.textContent = "Режу…";
    setStatus(status2, "Идёт резка — это может занять до минуты. Не трогай Premiere.");

    var cuts = st.result.cuts;
    var runs = st.result.runs || [];
    // старый способ «на месте» перестановку не делает (тысячи клипов): перестановка — только в быстром режиме через XML
    var cutsFinal = cuts;
    var reorder = false;
    var remap = function (list) {
      return reorder
        ? mods.markers.remapMarkersReorderFirst(list, runs, cutsFinal)
        : mods.markers.remapMarkers(list, cuts);
    };
    var flagged = remap(collectRows("flagged", true));
    var notes = remap(collectRows("notes", false));
    var ann = remap(collectRows("ann", false));

    function fail(msg) {
      if (typeof hideStopFn === "function") hideStopFn();
      setStatus(status2, msg, "err");
      btn.disabled = false;
      btn.textContent = "Порезать секвенцию";
    }

    try {
      mods.runfiles.writeRunFiles(RUN_DIR, { cuts: cutsFinal, runs: reorder ? runs : [], flagged: flagged, notes: notes, ann: ann });
    } catch (e) {
      fail("Ошибка подготовки:\n" + e.message);
      return;
    }

    var arg = JSON.stringify(RUN_DIR.replace(/\\/g, "/"));

    // Пошаговый режим: каждая пачка — отдельный вызов в Premiere (иначе «Stack overrun»).
    var hideStopFn = null;
    var CUT_BATCH = 20;
    var phase = "";
    st.cancel = false;
    var stopBtn = $("btn-stop");
    stopBtn.hidden = false;
    stopBtn.disabled = false;
    stopBtn.onclick = function () {
      st.cancel = true;
      stopBtn.disabled = true;
      setStatus(status2, "Останавливаю после текущей пачки…");
    };
    function hideStop() { stopBtn.hidden = true; }
    hideStopFn = hideStop;
    var RAZOR_BATCH = 3;
    var MOVE_BATCH = 20;
    var counts = { cuts: 0, bounds: 0, moved: 0 };

    // Premiere после тяжёлой операции отвечает «EvalScript error.», пока занят, — ждём и повторяем
    function call(expr, onOk, tries) {
      tries = tries || 0;
      if (st.cancel) {
        csi.evalScript("afRestorePlayhead(" + arg + ")", function () {});
        hideStop();
        setStatus(status2,
          "Остановлено. Дошли до шага: " + (phase || "начало") +
          ".\nСеквенция осталась в промежуточном состоянии — верни её из копии, если нужно начать заново.", "err");
        btn.disabled = false;
        btn.textContent = "Порезать секвенцию";
        return;
      }
      csi.evalScript(expr, function (res) {
        res = String(res || "");
        if (res.indexOf("OK:") === 0) { onOk(res.split(":")); return; }
        if (/^EvalScript error/.test(res) && tries < 40) {
          setStatus(status2, "Premiere занят, жду… (попытка " + (tries + 1) + ")");
          setTimeout(function () { call(expr, onOk, tries + 1); }, 1500);
          return;
        }
        var p = res.split(":");
        var where = p[0] === "ERROR" ? "после шага " + p[1] + ": " + p.slice(2).join(":") : res;
        fail("Резка не выполнена: " + where +
          "\nСеквенция могла быть порезана частично. Прогресс резки записан в run/af_progress.txt; " +
          "верни секвенцию из копии (Ctrl+Z не отменит всё разом).");
      });
    }
    var A = arg + ", " + st.fps;

    function stepCuts(from) {
      call("afCutStep(" + A + ", " + from + ", " + CUT_BATCH + ")", function (p) {
        var next = +p[1], total = +p[2];
        counts.cuts = total;
        phase = "вырезы " + next + " из " + total;
        setStatus(status2, "Режу: " + next + " из " + total + ". Не трогай Premiere.");
        if (next < total) stepCuts(next);
        else stepMarkers();
      });
    }
    function stepRazor(from) {
      call("afRazorStep(" + A + ", " + from + ", " + RAZOR_BATCH + ")", function (p) {
        var next = +p[1], total = +p[2];
        counts.bounds = total;
        phase = "разрезы по границам блоков " + next + " из " + total;
        setStatus(status2, "Перестановка: разрезы " + next + " из " + total + ". Не трогай Premiere.");
        if (next < total) stepRazor(next);
        else {
          call("afReorderInit(" + A + ")", function (q) { stepMove("stage", +q[1], 0); });
        }
      });
    }
    function phase_label(n) { return n === "stage" ? "1/2" : "2/2"; }
    function stepMove(phaseName, base, totalMoved) {
      call("afMoveStep(" + A + ", " + JSON.stringify(phaseName) + ", " + base + ", " + MOVE_BATCH + ")", function (p) {
        var remaining = +p[1];
        totalMoved += +p[2];
        phase = "перенос блоков (" + phase_label(phaseName) + "), осталось клипов " + remaining;
        setStatus(status2, "Перестановка (" + phase_label(phaseName) + "): осталось " + remaining + ". Не трогай Premiere.");
        if (remaining > 0) stepMove(phaseName, base, totalMoved);
        else if (phaseName === "stage") stepMove("final", base, totalMoved);
        else { counts.moved = totalMoved; stepCuts(0); }
      });
    }
    function stepMarkers() {
      call("afMarkersStep(" + A + ")", function (p) {
        csi.evalScript("afRestorePlayhead(" + arg + ")", function () {});
        hideStop();
        setStatus(status2,
          "Готово. Вырезано диапазонов: " + counts.cuts + ", маркеров: " + p[1] +
            (reorder ? ", блоков переставлено: " + runs.length : "") + ". Проверь таймлайн.", "ok");
        btn.disabled = false;
        btn.textContent = "В начало";
        btn.onclick = function () {
          st.result = null;
          setStatus(status2, "");
          goStep(1);
        };
      });
    }

    function run() {
      setStatus(status2, "Идёт " + (reorder ? "резка и перестановка" : "резка") + ". Не трогай Premiere.");
      // сначала перестановка блоков (клипов ещё мало), потом вырезы — иначе клипов десятки тысяч
      call("afParkPlayhead(" + arg + ")", function () {
        if (reorder) stepRazor(0); else stepCuts(0);
      });
    }

    if (!$("chk-backup").checked) { run(); return; }

    // резервная копия: сохранить проект и скопировать .prproj в <папка проекта>\AutoFish_backup
    setStatus(status2, "Сохраняю резервную копию проекта…");
    csi.evalScript("afBackupInfo()", function (res) {
      try {
        var info = JSON.parse(res);
        if (!info.ok) throw new Error(info.error || "проект не сохранён на диск");
        var dir = npath.join(npath.dirname(info.path), "AutoFish_backup");
        nfs.mkdirSync(dir, { recursive: true });
        var d = new Date();
        var pad = function (n) { return (n < 10 ? "0" : "") + n; };
        var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" +
          pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
        var ext = npath.extname(info.path);
        var dest = npath.join(dir, npath.basename(info.path, ext) + "_" + stamp + ext);
        nfs.copyFileSync(info.path, dest);
      } catch (e) {
        fail("Резервная копия не создана, резка отменена:\n" + e.message);
        return;
      }
      run();
    });
  }

  // ---------- резка по звуку: пики громкости на выбранной аудиодорожке ----------
  // График громкости дорожки с перетаскиваемой линией порога: всё громче линии вырезается по всей секвенции.
  // «Искать соседний пик в пределах N с» — если рядом нашёлся ещё один пик, пауза между ними тоже уходит (одна фраза).
  var stPeak = { cuts: [], envelopes: null, combinedPoints: null };

  function secLabel(sec) {
    return secToTc(sec, st.fps).slice(0, 8) + " (" + sec.toFixed(1) + " с)";
  }

  function renderPeakRows(cuts) {
    stPeak.cuts = cuts;
    var host = $("rows-peaks");
    host.innerHTML = "";
    cuts.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "row";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      var tc = document.createElement("span");
      tc.className = "tc";
      tc.textContent = secLabel(r[0]);
      var dur = document.createElement("span");
      dur.className = "marker";
      dur.textContent = "→ " + secLabel(r[1]) + "  ·  " + (r[1] - r[0]).toFixed(1) + " с";
      row.appendChild(cb);
      row.appendChild(tc);
      row.appendChild(dur);
      row._cb = cb;
      row._range = r;
      host.appendChild(row);
    });
    var total = cuts.reduce(function (s, r) { return s + (r[1] - r[0]); }, 0);
    var summary = $("peak-summary");
    summary.hidden = false;
    summary.textContent = "Найдено диапазонов: " + cuts.length + " · суммарно вырежется " + total.toFixed(1) + " с (" + (total / 60).toFixed(1) + " мин).";
    $("btn-peak-cut").hidden = cuts.length === 0;
    $("peak-backup-row").hidden = cuts.length === 0;
  }

  function collectPeakCuts() {
    var out = [];
    Array.prototype.forEach.call($("rows-peaks").querySelectorAll(".row"), function (row) {
      if (row._cb.checked) out.push(row._range);
    });
    return out;
  }

  function recomputeAtThreshold(thresholdDb) {
    if (!stPeak.envelopes) return;
    var t = mods.peakAnalyze.threshold(stPeak.envelopes, thresholdDb, { mergeGapSec: stPeak.mergeGapSec });
    renderPeakRows(t.cuts);
    redrawWaveform();
    setStatus($("status3"),
      t.cuts.length
        ? "Проверь список ниже перед резкой: двигай линию на графике, вписывай число или снимай галочки с лишних диапазонов."
        : "При таком пороге ничего не громче линии — подвинь её ниже.",
      t.cuts.length ? "ok" : "");
  }

  function dbToY(db, height) {
    var frac = (db - stPeak.dbLo) / (stPeak.dbHi - stPeak.dbLo);
    frac = Math.max(0, Math.min(1, frac));
    return height - frac * height;
  }
  function yToDb(y, height) {
    var frac = 1 - Math.max(0, Math.min(1, y / height));
    return stPeak.dbLo + frac * (stPeak.dbHi - stPeak.dbLo);
  }

  function computeBuckets(width) {
    var pts = stPeak.combinedPoints;
    if (!pts || !pts.length || width <= 0) return [];
    var tMin = pts[0][0], tMax = pts[pts.length - 1][0];
    var span = Math.max(1e-6, tMax - tMin);
    var buckets = new Array(width).fill(-Infinity);
    for (var i = 0; i < pts.length; i++) {
      var idx = Math.min(width - 1, Math.max(0, Math.floor(((pts[i][0] - tMin) / span) * width)));
      if (pts[i][1] > buckets[idx]) buckets[idx] = pts[i][1];
    }
    for (var b = 0; b < buckets.length; b++) if (buckets[b] === -Infinity) buckets[b] = stPeak.dbLo;
    return buckets;
  }

  function redrawWaveform() {
    var canvas = $("peak-waveform");
    if (!canvas || !stPeak.combinedPoints) return;
    var width = canvas.clientWidth || 400;
    var height = canvas.clientHeight || 140;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    if (!stPeak.buckets || stPeak.bucketsWidth !== width) {
      stPeak.buckets = computeBuckets(width);
      stPeak.bucketsWidth = width;
    }
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#1c1c1c";
    ctx.fillRect(0, 0, width, height);
    // сетка по 10 дБ
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.fillStyle = "rgba(255,255,255,.35)";
    ctx.font = "9px sans-serif";
    ctx.lineWidth = 1;
    var startMark = Math.ceil(stPeak.dbLo / 10) * 10;
    for (var m = startMark; m <= stPeak.dbHi; m += 10) {
      var y = Math.round(dbToY(m, height)) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      ctx.fillText(m + " дБ", 3, y - 2);
    }
    // огибающая громкости
    ctx.fillStyle = "#5c90fd";
    var buckets = stPeak.buckets;
    for (var i = 0; i < buckets.length; i++) {
      var y2 = dbToY(buckets[i], height);
      ctx.fillRect(i, y2, 1, height - y2);
    }
    // подсветка вырезаемых диапазонов
    if (stPeak.cuts && stPeak.cuts.length && stPeak.tMin != null) {
      var span2 = Math.max(1e-6, stPeak.tMax - stPeak.tMin);
      ctx.fillStyle = "rgba(224,133,133,.35)";
      stPeak.cuts.forEach(function (r) {
        var x1 = ((r[0] - stPeak.tMin) / span2) * width;
        var x2 = ((r[1] - stPeak.tMin) / span2) * width;
        ctx.fillRect(x1, 0, Math.max(1, x2 - x1), height);
      });
    }
    // линия порога
    var thY = Math.round(dbToY(stPeak.thresholdDb, height)) + 0.5;
    ctx.strokeStyle = "#e08585";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, thY); ctx.lineTo(width, thY); ctx.stroke();
  }

  function setThresholdFromClientY(clientY) {
    var canvas = $("peak-waveform");
    var rect = canvas.getBoundingClientRect();
    var db = Math.round(yToDb(clientY - rect.top, rect.height) * 10) / 10;
    stPeak.thresholdDb = db;
    $("peak-threshold").value = db;
    redrawWaveform();
    recomputeAtThreshold(db);
  }

  var waveformDragging = false;
  $("peak-waveform").addEventListener("mousedown", function (e) {
    waveformDragging = true;
    setThresholdFromClientY(e.clientY);
  });
  window.addEventListener("mousemove", function (e) {
    if (waveformDragging) setThresholdFromClientY(e.clientY);
  });
  window.addEventListener("mouseup", function () { waveformDragging = false; });
  window.addEventListener("resize", function () {
    if (stPeak.combinedPoints) redrawWaveform();
  });

  // Шкала дБFS всегда отрицательная; «громкость 35» по-человечески — это −35, положительный ввод трактуем как отрицательный.
  $("peak-threshold").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isFinite(v)) return;
    var db = v > 0 ? -v : v;
    stPeak.thresholdDb = db;
    redrawWaveform();
    recomputeAtThreshold(db);
  });

  $("peak-leftpad").addEventListener("input", function () {
    var v = parseFloat(this.value);
    if (!isFinite(v) || v < 0) return;
    stPeak.mergeGapSec = v;
    recomputeAtThreshold(stPeak.thresholdDb);
  });

  $("btn-peak-find").addEventListener("click", function () {
    var s3 = $("status3");
    if (!st.hasSeq) {
      setStatus(s3, "Открой секвенцию в Premiere и переоткрой панель.", "err");
      return;
    }
    var trackIndex = parseInt($("peak-track").value, 10) || 1;
    var btn = $("btn-peak-find");
    btn.disabled = true;
    btn.textContent = "Ищу…";
    setStatus(s3, "Читаю дорожку и анализирую звук — на большом файле может занять пару минут…");
    $("peak-threshold-block").hidden = true;
    $("peak-summary").hidden = true;
    $("btn-peak-cut").hidden = true;
    $("peak-backup-row").hidden = true;
    stPeak.envelopes = null;
    stPeak.combinedPoints = null;
    stPeak.buckets = null;

    csi.getTrackClips(trackIndex, function (info) {
      btn.disabled = false;
      btn.textContent = "Найти пики";
      if (info.error) { setStatus(s3, "" + info.error, "err"); return; }
      if (!info.hasTrack || !info.clips || !info.clips.length) {
        setStatus(s3, "На дорожке A" + trackIndex + " нет клипов.", "err");
        return;
      }
      var d;
      try {
        d = mods.peakAnalyze.decode(info.clips);
      } catch (e) {
        setStatus(s3, "Ошибка анализа: " + (e.message || e), "err");
        return;
      }
      // диагностика — всегда (по ней разбираем «пиков не найдено»)
      try {
        nfs.mkdirSync(RUN_DIR, { recursive: true });
        nfs.writeFileSync(
          npath.join(RUN_DIR, "af_peak_debug.json"),
          JSON.stringify((d.clipEnvelopes || []).map(function (c) {
            return Object.assign({}, c, { dbs: undefined, nWindows: c.dbs && c.dbs.length });
          }), null, 2)
        );
      } catch (eDbg) {}
      var hasUsable = d.clipEnvelopes && d.clipEnvelopes.some(function (c) { return !c.error; });
      if (!hasUsable) { setStatus(s3, "" + (d.error || "Не удалось декодировать звук."), "err"); return; }

      stPeak.envelopes = d.clipEnvelopes;
      var loudest = d.clipEnvelopes.filter(function (c) { return !c.error; })
        .reduce(function (a, b) { return b.stats.maxDb > a.stats.maxDb ? b : a; });
      $("peak-stats").textContent =
        "шумовой пол " + loudest.stats.floorDb + " дБ · максимум " + loudest.stats.maxDb + " дБ" +
        (loudest.usedAudioStream ? " · поток " + loudest.usedAudioStream : "");

      var combined = [];
      d.clipEnvelopes.forEach(function (c) {
        if (c.error) return;
        for (var i = 0; i < c.dbs.length; i++) combined.push([c.clipStart + i * c.windowSec, c.dbs[i]]);
      });
      stPeak.combinedPoints = combined;
      stPeak.tMin = combined.length ? combined[0][0] : 0;
      stPeak.tMax = combined.length ? combined[combined.length - 1][0] : 0;
      stPeak.dbLo = loudest.stats.floorDb - 5;
      stPeak.dbHi = loudest.stats.maxDb + 5;
      stPeak.buckets = null;

      $("peak-threshold-block").hidden = false;
      $("peak-threshold").value = d.suggestedThresholdDb;
      stPeak.thresholdDb = d.suggestedThresholdDb;
      stPeak.mergeGapSec = parseFloat($("peak-leftpad").value);
      if (!isFinite(stPeak.mergeGapSec)) stPeak.mergeGapSec = mods.peakAnalyze.DEFAULTS.mergeGapSec;
      $("peak-leftpad").value = stPeak.mergeGapSec;

      redrawWaveform();
      recomputeAtThreshold(d.suggestedThresholdDb);
    });
  });

  // Резка по пикам: те же пачки, повтор при «занят», «Остановить» и резервная копия, что и в основной резке по сценарию
  $("btn-peak-cut").addEventListener("click", function () {
    if (!st.hasSeq) return;
    var cuts = collectPeakCuts();
    if (!cuts.length) return;
    if (!window.confirm(
      "Секвенция должна быть в ИСХОДНОМ, ещё не порезанном виде.\n" +
      "Резка не отменяется одной Ctrl+Z (много шагов) — если не уверен, сделай дубль секвенции.\n\n" +
      "Вырезать " + cuts.length + " диапазон(ов)?"
    )) return;

    var s3 = $("status3");
    var btn = $("btn-peak-cut");
    var stopBtn = $("btn-stop3");
    btn.disabled = true;
    btn.textContent = "Режу…";
    function finishUi() { stopBtn.hidden = true; btn.disabled = false; btn.textContent = "Порезать по пикам"; }
    function fail(msg) { setStatus(s3, msg, "err"); finishUi(); }

    try {
      mods.runfiles.writeRunFiles(RUN_DIR, { cuts: cuts, runs: [], flagged: [], notes: [], ann: [] });
    } catch (e) {
      fail("Ошибка подготовки:\n" + e.message);
      return;
    }

    var arg = JSON.stringify(RUN_DIR.replace(/\\/g, "/"));
    var A = arg + ", " + st.fps;
    var cancel = false;
    var phase = "";
    stopBtn.hidden = false;
    stopBtn.disabled = false;
    stopBtn.onclick = function () {
      cancel = true;
      stopBtn.disabled = true;
      setStatus(s3, "Останавливаю после текущей пачки…");
    };

    // Premiere после тяжёлой операции отвечает «EvalScript error.», пока занят, — ждём и повторяем
    function call(expr, onOk, tries) {
      tries = tries || 0;
      if (cancel) {
        csi.evalScript("afRestorePlayhead(" + arg + ")", function () {});
        fail("Остановлено. Дошли до шага: " + (phase || "начало") + ".\nСеквенция осталась в промежуточном состоянии — верни её из копии, если нужно начать заново.");
        return;
      }
      csi.evalScript(expr, function (res) {
        res = String(res || "");
        if (res.indexOf("OK:") === 0) { onOk(res.split(":")); return; }
        if (/^EvalScript error/.test(res) && tries < 40) {
          setStatus(s3, "Premiere занят, жду… (попытка " + (tries + 1) + ")");
          setTimeout(function () { call(expr, onOk, tries + 1); }, 1500);
          return;
        }
        var p = res.split(":");
        var where = p[0] === "ERROR" ? "после шага " + p[1] + ": " + p.slice(2).join(":") : res;
        fail("Резка не выполнена: " + where + "\nСеквенция могла быть порезана частично; верни её из копии (Ctrl+Z не отменит всё разом).");
      });
    }

    function stepCuts(from) {
      call("afCutStep(" + A + ", " + from + ", 20)", function (p) {
        var next = +p[1], total = +p[2];
        phase = "вырезы " + next + " из " + total;
        setStatus(s3, "Режу: " + next + " из " + total + ". Не трогай Premiere.");
        if (next < total) { stepCuts(next); return; }
        csi.evalScript("afRestorePlayhead(" + arg + ")", function () {});
        setStatus(s3, "Готово. Вырезано диапазонов: " + total + ". Проверь таймлайн.", "ok");
        finishUi();
      });
    }

    function run() {
      setStatus(s3, "Идёт резка. Не трогай Premiere.");
      call("afParkPlayhead(" + arg + ")", function () { stepCuts(0); });
    }

    if (!$("chk-backup3").checked) { run(); return; }
    setStatus(s3, "Сохраняю резервную копию проекта…");
    csi.evalScript("afBackupInfo()", function (res) {
      try {
        var info = JSON.parse(res);
        if (!info.ok) throw new Error(info.error || "проект не сохранён на диск");
        var dir = npath.join(npath.dirname(info.path), "AutoFish_backup");
        nfs.mkdirSync(dir, { recursive: true });
        var d = new Date();
        var pad = function (n) { return (n < 10 ? "0" : "") + n; };
        var stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "_" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
        var ext = npath.extname(info.path);
        nfs.copyFileSync(info.path, npath.join(dir, npath.basename(info.path, ext) + "_" + stamp + ext));
      } catch (e) {
        fail("Резервная копия не создана, резка отменена:\n" + e.message);
        return;
      }
      run();
    });
  });

  $("btn-goto-peaks").addEventListener("click", function () { goStep(3); });
  $("btn-back3").addEventListener("click", function () { goStep(1); });
})();
