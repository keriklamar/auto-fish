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
    ["parseDocx", "parseTranscript", "analyze", "timecode", "runfiles", "markers"].forEach(function (n) {
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
    '(typeof autoFishCut === "function") ? "ok" : $.evalFile(' +
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
  function setDocx(p) {
    st.docxPath = p;
    var el = $("path-docx");
    el.textContent = p || "не выбран";
    el.classList.toggle("set", !!p);
    refreshParseBtn();
  }
  function setJson(p) {
    st.jsonPath = p;
    var el = $("path-json");
    el.textContent = p || "не выбран";
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

    renderRows("flagged", r.flagged, true);
    renderRows("notes", r.standalone_notes, false);
    renderRows("ann", r.annotations, false);

    setStatus(status2, "");
    var btn = $("btn-cut");
    btn.textContent = "Порезать секвенцию";
    btn.onclick = doCut;
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

  // ---------- резка ----------
  function doCut() {
    if (!st.result) return;
    if (!st.hasSeq) { refreshCutBtn(); return; }
    if (!window.confirm(
      "Секвенция должна быть в ИСХОДНОМ, ещё не порезанном виде.\n" +
      "Резка не отменяется одной Ctrl+Z (много шагов) — если не уверен, сделай дубль секвенции.\n\nПорезать сейчас?"
    )) return;

    var btn = $("btn-cut");
    btn.disabled = true;
    btn.textContent = "Режу…";
    setStatus(status2, "Идёт резка — это может занять до минуты. Не трогай Premiere.");

    var cuts = st.result.cuts;
    var flagged = mods.markers.remapMarkers(collectRows("flagged", true), cuts);
    var notes = mods.markers.remapMarkers(collectRows("notes", false), cuts);
    var ann = mods.markers.remapMarkers(collectRows("ann", false), cuts);

    try {
      mods.runfiles.writeRunFiles(RUN_DIR, { cuts: cuts, flagged: flagged, notes: notes, ann: ann });
    } catch (e) {
      setStatus(status2, "Ошибка подготовки:\n" + e.message, "err");
      btn.disabled = false;
      btn.textContent = "Порезать секвенцию";
      return;
    }

    var arg = JSON.stringify(RUN_DIR.replace(/\\/g, "/"));
    csi.evalScript("autoFishCut(" + arg + ", " + st.fps + ")", function (res) {
      if (res && res.indexOf("OK:") === 0) {
        var p = res.split(":");
        setStatus(status2, "Готово. Вырезано диапазонов: " + p[1] + ", маркеров: " + p[2] + ". Проверь таймлайн.", "ok");
        btn.disabled = false;
        btn.textContent = "В начало";
        btn.onclick = function () {
          st.result = null;
          setStatus(status2, "");
          goStep(1);
        };
      } else {
        setStatus(status2, "Резка не выполнена: " + res, "err");
        btn.disabled = false;
        btn.textContent = "Порезать секвенцию";
      }
    });
  }
})();
