/**
 * Чтение схемы реестра для экранов: подписи сторон, значения списков словом,
 * наше юрлицо и сторона, которая не наша.
 *
 * Порядок и названия полей приходят со схемы (админ их переименовывает), а не
 * из кода; скрытых полей в схеме нет вовсе - нет поля, нет колонки, нет строки
 * в карточке.
 */
import type { Contract, ListValue, Party, RegistryField, RegistrySchema, RegistryView } from "@/components/finance/api";

export const CLOSED_PHASES = new Set(["fulfilled", "terminated", "failed"]);

export function fieldOf(schema: RegistrySchema | null, key: string): RegistryField | undefined {
  return schema?.fields.find((item) => item.key === key);
}

export function listValue(schema: RegistrySchema | null, field: string, id: unknown): ListValue | undefined {
  if (!schema || typeof id !== "string") return undefined;
  // Архивное значение выборы не предлагают, но старый договор им подписан.
  return (
    schema.lists[field]?.find((item) => item.id === id) ??
    schema.archived_values?.[field]?.find((item) => item.id === id)
  );
}

export function listText(schema: RegistrySchema | null, field: string, id: unknown): string {
  return listValue(schema, field, id)?.value ?? "";
}

/**
 * Отделы кодами: «HR, ЮО». У договора отделов список (30.09.2026), у своего
 * поля типа «отдел» - один идентификатор.
 */
export function departmentText(schema: RegistrySchema | null, value: unknown): string {
  const ids = Array.isArray(value) ? value : value ? [value] : [];
  return ids
    .map((id) => schema?.departments.find((item) => item.id === id)?.code ?? "")
    .filter(Boolean)
    .join(", ");
}

export function phaseOf(schema: RegistrySchema | null, contract: Contract): string {
  return listValue(schema, "status", contract.values.status)?.meaning.phase ?? "";
}

export function isClosed(schema: RegistrySchema | null, contract: Contract): boolean {
  return CLOSED_PHASES.has(phaseOf(schema, contract));
}

/** Подписи слотов: из вида или предмета договора; иначе «Исполнитель / Заказчик». */
export function roleLabels(contract: Contract | undefined): { executor: string; customer: string; plain: boolean } {
  const roles = contract?.roles ?? {};
  const executor = roles.executor || "Исполнитель";
  const customer = roles.customer || "Заказчик";
  return { executor, customer, plain: !roles.executor && !roles.customer };
}

export function partyName(parties: Readonly<Record<string, Party>>, id: unknown): string {
  return typeof id === "string" ? parties[id]?.name ?? "" : "";
}

/**
 * Заголовок договора - сторона, которая не наша. Обе наши - «BBC → BBCA».
 * Ни одна не наша - исполнитель. Сторон нет - пусто.
 */
export function counterpartTitle(contract: Contract, parties: Readonly<Record<string, Party>>): string {
  const executor = parties[String(contract.values.executor ?? "")];
  const customer = parties[String(contract.values.customer ?? "")];
  if (executor?.own && customer?.own) return `${executor.code || executor.name} → ${customer.code || customer.name}`;
  if (executor?.own) return customer?.name ?? "";
  if (customer?.own) return executor?.name ?? "";
  return customer?.name ?? executor?.name ?? "";
}

/** Наше юрлицо договора: код и слот, в котором оно стоит. */
export function ownSide(
  contract: Contract,
  parties: Readonly<Record<string, Party>>,
): { code: string; slot: "executor" | "customer" | null } {
  const executor = parties[String(contract.values.executor ?? "")];
  const customer = parties[String(contract.values.customer ?? "")];
  if (executor?.own) return { code: executor.code || executor.name, slot: "executor" };
  if (customer?.own) return { code: customer.code || customer.name, slot: "customer" };
  return { code: "", slot: null };
}

export function economicText(schema: RegistrySchema | null, contract: Contract): string {
  return listText(schema, "economic_role", contract.values.economic_role);
}

const PROVENANCE_WORDS: Record<string, string> = {
  type: "по виду",
  subject: "по предмету",
  parties: "по сторонам",
  block: "по листу",
  amount: "по сумме",
  status: "по статусу",
};

/** `{ по виду }` у подставленного значения; у заданного руками - ничего. */
export function provenanceWord(contract: Contract, key: string): string {
  const source = contract.provenance?.[key];
  return source && source !== "manual" ? PROVENANCE_WORDS[source] ?? "" : "";
}

