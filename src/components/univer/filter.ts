/**
 * Фильтр в шапке листа — общий корень листов продукта.
 *
 * До 29.09.2026 фильтр жил только в пункте ленты «Сортировка и фильтр», и
 * этот пункт раскрывался пустым (`sheet.tsx`, `mergeSortFilter`): человек
 * нажимал и не понимал, как фильтровать. Днём 29.09 лист стал открываться
 * сразу с воронками в шапке — и вечером это назвали «таблица всё время в
 * отмеченном состоянии»: воронка в каждой из тридцати колонок, а убранные
 * воронки после перезагрузки возвращались. Теперь как в Excel и Google
 * Таблицах: фильтр включают воронкой в ленте («Показать фильтр»), выключают
 * там же, и выбор помнится в браузере у каждой учётки (`wanted`).
 *
 * Здесь то, чего Univer сам не умеет:
 *
 * * **условия переживают пересборку листа и перезагрузку** — хранятся в
 *   сессии (`session-state.tsx`) по ключу колонки, а не по номеру: колонку
 *   переставили в настройке — условие поедет вместе с ней;
 * * **диапазон следует за строками** — раздел, переложивший строки (пришёл
 *   договор коллеги), ставит диапазон заново и просит пересчитать, иначе
 *   Univer прятал бы строки по старым номерам, то есть чужие договоры;
 * * **сводка для строки под листом** — какие колонки отобраны и сколько
 *   строк видно из скольких.
 *
 * Все записи — мутациями, а не командами: они не попадают в отмену Univer, и
 * Ctrl+Z после открытия листа не снимает фильтр, который человек не ставил.
 */
import { readSession, writeSession } from "@/components/session-state";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UniverApi = any;

export type SheetRange = { startRow: number; endRow: number; startColumn: number; endColumn: number };

/** Что отобрано на листе: подписи колонок с условием и сколько строк видно. */
export type FilterStatus = { sheet: string; columns: string[]; shown: number; total: number };

const MUTATION = {
  range: "sheet.mutation.set-filter-range",
  criteria: "sheet.mutation.set-filter-criteria",
  remove: "sheet.mutation.remove-filter",
  recalc: "sheet.mutation.re-calc-filter",
};

/** Команды, после которых условия могли поменяться. */
const CHANGES = new Set([MUTATION.criteria, MUTATION.remove, MUTATION.recalc, "sheet.command.clear-filter-criteria"]);

type Placed = { range: SheetRange; keys: string[]; labels: string[] };
/** Лист → колонка (по ключу) → условие Univer без номера колонки. */
type Saved = Record<string, Record<string, Record<string, unknown>>>;

export type FilterKeeper = {
  /**
   * Поставить фильтр на диапазон (или передвинуть его) и вернуть условия.
   * `keys` — ключи колонок диапазона слева направо, `labels` — их подписи.
   */
  place: (sheet: string, range: SheetRange, keys: string[], labels: string[]) => void;
  /** Снять фильтр с листа совсем (воронок нет). */
  remove: (sheet: string) => void;
  /** Есть ли фильтр на листе. */
  has: (sheet: string) => boolean;
  /** Пересчитать, какие строки прятать, — после сортировки и перестройки. */
  recalc: (sheet: string) => void;
  /** Снять все условия, воронки остаются. */
  clear: (sheet: string) => void;
  status: (sheet: string) => FilterStatus | null;
  /** Включил ли человек фильтр на этом листе (помнится в браузере). */
  wanted: (sheet: string) => boolean;
  setWanted: (sheet: string, on: boolean) => void;
  stop: () => void;
};

