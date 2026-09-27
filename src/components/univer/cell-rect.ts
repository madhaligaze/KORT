/**
 * Где ячейка листа на экране — для слоёв поверх холста (стрелка списка,
 * вопрос реестра «опечатка или с даты»).
 *
 * Тот же расчёт, что у всплывающих слоёв самого Univer: координата ячейки на
 * холсте минус прокрутка, в масштабе, от угла холста.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UniverApi = any;

/** Прямоугольник ячейки в координатах окна; `visible: false` — ячейка вне видимой части листа. */
export type CellRect = { left: number; top: number; right: number; bottom: number; visible: boolean };

/** Холст листа — самый большой `canvas` внутри листа (у Univer их несколько). */
function canvasIn(host: HTMLElement | null): HTMLCanvasElement | null {
  let best: HTMLCanvasElement | null = null;
  let area = 0;
  for (const node of host?.querySelectorAll("canvas") ?? []) {
    const box = node.getBoundingClientRect();
    if (box.width * box.height > area) {
      area = box.width * box.height;
      best = node;
    }
  }
  return best;
}

/**
 * Прокрутка основной области листа в координатах холста — по состоянию
 * прокрутки и накопленным высотам строк и ширинам колонок.
 *
 * Подписка `onScroll` здесь не годится: связка листа запускается сразу после
 * создания книги, когда отрисовки ещё нет, и Univer тихо возвращает пустую
 * подписку. Прокрутка оставалась нулевой, слой вопроса реестра считал ячейку
 * суммы (колонка M, правее экрана) невидимой и закрывал вопрос в тот же кадр —
 * правка снималась, как по Esc, и человек видел, что сумма просто не меняется.
 */
function viewportScroll(ws: UniverApi): { x: number; y: number } {
  try {
    const state = ws.getScrollState?.() as
      | { sheetViewStartRow?: number; sheetViewStartColumn?: number; offsetX?: number; offsetY?: number }
      | undefined;
    const skeleton = ws.getSkeleton?.() as
      | { rowHeightAccumulation?: number[]; columnWidthAccumulation?: number[] }
      | undefined;
    const startRow = state?.sheetViewStartRow ?? 0;
    const startColumn = state?.sheetViewStartColumn ?? 0;
    const rowTop = startRow > 0 ? skeleton?.rowHeightAccumulation?.[startRow - 1] ?? 0 : 0;
    const columnLeft = startColumn > 0 ? skeleton?.columnWidthAccumulation?.[startColumn - 1] ?? 0 : 0;
    return { x: columnLeft + (state?.offsetX ?? 0), y: rowTop + (state?.offsetY ?? 0) };
  } catch {
    return { x: 0, y: 0 };
  }
}

/**
 * Ячейка активного листа на экране. `null` — лист не тот, что открыт, или
 * отрисовки ещё нет. `host` — узел, внутри которого Univer нарисовал лист.
 */
export function cellRect(api: UniverApi, host: HTMLElement | null, sheet: string, row: number, column: number): CellRect | null {
  const ws = api.getActiveWorkbook?.()?.getActiveSheet?.();
  if (!ws || ws.getSheetId() !== sheet) return null;
  const canvas = canvasIn(host);
  let cell: { startX: number; startY: number; endX: number; endY: number } | null = null;
  try {
    cell = ws.getRange(row, column, 1, 1).getCell?.() ?? null;
  } catch {
    cell = null;
  }
  if (!canvas || !cell) return null;
  const box = canvas.getBoundingClientRect();
  const cssWidth = parseFloat(canvas.style.width) || box.width;
  const zoom = Number(ws.getZoom?.() ?? 1) || 1;
  const scale = (box.width / cssWidth) * zoom;
  const scroll = viewportScroll(ws);
  const left = (cell.startX - scroll.x) * scale + box.left;
  const right = (cell.endX - scroll.x) * scale + box.left;
  const top = (cell.startY - scroll.y) * scale + box.top;
  const bottom = (cell.endY - scroll.y) * scale + box.top;
  let visible = bottom > box.top && top < box.bottom && right > box.left && left < box.right;
  try {
    const range = ws.getVisibleRange?.() as { startRow: number; endRow: number; startColumn: number; endColumn: number } | null;
    if (range) {
      visible = visible && row >= range.startRow && row <= range.endRow && column >= range.startColumn && column <= range.endColumn;
    }
  } catch {
    /* без видимого диапазона — по холсту */
  }
  return { left, top, right, bottom, visible };
}
