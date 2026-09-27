/**
 * Протокол разбора Excel: форма пунктов отчёта и решений.
 *
 * Отчёт строит сервер (`importer.report`), и каждое решение пересчитывает
 * его целиком: здесь нет своей логики «что заведётся» — только чтение того,
 * что сервер уже посчитал, и запись решений в том виде, в каком их ждёт
 * `importer.decide`.
 */
import type { ContractImportBatch, ContractImportSection, ViewFilter } from "@/components/finance/api";

export type Decisions = Record<string, unknown>;
export type Decide = (patch: Decisions) => void;
export type Report = ContractImportBatch["report"];

/** Порядок пунктов протокола — порядок `importer.report`. */
export const SECTION_KEYS = [
  "blocks", "columns", "entities", "statuses", "end_dates", "numbers", "orphans", "diffs", "rules",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export type Roles = { executor?: string; customer?: string; order?: ("executor" | "customer")[] };

export type BlockItem = {
  id: string;
  sheet: string;
  title: string;
  rows: number;
  header_row: number;
  roles: Roles;
  main: boolean;
};

export type ColumnDecision =
  | { action: "field"; field: string }
  | { action: "custom"; title: string; type: string }
  | { action: "note" }
  | { action: "skip" }
  | { action: "ask" };

export type ColumnItem = {
  id: string;
  index: number;
  letter: string;
  header: string;
  key: string | null;
  how: string;
  candidates: string[];
  samples: string[];
  filled: number;
  width: number | null;
  decision: ColumnDecision;
};

export type ColumnsBlock = { block: string; sheet: string; title: string; roles: Roles; columns: ColumnItem[] };

export type EntityItem = { key: string; names: string[]; executor: number; customer: number; own: boolean; known: string | null };
export type SimilarGroup = { keys: string[]; names: string[] };

export type StatusItem = {
  field: "status" | "type" | "department";
  value: string;
  count: number;
  known: boolean;
  meaning: Record<string, unknown>;
  odd: boolean;
};

export type EndDateItem = { ref: string; number: unknown; customer: unknown; status: unknown; type: unknown; end_date: unknown };
export type NumberItem = { number: string; contracts: number; refs: string[] };
export type OrphanItem = {
  ref: string;
  block: string;
  number: unknown;
  executor: unknown;
  customer: unknown;
  create: boolean;
  existing: string | null;
};
/**
 * Строка листа, сведённая с главным не по полному ключу (номер + обе стороны).
 * `kind`: `swapped` — те же стороны, но переставлены; `number_party` — номер и
 * одна общая внешняя сторона; `number` — только номер, и «это он» сказал
 * человек. У пар из `number_only` (тот же номер без общей стороны) `kind` нет:
 * они заводятся отдельно, пока человек не скажет «это он».
 */
export type LooseItem = {
  ref: string;
  main: string;
  number: unknown;
  sheet_customer: unknown;
  sheet_executor: unknown;
  main_customer: unknown;
  main_executor: unknown;
  kind?: "swapped" | "number_party" | "number";
};
export type DiffItem = {
  id: string;
  main_ref: string;
  sheet_ref: string;
  field: string;
  title: string;
  main: unknown;
  sheet: unknown;
  number: unknown;
  customer: unknown;
  take: "main" | "sheet";
};
export type Brief = { ref: string; number: unknown; customer: unknown; executor: unknown; type: unknown; subject: unknown };
export type RuleAction = "accept" | "rule" | "empty";

/**
 * Правило блока другого листа. `source`: `suggested` — предложено и ещё не
 * принято; `accepted` — принято как есть; `manual` — своё; `empty` — блок
 * оставлен пустым (пустое правило неглавного листа не отбирает ничего).
 * `needs_decision` — предложенное правило приносит лишних или теряет строк
 * больше `limit`, и без человека «Завести» не пустит; `reason` — почему.
 */
export type RuleItem = {
  block: string;
  sheet: string;
  title: string;
  filter: ViewFilter;
  sentence: string;
  source: "suggested" | "accepted" | "manual" | "empty";
  decision: RuleAction | null;
  needs_decision: boolean;
  reason: string;
  limit: number;
  in_sheet: number;
  caught: number;
  extra: number;
  missing_count: number;
  missing: Brief[];
  extra_sample: Brief[];
};

/** Поля, по которым разбор умеет проверить правило на строках файла (`importer.RULE_CONDITION_OPS`). */
export const RULE_LIST_FIELDS = ["type", "subject", "department", "status"] as const;
export const RULE_FLAG_FIELDS = ["executor_is_own", "customer_is_own"] as const;
export const RULE_FIELD_WORDS: Record<string, string> = {
  type: "вид",
  subject: "предмет",
  department: "отдел",
  status: "статус",
  executor_is_own: "исполнитель — наше юрлицо",
  customer_is_own: "заказчик — наше юрлицо",
};

export function sectionOf(report: Report, key: SectionKey): ContractImportSection | undefined {
  return report.sections.find((section) => section.key === key);
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Слить решения так же, как сливает сервер: словарь — поверх словаря на один
 * уровень, всё остальное заменяется. Поэтому очередь из нескольких правок,
 * отправленная одним запросом, даёт тот же итог, что и отправленная по одной.
 */
export function mergeDecisions(base: Decisions, patch: Decisions): Decisions {
  const out: Decisions = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const previous = out[key];
    out[key] = isPlain(value) && isPlain(previous) ? { ...previous, ...value } : value;
  }
  return out;
}

export function dictOf<T = unknown>(decisions: Decisions, key: string): Record<string, T> {
  const value = decisions[key];
  return isPlain(value) ? (value as Record<string, T>) : {};
}

/** Значение ячейки файла строкой: числа и даты приходят как есть. */
export function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

/** «2026-06-08» → «08.06.2026»; остальное — как в файле («12q» так и остаётся). */
export function cellDate(value: unknown): string {
  const raw = text(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return iso ? `${iso[3]}.${iso[2]}.${iso[1]}` : raw;
}

/** «Исполнитель ГК!39» → «Исполнитель ГК», «39». */
export function splitRef(ref: string): { sheet: string; line: string } {
  const at = ref.lastIndexOf("!");
  return at < 0 ? { sheet: ref, line: "" } : { sheet: ref.slice(0, at), line: ref.slice(at + 1) };
}

/** Название блока для людей: «Прочие договоры · АРЕНДА»; блок, названный как лист, — одним словом. */
export function blockLabel(sheet: string, title: string): string {
  return title && title.trim().toLowerCase() !== sheet.trim().toLowerCase() ? `${sheet} · ${title}` : sheet;
}

/** Первая по порядку колонок сторона — заказчик: стороны в файле стоят наоборот. */
export function isReversed(roles: Roles): boolean {
  return roles.order?.[0] === "customer";
}

// ── Смыслы списков: подписи для людей ────────────────────────────────────────

export const PHASE_LABELS: Record<string, string> = {
  draft: "черновик",
  active: "действует",
  in_progress: "на исполнении",
  suspended: "приостановлен",
  fulfilled: "исполнен",
  terminated: "расторгнут",
  failed: "не состоялся",
};

export const BILLING_LABELS: Record<string, string> = {
  month: "в месяц",
  total: "вся сумма",
  terms: "условие текстом",
};

export const ECONOMIC_LABELS: Record<string, string> = {
  revenue: "выручка",
  expense: "расход",
  financing: "финансирование",
  intra_group: "внутри группы",
};

/** Типы своего поля — те, что умеет `setup.add_field`. */
export const CUSTOM_TYPES: { value: string; label: string }[] = [
  { value: "text", label: "текст" },
  { value: "number", label: "число" },
  { value: "money", label: "деньги" },
  { value: "date", label: "дата" },
  { value: "bool", label: "да/нет" },
  { value: "list", label: "список" },
  { value: "url", label: "ссылка" },
];
