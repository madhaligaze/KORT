/**
 * Место на листе на время сессии — общее для всех таблиц продукта.
 *
 * Перезагрузка страницы возвращает лист туда же, где он был: тот же лист
 * книги, та же выбранная ячейка, та же прокрутка до пикселя и «На весь
 * экран», если лист был развёрнут. Хранится в `sessionStorage` через
 * `session-state.tsx` — живёт, пока открыта вкладка.
 *
 * Что не возвращается: текст, набранный в ячейке и ещё не принятый Enter.
 * Правка ячейки уходит на сервер по Enter, а открыть редактор Univer на
 * нужной ячейке с нужным текстом извне нельзя без его внутренностей.
 */
import { readSession, writeSession } from "@/components/session-state";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UniverApi = any;

type Place = { sheet: string; row: number; column: number; top: number; left: number; x: number; y: number; full: boolean };

const NOWHERE: Place = { sheet: "", row: -1, column: -1, top: 0, left: 0, x: 0, y: 0, full: false };

/** Команды, после которых место на листе поменялось. */
const MOVES = new Set([
  "sheet.operation.set-selections",
  "sheet.operation.set-scroll",
  "sheet.operation.set-worksheet-active",
]);

export type PlaceKeeper = {
  /** Вернуть лист на запомненное место; `true` — лист был развёрнут на весь экран. */
  restore: () => boolean;
  /** Запомнить сейчас (развернули, свернули). */
  save: () => void;
  stop: () => void;
};

export function keepPlace(api: UniverApi, scope: string, key: string, isFull: () => boolean): PlaceKeeper {
  const address = `sheet.${key}`;
  // Пока место не возвращено, не пишем: первая отрисовка стоит в начале листа
  // и затёрла бы запомненное.
  let ready = false;
  let timer = 0;

  const save = () => {
    if (!ready) return;
    try {
      const ws = api.getActiveWorkbook?.()?.getActiveSheet?.();
      if (!ws) return;
      const range = ws.getActiveRange?.();
      const scroll = (ws.getScrollState?.() ?? {}) as {
        sheetViewStartRow?: number;
        sheetViewStartColumn?: number;
        offsetX?: number;
        offsetY?: number;
      };
      const place: Place = {
        sheet: ws.getSheetId(),
        row: range?.getRow?.() ?? -1,
        column: range?.getColumn?.() ?? -1,
        top: scroll.sheetViewStartRow ?? 0,
        left: scroll.sheetViewStartColumn ?? 0,
        x: scroll.offsetX ?? 0,
        y: scroll.offsetY ?? 0,
        full: isFull(),
      };
      writeSession(scope, address, place);
    } catch {
      /* лист снимают — запомнится в следующий раз */
    }
  };
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(save, 200);
  };

  const listener = api.onCommandExecuted?.((command: { id: string }) => {
    if (MOVES.has(command.id)) later();
  });
  // Закрытие и перезагрузка вкладки: запомнить последнее, не дожидаясь таймера.
  window.addEventListener("pagehide", save);

  const restore = () => {
    const place = readSession(scope, address, NOWHERE);
    ready = true;
    if (!place.sheet) return false;
    try {
      const workbook = api.getActiveWorkbook?.();
      const target = workbook?.getSheetBySheetId?.(place.sheet);
      if (target && workbook.getActiveSheet?.()?.getSheetId?.() !== place.sheet) workbook.setActiveSheet(target);
      const ws = workbook?.getActiveSheet?.();
      if (!ws || ws.getSheetId() !== place.sheet) return place.full;
      const rows = Number(ws.getMaxRows?.() ?? 0);
      const columns = Number(ws.getMaxColumns?.() ?? 0);
      // Сначала выбор, потом прокрутка: выбор сам доводит лист до ячейки и
      // сбил бы точную прокрутку.
      if (place.row >= 0 && place.column >= 0 && place.row < rows && place.column < columns) {
        ws.getRange(place.row, place.column, 1, 1).activate?.();
      }
      api.syncExecuteCommand?.("sheet.command.scroll-view", {
        sheetViewStartRow: Math.max(0, Math.min(place.top, Math.max(0, rows - 1))),
        sheetViewStartColumn: Math.max(0, Math.min(place.left, Math.max(0, columns - 1))),
        offsetX: place.x,
        offsetY: place.y,
      });
    } catch {
      /* лист другой формы (пересобран с меньшим числом строк) — остаёмся в начале */
    }
    return place.full;
  };

  return {
    restore,
    save,
    stop: () => {
      save();
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", save);
      listener?.dispose?.();
    },
  };
}
