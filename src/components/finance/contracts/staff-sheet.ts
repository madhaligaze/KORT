/**
 * Лист «По сотрудникам» в табличном виде «Разовых» (28.09.2026: «блок по
 * сотрудникам вывести листом в табличном виде»).
 *
 * У юротдела BBC это два листа книги — «Сводка (общий) по сотрудникам» и
 * «Сводка (на исполн) по Сотр.»; здесь обе сводки на одном листе друг под
 * другом, как блоки реестра: название, шапка, строки, итог. Лист только для
 * чтения — это формулы, а не данные: цифры считает `staff.ts` из хранилища,
 * тот же подсчёт, что у таблиц в карточном виде. Правка договора, приход
 * сводки или чужая правка — лист переписывается по месту (`RegistryBinding`).
 */
import { HEADER_STYLE, PAPER, ROW_H } from "@/components/univer/columns";
import { MONEY_PATTERN, WHOLE_PATTERN } from "@/components/univer/sheet-model";

import { type StaffSource, type Tally, staffTable } from "@/components/finance/contracts/staff";
import { plural } from "@/components/finance/format";

/** Ключ листа в книге: не пересекается с ключами листов-отборов (у них нет «__»). */
export const STAFF_SHEET = "__staff";
export const STAFF_TITLE = "По сотрудникам";

type Style = Record<string, unknown>;
export type StaffCell = { v?: string | number; t?: number; s?: Style };
export type StaffMatrix = {
  cells: Record<number, Record<number, StaffCell>>;
  rows: number;
  cols: number;
  /** Отпечаток значений — лист переписывается, только если он поменялся. */
  sig: string;
};

const TITLE: Style = { bg: { rgb: PAPER.titleBg }, bl: 1, vt: 2 };
const TOTAL: Style = { bl: 1 };
const money = (value: number): Style => ({ n: { pattern: Number.isInteger(value) ? WHOLE_PATTERN : MONEY_PATTERN }, ht: 3 });
const COUNT: Style = { ht: 3 };

export const STAFF_WIDTHS = [220, 96, 96, 140, 140, 140, 140, 140, 140, 140, 140];

function text(value: string, style?: Style): StaffCell {
  return style ? { v: value, t: 1, s: style } : { v: value, t: 1 };
}

function num(value: number, style: Style): StaffCell {
  return { v: Math.round(value * 100) / 100, t: 2, s: style };
}

export function staffMatrix(source: StaffSource, book = "oneoff"): StaffMatrix {
  const table = staffTable(source, book);
  const cells: Record<number, Record<number, StaffCell>> = {};
  let row = 0;
  let cols = 5;
  const put = (line: (StaffCell | null)[]) => {
    const out: Record<number, StaffCell> = {};
    line.forEach((cell, column) => {
      if (cell) out[column] = cell;
    });
    if (Object.keys(out).length) cells[row] = out;
    cols = Math.max(cols, line.length);
    row += 1;
  };
  if (!table || !table.rows.length) {
    put([text("Договоров в книге пока нет")]);
    return { cells, rows: row, cols, sig: JSON.stringify(cells) };
  }
  const { rows, months, older, olderOf } = table;
  const total = (pick: (item: Tally) => number, list: Tally[] = rows) => list.reduce((sum, item) => sum + pick(item), 0);

  put([text(`Все договоры · ${rows.length} ${plural(rows.length, "человек", "человека", "человек")}`, TITLE)]);
  put(["Сотрудник", "Клиентов", "Договоров", "Сумма", "Остаток"].map((label) => text(label, HEADER_STYLE)));
  for (const item of rows) {
    put([
      text(item.name),
      num(item.clients.size, COUNT),
      num(item.contracts, COUNT),
      num(item.amount, money(item.amount)),
      num(item.remaining, money(item.remaining)),
    ]);
  }
  const amount = total((item) => item.amount);
  const remaining = total((item) => item.remaining);
  put([
    text("Итого", TOTAL),
    null,
    num(total((item) => item.contracts), { ...COUNT, ...TOTAL }),
    num(amount, { ...money(amount), ...TOTAL }),
    num(remaining, { ...money(remaining), ...TOTAL }),
  ]);
  put([]);

  const open = rows.filter((item) => item.openContracts > 0);
  put([text("На исполнении — по месяцу в сводке", TITLE)]);
  put(
    ["Сотрудник", "Клиентов", "Договоров", "Сумма", "Нет в сводке", ...(older ? ["Раньше"] : []), ...months.map((month) => month.toLowerCase())].map(
      (label) => text(label, HEADER_STYLE),
    ),
  );
  for (const item of open) {
    const none = item.byMonth.get("") ?? 0;
    const early = olderOf(item);
    put([
      text(item.name),
      num(item.openClients.size, COUNT),
      num(item.openContracts, COUNT),
      num(item.openAmount, money(item.openAmount)),
      num(none, money(none)),
      ...(older ? [num(early, money(early))] : []),
      ...months.map((month) => {
        const value = item.byMonth.get(month) ?? 0;
        return num(value, money(value));
      }),
    ]);
  }
  const openAmount = total((item) => item.openAmount, open);
  const none = total((item) => item.byMonth.get("") ?? 0, open);
  const early = total(olderOf, open);
  put([
    text("Итого", TOTAL),
    null,
    num(total((item) => item.openContracts, open), { ...COUNT, ...TOTAL }),
    num(openAmount, { ...money(openAmount), ...TOTAL }),
    num(none, { ...money(none), ...TOTAL }),
    ...(older ? [num(early, { ...money(early), ...TOTAL })] : []),
    ...months.map((month) => {
      const value = total((item) => item.byMonth.get(month) ?? 0, open);
      return num(value, { ...money(value), ...TOTAL });
    }),
  ]);
  return { cells, rows: row, cols, sig: JSON.stringify(cells) };
}

/** Лист для снимка книги Univer. */
export function staffSnapshot(matrix: StaffMatrix): Record<string, unknown> {
  const columnData: Record<number, { w: number }> = {};
  for (let column = 0; column < Math.max(matrix.cols, 6); column += 1) {
    columnData[column] = { w: STAFF_WIDTHS[column] ?? 140 };
  }
  return {
    id: STAFF_SHEET,
    name: STAFF_TITLE,
    rowCount: matrix.rows + 40,
    // С запасом: месяцы сводки добавляют колонки, а лист их не пересоздаёт.
    columnCount: Math.max(matrix.cols + 2, 12),
    defaultRowHeight: ROW_H,
    cellData: matrix.cells,
    columnData,
  };
}
