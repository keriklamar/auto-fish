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

function remapMarkers(list, cuts) {
  return list.map(function (m) {
    var copy = Object.assign({}, m);
    copy.start = mapTimeAfterCuts(m.start, cuts);
    return copy;
  });
}

module.exports = { mapTimeAfterCuts, remapMarkers };
