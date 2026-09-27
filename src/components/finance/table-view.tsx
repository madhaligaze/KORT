"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HEADER_STYLE, PAPER, ROW_H, fitWidth, headerHeight, sampled } from "@/components/univer/columns";
import { listRule, putLists } from "@/components/univer/lists";
import { type PollOutcome, pollWhileVisible } from "@/components/univer/live";
import { type LookKeeper, keepLook } from "@/components/univer/look";
import { guardSheets } from "@/components/univer/protect";
import { UniverSheet, type UniverApi, type WorkbookSnapshot } from "@/components/univer/sheet";
import { DATE_PATTERN, MONEY_PATTERN, WRAP_CLIP, dateOf, serialOf } from "@/components/univer/sheet-model";
import { useFillHeight } from "@/components/univer/use-fill-height";
import { writeCells } from "@/components/univer/write";
import { lookStore } from "@/components/finance/look-store";
import { useSessionScope } from "@/components/session-state";
import {
  type GridColumn,
  type GridPayload,
  type GridRow,
  FinanceApiError,
  financeApi,
} from "@/components/finance/api";

/**
 * Журнал как лист Univer — второй вид на те же операции.
 *
 * Почему именно Univer, а не своя решётка
 * ───────────────────────────────────────
 * Это уже решалось в разделе «Книги» в сентябре 2026 и стоило переписанного
 * компонента. Своя решётка была: виртуализированная, с правкой по ячейке,
 * пустой строкой внизу, и она проходила все проверки. А человек из Excel
 * приходит с привычками — выделить диапазон и увидеть сумму, потянуть за угол,
 * вставить столбец из буфера, Ctrl+Z, — и ни одной из них она не отвечала.
 * Догонять по одной значит писать Univer заново и хуже.
 *
 * Разметка листа
 * ──────────────
 * Строка 0 — заголовки. Дальше операции в порядке журнала (новые сверху). Под
 * последней — запас пустых строк: новую операцию заводят, спустившись вниз и
 * напечатав, а не кнопкой.
 *
 * Колонка — поле операции по порядку из ответа сервера. Позиция колонки не
 * адрес: адрес — это `key`, и правка уходит по нему. То же правило, что для
 * колонок книг, и по той же причине.
 */

/** Сколько пустых строк держать под последней операцией. */
const SPARE_ROWS = 100;
const HEADER_ROW = 0;

/** Стиль текста колонки: серый — правка здесь не сохранится. */
const textStyle = (column: GridColumn) => (column.editable ? "text" : "readonly");

/**
 * Ячейка листа для значения колонки.
 *
 * Одна функция на сборку листа и на запись ответа сервера обратно: иначе
 * значение, пришедшее после правки, выглядело бы иначе, чем то же значение
 * при открытии листа, — дата текстом вместо даты, сумма без разрядов.
 *
 * Стиль есть и у пустой ячейки: в нём обрезка (`WRAP_CLIP`), и значение,
 * выбранное в пустой ячейке из списка, иначе переносилось бы по словам до
 * ответа сервера.
 */
