/**
 * Шапка и ширины колонок листа с данными — одни на все таблицы продукта.
 *
 * До 27.09.2026 это умел один реестр (своим адаптером), а журнал «Таблица»
 * рисовал шапку по-своему — жирным на сером — и брал ширины с сервера как
 * есть: «Поступление» в «Виде» резалось до «Поступлени». Теперь раздел даёт
 * подписи и значения, а как выглядит шапка и насколько широка колонка —
 * решается здесь.
 *
 * Модуль чистый: ни Univer, ни React. Меряет канвой браузера, без неё —
 * прикидкой по числу знаков.
 */

/** Высота строки данных. */
export const ROW_H = 24;

/**
 * Бумага листа — постоянные светлые цвета: в тёмной теме Univer сам
 * перекрашивает их своей матрицей. Токены раздела (вспышка, отказ) сюда не
 * входят: их читают из CSS и переворачивают заранее (`invertLikeUniver`).
 */
export const PAPER = {
  headBg: "#efede5",
  headText: "#5a5d55",
  titleBg: "#e5e2d7",
  line: "#cfcbbf",
  muted: "#a3a69e",
  soft: "#7d8078",
};

/**
 * Шапка — наша, а не из файла: жёлтые и голубые заливки Excel спорили бы с
 * единственным цветом листа — розовой ячейкой ошибки. Подпись мелкая и
 * переносится по словам: высоту строки шапки даёт `headerHeight`.
 */
export const HEADER_STYLE = {
  bg: { rgb: PAPER.headBg },
  cl: { rgb: PAPER.headText },
  vt: 2,
  tb: 3,
  fs: 9,
  bd: { b: { s: 1, cl: { rgb: PAPER.line } } },
};

/** Шрифт ячеек Univer по умолчанию (Arial 11pt) и шапки (9pt) — ими и мерим. */
export const CELL_FONT = "14.667px Arial";
const HEAD_FONT = "12px Arial";
/** Поля ячейки слева и справа и запас на округление. */
const CELL_PAD = 14;
/** Сколько строк мерить: на десяти тысячах строк хватает выборки. */
const MEASURE_ROWS = 1500;

let measureCanvas: CanvasRenderingContext2D | null | undefined;
const measureMemo = new Map<string, number>();

export function textWidth(text: string, font: string): number {
  if (!text) return 0;
  const key = `${font}|${text}`;
  let width = measureMemo.get(key);
  if (width === undefined) {
    if (measureCanvas === undefined) {
      measureCanvas = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    }
    if (measureCanvas) {
      measureCanvas.font = font;
      width = measureCanvas.measureText(text).width;
    } else {
      width = text.length * 7.5;
    }
    if (measureMemo.size > 20000) measureMemo.clear();
    measureMemo.set(key, width);
  }
  return width;
}

/**
 * Сколько строк займёт подпись шапки в колонке такой ширины.
 *
 * Подписи шапки бывают длинными: «Текущее состояние (действующий/
 * недействующий/ на исполении/ исполнен/ не состоялся)» в колонке шириной в
 * сто пикселей. В одну строку такая подпись обрезалась бы на «Текущее сост»,
 * и человек не узнал бы свою колонку. Строки считаются переносом по словам
 * тем же шрифтом, что у шапки: прикидка «шесть пикселей на букву» насчитывала
 * пять строк там, где их шесть, и подпись статуса срезалась сверху и снизу.
 */
function headerLines(label: string, width: number): number {
  const room = Math.max(24, width - 10);
  let lines = 1;
  let used = 0;
  for (const word of label.split(/\s+/).filter(Boolean)) {
    const size = textWidth(word, HEAD_FONT);
    const gap = used ? textWidth(" ", HEAD_FONT) : 0;
    if (used && used + gap + size > room) {
      lines += 1;
      used = size;
    } else {
      used += gap + size;
    }
  }
  return lines;
}

/** Высота строки шапки — по самой длинной подписи (не больше восьми строк). */
export function headerHeight(columns: ReadonlyArray<{ label: string; width: number }>): number {
  let lines = 1;
  for (const column of columns) lines = Math.max(lines, Math.min(8, headerLines(column.label, column.width)));
  return 12 + lines * 15;
}

/** Не больше `MEASURE_ROWS` элементов, равномерно по всему списку. */
export function sampled<T>(items: T[]): T[] {
  const step = Math.max(1, Math.ceil(items.length / MEASURE_ROWS));
  return step > 1 ? items.filter((_, index) => index % step === 0) : items;
}

/**
 * Ширина колонки по содержимому.
 *
 * `texts` — значения так, как их рисует лист («12 345,00», «01.09.2026»).
 * `min` — ширина, уже данная колонке (файлом, сервером): колонку, которую
 * человек сделал широкой, лист не сужает; узкую расширяет до содержимого, но
 * не дальше `cap`, иначе одно примечание на абзац делало бы колонку во весь
 * экран. `share` — какую долю значений колонка обязана вместить целиком: у
 * справочных колонок все (их немного, и все должны читаться), у свободного
 * текста девять из десяти.
 */
export function fitWidth(texts: string[], label: string, { min, cap, share = 1 }: { min: number; cap: number; share?: number }): number {
  const widths: number[] = [];
  // Univer рисует текст чуть шире, чем мерит канва (сглаживание, округление
  // по пикселям): без запаса у «№ 333-2023-BBC-BUH» съедалась последняя буква.
  for (const text of texts) if (text) widths.push(textWidth(text, CELL_FONT) * 1.05);
  widths.sort((a, b) => a - b);
  const content = widths.length ? widths[Math.min(widths.length - 1, Math.floor((widths.length - 1) * share))] + CELL_PAD : 0;
  const word = Math.max(0, ...label.split(/\s+/).map((part) => textWidth(part, HEAD_FONT))) + 12;
  return Math.round(Math.max(min, Math.min(Math.max(content, word), cap)));
}
