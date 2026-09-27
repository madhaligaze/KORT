/**
 * Личный вид листа: ширины, перенос, цвета, жирный, скрытые колонки — у
 * каждой учётки свои, и ни одного значения они не меняют.
 *
 * Почему это было закрыто
 * ───────────────────────
 * Листы журнала и реестра пишут в базу только значения, а строки
 * перерисовывают сами (правка коллеги, ответ сервера, пересборка книги).
 * Жирный или заливка, поставленные лентой, пропадали при первой перерисовке
 * строки, и 26.09 оформление в ленте спрятали целиком. Пользователь попросил
 * вернуть всё, что меняет только вид (27.09): «если строка длинная и
 * обрезается — чтобы можно было показать целиком», и чтобы каждый настраивал
 * под себя, не задевая коллег — даже администратор.
 *
 * Как устроено
 * ────────────
 * * **Команды оформления Univer работают как есть** — пишут стиль в ячейку,
 *   попадают в «Отменить», переключатели ленты (жирный, перенос) видят
 *   состояние ячейки. Раздел их правкой не считает (`busy()`).
 * * **Вид запоминается по смыслу, а не по номерам**: строка — адрес раздела
 *   (договор, операция, шапка блока), колонка — ключ поля. Вставленная
 *   строка, сортировка и пересборка книги вид не сдвигают.
 * * **Любая запись раздела в ячейку проходит через вид**: перед мутацией
 *   значений стиль ячейки дополняется видом этой ячейки, поэтому перерисовка
 *   строки и новый договор в колонке с заливкой его не теряют.
 * * **Ctrl+Z** откатывает и сам лист, и запомненный вид: запись стека отмены,
 *   рождённая командой оформления, помечена видом «до» и «после».
 * * Хранится на сервере за учёткой и компанией (`/finance/looks/{key}`) —
 *   раздел даёт `store`, корень про адрес не знает.
 */
import { ICommandService, IUndoRedoService, IUniverInstanceService } from "@univerjs/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UniverApi = any;
type Style = Record<string, unknown>;

/** Как раздел адресует строки и колонки своего листа. */
export type LookIds = {
  /** Устойчивый адрес строки: договор, операция, шапка блока. `null` — у строки адреса нет. */
  rowId(sheet: string, row: number): string | null;
  rowOf(sheet: string, id: string): number | null;
  /** Поле ячейки. У листа с блоками колонка у каждого блока своя. */
  fieldAt(sheet: string, row: number, col: number): string | null;
  /** Колонка поля в строке — для оформления, запомненного по полю. */
  colOfField(sheet: string, row: number, field: string): number | null;
  /** Ключ физической колонки листа (ширина, скрытие) и обратно. */
  colKey(sheet: string, col: number): string | null;
  colOf(sheet: string, key: string): number | null;
  /** Строки листа с адресом — чтобы наложить оформление всей колонки. */
  rows(sheet: string): Iterable<[number, string]>;
};

type SheetLook = {
  /** Ширина и скрытие колонки — по ключу колонки. */
  cols?: Record<string, { w?: number; hidden?: boolean }>;
  /** Высота строки — по её адресу. */
  rows?: Record<string, { h?: number }>;
  /** Оформление ячеек: «адрес строки|поле». */
  cells?: Record<string, Style>;
  /** Оформление всей колонки (выделили колонку целиком) — по полю, и для новых строк тоже. */
  fields?: Record<string, Style>;
};

export type Look = { v: 1; sheets: Record<string, SheetLook> };

export type LookStore = {
  load: () => Promise<Look | null>;
  save: (look: Look) => Promise<void>;
  clear: () => Promise<void>;
};

export type LookKeeper = {
  /** Идёт команда оформления или её отмена: раздел не принимает это за правку. */
  busy: () => boolean;
  /** Наложить вид на лист (после сборки книги и после загрузки вида). */
  apply: () => void;
  /** Есть ли что сбрасывать. */
  empty: () => boolean;
  /** Стереть свой вид (и на сервере). Лист раздел пересобирает сам. */
  reset: () => Promise<void>;
  /** Вид появился или пропал — чтобы раздел показал «Сбросить мой вид». */
  subscribe: (listener: () => void) => () => void;
  stop: () => void;
};