function cellFor(column: GridColumn, raw: string): Record<string, unknown> {
  if (!raw) return { v: "", s: textStyle(column) };
  if (column.kind === "money") {
    const asNumber = Number(String(raw).replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(asNumber) ? { v: asNumber, s: "money" } : { v: String(raw), s: textStyle(column) };
  }
  if (column.kind === "date") {
    const serial = serialOf(String(raw));
    return serial === null ? { v: String(raw), s: textStyle(column) } : { v: serial, t: 2, s: "date" };
  }
  return { v: String(raw), s: textStyle(column) };
}

/** Значение ячейки в том виде, в каком его ждёт сервер. */
function rawOf(column: GridColumn, cell: unknown): unknown {
  if (cell === null || cell === undefined) return "";
  const value = typeof cell === "object" ? ((cell as { v?: unknown }).v ?? "") : cell;
  // Дата вернулась номером дня — переводим обратно, иначе на сервер
  // уехало бы «46174», и следующее чтение показало бы сорок шесть тысяч.
  if (column.kind === "date" && typeof value === "number") return dateOf(value);
  return value;
}

/**
 * То же ли это значение, что уже в учёте.
 *
 * Событие правки Univer присылает и на смену оформления (жирный, заливка), и
 * на нашу же запись ответа обратно в ячейку. Отправлять такое на сервер —
 * значит плодить версии и записи в истории без единой изменённой цифры.
 */
function same(column: GridColumn, raw: unknown, known: string): boolean {
  const a = String(raw ?? "").trim();
  const b = String(known ?? "").trim();
  if (column.kind === "money" && a && b) {
    const left = Number(a.replace(/\s/g, "").replace(",", "."));
    const right = Number(b);
    return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.005;
  }
  return a === b;
}

/**
 * Предел ширины по виду колонки — те же, что у таких же колонок реестра:
 * справочники (счёт, статья, контрагент) и «только чтение» (вид, состояние)
 * читаются целиком, свободный текст — девять значений из десяти.
 */
const WIDTH_CAP: Record<string, number> = { date: 112, money: 160, enum: 280, readonly: 160 };
const TEXT_CAP = 320;

/** Значение так, как его рисует лист, — для замера ширины колонки. */
function faceOf(column: GridColumn, raw: string): string {
  if (!raw) return "";
  const cell = cellFor(column, raw);
  if (typeof cell.v === "number" && column.kind === "money") {
    return cell.v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (typeof cell.v === "number" && column.kind === "date") return raw.split("-").reverse().join(".");
  return String(cell.v ?? "");
}

/**
 * Ширины колонок — по содержимому, общим правилом листов (`fitWidth`):
 * ширина с сервера — нижняя граница. Раньше она была и верхней, и «Вид»
 * шириной 90 резал «Поступление» до «Поступлени».
 */
function fitColumns(payload: GridPayload): Array<{ label: string; width: number }> {
  const rows = sampled(payload.rows);
  return payload.columns.map((column) => ({
    label: column.title,
    width: fitWidth(
      rows.map((row) => faceOf(column, String(row.cells[column.key] ?? ""))),
      column.title,
      { min: column.width, cap: WIDTH_CAP[column.kind] ?? TEXT_CAP, share: column.kind in WIDTH_CAP ? 1 : 0.9 },
    ),
  }));
}

function buildWorkbook(payload: GridPayload): WorkbookSnapshot {
  const cellData: Record<number, Record<number, Record<string, unknown>>> = {};

  const head: Record<number, Record<string, unknown>> = {};
  payload.columns.forEach((column, index) => {
    head[index] = { v: column.title, s: "head" };
  });
  cellData[HEADER_ROW] = head;

  // Каждая ячейка до последней запасной строки — со стилем (см. `cellFor`);
  // у пустой — только стиль, без значения.
  for (let index = 0; index < payload.rows.length + SPARE_ROWS; index += 1) {
    const row = payload.rows[index];
    const line: Record<number, Record<string, unknown>> = {};
    payload.columns.forEach((column, columnIndex) => {
      const raw = String(row?.cells[column.key] ?? "");
      line[columnIndex] = raw ? cellFor(column, raw) : { s: textStyle(column) };
    });
    cellData[index + 1] = line;
  }

  const fitted = fitColumns(payload);
  const columnData: Record<number, { w: number }> = {};
  fitted.forEach((column, index) => {
    columnData[index] = { w: column.width };
  });

  return {
    id: `finance-journal`,
    name: "Журнал",
    locale: "ruRU",
    sheetOrder: ["journal"],
    styles: {
      // Шапка — общий стиль листов, как у реестра (`univer/columns.ts`).
      head: HEADER_STYLE,
      // Значение не выходит за свою колонку и не переносится — стандарт
      // ячеек листов, тот же, что у реестра (`WRAP_CLIP` в общем корне).
      text: { tb: WRAP_CLIP },
      money: { ht: 3, n: { pattern: MONEY_PATTERN }, tb: WRAP_CLIP },
      date: { n: { pattern: DATE_PATTERN }, tb: WRAP_CLIP },
      // Нередактируемые колонки приглушены: правка в них не сохранится, и
      // человек обязан понять это до того, как напечатает.
      readonly: { cl: { rgb: PAPER.soft }, tb: WRAP_CLIP },
    },
    sheets: {
      journal: {
        id: "journal",
        name: "Журнал",
        rowCount: payload.rows.length + SPARE_ROWS + 1,
        columnCount: Math.max(payload.columns.length, 1),
        defaultRowHeight: ROW_H,
        cellData,
        rowData: { [HEADER_ROW]: { h: headerHeight(fitted) } },
        columnData,
        freeze: { xSplit: 0, ySplit: 1, startRow: 1, startColumn: 0 },
      },
    },
  };
}

/**
 * Выпадающие списки на колонках-справочниках.
 *
 * Это то, чего нашей таблице не хватало по сравнению с Google Sheets: в книге
 * «Журнал ГК BBC» у колонок «Счёт», «Подкатегория» и прочих стоят списки, и
 * человек не печатает названия руками, а выбирает. Печать руками — это
 * опечатки, а опечатка в названии статьи создаёт вторую статью и делит отчёт
 * надвое.
 *
 * Список — подсказка, а не запрет. Новая статья появляется в работе постоянно,
 * и запретить ввести её значило бы заставить идти в справочник посреди
 * заполнения. Счёт — исключение, но его строгость обеспечивает сервер: он
 * откажет с объяснением, а не создаст счёт из опечатки.
 *
 * Как список выглядит и ведёт себя — общий стандарт листов
 * (`univer/lists.ts`), тот же, что у реестра. До 27.09 журнал ставил правило
 * Univer по умолчанию, и значения в колонке рисовались цветными капсулами.
 * Список только там, где правка открыта: колонка «только чтение» или лист без
 * права правки предлагали бы выбор, который не запишется.
 */
function listRules(payload: GridPayload, canEdit: boolean): Array<Record<string, unknown>> {
  if (!canEdit) return [];
  const rows = payload.rows.length + SPARE_ROWS;
  const out: Array<Record<string, unknown>> = [];
  payload.columns.forEach((column, index) => {
    if (column.kind !== "enum" || !column.source || !column.editable) return;
    const list = payload.options?.[column.source] ?? [];
    if (!list.length) return;
    out.push(
      listRule(`journal-list-${column.key}`, list, [{ startRow: 1, endRow: rows, startColumn: index, endColumn: index }]),
    );
  });
  return out;
}

/**
 * Лист, который сейчас на экране, и то, какая операция в какой его строке.
 *
 * Главное правило листа: **строка на экране — это адрес операции до тех пор,
 * пока лист не пересобран.** Карта строится один раз из того ответа, по
 * которому лист собран, и дальше меняется только по месту: правка обновляет
 * версию и ячейки своей строки, новая операция занимает ту пустую строку, где
 * её напечатали.
 *
 * Раньше после каждой правки журнал перечитывался целиком, а лист оставался
 * прежним. Перечитанный журнал отсортирован по дате заново, поэтому стоило
 * поправить дату — и операции ниже сдвигались в памяти на строку, а на экране
 * нет. Следующая правка уходила в соседнюю операцию. Проверено живьём 21
 * сентября: сумму правили у «Перевод · Тофиг Т.», а записалась она в «Билет
 * Avtobys», со строкой состояния «записано».
 */
type Mounted = {
  generation: number;
  payload: GridPayload;
  rows: Map<number, GridRow>;
  /** Обратная карта: операция → строка листа. Правка коллеги ложится по ней. */
  ids: Map<string, number>;
  /** Номер изменения журнала, после которого спрашивает живой режим. */
  seq: number;
};

function mount(payload: GridPayload, generation: number): Mounted {
  const rows = new Map<number, GridRow>();
  const ids = new Map<string, number>();
  payload.rows.forEach((row, index) => {
    rows.set(index + 1, row);
    ids.set(row.id, index + 1);
  });
  return { generation, payload, rows, ids, seq: payload.seq ?? 0 };
}

/** Лист журнала в книге Univer — адрес для записи и прав. */
const SHEET_ID = "journal";

/** Что сделано одной правкой — для строки состояния. */
type Tally = {
  saved: number;
  created: number;
  lastRow: number;
  refusals: string[];
  missing: string;
};

type Beat = { text: string; at: number; refusal: boolean };

/** Номер строки так, как его видит человек: слева у Univer строка шапки — «1». */
const shown = (sheetRow: number) => sheetRow + 1;

export function TableView({
  onChanged,
  refresh = 0,
  canEdit = true,
}: {
  onChanged: () => void;
  refresh?: number;
  /** Право правки раздела «Таблица». Нет — лист только для чтения. */
  canEdit?: boolean;
}) {
  const [sheet, setSheet] = useState<Mounted | null>(null);
  const [error, setError] = useState("");
  const [beat, setBeat] = useState<Beat | null>(null);
  const { ref: box, height } = useFillHeight(360, 44);
  /**
   * Смонтированный лист держим и в ref: обработчик правки живёт внутри Univer
   * и пересоздаваться не должен — иначе подписка навесится повторно и одна
   * правка уедет на сервер дважды.
   */
  const current = useRef<Mounted | null>(null);
  const generation = useRef(0);
  /** Очередь правок: по одной, чтобы версия строки успевала обновиться. */
  const queue = useRef<Promise<void>>(Promise.resolve());
  /** Больше нуля — лист пишет в свои ячейки сам, и эти правки не наши. */
  const writing = useRef(0);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);
  const canEditRef = useRef(canEdit);
  useEffect(() => {
    canEditRef.current = canEdit;
  }, [canEdit]);
  /** Чей вид листа: учётка и компания (`session-state.tsx`). */
  const scope = useSessionScope();
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [keeper, setKeeper] = useState<LookKeeper | null>(null);
  const [lookEmpty, setLookEmpty] = useState(true);
  /** Пересобрать лист с тем же ответом — после «Сбросить мой вид». */
  const [remount, setRemount] = useState(0);

  // Чтение — с отменой: ответ, пришедший после ухода с раздела, не должен
  // собирать лист в уже снятом компоненте. `refresh` — кнопка «Перечитать» в
  // шапке раздела: только она пересобирает открытый лист.
  useEffect(() => {
    let alive = true;
    financeApi
      .grid({})
      .then((next) => {
        if (!alive) return;
        generation.current += 1;
        const mounted = mount(next, generation.current);
        current.current = mounted;
        setSheet(mounted);
        setError("");
      })
      .catch((exc) => alive && setError(exc instanceof Error ? exc.message : "Лист не собрался"));
    return () => {
      alive = false;
    };
  }, [refresh]);

  /**
   * Сообщение гаснет само.
   *
   * «Строка 5: записано» через минуту — уже не отчёт о действии, а
   * утверждение о текущем состоянии, и неверное: рядом может идти правка,
   * которую сервер отклонил. Отказ держим дольше: его читают, а не замечают
   * краем глаза.
   */
  useEffect(() => {
    if (!beat) return;
    const id = window.setTimeout(() => setBeat(null), beat.refusal ? 12000 : 5000);
    return () => window.clearTimeout(id);
  }, [beat]);

  const onReady = useCallback((api: UniverApi) => {
    const disposers: Array<() => void> = [];
    // Карта этого листа. Не `current.current` в момент правки: если лист
    // пересоберут, старый обработчик обязан работать со своими строками, а не
    // с чужими.
    const mine = current.current;
    if (!mine) return;
    putLists(api, SHEET_ID, listRules(mine.payload, canEditRef.current));
    const { columns } = mine.payload;
    // Личный вид: ширины, цвета, перенос — у каждого свои (`univer/look.ts`).
    // Строка — операция («o:<id>»), шапка — «h»; колонка — ключ поля.
    const fieldIndex = (key: string) => {
      const at = columns.findIndex((column) => column.key === key);
      return at >= 0 ? at : null;
    };
    const look = keepLook(
      api,
      {
        rowId: (sheetId, row) => {
          if (sheetId !== SHEET_ID) return null;
          if (row === HEADER_ROW) return "h";
          const id = mine.rows.get(row)?.id;
          return id ? `o:${id}` : null;
        },
        rowOf: (sheetId, id) =>
          sheetId !== SHEET_ID ? null : id === "h" ? HEADER_ROW : (mine.ids.get(id.slice(2)) ?? null),
        fieldAt: (sheetId, _row, col) => (sheetId === SHEET_ID ? (columns[col]?.key ?? null) : null),
        colOfField: (sheetId, _row, field) => (sheetId === SHEET_ID ? fieldIndex(field) : null),
        colKey: (sheetId, col) => (sheetId === SHEET_ID ? (columns[col]?.key ?? null) : null),
        colOf: (sheetId, key) => (sheetId === SHEET_ID ? fieldIndex(key) : null),
        rows: function* (sheetId) {
          if (sheetId !== SHEET_ID) return;
          yield [HEADER_ROW, "h"] as [number, string];
          for (const [row, item] of mine.rows) yield [row, `o:${item.id}`] as [number, string];
        },
      },
      lookStore("journal", scopeRef.current),
    );
    setKeeper(look);
    setLookEmpty(look.empty());
    const unwatch = look.subscribe(() => setLookEmpty(look.empty()));
    disposers.push(() => {
      unwatch();
      look.stop();
    });

    const active = () => api.getActiveWorkbook()?.getActiveSheet();
    let alive = true;
    disposers.push(() => {
      alive = false;
    });
    /** Строки, у которых правка уходит на сервер: опрос их не трогает. */
    const busy = new Set<number>();
    /** Строка, где сейчас открыт редактор ячейки, и правки коллег, ждущие его закрытия. */
    let editingRow: number | null = null;
    const deferred = new Map<number, GridRow>();

    /**
     * Записать в строку листа то, что знает сервер. Мутацией из корня листов
     * (`univer/write.ts`): права её не режут (колонки «только чтение» пишет
     * сервер, не человек), и в «Отменить» она не попадает.
     */
    const writeRow = (sheetRow: number, row: GridRow | null) => {
      writing.current += 1;
      try {
        const line: Record<number, Record<string, unknown> | null> = {};
        columns.forEach((column, index) => {
          line[index] = cellFor(column, row?.cells[column.key] ?? "");
        });
        if (!writeCells(api, SHEET_ID, { [sheetRow]: line })) {
          console.warn(`строка ${shown(sheetRow)} не перерисовалась`);
        }
      } finally {
        writing.current -= 1;
      }
    };

    const writeHeader = () => {
      writing.current += 1;
      try {
        const line: Record<number, Record<string, unknown>> = {};
        columns.forEach((column, index) => {
          line[index] = { v: column.title, s: "head" };
        });
        writeCells(api, SHEET_ID, { [HEADER_ROW]: line });
      } finally {
        writing.current -= 1;
      }
    };

    /** Строка целиком — для новой операции нужны все её ячейки, а не одна. */
    const readRow = (sheetRow: number): Record<string, unknown> => {
      const target = active();
      const cells: Record<string, unknown> = {};
      columns.forEach((column, index) => {
        const cell = target?.getRange(sheetRow, index, 1, 1).getCellData?.();
        cells[column.key] = rawOf(column, cell);
      });
      return cells;
    };

    /** Строку успели поправить в другом окне: показать свежую и не гадать. */
    const refetch = async (sheetRow: number, id: string) => {
      try {
        const fresh = (await financeApi.grid({})).rows.find((row) => row.id === id) ?? null;
        if (fresh) mine.rows.set(sheetRow, fresh);
        writeRow(sheetRow, fresh);
      } catch {
        /* останется как есть; сервер всё равно не примет правку со старой версией */
      }
    };

    const saveExisting = async (sheetRow: number, index: number, tally: Tally) => {
      busy.add(sheetRow);
      try {
        await saveExistingCell(sheetRow, index, tally);
      } finally {
        busy.delete(sheetRow);
      }
    };

    const saveExistingCell = async (sheetRow: number, index: number, tally: Tally) => {
      const column = columns[index];
      const row = mine.rows.get(sheetRow);
      if (!column || !row) return;
      const raw = rawOf(column, active()?.getRange(sheetRow, index, 1, 1).getCellData?.());
      if (same(column, raw, row.cells[column.key] ?? "")) return;
      if (!column.editable) {
        tally.refusals.push(`строка ${shown(sheetRow)}: «${column.title}» правится в карточке операции`);
        writeRow(sheetRow, row);
        return;
      }
      try {
        const out = await financeApi.patchCell({
          operation_id: row.id,
          column: column.key,
          value: raw,
          version: row.version,
        });
        mine.rows.set(sheetRow, out.row);
        // Обратно пишем ответ сервера, а не оставляем напечатанное: «3.9.26»
        // становится датой, «1 500,5» — суммой с разрядами, и на экране ровно
        // то, что в учёте.
        writeRow(sheetRow, out.row);
        tally.saved += 1;
        tally.lastRow = sheetRow;
      } catch (exc) {
        if (exc instanceof FinanceApiError && exc.status === 409) {
          await refetch(sheetRow, row.id);
          tally.refusals.push(
            `строка ${shown(sheetRow)}: её успели изменить — на экране свежие значения, повторите правку`,
          );
          return;
        }
        tally.refusals.push(
          `строка ${shown(sheetRow)}: ${exc instanceof Error ? exc.message : "правка не сохранилась"}`,
        );
        // Откат по месту. Оставить на экране значение, которое сервер не
        // принял, — значит показать цифру, которой нет в учёте.
        writeRow(sheetRow, row);
      }
    };

    const saveNew = async (sheetRow: number, tally: Tally) => {
      const cells = readRow(sheetRow);
      const filled = (key: string) => String(cells[key] ?? "").trim() !== "";
      if (!Object.keys(cells).some(filled)) return;
      // Пока строке не хватает данных, сервер не зовём: отказ после каждой
      // напечатанной ячейки читается как каприз, хотя человек просто ещё не
      // дописал. Говорим, чего не хватает, — ровным тоном, это не ошибка.
      const missing: string[] = [];
      if (!filled("paid_at")) missing.push("дата платежа");
      if (!filled("amount")) missing.push("сумма");
      if (!filled("account_from") && !filled("account_to"))
        missing.push("счёт: «Со счёта» — расход, «На счёт» — поступление");
      if (missing.length) {
        tally.missing = `строка ${shown(sheetRow)}: не хватает — ${missing.join(", ")}`;
        return;
      }
      busy.add(sheetRow);
      try {
        const out = await financeApi.addGridRow(cells);
        // Операция остаётся там, где её напечатали. Место по дате она займёт
        // при следующей сборке листа — как новая строка в Excel не прыгает
        // посреди ввода в середину таблицы.
        mine.rows.set(sheetRow, out.row);
        mine.ids.set(out.row.id, sheetRow);
        writeRow(sheetRow, out.row);
        tally.created += 1;
        tally.lastRow = sheetRow;
      } catch (exc) {
        tally.refusals.push(
          `строка ${shown(sheetRow)}: ${exc instanceof Error ? exc.message : "операция не заведена"}`,
        );
      } finally {
        busy.delete(sheetRow);
      }
    };

    // ── Живой режим: правки коллег (опрос — общий движок `univer/live.ts`) ──

    /** Первая пустая строка под журналом — туда встаёт операция коллеги. */
    const freeRow = (): number | null => {
      const limit = Number(active()?.getMaxRows?.() ?? mine.payload.rows.length + SPARE_ROWS + 1);
      for (let sheetRow = mine.payload.rows.length + 1; sheetRow < limit; sheetRow += 1) {
        if (mine.rows.has(sheetRow) || busy.has(sheetRow) || editingRow === sheetRow) continue;
        const cells = readRow(sheetRow);
        if (Object.values(cells).some((value) => String(value ?? "").trim() !== "")) continue;
        return sheetRow;
      }
      return null;
    };

    /** Строка коллеги новее той, что на экране, — записать; занята — отложить. */
    const place = (sheetRow: number, row: GridRow): boolean => {
      const known = mine.rows.get(sheetRow);
      if (known && known.version >= row.version) return false;
      if (busy.has(sheetRow) || editingRow === sheetRow) {
        deferred.set(sheetRow, row);
        return false;
      }
      mine.rows.set(sheetRow, row);
      writeRow(sheetRow, row);
      return true;
    };

    const applyRemote = (batch: { rows: GridRow[]; removed: string[] }) => {
      let changed = 0;
      let added = 0;
      let removed = 0;
      let overflow = 0;
      for (const row of batch.rows) {
        const at = mine.ids.get(row.id);
        if (at !== undefined) {
          if (place(at, row)) changed += 1;
          continue;
        }
        // Новая операция коллеги — в первую пустую строку внизу, как новая
        // операция, напечатанная здесь: место по дате она займёт при
        // следующей сборке листа, а не прыжком посреди чужого ввода.
        const free = freeRow();
        if (free === null) {
          overflow += 1;
          continue;
        }
        mine.rows.set(free, row);
        mine.ids.set(row.id, free);
        writeRow(free, row);
        added += 1;
      }
      for (const id of batch.removed) {
        const at = mine.ids.get(id);
        if (at === undefined) continue;
        mine.rows.delete(at);
        mine.ids.delete(id);
        deferred.delete(at);
        writeRow(at, null);
        removed += 1;
      }
      const parts: string[] = [];
      if (changed) parts.push(`изменено строк: ${changed}`);
      if (added) parts.push(`новых операций: ${added}`);
      if (removed) parts.push(`удалено: ${removed}`);
      if (overflow) parts.push(`ещё ${overflow} — пустых строк не хватило, «Перечитать» соберёт лист заново`);
      if (parts.length) {
        setBeat({ text: `Правки коллег: ${parts.join(" · ")}`, at: Date.now(), refusal: false });
        onChangedRef.current();
      }
    };

    const tick = async (): Promise<PollOutcome> => {
      try {
        const batch = await financeApi.gridChanges(mine.seq);
        if (!alive) return "stop";
        applyRemote(batch);
        mine.seq = Math.max(mine.seq, batch.seq);
        return "ok";
      } catch (exc) {
        // Вход потерян или раздел закрыли — опрашивать больше нечего.
        if (exc instanceof FinanceApiError && (exc.status === 401 || exc.status === 403)) return "stop";
        return "fail";
      }
    };
    const poller = pollWhileVisible(tick);
    disposers.push(() => poller.stop());

    // Права листа — общим корнем (`univer/protect.ts`). Строки не вставляются
    // и не удаляются (строка — адрес операции; новая заводится в пустой
    // строке внизу), колонки — тоже (их задаёт сервер); сортировка закрыта:
    // она перемешала бы строки на экране, а карта «строка → операция»
    // осталась бы прежней, и правка ушла бы в соседнюю операцию. Фильтр
    // строки не двигает — он открыт.
    void guardSheets(
      api,
      [
        {
          sheetId: SHEET_ID,
          guard: {
            name: "Журнал",
            readOnly: !canEditRef.current,
            allow: {
              insertRows: false,
              deleteRows: false,
              insertColumns: false,
              deleteColumns: false,
              sort: false,
              filter: true,
            },
            lockedColumns: columns.flatMap((column, index) => (column.editable ? [] : [index])),
            lockedRows: [HEADER_ROW],
          },
        },
      ],
      () => alive,
    ).then((cancel) => {
      if (alive) disposers.push(cancel);
      else cancel();
    });

    const apply = async (touched: Map<number, Set<number>>) => {
      const tally: Tally = { saved: 0, created: 0, lastRow: 0, refusals: [], missing: "" };
      const order = [...touched.keys()].sort((a, b) => a - b);
      const big = order.length > 20;
      for (const [position, sheetRow] of order.entries()) {
        if (big && position % 20 === 0) {
          setBeat({ text: `записываем строки: ${position} из ${order.length}`, at: Date.now(), refusal: false });
        }
        if (sheetRow === HEADER_ROW) {
          writeHeader();
          continue;
        }
        if (mine.rows.has(sheetRow)) {
          for (const index of [...(touched.get(sheetRow) ?? [])].sort((a, b) => a - b)) {
            await saveExisting(sheetRow, index, tally);
          }
        } else {
          await saveNew(sheetRow, tally);
        }
      }

      const done: string[] = [];
      if (tally.created === 1) done.push(`строка ${shown(tally.lastRow)}: операция заведена`);
      else if (tally.created > 1) done.push(`заведено операций: ${tally.created}`);
      if (tally.saved === 1 && !tally.created) done.push(`строка ${shown(tally.lastRow)}: записано`);
      else if (tally.saved > 1) done.push(`записано ячеек: ${tally.saved}`);

      if (tally.refusals.length) {
        const more = tally.refusals.length > 1 ? ` · ещё отказов: ${tally.refusals.length - 1}` : "";
        setBeat({
          text: [...done, tally.refusals[0] + more].join(" · "),
          at: Date.now(),
          refusal: true,
        });
      } else if (done.length) {
        setBeat({ text: done.join(" · "), at: Date.now(), refusal: false });
      } else if (tally.missing) {
        setBeat({ text: tally.missing, at: Date.now(), refusal: false });
      }
      if (tally.saved || tally.created) onChangedRef.current();
    };

    const values = api.addEvent?.(
      api.Event.SheetValueChanged,
      (event: {
        effectedRanges?: Array<{
          getRow: () => number;
          getColumn: () => number;
          getHeight?: () => number;
          getWidth?: () => number;
        }>;
      }) => {
        if (writing.current > 0) return;
        // Оформление — личный вид, а не правка операции.
        if (look.busy()) return;
        // Все ячейки всех затронутых диапазонов, а не левая верхняя. Вставка
        // столбца сумм из буфера приходит одним диапазоном; раньше из него
        // записывалась первая ячейка, а остальные оставались на экране и не
        // доходили до учёта.
        const touched = new Map<number, Set<number>>();
        for (const range of event.effectedRanges ?? []) {
          const top = range.getRow();
          const left = range.getColumn();
          const height = Math.max(1, range.getHeight?.() ?? 1);
          const width = Math.max(1, range.getWidth?.() ?? 1);
          for (let row = top; row < top + height; row += 1) {
            for (let column = left; column < Math.min(left + width, columns.length); column += 1) {
              if (!touched.has(row)) touched.set(row, new Set());
              touched.get(row)?.add(column);
            }
          }
        }
        if (!touched.size) return;
        queue.current = queue.current.then(() => apply(touched)).catch((exc) => {
          console.warn("правка листа не обработана:", exc);
        });
      },
    );
    if (values?.dispose) disposers.push(() => values.dispose());

    // Печать в ячейке со списком остаётся печатью (сервер узнаёт счёт и
    // статью по началу названия) — это делает общий корень листов.
    const edits = api.addEvent?.(api.Event.SheetEditStarted, (event: { row: number }) => {
      // Пока человек печатает в строке, правка коллеги её не перетирает —
      // она ждёт закрытия редактора (см. SheetEditEnded ниже).
      editingRow = event.row;
    });
    if (edits?.dispose) disposers.push(() => edits.dispose());

    const ended = api.addEvent?.(api.Event.SheetEditEnded, () => {
      // Значение из редактора ложится командой чуть позже события — даём ему
      // лечь и сохраниться, потом дописываем правки коллег, ждавшие этой
      // строки (если своя правка их не обогнала — версия решает).
      window.setTimeout(() => {
        editingRow = null;
        const waiting = [...deferred.entries()];
        deferred.clear();
        for (const [sheetRow, row] of waiting) place(sheetRow, row);
      }, 30);
    });
    if (ended?.dispose) disposers.push(() => ended.dispose());
    return () => disposers.forEach((stop) => stop());
  }, []);

  const workbook = useMemo(() => (sheet ? buildWorkbook(sheet.payload) : null), [sheet]);

  // «На весь экран» и тема — в общем корне листов (`univer/sheet.tsx`).
  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
          {error}
        </p>
      ) : null}
      <div className="fin-sheet" ref={box} style={{ height }}>
        {workbook ? (
          <UniverSheet
            key={`journal|${sheet?.generation ?? 0}|${remount}`}
            data={workbook}
            onReady={onReady}
            listEdit={false}
            formatting="look"
            session="journal"
          />
        ) : null}
      </div>
      {/* Строка состояния: таблица обязана говорить, что записала. Молчание
          после правки — это и есть сомнение «сохранилось ли». В покое пусто:
          место держим, текста не пишем. */}
      <div className="flex items-start gap-3">
        <p
          className="text-xs flex-1"
          role="status"
          style={{
            // Цвет — только отказу. «Записано» и «не хватает суммы» — ход работы.
            color: beat?.refusal ? "var(--accent-rose)" : "var(--text-secondary)",
            minHeight: "1.2em",
          }}
        >
          {beat ? beat.text : ""}
        </p>
        {keeper && !lookEmpty ? (
          <button
            type="button"
            className="btn-ghost text-xs"
            title="Ширины, цвета и перенос — ваши, коллеги их не видят"
            onClick={async () => {
              await keeper.reset();
              setRemount((value) => value + 1);
            }}
          >
            Сбросить мой вид
          </button>
        ) : null}
        <a className="btn-ghost text-xs" href={financeApi.exportJournalUrl({})} download>
          Скачать в Excel
        </a>
      </div>
    </div>
  );
}
