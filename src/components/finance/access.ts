import type { AccessLevel, Me } from "@/components/finance/api";

/**
 * Права на клиенте: только показать. Держит их сервер.
 *
 * Клиент прячет то, что человеку не открыто (пункты колонки, кнопки правки),
 * чтобы не предлагать дверей, которые ответят 403. Решает всё равно сервер:
 * скрытое поле договора не приходит вовсе, и здесь для полей логики нет.
 *
 * Если сервер ещё старый и `access` не прислал, права выводятся из прежних
 * способностей: `read` — видит всё, `write` — правит учёт.
 */
const RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };

export function isAdmin(me: Me | null | undefined): boolean {
  const role = me?.role ?? me?.company?.role;
  return role === "owner" || role === "admin";
}

export function isOwner(me: Me | null | undefined): boolean {
  return (me?.role ?? me?.company?.role) === "owner";
}

export function levelOf(me: Me | null | undefined, resource: string): AccessLevel {
  if (!me) return "none";
  const known = me.access?.[resource];
  if (known) return known;
  if (me.access) return "none";
  if (isAdmin(me)) return "edit";
  const abilities = me.abilities ?? [];
  if (resource === "people") return abilities.includes("people") ? "edit" : "none";
  if (resource === "audit") return abilities.includes("people") ? "view" : "none";
  if (abilities.includes("write")) return "edit";
  return abilities.includes("read") ? "view" : "none";
}

export function can(me: Me | null | undefined, resource: string, level: AccessLevel = "view"): boolean {
  return RANK[levelOf(me, resource)] >= RANK[level];
}

export function canAny(me: Me | null | undefined, resources: readonly string[], level: AccessLevel = "view"): boolean {
  return resources.some((resource) => can(me, resource, level));
}

/** Разделы с деньгами: им нужны сводка и справочники (счета, статьи). */
export const MONEY_RESOURCES = [
  "journal",
  "table",
  "calendar",
  "invoices",
  "recurrences",
  "import",
  "sheets",
  "reports.cash",
  "reports.profit",
  "reports.debts",
  "reports.balance",
  "reports.indicators",
  "reports.statement",
  "reports.projects",
  "reports.plan",
  "integrations",
  "rules",
  "dictionaries",
] as const;

/** Разделы прав в порядке колонки — зеркало `RESOURCES` из `app/finance/access.py`. */
export const RESOURCE_TITLES: { key: string; title: string; note?: string }[] = [
  { key: "contracts", title: "Договоры" },
  { key: "journal", title: "Журнал", note: "весь журнал" },
  { key: "table", title: "Таблица", note: "весь журнал" },
  { key: "calendar", title: "Календарь" },
  { key: "invoices", title: "Счета" },
  { key: "recurrences", title: "Повторения" },
  { key: "import", title: "Загрузка" },
  { key: "sheets", title: "Книги Google" },
  { key: "reports.summary", title: "Остатки и долги", note: "колонка слева" },
  { key: "reports.cash", title: "Деньги" },
  { key: "reports.profit", title: "Прибыль" },
  { key: "reports.debts", title: "Долги" },
  { key: "reports.balance", title: "Баланс" },
  { key: "reports.indicators", title: "Показатели" },
  { key: "reports.statement", title: "Выписка по счёту" },
  { key: "reports.projects", title: "Проекты" },
  { key: "reports.plan", title: "План/Факт" },
  { key: "integrations", title: "Подключения" },
  { key: "rules", title: "Автоправила" },
  { key: "dictionaries", title: "Справочники и счета" },
  { key: "people", title: "Сотрудники и права" },
  { key: "audit", title: "Журнал действий" },
];

/** Имя человека: из записи сотрудника, иначе из учётки, иначе логин. */
export function nameOf(me: Me | null | undefined): string {
  return (
    me?.employee?.full_name?.trim() ||
    me?.user?.full_name?.trim() ||
    me?.user?.email ||
    me?.user?.phone ||
    ""
  );
}
