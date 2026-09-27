/**
 * Слова настройки реестра: типы полей, фазы статусов, начисление, смыслы.
 *
 * Ключи — те, что держит сервер (`models.py`: STATUS_PHASES, BILLING_KINDS,
 * ECONOMIC_ROLES; `setup.py`: CUSTOM_TYPES). Подписи — строчными: это части
 * фразы и пометки `{ деньги }`, а не заголовки.
 */
import type { Contract, FieldFill, FieldType, RegistrySchema } from "@/components/finance/api";

export const TYPE_WORDS: Record<FieldType, string> = {
  text: "текст",
  number: "число",
  money: "деньги",
  date: "дата",
  bool: "да или нет",
  list: "список",
  multi_list: "несколько из списка",
  url: "ссылка",
  person: "сотрудник",
  party: "сторона",
  department: "отдел",
  choice: "выбор",
};

/**
 * Способ заполнения поля — как его заполняют в листе и карточке. Подпись
 * зависит от типа: у стороны «список» — это наши юрлица, у сотрудника —
 * справочник людей из личного кабинета.
 */
export function fillWord(type: FieldType, fill: FieldFill): string {
  if (type === "party") return fill === "own" ? "только наши юрлица" : "любая сторона";
  if (type === "person") return fill === "list" ? "только из сотрудников" : "сотрудник или новый";
  return fill === "list" ? "только из списка" : "список или своё";
}

/** Типы, которые можно дать своему полю. `party` и `choice` — только системные. */
export const CUSTOM_TYPES: FieldType[] = [
  "text", "number", "money", "date", "bool", "list", "multi_list", "url", "person", "department",
];

export const PHASE_WORDS: Record<string, string> = {
  draft: "проект",
  active: "действует",
  in_progress: "на исполнении",
  suspended: "приостановлен",
  fulfilled: "исполнен",
  terminated: "расторгнут",
  failed: "не состоялся",
};

export const BILLING_WORDS: Record<string, string> = {
  month: "в месяц",
  total: "вся сумма",
  terms: "условие",
};

export const ECONOMIC_WORDS: Record<string, string> = {
  revenue: "выручка",
  expense: "расход",
  financing: "финансирование",
  intra_group: "внутри группы",
};

/** Списки со своими значениями: системные четыре и свои поля-списки. */
export const SYSTEM_LISTS = ["status", "type", "subject", "economic_role"];

/**
 * «Вид услуги» → «вид услуги» для середины фразы. Аббревиатуру («НДС», «БИН»)
 * не трогаем: «нДС» читается как опечатка.
 */
export function lowerFirst(text: string): string {
  if (text.length > 1 && text[1] === text[1].toUpperCase() && text[1] !== text[1].toLowerCase()) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** Есть ли у договора значение поля: пустая строка и пустой список — не значение. */
export function hasValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Сколько договоров держат это значение списка. Считается по хранилищу, без запроса. */
export function countByValue(contracts: Iterable<Contract>, field: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const contract of contracts) {
    if (contract.deleted) continue;
    const raw = contract.values[field];
    const ids = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
    for (const id of ids) counts.set(String(id), (counts.get(String(id)) ?? 0) + 1);
  }
  return counts;
}

/** Счёт «Kaspi Business ·4410»: хвост номера, по которому счёт узнают глазами. */
export function accountLabel(account: { name: string; number?: string | null }): string {
  const digits = (account.number ?? "").replace(/\s+/g, "");
  return digits.length >= 4 ? `${account.name} ·${digits.slice(-4)}` : account.name;
}

/** Наше юрлицо коротко: код, если он есть, иначе имя. */
export function entityShort(entity: { code: string; name: string }): string {
  return entity.code || entity.name;
}

/** Подписи сторон по умолчанию — поля «Исполнитель» и «Заказчик» схемы. */
export function slotTitles(schema: RegistrySchema | null): { executor: string; customer: string } {
  const title = (key: string, fallback: string) => schema?.fields.find((item) => item.key === key)?.title || fallback;
  return { executor: title("executor", "Исполнитель"), customer: title("customer", "Заказчик") };
}
