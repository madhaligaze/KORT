/**
 * Сводки «Разовых» по сотрудникам — одна арифметика на два вида.
 *
 * В книге юротдела BBC это листы «Сводка (общий) по сотрудникам» и «Сводка
 * (на исполн) по Сотр.» — формулы над листом «Разовые». Здесь они считаются
 * из хранилища реестра: в карточном виде — таблицами (`OneoffStaff`), в
 * табличном — своим листом книги (`staff-sheet.ts`). Считает один модуль,
 * чтобы два вида не разошлись в цифрах.
 *
 * Договор с двумя ответственными считается у каждого — как у каждого он и
 * висит в работе. «Остаток» и месяц — из книги-сводки (`summary`), договора
 * в ней нет — остатка нет, месяц «нет в сводке».
 */
import type { Contract, PersonRef, RegistrySchema, SummaryEntry } from "@/components/finance/api";
import { CLOSED_PHASES, phaseOf } from "@/components/finance/contracts/schema";

export type Tally = {
  name: string;
  clients: Set<string>;
  contracts: number;
  amount: number;
  remaining: number;
  openContracts: number;
  openClients: Set<string>;
  openAmount: number;
  /** Сумма незавершённых по месяцу строки сводки; `""` — договора в сводке нет. */
  byMonth: Map<string, number>;
};

export type StaffTable = {
  rows: Tally[];
  /** Последние месяцы сводки — колонками, от старого к новому. */
  months: string[];
  /** Есть месяцы раньше показанных — колонка «Раньше». */
  older: boolean;
  /** Сумма незавершённых раньше показанных месяцев. */
  olderOf: (row: Tally) => number;
};

export type StaffSource = {
  schema: RegistrySchema | null;
  byId: ReadonlyMap<string, Contract>;
  order: readonly string[];
  people: Readonly<Record<string, PersonRef>>;
  parties: Readonly<Record<string, { name: string }>>;
  summary: Readonly<Record<string, SummaryEntry>> | null;
};

const MONTHS = ["ЯНВАРЬ", "ФЕВРАЛЬ", "МАРТ", "АПРЕЛЬ", "МАЙ", "ИЮНЬ", "ИЮЛЬ", "АВГУСТ", "СЕНТЯБРЬ", "ОКТЯБРЬ", "НОЯБРЬ", "ДЕКАБРЬ"];

/** «АВГУСТ 2026» → 202608; не месяц — 0 (встаёт в конец). */
function monthOrder(label: string): number {
  const [word, year] = label.trim().toUpperCase().split(/\s+/);
  const index = MONTHS.indexOf(word ?? "");
  return index >= 0 && Number(year) ? Number(year) * 100 + index + 1 : 0;
}

export function numberOf(raw: unknown): number {
  const value = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[\s  ]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

/** Сколько последних месяцев показывать колонками; раньше — одной «Раньше». */
const RECENT = 4;

/** Первый лист книги — «весь список»: сводки считаются по нему, как у юротдела. */
export function mainOf(schema: RegistrySchema | null, book: string) {
  return (
    [...(schema?.views ?? [])]
      .filter((view) => (view.book ?? "") === book)
      .sort((a, b) => a.position - b.position)[0] ?? null
  );
}

export function staffTable(source: StaffSource, book = "oneoff"): StaffTable | null {
  const { schema, byId, order, people, parties, summary } = source;
  const main = mainOf(schema, book);
  if (!schema || !main) return null;
  const byPerson = new Map<string, Tally>();
  const monthSet = new Set<string>();
  for (const id of order) {
    const contract = byId.get(id);
    if (!contract || contract.deleted || !contract.views.some((place) => place.view === main.key)) continue;
    const ids = Array.isArray(contract.values.people) ? (contract.values.people as string[]) : [];
    const names = ids.length ? ids.map((person) => people[person]?.name ?? "—") : ["Без ответственного"];
    const client = parties[String(contract.values.customer ?? "")]?.name ?? "";
    const amount = numberOf(contract.values.amount);
    const entry = summary?.[contract.id];
    const remaining = entry?.state === "found" ? numberOf(entry.remaining) : 0;
    const open = !CLOSED_PHASES.has(phaseOf(schema, contract));
    const month = entry?.state === "found" ? entry.months?.[0] ?? "" : "";
    if (open && month) monthSet.add(month);
    for (const name of names) {
      let tally = byPerson.get(name);
      if (!tally) {
        tally = {
          name,
          clients: new Set(),
          contracts: 0,
          amount: 0,
          remaining: 0,
          openContracts: 0,
          openClients: new Set(),
          openAmount: 0,
          byMonth: new Map(),
        };
        byPerson.set(name, tally);
      }
      if (client) tally.clients.add(client);
      tally.contracts += 1;
      tally.amount += amount;
      tally.remaining += remaining;
      if (open) {
        if (client) tally.openClients.add(client);
        tally.openContracts += 1;
        tally.openAmount += amount;
        tally.byMonth.set(month, (tally.byMonth.get(month) ?? 0) + amount);
      }
    }
  }
  const all = [...monthSet].sort((a, b) => monthOrder(b) - monthOrder(a));
  const recent = all.slice(0, RECENT);
  const shown = new Set(recent);
  return {
    rows: [...byPerson.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ru")),
    months: [...recent].reverse(),
    older: all.length > RECENT,
    olderOf: (row) =>
      [...row.byMonth].reduce((sum, [month, value]) => (month && !shown.has(month) ? sum + value : sum), 0),
  };
}
