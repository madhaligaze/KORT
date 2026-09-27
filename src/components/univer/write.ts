/**
 * Запись в лист того, что знает сервер, — общая для всех таблиц продукта.
 *
 * Ответ сервера после правки и правки коллег из живого режима пишутся не
 * командой (`range.setValues`), а мутацией `sheet.mutation.set-range-values`:
 *
 * * **права её не проверяют.** Команду Univer сверяет с правами листа, и
 *   запись в колонку «только чтение» (вид, статус операции) была бы отрезана
 *   — хотя пишет не человек, а сервер;
 * * **её нет в «Отменить».** Ctrl+Z человека не должен откатывать правку
 *   коллеги или ответ сервера на свою же правку.
 *
 * `cells` — строка → колонка → ячейка Univer (`{ v, s, t }`); `null` чистит.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UniverApi = any;

export type CellMatrix = Record<number, Record<number, Record<string, unknown> | null>>;

export function writeCells(api: UniverApi, sheetId: string | null, cells: CellMatrix): boolean {
  const workbook = api.getActiveWorkbook?.();
  if (!workbook) return false;
  const unitId = workbook.getId?.();
  const subUnitId = sheetId ?? workbook.getActiveSheet?.()?.getSheetId?.();
  if (!unitId || !subUnitId) return false;
  const cellValue: Record<number, Record<number, Record<string, unknown>>> = {};
  for (const [row, columns] of Object.entries(cells)) {
    const line: Record<number, Record<string, unknown>> = {};
    for (const [column, cell] of Object.entries(columns)) {
      // Пустая ячейка — пустое значение и без оформления: иначе на месте
      // удалённой строки оставался бы серый текст «только чтение».
      line[Number(column)] = cell ?? { v: "", s: null };
    }
    cellValue[Number(row)] = line;
  }
  try {
    api.syncExecuteCommand("sheet.mutation.set-range-values", { unitId, subUnitId, cellValue });
    return true;
  } catch (exc) {
    console.warn("лист не принял запись:", exc);
    return false;
  }
}
