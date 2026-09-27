/**
 * Права листа — механизмом Univer, общим для всех таблиц продукта.
 *
 * Прятать кнопки бесполезно: спрятанная кнопка не мешает ни горячей
 * клавише, ни вставке из буфера. Запрещать надо самим Univer, и у него три
 * ловушки, найденные на листе реестра (сентябрь 2026):
 *
 * 1. **Точки прав ставятся только на защищённый лист.** С версии 0.25 без
 *    `protect()` каждая точка бросает «worksheet protection does not exist»,
 *    и лист молча остаётся открытым для вставки строк и колонок.
 * 2. **Защищённый лист заштрихован целиком** — косой сеткой поверх шапки и
 *    всех строк, хотя править в нём можно почти всё. Стратегию штриховки
 *    Univer читает при создании отрисовки, а меняет только у созданной:
 *    снимаем после того, как отрисовка есть, и ещё раз чуть позже.
 * 3. **Владельцу правила диапазона правка разрешена** — а владелец и есть
 *    вошедший. Запрет правки ставится точкой явно.
 *
 * Оформление ячеек не закрывается: Univer требует права на оформление для
 * любой вставки из буфера, даже «только значения».
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UniverApi = any;

export type SheetGuard = {
  /** Название защиты — Univer показывает его в своих подсказках. */
  name: string;
  /** Весь лист только для чтения — у того, кому правка раздела не открыта. */
  readOnly?: boolean;
  /** Что можно на листе; не названное — как у Univer по умолчанию (можно). */
  allow?: Partial<Record<"insertRows" | "deleteRows" | "insertColumns" | "deleteColumns" | "sort" | "filter", boolean>>;
  /** Колонки только для чтения — номера с нуля. */
  lockedColumns?: number[];
  /** Строки только для чтения — номера с нуля (например, шапка). */
  lockedRows?: number[];
};

function columnLetter(index: number): string {
  let out = "";
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    out = String.fromCharCode(65 + ((rest - 1) % 26)) + out;
  }
  return out;
}

/** Отрисовка листа создаётся позже книги — ждём её (до трёх секунд). */
async function waitRendered(api: UniverApi, alive: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 60 && alive(); attempt += 1) {
    try {
      if (api.getActiveWorkbook?.()?.getActiveSheet?.()?.getSkeleton?.()) return;
    } catch {
      /* отрисовки ещё нет */
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
}

function hideShade(api: UniverApi): void {
  try {
    api.setProtectedRangeShadowStrategy?.("none");
  } catch {
    /* старая версия без стратегии — штриховка останется */
  }
}

async function guardOne(api: UniverApi, sheet: UniverApi, guard: SheetGuard): Promise<void> {
  const point = api.Enum?.WorksheetPermissionPoint;
  const rangePoint = api.Enum?.RangePermissionPoint;
  const permission = sheet?.getWorksheetPermission?.();
  if (!point || !permission) return;
  if (!permission.isProtected?.()) {
    await permission.protect({ name: guard.name, allowViewByOthers: true });
  }
  if (guard.readOnly) {
    await permission.setReadOnly();
    return;
  }
  const allow = guard.allow ?? {};
  const points: Record<string, boolean> = {};
  const map: Record<string, string> = {
    insertRows: "InsertRow",
    deleteRows: "DeleteRow",
    insertColumns: "InsertColumn",
    deleteColumns: "DeleteColumn",
    sort: "Sort",
    filter: "Filter",
  };
  for (const [key, value] of Object.entries(allow)) {
    const name = map[key];
    if (name && point[name] !== undefined && value !== undefined) points[point[name]] = value;
  }
  await permission.applyConfig({ mode: "editable", points });

  const ranges: UniverApi[] = [];
  for (const column of guard.lockedColumns ?? []) {
    const letter = columnLetter(column);
    ranges.push(sheet.getRange(`${letter}:${letter}`));
  }
  const width = Math.max(1, Number(sheet.getMaxColumns?.() ?? 26));
  for (const row of guard.lockedRows ?? []) ranges.push(sheet.getRange(row, 0, 1, width));
  if (!ranges.length) return;
  const rules = await permission.protectRanges([{ ranges, options: { name: "Только чтение", allowViewByOthers: true } }]);
  for (const rule of rules ?? []) {
    if (rangePoint) await rule.setPoint?.(rangePoint.Edit, false);
  }
}

/**
 * Поставить права листам книги. `sheets` — лист по его id (или активный,
 * если id нет) и что на нём можно. Возвращает отмену отложенного снятия
 * штриховки — её зовут при размонтировании листа.
 */
export async function guardSheets(
  api: UniverApi,
  sheets: { sheetId?: string; guard: SheetGuard }[],
  alive: () => boolean = () => true,
): Promise<() => void> {
  const workbook = api.getActiveWorkbook?.();
  if (!workbook) return () => undefined;
  // Штриховку снимаем до защиты, иначе лист успевает показаться под ней.
  await waitRendered(api, alive);
  hideShade(api);
  for (const { sheetId, guard } of sheets) {
    if (!alive()) break;
    const sheet = sheetId ? workbook.getSheetBySheetId?.(sheetId) : workbook.getActiveSheet?.();
    try {
      await guardOne(api, sheet, guard);
    } catch (exc) {
      console.warn(`права листа «${guard.name}» не встали:`, exc);
    }
  }
  // Отрисовка могла доехать позже прав — снимаем штриховку ещё раз.
  const timer = window.setTimeout(() => alive() && hideShade(api), 600);
  return () => window.clearTimeout(timer);
}
