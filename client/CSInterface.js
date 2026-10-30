// CSInterface.js — тонкая собственная обёртка над нативным мостом CEP.
// CEP инжектит в window: __adobe_cep__ (мост к Premiere) и cep (fs-хелперы).
// Полный CSInterface.js от Adobe не тащим — нужно только это.

function CSInterface() {}

CSInterface.prototype.evalScript = function (script, callback) {
  if (!window.__adobe_cep__) {
    if (callback) callback("ERROR: __adobe_cep__ недоступен (страница открыта не в CEP-панели Premiere)");
    return;
  }
  window.__adobe_cep__.evalScript(script, function (result) {
    if (callback) callback(result);
  });
};

CSInterface.prototype.getSystemPath = function (pathType) {
  if (!window.__adobe_cep__ || !window.__adobe_cep__.getSystemPath) return "";
  var p = window.__adobe_cep__.getSystemPath(pathType);
  if (p && p.indexOf("file://") === 0) {
    p = decodeURIComponent(p.replace(/^file:\/\/\/?/, ""));
    if (!/^[A-Za-z]:/.test(p)) p = "/" + p;
  }
  return p;
};

// {hasSeq, fps, name} из активной секвенции.
CSInterface.prototype.getSeqInfo = function (callback) {
  this.evalScript("afSeqInfo()", function (res) {
    var info = { hasSeq: false, fps: 25, name: "" };
    try {
      var o = JSON.parse(res);
      if (o && typeof o === "object") info = Object.assign(info, o);
    } catch (e) {}
    callback(info);
  });
};

// {hasTrack, clips:[{start,end,inPoint,mediaPath}], error?} для аудиодорожки
// trackIndex (1-based, как в интерфейсе Premiere — A6 = 6).
CSInterface.prototype.getTrackClips = function (trackIndex, callback) {
  this.evalScript("afTrackClips(" + trackIndex + ")", function (res) {
    var info = { hasTrack: false, clips: [] };
    try {
      var o = JSON.parse(res);
      if (o && typeof o === "object") info = Object.assign(info, o);
    } catch (e) {
      info.error = "Не удалось разобрать ответ Premiere: " + res;
    }
    callback(info);
  });
};
