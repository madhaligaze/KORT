/**
 * Скорость отрисовки — общая для всех листов продукта.
 *
 * Лист тормозил не из-за объёма. Реестр на проде — 423 договора и 21 колонка,
 * а на прокрутке каждый щелчок колеса занимал поток на сотни миллисекунд, и
 * лист не успевал дорисоваться. Время уходило не в рисование, а в
 * `worksheet.getCell`: каждое обращение прогоняет ячейку через всю цепочку
 * перехватчиков Univer — защиту листа, проверку данных, условное
 * форматирование, заметки, таблицы, форматы чисел. Лечится это здесь, а не в
 * разделах: цепочка одна у журнала, реестра, «Таблиц» и «Книг».
 *
 * Три меры, каждая — без изменения того, что лист показывает (проверено
 * попиксельно на реестре, журнале и «Таблицах»: `pw-finmap/erp-sheet/speed-verify.cjs`):
 *
 * 1. **Память кадра** — `getCell` и «скрыта ли строка» считаются один раз на
 *    ячейку за кадр, а не семь-восемь (кэш стилей, шрифт, маркеры, штриховка
 *    защиты, своя отрисовка, полосы и значки условного форматирования — каждый
 *    читатель спрашивает сам).
 * 2. **Проход «под перелив»** пропускает ячейки, которые кэш стилей уже знает.
 * 3. **Метка «число как текст»** не разбирает заново строки, заведомо не
 *    похожие на число.
 */
import { getNumfmtParseValueFilter, isRealNum, Worksheet } from "@univerjs/core";
import {
  INTERCEPTOR_POINT,
  IRenderManagerService,
  SheetInterceptorService,
  SpreadsheetSkeleton,
} from "@univerjs/preset-sheets-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UniverApi = any;

// ── 1. Память кадра ──────────────────────────────────────────────────────────
//
// * **Только внутри кадра движка.** Кадр Univer — `_beginFrame → _renderFrame →
//   _endFrame` одним синхронным вызовом, и данные посреди него поменяться не
//   могут: правка, опрос, ответ проверки данных приходят между кадрами. Вне
//   кадра (команды, буфер обмена, наш код) всё работает как раньше.
// * **Каждый кадр — с чистого листа**, поэтому ни правка, ни пришедший позже
//   статус проверки данных не увидят прошлого ответа.
// * **Если `_endFrame` не случился** (отрисовка упала), кадр закрывает
//   микрозадача: она срабатывает, как только стек кадра размотался.
//
// Читатели ответ не меняют: кэш стилей копирует ячейку (`{ ...cell }`), а
// расширения только читают маркеры, права, полосы и значки.

type GetCell = (this: object, row: number, col: number, ...rest: unknown[]) => unknown;
type RowFiltered = (this: object, row: number, ...rest: unknown[]) => boolean;

/** Колонок у листа заведомо меньше — строка и колонка складываются в одно число. */
const ROW_STRIDE = 1 << 20;

/** Сейчас идёт кадр движка. */
let framing = false;
/** Номер кадра: память, снятая в другом кадре, недействительна. */
let frame = 0;

type FrameMemo = { frame: number; cells: Map<number, unknown>; rows: Map<number, boolean> };
const remembered = new WeakMap<object, FrameMemo>();

function memoOf(sheet: object): FrameMemo {
  let memo = remembered.get(sheet);
  if (!memo || memo.frame !== frame) {
    memo = { frame, cells: new Map(), rows: new Map() };
    remembered.set(sheet, memo);
  }
  return memo;
}

function openFrame(): void {
  framing = true;
  frame += 1;
  queueMicrotask(closeFrame);
}

function closeFrame(): void {
  if (!framing) return;
  framing = false;
  frame += 1;
}

