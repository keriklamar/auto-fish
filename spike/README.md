# spike/ — проверки ядра

`node spike/all.js` (или `npm test`) — прогоняет всё:

- **tcSpike.js** — `parseTcRange` / `detectTcMode` на разных форматах таймкодов.
- **parseDocxSpike.js** — `parseDocxFile` vs `fixtures/ref_parseDocx.json`.
- **parseSpike.js** — полный `runParse` vs `fixtures/ref_runParse.json`.
- **markersSpike.js** — `mapTimeAfterCuts` (пересчёт позиций маркеров).

## fixtures/

`sample.docx` + `sample.json` — **анонимизированная** реальная транскрибация:
структура (таймкоды, спикеры, подсветка, границы блоков, заметки) сохранена,
слова заменены на нейтральные. `ref_*.json` — эталонный вывод, зафиксированный
когда JS-ядро было сверено байт-в-байт с исходным Python-ядром (см. историю git).
