import { formatMoney, type JournalRecord } from "@/components/finance/api";

/**
 * Общее для «Записей», карточки и окна загрузки журнала: подписи сумм, дней,
 * месяцев и сторон записи - одними словами на всех трёх экранах.
 */

const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS_OF = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
export const MONTH_TITLES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

/** «2026-06-01» → «пн, 1 июня» - день журнала, как его называют вслух. */
export function dayTitle(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  const weekday = WEEKDAYS[new Date(year, month - 1, day).getDay()];
  return `${weekday}, ${day} ${MONTHS_OF[month - 1]}`;
}

/** «2026-06-01» → «01.06.2026» - так дату печатают в журнале и ждут в поле. */
export function dotted(iso: string): string {
  const [year, month, day] = (iso || "").split("-");
  return year && month && day ? `${day}.${month}.${year}` : iso || "";
}

/** «01.06.2026» → «2026-06-01»; непонятное - как есть (разберёт сервер). */
export function isoOf(text: string): string {
  const match = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/.exec(text.trim());
  if (!match) return text.trim();
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

/** «2026-06» → «Июнь 2026». */
export function monthTitle(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return year && month ? `${MONTH_TITLES[month - 1]} ${year}` : key;
}

/** «2026-07» → «июля 2026» - для «На 1 июля 2026». */
export function monthOf(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return year && month ? `${MONTHS_OF[month - 1]} ${year}` : key;
}

/** Сумма со знаком стороны: «+400 000,00», «−95 323,00», «⇄ 614 920,00». */
export function signed(kind: JournalRecord["kind"], amount: string): string {
  const sign = kind === "income" ? "+" : kind === "expense" ? "−" : "⇄";
  return `${sign} ${formatMoney(amount)}`;
}

/** Деньги без знака; пусто - «-». */
export function money(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "-";
  return formatMoney(value);
}

export const KIND_TITLES: Record<JournalRecord["kind"], string> = {
  income: "Приход",
  expense: "Расход",
  transfer: "Перевод",
};

/**
 * Чем запись «требует внимания» - коротко, для отбора над списком.
 * Порядок - по тому, что мешает свести месяц: без статьи свод не сходится,
 * без договора деньги не дошли до реестра.
 */
export const ATTENTION_TITLES: Record<string, string> = {
  uncategorized: "Без статьи",
  no_contract: "Поступления без договора",
  question: "С вопросом",
  half: "Перевод без второй стороны",
  split: "Дробление",
};

/** Счёт записи для строки списка: у перевода - откуда и куда. */
export function placeOf(record: JournalRecord): string {
  if (record.kind === "income") return record.account_to;
  if (record.kind === "expense") return record.account_from;
  if (record.account_from && record.account_to) return `${record.account_from} → ${record.account_to}`;
  return record.account_to ? `→ ${record.account_to}` : `${record.account_from} →`;
}

/** Строка списка открывается по Enter и пробелу, как кнопка. */
export function activates(event: { key: string }): boolean {
  return event.key === "Enter" || event.key === " ";
}