const M = {
  values: "sheet.mutation.set-range-values",
  colWidth: "sheet.mutation.set-worksheet-col-width",
  colHidden: "sheet.mutation.set-col-hidden",
  colVisible: "sheet.mutation.set-col-visible",
  rowHeight: "sheet.mutation.set-worksheet-row-height",
};

/**
 * Команды, которые меняют только вид. Пока идёт такая команда (и её вложенные
 * `set-style`, `set-border`), мутации листа — оформление, а не правка.
 */
const LOOK_COMMAND =
  /^sheet\.command\.(set-style|set-border.*|clear-selection-format|set-(range-)?(bold|italic|underline|stroke|font-family|fontsize|font-size|font-increase|font-decrease|text-color)|reset-(range-)?text-color|set-background-color|reset-background-color|set-horizontal-text-align|set-vertical-text-align|set-text-wrap|set-text-rotation|delta-column-width|set-worksheet-col-width|set-col-is-auto-width|delta-row-height|set-row-height|set-row-is-auto-height|set-col-hidden|set-selected-cols-visible|set-col-visible-on-cols)$/;

/** Ячеек с личным оформлением больше этого не бывает — дальше лишь по колонкам. */
const MAX_CELLS = 20000;
const SAVE_MS = 800;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Слить заплатку стиля: `null` у ключа — «как у листа», ключ из вида уходит. */
function patch(into: Style | undefined, change: Style): Style | undefined {
  const next: Style = { ...(into ?? {}) };
  for (const [key, value] of Object.entries(change)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  return Object.keys(next).length ? next : undefined;
}

export function keepLook(api: UniverApi, ids: LookIds, store: LookStore): LookKeeper {
  let look: Look = { v: 1, sheets: {} };
  let loaded = false;
  let alive = true;
  let depth = 0;
  /** Вид до первой команды оформления, которая сейчас идёт. */
  let pendingBefore: Look | null = null;
  let restoring = false;
  let saveTimer = 0;
  const listeners = new Set<() => void>();
  const disposers: Array<() => void> = [];
  const injector = api._injector;
  const unitId: string = api.getActiveWorkbook?.()?.getId?.() ?? "";
  let applying = false;

  const sheetLook = (sheet: string): SheetLook => (look.sheets[sheet] ??= {});
  const isEmpty = () =>
    Object.values(look.sheets).every(
      (sheet) =>
        !Object.keys(sheet.cols ?? {}).length &&
        !Object.keys(sheet.rows ?? {}).length &&
        !Object.keys(sheet.cells ?? {}).length &&
        !Object.keys(sheet.fields ?? {}).length,
    );
  const notify = () => listeners.forEach((listener) => listener());
  const changed = () => {
    notify();
    if (!loaded) return;
    window.clearTimeout(saveTimer);
    const snapshot = clone(look);
    saveTimer = window.setTimeout(() => {
      void store.save(snapshot).catch((exc) => console.warn("личный вид листа не сохранился:", exc));
    }, SAVE_MS);
  };

  const model = () => {
    try {
      return injector.get(IUniverInstanceService).getUnit(unitId);
    } catch {
      return null;
    }
  };

  /** Оформление ячейки из вида: колонка целиком, поверх — сама ячейка. */
  const lookAt = (sheet: string, row: number, col: number): Style | undefined => {
    const own = look.sheets[sheet];
    if (!own) return undefined;
    const id = ids.rowId(sheet, row);
    const field = ids.fieldAt(sheet, row, col);
    if (!id || !field) return undefined;
    const column = own.fields?.[field];
    const cell = own.cells?.[`${id}|${field}`];
    if (!column && !cell) return undefined;
    return { ...(column ?? {}), ...(cell ?? {}) };
  };

  const exec = (id: string, params: Record<string, unknown>) => {
    try {
      api.syncExecuteCommand(id, { unitId, ...params });
    } catch (exc) {
      console.warn(`вид листа: ${id} не встал:`, exc);
    }
  };

  type Command = { id: string; params?: Record<string, unknown> };
  type Listen = (listener: (command: Command) => void) => { dispose?: () => void } | undefined;
  const commandService = injector.get(ICommandService) as { beforeCommandExecuted: Listen; onCommandExecuted: Listen };

  // ── Раздел пишет в ячейки → стиль дополняется видом ──
  const before = commandService.beforeCommandExecuted((command) => {
    if (!alive) return;
    if (LOOK_COMMAND.test(command.id)) {
      // Снимок «до» — у первой команды оформления, пока вид ещё прежний.
      if (depth === 0) pendingBefore = clone(look);
      depth += 1;
      return;
    }
    if (command.id !== M.values || depth > 0 || restoring) return;
    const params = command.params as { unitId?: string; subUnitId?: string; cellValue?: Record<number, Record<number, { s?: unknown } | null>> } | undefined;
    if (!params || params.unitId !== unitId || !params.subUnitId || !look.sheets[params.subUnitId]) return;
    const sheet = params.subUnitId;
    const styles = model()?.getStyles?.();
    for (const [rowKey, line] of Object.entries(params.cellValue ?? {})) {
      const row = Number(rowKey);
      for (const [colKey, cell] of Object.entries(line ?? {})) {
        if (!cell || !("s" in cell)) continue;
        const extra = lookAt(sheet, row, Number(colKey));
        if (!extra) continue;
        const base = (typeof cell.s === "string" ? styles?.get?.(cell.s) : cell.s) as Style | null | undefined;
        cell.s = { ...(base ?? {}), ...extra };
      }
    }
  });
  if (before?.dispose) disposers.push(() => before.dispose?.());

  // ── Команда оформления → вид запоминается ──
  const record = (id: string, params: Record<string, unknown>) => {
    const sheet = String(params.subUnitId ?? "");
    if (!sheet || params.unitId !== unitId) return;
    if (id === M.values) {
      const own = sheetLook(sheet);
      const cellValue = (params.cellValue ?? {}) as Record<number, Record<number, { s?: unknown } | null>>;
      // Колонка целиком: у всех строк с адресом — одна и та же заплатка.
      const byField = new Map<string, { count: number; style: string }>();
      const touched: Array<{ id: string; field: string; change: Style | null }> = [];
      for (const [rowKey, line] of Object.entries(cellValue)) {
        const row = Number(rowKey);
        const rowId = ids.rowId(sheet, row);
        if (!rowId) continue;
        for (const [colKey, cell] of Object.entries(line ?? {})) {
          if (!cell || !("s" in cell)) continue;
          const field = ids.fieldAt(sheet, row, Number(colKey));
          if (!field) continue;
          const change = cell.s === null ? null : ((typeof cell.s === "object" ? cell.s : null) as Style | null);
          touched.push({ id: rowId, field, change });
          const signature = JSON.stringify(change);
          const seen = byField.get(field);
          if (!seen) byField.set(field, { count: 1, style: signature });
          else if (seen.style === signature) seen.count += 1;
          else seen.style = "*";
        }
      }
      const total = new Map<string, number>();
      for (const [row] of ids.rows(sheet)) {
        for (const field of byField.keys()) if (ids.colOfField(sheet, row, field) !== null) total.set(field, (total.get(field) ?? 0) + 1);
      }
      const whole = new Set(
        [...byField].filter(([field, seen]) => seen.style !== "*" && seen.count >= (total.get(field) ?? Infinity) && seen.count > 1).map(([field]) => field),
      );
      for (const field of whole) {
        const change = touched.find((item) => item.field === field)?.change ?? null;
        own.fields ??= {};
        const next = change === null ? undefined : patch(own.fields[field], change);
        if (next) own.fields[field] = next;
        else delete own.fields[field];
      }
      for (const item of touched) {
        const key = `${item.id}|${item.field}`;
        own.cells ??= {};
        // Колонка целиком: заплатка ложится и на ячейки со своим видом —
        // Univer перекрасил и их.
        if (whole.has(item.field) && !own.cells[key]) continue;
        const next = item.change === null ? undefined : patch(own.cells[key], item.change);
        if (next) own.cells[key] = next;
        else delete own.cells[key];
      }
      if (Object.keys(own.cells ?? {}).length > MAX_CELLS) {
        console.warn("личный вид: слишком много раскрашенных ячеек — старые уходят");
        own.cells = Object.fromEntries(Object.entries(own.cells ?? {}).slice(-MAX_CELLS));
      }
      changed();
      return;
    }
    const ranges = (params.ranges ?? []) as Array<{ startColumn: number; endColumn: number; startRow: number; endRow: number }>;
    if (id === M.colWidth || id === M.colHidden || id === M.colVisible) {
      const own = sheetLook(sheet);
      own.cols ??= {};
      for (const range of ranges) {
        for (let col = range.startColumn; col <= range.endColumn; col += 1) {
          const key = ids.colKey(sheet, col);
          if (!key) continue;
          const entry = { ...(own.cols[key] ?? {}) };
          if (id === M.colWidth) {
            const width = typeof params.colWidth === "number" ? params.colWidth : (params.colWidth as number[] | undefined)?.[col];
            if (typeof width === "number") entry.w = Math.round(width);
          } else if (id === M.colHidden) entry.hidden = true;
          else delete entry.hidden;
          if (Object.keys(entry).length) own.cols[key] = entry;
          else delete own.cols[key];
        }
      }
      changed();
      return;
    }
    if (id === M.rowHeight) {
      const own = sheetLook(sheet);
      own.rows ??= {};
      for (const range of ranges) {
        for (let row = range.startRow; row <= range.endRow; row += 1) {
          const rowId = ids.rowId(sheet, row);
          const height = typeof params.rowHeight === "number" ? params.rowHeight : (params.rowHeight as number[] | undefined)?.[row];
          if (rowId && typeof height === "number") own.rows[rowId] = { h: Math.round(height) };
        }
      }
      changed();
    }
  };

  // ── Стек отмены: запись оформления помечена видом «до» и «после» ──
  //
  // Методы сервиса отмены не подменяются: инжектор отдаёт его через прокси, и
  // подменённый метод до настоящего стека не доходит. Вместо этого запись
  // помечается после команды (верх стека, если он новый), а перед «Отменить»
  // и «Вернуть» смотрится, чья запись сейчас наверху.
  type Mark = { before: Look; after: Look };
  const marks = new WeakMap<object, Mark>();
  type UndoService = { pitchTopUndoElement: () => object | null; pitchTopRedoElement: () => object | null };
  let undoService: UndoService | null = null;
  try {
    undoService = injector.get(IUndoRedoService) as UndoService;
  } catch {
    undoService = null;
  }
  /** Верх стека отмены до команды оформления — чтобы отличить новую запись. */
  let topBefore: object | null = null;
  const top = (which: "undo" | "redo"): object | null => {
    try {
      return (which === "undo" ? undoService?.pitchTopUndoElement() : undoService?.pitchTopRedoElement()) ?? null;
    } catch {
      return null;
    }
  };
  const history = commandService.beforeCommandExecuted((command) => {
    if (!alive) return;
    if (command.id === "univer.command.undo" || command.id === "univer.command.redo") {
      const which = command.id === "univer.command.undo" ? "undo" : "redo";
      const element = top(which);
      const mark = element ? marks.get(element) : undefined;
      if (!mark) return;
      // Вид — прежний; мутации отмены (старые стили ячеек) им не дополняются
      // и правкой раздела не считаются.
      look = clone(which === "undo" ? mark.before : mark.after);
      restoring = true;
      changed();
      return;
    }
    if (depth === 1 && LOOK_COMMAND.test(command.id)) topBefore = top("undo");
  });
  if (history?.dispose) disposers.push(() => history.dispose?.());

  const executed = commandService.onCommandExecuted((command) => {
    if (!alive) return;
    if (command.id === "univer.command.undo" || command.id === "univer.command.redo") {
      restoring = false;
      return;
    }
    if (LOOK_COMMAND.test(command.id)) {
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        const element = top("undo");
        if (element && element !== topBefore && pendingBefore) {
          marks.set(element, { before: pendingBefore, after: clone(look) });
        }
        pendingBefore = null;
        topBefore = null;
      }
      return;
    }
    if (depth > 0 && !restoring && !applying && command.params) record(command.id, command.params);
  });
  if (executed?.dispose) disposers.push(() => executed.dispose?.());

  // ── Наложить вид на собранный лист ──
  const apply = () => {
    if (!alive || isEmpty()) return;
    const workbook = model();
    applying = true;
    try {
      for (const [sheet, own] of Object.entries(look.sheets)) {
        const ws = workbook?.getSheetBySheetId?.(sheet);
        if (!ws) continue;
        for (const [key, col] of Object.entries(own.cols ?? {})) {
          const at = ids.colOf(sheet, key);
          if (at === null) continue;
          const ranges = [{ startRow: 0, endRow: 0, startColumn: at, endColumn: at }];
          if (col.w) exec(M.colWidth, { subUnitId: sheet, ranges, colWidth: col.w });
          if (col.hidden) exec(M.colHidden, { subUnitId: sheet, ranges });
        }
        for (const [id, row] of Object.entries(own.rows ?? {})) {
          const at = ids.rowOf(sheet, id);
          if (at === null || !row.h) continue;
          exec(M.rowHeight, { subUnitId: sheet, ranges: [{ startRow: at, endRow: at, startColumn: 0, endColumn: 0 }], rowHeight: row.h });
        }
        const styles = workbook?.getStyles?.();
        const cellValue: Record<number, Record<number, { s: Style }>> = {};
        const fields = Object.keys(own.fields ?? {});
        const cells = own.cells ?? {};
        const byRow = new Map<string, string[]>();
        for (const key of Object.keys(cells)) {
          const cut = key.lastIndexOf("|");
          const id = key.slice(0, cut);
          const list = byRow.get(id) ?? [];
          list.push(key.slice(cut + 1));
          byRow.set(id, list);
        }
        for (const [row, id] of ids.rows(sheet)) {
          for (const field of new Set([...fields, ...(byRow.get(id) ?? [])])) {
            const col = ids.colOfField(sheet, row, field);
            if (col === null) continue;
            const raw = ws.getCellRaw?.(row, col) as { s?: unknown } | undefined;
            const base = (typeof raw?.s === "string" ? styles?.get?.(raw.s) : raw?.s) as Style | undefined;
            (cellValue[row] ??= {})[col] = { s: { ...(base ?? {}), ...(lookAt(sheet, row, col) ?? {}) } };
          }
        }
        if (Object.keys(cellValue).length) exec(M.values, { subUnitId: sheet, cellValue });
      }
    } finally {
      applying = false;
    }
  };

  void store
    .load()
    .then((saved) => {
      if (!alive) return;
      // Успели оформить до ответа сервера — своё не теряем, дописываем поверх.
      const early = !isEmpty();
      if (saved && saved.v === 1 && saved.sheets && !early) look = saved;
      loaded = true;
      notify();
      if (early) changed();
      else apply();
    })
    .catch(() => {
      // Не прочитался — лист как у всех, а вид начнёт копиться с чистого.
      loaded = true;
    });

  return {
    busy: () => depth > 0 || restoring,
    apply,
    empty: isEmpty,
    reset: async () => {
      look = { v: 1, sheets: {} };
      window.clearTimeout(saveTimer);
      notify();
      await store.clear();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop: () => {
      alive = false;
      // Несохранённое — сразу, а не через таймер, который уже не сработает.
      if (saveTimer && loaded) {
        window.clearTimeout(saveTimer);
        void store.save(clone(look)).catch(() => undefined);
      }
      disposers.forEach((stop) => stop());
      listeners.clear();
    },
  };
}
