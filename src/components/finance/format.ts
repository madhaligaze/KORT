/**
 * Набор текста «Финансов»: склонения, даты, короткие имена, деньги договоров.
 *
 * Правила — раздел 2.4 фронт-плана: деньги через `formatMoney` (узкий
 * неразрывный пробел), даты `дд.мм.гггг`, имя в списках — «Фамилия И.»,
 * заглавные буквы в своих подписях не используются.
 */
import { formatMoney } from "@/components/finance/api";

/** Склонение по числу: 1 договор, 2 договора, 5 договоров. */
export function plural(count: number, one: string, few: string, many: string): string {
  const tail100 = Math.abs(count) % 100;
  if (tail100 >= 11 && tail100 <= 14) return many;
  const tail = tail100 % 10;
  if (tail === 1) return one;
  if (tail >= 2 && tail <= 4) return few;
  return many;
}

/** «2026-07-15» → «15.07.2026». Пусто — пусто. */
export function formatDay(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "";
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return iso;
  return `${day}.${month}.${year}`;
}

/** «15.07.2026», «15.07.26», «2026-07-15» → ISO; не дата — null. */
export function parseDay(text: string): string | null {
  const clean = text.trim();
  if (!clean) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean);
  if (iso) return clean;
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(clean);
  if (!dmy) return null;
  let year = Number(dmy[3]);
  if (year < 100) year += year < 70 ? 2000 : 1900;
  const month = Number(dmy[2]);
  const day = Number(dmy[1]);
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Время «14:07» из ISO. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** «Сегодня», «Вчера», «12 сентября» — заголовок дня в истории. */
export function dayTitle(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  const today = new Date();
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(date, today)) return "Сегодня";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (same(date, yesterday)) return "Вчера";
  const months = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];
  const year = date.getFullYear() !== today.getFullYear() ? ` ${date.getFullYear()}` : "";
  return `${date.getDate()} ${months[date.getMonth()]}${year}`;
}

/** «Жумабекова Динара» → «Жумабекова Д.»; одно слово остаётся как есть. */
export function shortName(full: string | null | undefined): string {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts[0]} ${parts[1][0]}.`;
}

/** Сумма договора без копеек, если их нет: реестр читают по разрядам, но
 *  «250 000,00» у абонентского договора — шум. */
export function contractMoney(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return formatMoney(number, { whole: Number.isInteger(number) });
}

/** Номер договора в столбце: ведущий «№» срезается — он уже в шапке. */
export function bareNumber(number: unknown): string {
  return String(number ?? "").replace(/^\s*№\s*/, "").trim();
}

/** Адрес с многоточием в середине: «bitrix24.kz/…/4411». */
export function middleEllipsis(text: string, max = 40): string {
  const clean = text.replace(/^https?:\/\//, "");
  if (clean.length <= max) return clean;
  const head = Math.ceil((max - 1) * 0.55);
  const tail = max - 1 - head;
  return `${clean.slice(0, head)}…${clean.slice(clean.length - tail)}`;
}