function rememberCells(): void {
  const proto = Worksheet?.prototype as unknown as
    | { getCell?: GetCell; isRowFiltered?: RowFiltered; getRowFiltered?: RowFiltered }
    | undefined;
  const plainCell = proto?.getCell;
  if (!proto || typeof plainCell !== "function") return;
  proto.getCell = function getCell(this: object, row: number, col: number, ...rest: unknown[]) {
    // Лишние аргументы — чужая сигнатура следующей версии: её не угадываем.
    if (!framing || rest.length || row < 0 || col < 0 || col >= ROW_STRIDE) {
      return plainCell.call(this, row, col, ...rest);
    }
    const memo = memoOf(this);
    const key = row * ROW_STRIDE + col;
    const hit = memo.cells.get(key);
    if (hit !== undefined || memo.cells.has(key)) return hit;
    const cell = plainCell.call(this, row, col);
    memo.cells.set(key, cell);
    return cell;
  };
  // «Скрыта ли строка фильтром» — такая же цепочка перехватчиков (таблицы,
  // фильтр), и её так же спрашивают по разу на ячейку в каждом расширении.
  for (const name of ["isRowFiltered", "getRowFiltered"] as const) {
    const plain = proto[name];
    if (typeof plain !== "function") continue;
    proto[name] = function rowFiltered(this: object, row: number, ...rest: unknown[]) {
      if (!framing || rest.length) return plain.call(this, row, ...rest);
      const memo = memoOf(this);
      const hit = memo.rows.get(row);
      if (hit !== undefined) return hit;
      const value = plain.call(this, row);
      memo.rows.set(row, value);
      return value;
    };
  }
}

// ── 2. Проход «под перелив» ──────────────────────────────────────────────────
//
// Кэш стилей листа (`SpreadsheetSkeleton.setStylesCache`) для каждой строки
// новой полосы проходит видимые колонки, а потом ещё раз ±20 колонок вокруг —
// узнать, не переливается ли в видимое текст соседей. На шаге вбок новая
// полоса — одна колонка во всю высоту, а проход «под перелив» — вся ширина
// каждой строки, хотя почти все эти ячейки лист посчитал в прошлых кадрах.
// Половина всех ячеек, которые кэш стилей перебирал на прокрутке реестра.
//
// Для ячейки, у которой запись шрифта в кэше уже есть, этот проход (без фона и
// рамок) делает одно — кладёт в запись ту же ячейку. Сам Univer запись при
// любой правке удаляет (`resetRangeCache` — по ячейкам, `_resetCache` —
// целиком), и тогда ячейка пройдёт как прежде. Поэтому такой проход
// пропускается: пересчитывается только то, чего в кэше нет.

type StyleOptions = { cacheItem?: { bg?: boolean; border?: boolean }; mergeRange?: unknown } | undefined;
type SkeletonLike = { _stylesCache?: { fontMatrix?: { getValue: (row: number, col: number) => unknown } } };
type StyleOne = (this: SkeletonLike, row: number, col: number, options?: StyleOptions) => unknown;

function skipKnownOverflow(): void {
  const proto = (SpreadsheetSkeleton as unknown as { prototype?: Record<string, unknown> } | undefined)?.prototype;
  const plain = proto?._setStylesCacheForOneCell as StyleOne | undefined;
  if (!proto || typeof plain !== "function") return;
  proto._setStylesCacheForOneCell = function styleOne(this: SkeletonLike, row: number, col: number, options?: StyleOptions) {
    const item = options?.cacheItem;
    const overflowOnly = item && !item.bg && !item.border && !options?.mergeRange;
    if (overflowOnly && this._stylesCache?.fontMatrix?.getValue(row, col) !== undefined) return;
    return plain.call(this, row, col, options);
  };
}

// ── 3. Метка «число как текст» ───────────────────────────────────────────────
//
// Зелёный уголок у текста, похожего на число (`ForceStringRenderController` в
// sheets-ui). Чтобы решить, ставить ли его, перехватчик разбирает строку каждой
// текстовой ячейки как дату, время и число — и разбор даты на каждом вызове
// заново нормализует и сортирует названия месяцев. «Действующий», «Гульмира»,
// ссылка на Битрикс — в каждой ячейке каждого кадра: больше, чем все остальные
// перехватчики вместе.
//
// Выключить метку настройкой не выход: `disableForceStringMark` проверяется
// уже после разбора. Переписывать перехватчик — тоже: его логику ведёт Univer.
// Поэтому перед ним ставится фильтр. Строка, которая не число и не разбирается
// как число или дата, уходит дальше без изменений — ровно так поступил бы и сам
// перехватчик, дойдя до конца. Остальное («123» и «01.06.2026» текстом)
// проходит через него как прежде, со всеми его проверками формата и настроек.
// Разбор — чистая функция строки, поэтому ответ запоминается.