/** Порядок полей карточки по умолчанию - порядок заполнения из плана. */
export const CARD_ORDER = [
  "type", "status", "executor", "customer", "billing", "economic_role", "amount", "amount_terms", "currency",
  "planned_end_at", "end_date", "subject", "department", "people", "number", "signed_at", "folder_url", "note",
];
/** Поля, которые карточка рисует своими блоками, а не в сетке. */
export const OWN_BLOCKS = new Set([
  "amendments_text", "amendments_summary_text", "paid_snapshot", "remaining_snapshot", "end_kind", "currency",
  "paid", "remaining", "summary_paid", "summary_remaining", "age_months",
]);
export const WIDE_FIELDS = new Set(["subject", "note", "amount_terms", "folder_url"]);

export function viewCounts(
  views: RegistryView[],
  contracts: Iterable<Contract>,
  matches?: (contract: Contract) => boolean,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const view of views) counts[view.key] = 0;
  for (const contract of contracts) {
    if (contract.deleted) continue;
    if (matches && !matches(contract)) continue;
    for (const place of contract.views) counts[place.view] = (counts[place.view] ?? 0) + 1;
  }
  return counts;
}

/**
 * Отдел, которым отобраны все листы книги, - его код: «Разовые» с условием
 * «отдел - ЮО» в каждой группе каждого блока - это «Разовые ЮО». Хоть один
 * блок без такого условия или отделы разные - пусто.
 */
export function bookDepartment(schema: RegistrySchema | null, book: string): string {
  const views = (schema?.views ?? []).filter((view) => (view.book ?? "") === book);
  if (!schema || !views.length) return "";
  let found: string | null = null;
  for (const view of views) {
    for (const block of view.blocks) {
      const groups = block.filter?.any ?? [];
      if (!groups.length) return "";
      for (const group of groups) {
        const hit = group.all.find(
          (item) => item.field === "department" && item.op === "in" && Array.isArray(item.value) && item.value.length === 1,
        );
        const id = hit ? String((hit.value as unknown[])[0]) : null;
        if (!id || (found !== null && found !== id)) return "";
        found = id;
      }
    }
  }
  return found ? departmentText(schema, found) : "";
}

/** Подпись книги в колонке и заголовке: «Реестр», «Разовые ЮО». */
export function bookTitle(schema: RegistrySchema | null, book: string): string {
  if (!book) return "Реестр";
  const code = bookDepartment(schema, book);
  return code ? `Разовые ${code}` : "Разовые";
}

/** Выбор значений поля в блоке листа (`choices`): id значений или `null` - весь список. */
export function blockChoices(schema: RegistrySchema | null, view: string | undefined, block: number | undefined, field: string): string[] | null {
  if (!schema || !view) return null;
  const found = schema.views.find((item) => item.key === view);
  const ids = found?.blocks[block ?? 0]?.choices?.[field];
  return ids?.length ? ids : null;
}

/** Номер договора без «№» и пробелов по краям - для ссылки на него. */
export function bareNumberOf(contract: Contract): string {
  return String(contract.values.number ?? "").replace(/^\s*№\s*/, "").trim();
}

/**
 * Где договор стоит - «Исполнитель ГК · Разовые ЮО / до 2 мес»: листы, кроме
 * главного (он держит всё и места не называет), с книгой, если она не реестр.
 */
export function placesText(schema: RegistrySchema | null, contract: Contract): string {
  if (!schema) return "";
  const names: string[] = [];
  for (const place of contract.views) {
    const view = schema.views.find((item) => item.key === place.view);
    if (!view || view.main) continue;
    const block = view.blocks.length > 1 ? view.blocks[place.block]?.title?.trim() : "";
    const book = view.book ? `${bookTitle(schema, view.book)} / ` : "";
    names.push(`${book}${view.title}${block ? ` / ${block}` : ""}`);
  }
  if (!names.length) {
    const main = schema.views.find((item) => item.main);
    return main && contract.views.some((place) => place.view === main.key) ? main.title : "";
  }
  return names.join(" · ");
}

export function inView(contract: Contract, view: string): { block: number } | null {
  const place = contract.views.find((item) => item.view === view);
  return place ? { block: place.block } : null;
}