/** Листы с включённым фильтром — у учётки в этом браузере. */
function readWanted(address: string): string[] {
  try {
    const raw = localStorage.getItem(address);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeWanted(address: string, list: string[]): void {
  try {
    if (list.length) localStorage.setItem(address, JSON.stringify(list));
    else localStorage.removeItem(address);
  } catch {
    /* выбор живёт до перезагрузки */
  }
}

export function keepFilter(
  api: UniverApi,
  unitId: string,
  scope: string,
  key: string,
  onChange: () => void,
): FilterKeeper {
  const address = `filter.${key}`;
  const wantedAddress = `kort_filter_on:${scope}:${key}`;
  let wanted = new Set(readWanted(wantedAddress));
  const placed = new Map<string, Placed>();
  let applying = 0;

  const run = (id: string, params: Record<string, unknown>) => {
    applying += 1;
    try {
      api.syncExecuteCommand?.(id, { unitId, ...params });
    } catch (exc) {
      console.warn(`фильтр листа: ${id} не прошёл`, exc);
    } finally {
      applying -= 1;
    }
  };

  const filterOf = (sheet: string): UniverApi | null => {
    try {
      return api.getActiveWorkbook?.()?.getSheetBySheetId?.(sheet)?.getFilter?.() ?? null;
    } catch {
      return null;
    }
  };

  const readSaved = (): Saved => readSession<Saved>(scope, address, {});

  /** Запомнить условия листа по ключам колонок. */
  const save = (sheet: string) => {
    const at = placed.get(sheet);
    const filter = filterOf(sheet);
    const saved = { ...readSaved() };
    const own: Record<string, Record<string, unknown>> = {};
    if (at && filter) {
      at.keys.forEach((colKey, offset) => {
        const col = at.range.startColumn + offset;
        const criteria = filter.getColumnFilterCriteria?.(col);
        if (criteria && colKey) {
          const rest = { ...criteria } as Record<string, unknown>;
          delete rest.colId;
          own[colKey] = rest;
        }
      });
    }
    if (Object.keys(own).length) saved[sheet] = own;
    else delete saved[sheet];
    writeSession(scope, address, saved);
  };

  const listener = api.onCommandExecuted?.((command: { id: string; params?: { unitId?: string; subUnitId?: string } }) => {
    if (applying || !CHANGES.has(command.id)) return;
    const params = command.params ?? {};
    if (params.unitId && params.unitId !== unitId) return;
    const sheet = params.subUnitId ?? api.getActiveWorkbook?.()?.getActiveSheet?.()?.getSheetId?.();
    if (!sheet || !placed.has(sheet)) return;
    if (command.id === MUTATION.remove) placed.delete(sheet);
    // Univer дописывает условие чуть позже команды — читаем в следующей задаче.
    queueMicrotask(() => {
      if (placed.has(sheet)) save(sheet);
      onChange();
    });
  });

  const place = (sheet: string, range: SheetRange, keys: string[], labels: string[]) => {
    placed.set(sheet, { range, keys, labels });
    run(MUTATION.range, { subUnitId: sheet, range });
    const own = readSaved()[sheet] ?? {};
    let any = false;
    keys.forEach((colKey, offset) => {
      const criteria = colKey ? own[colKey] : undefined;
      if (!criteria) return;
      const col = range.startColumn + offset;
      run(MUTATION.criteria, { subUnitId: sheet, col, criteria: { ...criteria, colId: col }, reCalc: false });
      any = true;
    });
    if (any) run(MUTATION.recalc, { subUnitId: sheet });
    onChange();
  };

  return {
    place,
    remove: (sheet) => {
      // Убранный фильтр забывает и условия: включённый снова начинает с чистого.
      const saved = { ...readSaved() };
      if (saved[sheet]) {
        delete saved[sheet];
        writeSession(scope, address, saved);
      }
      if (!filterOf(sheet)) return;
      placed.delete(sheet);
      run(MUTATION.remove, { subUnitId: sheet });
      onChange();
    },
    has: (sheet) => Boolean(filterOf(sheet)),
    recalc: (sheet) => {
      const filter = filterOf(sheet);
      if (!filter) return;
      run(MUTATION.recalc, { subUnitId: sheet });
      onChange();
    },
    clear: (sheet) => {
      const at = placed.get(sheet);
      if (!at) return;
      at.keys.forEach((_, offset) => run(MUTATION.criteria, { subUnitId: sheet, col: at.range.startColumn + offset, criteria: null, reCalc: false }));
      run(MUTATION.recalc, { subUnitId: sheet });
      save(sheet);
      onChange();
    },
    status: (sheet) => {
      const at = placed.get(sheet);
      const filter = filterOf(sheet);
      if (!at || !filter) return null;
      const columns: string[] = [];
      at.keys.forEach((_, offset) => {
        if (filter.getColumnFilterCriteria?.(at.range.startColumn + offset)) columns.push(at.labels[offset] || at.keys[offset]);
      });
      const total = Math.max(0, at.range.endRow - at.range.startRow);
      const hidden = (filter.getFilteredOutRows?.() ?? []).length;
      return { sheet, columns, shown: Math.max(0, total - hidden), total };
    },
    wanted: (sheet) => wanted.has(sheet),
    setWanted: (sheet, on) => {
      wanted = new Set(readWanted(wantedAddress));
      if (on) wanted.add(sheet);
      else wanted.delete(sheet);
      writeWanted(wantedAddress, [...wanted]);
    },
    stop: () => listener?.dispose?.(),
  };
}