const numeric = new Map<string, boolean>();

function mayLookNumeric(text: string): boolean {
  let known = numeric.get(text);
  if (known === undefined) {
    known = isRealNum(text) || Boolean(getNumfmtParseValueFilter(text));
    if (numeric.size >= 20000) numeric.clear();
    numeric.set(text, known);
  }
  return known;
}

type CellHandler = (cell: unknown, pos: { rawData?: { v?: unknown } | null }, next: (cell: unknown) => unknown) => unknown;
type Interceptor = { handler: CellHandler; __usheetFiltered?: true };

function prefilterForceString(target: Interceptor): void {
  // Опознаём по ключу настройки: имена свойств и строки сборка не сжимает.
  if (target.__usheetFiltered || !String(target.handler).includes("disableForceStringMark")) return;
  const original = target.handler;
  // Цепочка читает `handler` с объекта на каждом вызове — подмена действует сразу.
  target.handler = function filtered(this: unknown, cell, pos, next) {
    const value = pos?.rawData?.v;
    if (typeof value === "string" && !mayLookNumeric(value)) return next(cell);
    return original.call(this, cell, pos, next);
  };
  target.__usheetFiltered = true;
}

/**
 * Перехватчик метки заводит отрисовка листа, и не к первым кадрам (проверено:
 * к пятому кадру его ещё нет). Поэтому список перехватчиков пересматривается на
 * каждом кадре, но только когда в нём поменялось число записей — сравнить
 * длину дешевле, чем кадр.
 */
function forceStringWatcher(univerAPI: UniverApi): () => void {
  // Ключ — имя точки перехвата; в типах Univer он объявлен интерфейсом.
  let service: { _interceptorsByName?: Map<unknown, Interceptor[]> } | null = null;
  let seen = -1;
  return () => {
    if (!service) {
      try {
        service = univerAPI._injector.get(SheetInterceptorService);
      } catch {
        // Плагины листа ещё не стартовали — спросим на следующем кадре.
        return;
      }
    }
    const list = service?._interceptorsByName?.get(INTERCEPTOR_POINT.CELL_CONTENT);
    if (!list || list.length === seen) return;
    seen = list.length;
    for (const item of list) prefilterForceString(item);
  };
}

// ── Подключение ──────────────────────────────────────────────────────────────

let installed = false;

type Subscribable = { subscribe: (fn: () => void) => { unsubscribe: () => void } };
type Engine = { beginFrame$?: Subscribable; endFrame$?: Subscribable };

/**
 * Ускорить лист. Зовётся после `createWorkbook` — до книги служб листа в Univer
 * ещё нет. Возвращает отписку; её зовут при размонтировании вместе с
 * `univerAPI.dispose()`.
 *
 * Подмены на прототипах ставятся один раз на страницу; память кадра молчит,
 * пока ни один лист не рисует кадр.
 */
export function speedUp(univerAPI: UniverApi): () => void {
  try {
    if (!installed) {
      installed = true;
      rememberCells();
      skipKnownOverflow();
    }
    const renders = univerAPI._injector.get(IRenderManagerService) as {
      getRenderAll: () => Map<string, { engine?: Engine }>;
      created$: { subscribe: (fn: (render: { engine?: Engine }) => void) => { unsubscribe: () => void } };
    };
    const subscriptions: { unsubscribe: () => void }[] = [];
    const seen = new WeakSet<object>();
    const filterMark = forceStringWatcher(univerAPI);
    const begin = () => {
      filterMark();
      openFrame();
    };
    const watch = (render: { engine?: Engine } | undefined) => {
      const engine = render?.engine;
      if (!engine || seen.has(engine) || !engine.beginFrame$ || !engine.endFrame$) return;
      seen.add(engine);
      subscriptions.push(engine.beginFrame$.subscribe(begin), engine.endFrame$.subscribe(closeFrame));
    };
    renders.getRenderAll().forEach((render) => watch(render));
    subscriptions.push(renders.created$.subscribe(watch));
    return () => {
      subscriptions.forEach((subscription) => subscription.unsubscribe());
      closeFrame();
    };
  } catch (exc) {
    // Без ускорения лист медленнее, но тот же.
    console.warn("ускорение листа не включилось:", exc);
    return () => {};
  }
}
