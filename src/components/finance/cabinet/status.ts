import type { EmployeeRow, MemberRole } from "@/components/finance/api";
import { formatTime } from "@/components/finance/format";

/**
 * Статус учётки словами (фронт-план, 6.9).
 *
 * **Без рода.** «Был», «забыл», «заблокирована» требуют знать пол, а его нет
 * ни в учётке, ни в плане, и по имени он не угадывается. Поэтому фразы
 * построены так, чтобы род был не нужен: «в системе 2 ч назад», «просит
 * сбросить пароль», «вход заблокирован».
 *
 * **Цвет — только у отказа.** Неверные пароли подряд — роза (возможный
 * перебор); истёкшее окно пароля — янтарь (ждёт действия, но не отказ);
 * «вход заблокирован» — вес без цвета: это решение администратора.
 */
export type Tone = "" | "fail" | "wait" | "strong";

export type Status = { text: string; tone: Tone; rank: number };

/** Сколько «в системе» держится после последнего запроса сеанса. */
const ONLINE_MS = 5 * 60 * 1000;

function dayMonth(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** «26.09, 18:40». */
export function stamp(iso: string | null | undefined): string {
  if (!iso) return "";
  return `${dayMonth(iso)}, ${formatTime(iso)}`;
}

/** «14:02» сегодня, «вчера, 14:02», «12.09, 14:02» раньше. */
export function when(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const date = new Date(iso);
  const today = new Date(now);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(date, today)) return formatTime(iso);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (same(date, yesterday)) return `вчера, ${formatTime(iso)}`;
  return stamp(iso);
}

/**
 * Относительное время (фронт-план, 8 `relativeTime`): «только что» ·
 * «N мин назад» · «N ч назад» (до суток) · «вчера в 14:02» · «12.09 в 14:02» ·
 * дальше года — «12.09.2025».
 */
export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const date = new Date(iso);
  const ms = now - date.getTime();
  if (!Number.isFinite(ms)) return "";
  if (ms < 60000) return "только что";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const today = new Date(now);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return `вчера в ${formatTime(iso)}`;
  }
  if (ms > 365 * 86400000) {
    return `${dayMonth(iso)}.${date.getFullYear()}`;
  }
  return `${dayMonth(iso)} в ${formatTime(iso)}`;
}

export function employeeStatus(row: EmployeeRow, now = Date.now()): Status {
  const locked = row.requests.find((item) => item.kind === "login_locked");
  if (locked) return { text: `5 неверных паролей · ${when(locked.created_at, now)}`, tone: "fail", rank: 0 };
  const reset = row.requests.find((item) => item.kind === "password_reset_requested");
  if (reset) return { text: `просит сбросить пароль · ${when(reset.created_at, now)}`, tone: "strong", rank: 1 };
  const account = row.account;
  switch (row.status) {
    case "active": {
      // «Был в сети» живёт в сеансе, а «Выйти» сеанс удаляет: после выхода
      // человек, который входил вчера, показывался «входа ещё не было».
      // Последний вход хранится в учётке и переживает выход.
      const live = account?.last_seen_at ?? null;
      if (live && now - new Date(live).getTime() < ONLINE_MS) return { text: "в системе", tone: "", rank: 2 };
      const seen = latest(live, account?.last_login_at ?? null);
      if (seen) return { text: `в системе ${ago(seen, now)}`, tone: "", rank: 3 };
      return { text: "входа ещё не было", tone: "", rank: 3 };
    }
    case "pending":
      return { text: `ждёт пароль до ${stamp(account?.pending_until)}`, tone: "", rank: 4 };
    case "pending_expired":
      return { text: "окно пароля истекло", tone: "wait", rank: 5 };
    case "blocked":
      return { text: "вход заблокирован", tone: "strong", rank: 7 };
    default:
      return { text: "без доступа", tone: "", rank: 6 };
  }
}

function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/** Время последнего входа для порядка внутри «в системе». */
export function seenAt(row: EmployeeRow): number {
  const seen = latest(row.account?.last_seen_at ?? null, row.account?.last_login_at ?? null);
  return seen ? new Date(seen).getTime() : 0;
}

/** Порядок — это сообщение: запросы, в системе, остальные по давности входа, ждущие, без доступа, закрытые. */
export function sortPeople(rows: EmployeeRow[], now = Date.now()): EmployeeRow[] {
  return rows
    .map((row) => ({ row, status: employeeStatus(row, now) }))
    .sort((a, b) => {
      if (a.status.rank !== b.status.rank) return a.status.rank - b.status.rank;
      if (a.status.rank === 3) return seenAt(b.row) - seenAt(a.row);
      return a.row.full_name.localeCompare(b.row.full_name, "ru");
    })
    .map((item) => item.row);
}

export const ROLE_TITLES: Record<MemberRole, string> = {
  owner: "владелец",
  admin: "администратор",
  employee: "сотрудник",
};

/** «Chrome на Windows» из строки браузера. */
export function deviceOf(agent: string | null | undefined): string {
  const text = agent ?? "";
  if (!text) return "неизвестное устройство";
  const browser = /Edg\//.test(text)
    ? "Edge"
    : /OPR\/|Opera/.test(text)
      ? "Opera"
      : /YaBrowser/.test(text)
        ? "Яндекс Браузер"
        : /Firefox\//.test(text)
          ? "Firefox"
          : /Chrome\//.test(text)
            ? "Chrome"
            : /Safari\//.test(text)
              ? "Safari"
              : /HeadlessChrome/.test(text)
                ? "Chrome"
                : "";
  const system = /Windows/.test(text)
    ? "Windows"
    : /iPhone/.test(text)
      ? "iPhone"
      : /iPad/.test(text)
        ? "iPad"
      : /Android/.test(text)
        ? "Android"
        : /Mac OS X|Macintosh/.test(text)
          ? "macOS"
          : /Linux/.test(text)
            ? "Linux"
            : "";
  if (browser && system) return `${browser} на ${system}`;
  return browser || system || "неизвестное устройство";
}
