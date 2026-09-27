/**
 * Общая арифметика листов Univer: даты номером дня Excel, форматы с русской
 * локалью в образце, ширины колонок из файла, цвета строкой.
 *
 * Модуль чистый — ни сети, ни Univer, ни React. Его берут «Книги», журнал
 * «Финансов» и реестр договоров; раньше он жил в `books/`, и «Финансам»
 * приходилось тянуть чужой раздел ради двух функций дат. Раздел, который могут
 * снести, не должен держать общий код.
 */

/**
 * Префикс `[$-419]` — русская локаль ПРЯМО В ОБРАЗЦЕ формата.
 *
 * Движок форматов Univer берёт локаль не из книги, а из самого образца. Без
 * префикса тот же `#,##0.00` даёт «95,323.00» вместо «95 323,00»: цифры на
 * месте, а разделители чужие — худший вид расхождения, потому что число
 * выглядит правильным. То же правило и по той же причине применяет импорт из
 * Google (`app/webexcel/univer.py`).
 */
export const RU = "[$-419]";

export const MONEY_PATTERN = `${RU}#,##0.00`;
/** Сумма без копеек — у абонентского договора «250 000,00» читается как шум. */
export const WHOLE_PATTERN = `${RU}#,##0`;
export const DATE_PATTERN = `${RU}DD.MM.YYYY`;

/**
 * `WrapStrategy.CLIP` — значение не выходит за свою колонку. Стандарт ячеек
 * листов с данными (реестр, журнал), в стиль каждой ячейки со значением.
 *
 * Без него два дефекта. Univer, как Excel, выпускает текст в пустую соседнюю
 * ячейку — хвост «Предмета доп. соглашения» читался значением «Даты
 * расторжения». А ячейку со списком без явного способа он переносит по словам
 * (`tb ?? WRAP` в проверке данных): «TOO Nomad and KO (Номад и Ко)» двумя
 * строками в строке высотой 24, срезанное сверху. Способ Univer читает только
 * из стиля самой ячейки — стиль колонки или строки его не задаёт.
 */
export const WRAP_CLIP = 2;

/**
 * Дата → порядковый номер дня, как их считает Excel: сутки от 30 декабря 1899.
 *
 * Отдавать дату строкой нельзя. Строка в таблице — текст: она не отсортируется
 * по времени, не встанет в формулу и покажется как «2026-06-01» вместо
 * «01.06.2026». Ровно это и было видно на первой же собранной книге.
 *
 * Обе точки берутся полночью по UTC, и разница между ними — целое число
 * суток. Часовой пояс сюда не входит вовсе, поэтому и защищаться от него не
 * нужно. Первая попытка всё же защищалась — брала полдень «на всякий случай»,
 * — и получала ровно половину суток сверху, которую `Math.round` округлял
 * вверх. Вся книга сдвинулась на день вперёд: `2026-06-01` показывалось как
 * `02.06.2026`. Заметить это можно было только сверив с исходной книгой, и
 * никакой ошибки при этом не возникало.
 */
const EPOCH = Date.UTC(1899, 11, 30);

export function serialOf(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const at = Date.UTC(Number(year), Number(month) - 1, Number(day));
  if (!Number.isFinite(at)) return null;
  return Math.round((at - EPOCH) / 86400000);
}

/** Порядковый номер дня Excel → `ГГГГ-ММ-ДД`. */
export function dateOf(serial: number): string {
  const at = new Date(EPOCH + Math.round(serial) * 86400000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/**
 * Ширина колонки из файла Excel (в «символах») → пиксели листа.
 *
 * Excel хранит ширину числом знаков шрифта по умолчанию: 8,43 — это 64
 * пикселя. Формула та же, что у самого Excel для Calibri 11: семь пикселей на
 * знак и пять на поля. Без перевода лист реестра, собранный по шапке файла,
 * получил бы колонки шириной в двадцать пикселей.
 */
export function excelWidthPx(width: number | null | undefined, fallback: number): number {
  if (typeof width !== "number" || !Number.isFinite(width) || width <= 0) return fallback;
  return Math.max(28, Math.round(width * 7 + 5));
}

/** Текст ячейки Univer: значение или строка богатого текста без хвостового перевода строки. */
export function textOfCell(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell !== "object") return String(cell);
  const data = cell as { v?: unknown; p?: { body?: { dataStream?: string } } | null };
  if (data.v !== null && data.v !== undefined && data.v !== "") return String(data.v);
  const stream = data.p?.body?.dataStream;
  return typeof stream === "string" ? stream.replace(/[\r\n]+$/, "") : "";
}

// ── Цвета ────────────────────────────────────────────────────────────────────

let probe: CanvasRenderingContext2D | null = null;

/** Любой цвет CSS → `#rrggbb`. Univer берёт цвета строкой, токен ему не передать. */
export function toHex(value: string, fallback: string): string {
  const text = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`.toLowerCase();
  }
  if (typeof document === "undefined" || !text) return fallback;
  try {
    probe ??= document.createElement("canvas").getContext("2d");
    if (!probe) return fallback;
    probe.fillStyle = "#000000";
    probe.fillStyle = text;
    const normalized = String(probe.fillStyle);
    if (normalized.startsWith("#")) return normalized.toLowerCase();
    // rgba(...) — полупрозрачный токен: кладём на белую бумагу листа.
    const parts = /rgba?\(([^)]+)\)/.exec(normalized)?.[1].split(",").map((item) => Number(item.trim()));
    if (!parts || parts.length < 3) return fallback;
    const alpha = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
    const mix = (channel: number) => Math.round(channel * alpha + 255 * (1 - alpha));
    return `#${[parts[0], parts[1], parts[2]].map((c) => mix(c).toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return fallback;
  }
}

/** Значение токена CSS цветом `#rrggbb`. */
export function cssHex(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  return raw ? toHex(raw, fallback) : fallback;
}

/**
 * Тёмная тема Univer перекрашивает каждый цвет ячейки матрицей
 * (`invertColorByMatrix` в `@univerjs/core`). Матрица почти обратна сама себе,
 * поэтому, чтобы на тёмном холсте встал ровно цвет токена тёмной темы, его
 * надо отдать Univer уже перевёрнутым той же матрицей.
 */
export function invertLikeUniver(hex: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return hex;
  const [r, g, b] = [match[1], match[2], match[3]].map((part) => parseInt(part, 16) / 255);
  const sum = (r + g + b) * 0.667;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return `#${[1 + r - sum, 1 + g - sum, 1 + b - sum]
    .map((value) => Math.round(clamp(value) * 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Тёмная ли сейчас тема приложения (атрибут `data-theme` у `<html>`). */
export function isDarkTheme(): boolean {
  if (typeof document === "undefined") return false;
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
}
