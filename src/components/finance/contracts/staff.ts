/**
 * Сводки «Разовых» по сотрудникам - одна арифметика на два вида.
 *
 * В книге юротдела BBC это листы «Сводка (общий) по сотрудникам» и «Сводка
 * (на исполн) по Сотр.» - формулы над листом «Разовые». Здесь они считаются
 * из хранилища реестра: в карточном виде - таблицами (`OneoffStaff`), в
 * табличном - своим листом книги (`staff-sheet.ts`). Считает один модуль,
 * чтобы два вида не разошлись в цифрах.
 *
 * Договор с двумя ответственными считается у каждого - как у каждого он и
 * висит в работе. С 29.09.2026 - долей, если она задана и открыта этому
 * человеку (`shares.py`): у кого 500 000 из 700 000, у того в строке 500 000,
 * а остаток и месяц - той же долей. Чужая доля не открыта - у того человека
 * договор, как прежде, целиком. «Остаток» и месяц - из книги-сводки
 * (`summary`), договора в ней нет - остатка нет, месяц «нет в сводке».
 *
 * «Итого» - по договорам, каждый один раз (`totals`), а не сумма строк. До
 * 29.09.2026 итог складывал строки, и договор на двоих входил в него дважды:
 * у «Разовых» из 93 договоров итог показывал 98, а сумма - на миллионы больше
 * настоящей.
 */
import type { Contract, PersonRef, RegistrySchema, ShareMap, SummaryEntry } from "@/components/finance/api";
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
  /** Сумма незавершённых по месяцу строки сводки; `""` - договора в сводке нет. */
  byMonth: Map<string, number>;
};

/** Итог по договорам без повторов; `shared` - сколько договоров на нескольких. */
export type StaffTotals = {
  contracts: number;
  amount: number;
  remaining: number;
  openContracts: number;
  openAmount: number;
  byMonth: Map<string, number>;
  shared: number;
  openShared: number;
};

export type StaffTable = {
  rows: Tally[];
  totals: StaffTotals;
  /** Последние месяцы сводки - колонками, от старого к новому. */
  months: string[];
  /** Есть месяцы раньше показанных - колонка «Раньше». */
  older: boolean;
  /** Сумма незавершённых раньше показанных месяцев - у строки или у итога. */
  olderOf: (row: { byMonth: Map<string, number> }) => number;
};

export type StaffSource = {
  schema: RegistrySchema | null;
  byId: ReadonlyMap<string, Contract>;
  order: readonly string[];
  people: Readonly<Record<string, PersonRef>>;
  parties: Readonly<Record<string, { name: string }>>;
  summary: Readonly<Record<string, SummaryEntry>> | null;
  /** Доли людей в договорах - только открытые этому человеку (`ensureShares`). */
  shares?: Readonly<Record<string, ShareMap>> | null;
};

const MONTHS = ["ЯНВАРЬ", "ФЕВРАЛЬ", "МАРТ", "АПРЕЛЬ", "МАЙ", "ИЮНЬ", "ИЮЛЬ", "АВГУСТ", "СЕНТЯБРЬ", "ОКТЯБРЬ", "НОЯБРЬ", "ДЕКАБРЬ"];

/** «АВГУСТ 2026» → 202608; не месяц - 0 (встаёт в конец). */
function monthOrder(label: string): number {
  const [word, year] = label.trim().toUpperCase().split(/\s+/);
  const index = MONTHS.indexOf(word ?? "");
  return index >= 0 && Number(year) ? Number(year) * 100 + index + 1 : 0;
}

export function numberOf(raw: unknown): number {
  const value = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[\s  ]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

/** Сколько последних месяцев показывать колонками; раньше - одной «Раньше». */
const RECENT = 4;

/** Первый лист книги - «весь список»: сводки считаются по нему, как у юротдела. */
export function mainOf(schema: RegistrySchema | null, book: string) {
  return (
    [...(schema?.views ?? [])]
      .filter((view) => (view.book ?? "") === book)
      .sort((a, b) => a.position - b.position)[0] ?? null
  );
}

export function staffTable(source: StaffSource, book = "oneoff"): StaffTable | null {
  const { schema, byId, order, people, parties, summary, shares } = source;
  const main = mainOf(schema, book);
  if (!schema || !main) return null;
  const byPerson = new Map<string, Tally>();
  const monthSet = new Set<string>();
  const totals: StaffTotals = {
    contracts: 0,
    amount: 0,
    remaining: 0,
    openContracts: 0,
    openAmount: 0,
    byMonth: new Map(),
    shared: 0,
    openShared: 0,
  };
  for (const id of order) {
    const contract = byId.get(id);
    if (!contract || contract.deleted || !contract.views.some((place) => place.view === main.key)) continue;
    const ids = Array.isArray(contract.values.people) ? (contract.values.people as string[]) : [];
    const persons = ids.length
      ? ids.map((person) => ({ id: person, name: people[person]?.name ?? "-" }))
      : [{ id: "", name: "Без ответственного" }];
    const names = persons.map((person) => person.name);
    // Доля человека, если она задана и ему открыта; нет - договор у него целиком.
    const split = shares?.[contract.id]?.people;
    const shareOf = (person: string): number | null => {
      const raw = split?.[person]?.amount;
      if (raw === null || raw === undefined || raw === "") return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    // Договор разложен по долям у всех - в строках людей он не повторяется.
    const whole = !(ids.length > 1 && ids.every((person) => shareOf(person) !== null));
    const client = parties[String(contract.values.customer ?? "")]?.name ?? "";
    const amount = numberOf(contract.values.amount);
    const entry = summary?.[contract.id];
    const remaining = entry?.state === "found" ? numberOf(entry.remaining) : 0;
    const open = !CLOSED_PHASES.has(phaseOf(schema, contract));
    const month = entry?.state === "found" ? entry.months?.[0] ?? "" : "";
    if (open && month) monthSet.add(month);
    totals.contracts += 1;
    totals.amount += amount;
    totals.remaining += remaining;
    if (names.length > 1 && whole) totals.shared += 1;
    if (open) {
      totals.openContracts += 1;
      totals.openAmount += amount;
      totals.byMonth.set(month, (totals.byMonth.get(month) ?? 0) + amount);
      if (names.length > 1 && whole) totals.openShared += 1;
    }
    for (const { id: person, name } of persons) {
      const part = person ? shareOf(person) : null;
      const mine = part ?? amount;
      const fraction = part === null ? 1 : amount > 0 ? part / amount : 0;
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
      tally.amount += mine;
      tally.remaining += remaining * fraction;
      if (open) {
        if (client) tally.openClients.add(client);
        tally.openContracts += 1;
        tally.openAmount += mine;
        tally.byMonth.set(month, (tally.byMonth.get(month) ?? 0) + mine);
      }
    }
  }
  const all = [...monthSet].sort((a, b) => monthOrder(b) - monthOrder(a));
  const recent = all.slice(0, RECENT);
  const shown = new Set(recent);
  const olderOf = (row: { byMonth: Map<string, number> }) =>
    [...row.byMonth].reduce((sum, [month, value]) => (month && !shown.has(month) ? sum + value : sum), 0);
  return {
    rows: [...byPerson.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ru")),
    totals,
    months: [...recent].reverse(),
    older: all.length > RECENT,
    olderOf,
  };
}
