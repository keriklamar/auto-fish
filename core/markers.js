// markers.js — пересчёт позиций маркеров под УЖЕ порезанную секвенцию.
//
// Premiere при ripple/extract НЕ двигает маркеры секвенции (подтверждено).
// Поэтому маркеры ставятся после резки, а их время пересчитывается: из
// исходного времени вычитается суммарная длина всех вырезов, что лежат
// раньше. Если маркер попал внутрь выреза — он схлопывается в точку склейки.

// cuts: отсортированный по возрастанию, непересекающийся список [[s,e]…]
// (ровно то, что отдаёт mergeCloseCuts в analyze.js) в секундах ОРИГИНАЛА.
function mapTimeAfterCuts(t, cuts) {
  var removed = 0;
  for (var i = 0; i < cuts.length; i++) {
    var s = cuts[i][0];
    var e = cuts[i][1];
    if (e <= t) {
      removed += e - s;
    } else if (s < t) {
      removed += t - s; // маркер внутри выреза -> в точку склейки
      break;
    } else {
      break; // вырез целиком позже маркера
    }
  }
  return t - removed;
}

// Перестановка: pieces — [[srcStart,srcEnd],…] в порядке итогового таймлайна.
// Время на итоге = сумма длин предыдущих кусков + смещение внутри куска, в котором лежит t.
// Если t попал в вырезанный участок — снапаем к началу ближайшего следующего по исходнику куска.
function mapTimeReordered(t, pieces) {
  var acc = 0;
  var bestNext = null; // [srcStart, outPos] ближайшего следующего по исходнику куска
  for (var i = 0; i < pieces.length; i++) {
    var s = pieces[i][0];
    var e = pieces[i][1];
    if (t >= s && t < e) return acc + (t - s);
    if (s >= t && (bestNext === null || s < bestNext[0])) bestNext = [s, acc];
    acc += e - s;
  }
  if (bestNext !== null) return bestNext[1];
  return acc; // за последним куском
}

function remapMarkersReordered(list, pieces) {
  return list.map(function (m) {
    var copy = Object.assign({}, m);
    copy.start = mapTimeReordered(m.start, pieces);
    return copy;
  });
}

// Крупные блоки (исходные координаты) -> координаты ПОРЕЗАННОГО таймлайна, в порядке дока.
// Пустые (целиком вырезанные) отбрасываются, смежные склеиваются.
function runsAfterCuts(runs, cuts) {
  var out = [];
  for (var i = 0; i < runs.length; i++) {
    var s = mapTimeAfterCuts(runs[i][0], cuts);
    var e = mapTimeAfterCuts(runs[i][1], cuts);
    if (e - s < 0.0005) continue;
    var last = out[out.length - 1];
    if (last && Math.abs(last[1] - s) < 0.0005) last[1] = e;
    else out.push([s, e]);
  }
  return out;
}

// метка: исходное время -> порезали -> переставили блоки
function remapMarkersFull(list, cuts, runsPost) {
  return list.map(function (m) {
    var copy = Object.assign({}, m);
    copy.start = mapTimeReordered(mapTimeAfterCuts(m.start, cuts), runsPost);
    return copy;
  });
}

// Порядок на таймлайне: сначала перестановка блоков (runs, исходные координаты), потом вырезы в новых координатах.
function remapMarkersReorderFirst(list, runs, cutsReordered) {
  return list.map(function (m) {
    var copy = Object.assign({}, m);
    copy.start = mapTimeAfterCuts(mapTimeReordered(m.start, runs), cutsReordered);
    return copy;
  });
}

function remapMarkers(list, cuts) {
  return list.map(function (m) {
    var copy = Object.assign({}, m);
    copy.start = mapTimeAfterCuts(m.start, cuts);
    return copy;
  });
}

module.exports = { mapTimeAfterCuts, remapMarkers, mapTimeReordered, remapMarkersReordered, runsAfterCuts, remapMarkersFull, remapMarkersReorderFirst };
