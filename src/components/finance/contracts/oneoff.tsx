"use client";

/**
 * «Разовые» — книга листов тех же договоров вида «Разовая услуга».
 *
 * Повторяет книгу юротдела BBC «Разовые» (27.09.2026): весь список, отборы
 * незавершённых по сроку («до 2 мес» … «6+ мес»), «Остатки» и две сводки по
 * сотрудникам. Листы — обычные листы реестра книги `oneoff` (правятся в
 * «Настроить реестр» → «Листы»), сводки по сотрудникам — здесь, из того же
 * хранилища: в книге это были формулы над листом «Разовые», и отдельного
 * хранения у них нет.
 *
 * «Оплачено» — из книги-сводки компании («Осн.Общая сводка BBC 2026»), как
 * колонка Q книги: по номеру договора и клиенту (`contracts/summary.py`).
 */
import { useMemo, useState } from "react";

import type { Contract, RegistrySchema, SummaryEntry, SummarySource } from "@/components/finance/api";
import { CLOSED_PHASES, phaseOf } from "@/components/finance/contracts/schema";
import { ensureSummary, inBook, useRegistry } from "@/components/finance/contracts/store";
import { formatTime, plural } from "@/components/finance/format";
import { formatMoney } from "@/components/finance/api";

/** Строка «откуда оплата»: книга, лист, когда прочитана; отказ — словами. */
export function SummaryLine({ onSetup }: { onSetup?: () => void }) {
  const source = useRegistry((s) => s.summarySource);
  const schemaSource = useRegistry((s) => s.schema?.summary ?? null);
  const ready = useRegistry((s) => s.phase === "ready");
  const [busy, setBusy] = useState(false);
  const shown: SummarySource | null = source ?? schemaSource;
  if (!ready) return null;
  if (!shown) {
    return (
      <p className="creg-oneoff-line">
        «Оплачено» берётся из книги-сводки — она не подключена
        {onSetup ? (
          <>
            {" · "}
            <button type="button" className="fin-link-btn" onClick={onSetup}>
              Подключить
            </button>
          </>
        ) : null}
      </p>
    );
  }
  return (
    <p className="creg-oneoff-line">
      <span>
        «Оплачено» — из{" "}
        <a href={shown.url} target="_blank" rel="noreferrer" className="fin-link-btn">
          {shown.title || "книги-сводки"}
        </a>
        , лист «{shown.worksheet}»
        {shown.read_at ? ` · прочитана в ${formatTime(shown.read_at)}` : ""}
      </span>
      {shown.error ? <span className="fin-fail"> · {shown.error}</span> : null}
      {shown.drift ? <span> · книгу поправили: {shown.drift}</span> : null}
      <button
        type="button"
        className="fin-link-btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await ensureSummary(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Читаем…" : "Обновить"}
      </button>
    </p>
  );
}

type Tally = {
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

const MONTHS = ["ЯНВАРЬ", "ФЕВРАЛЬ", "МАРТ", "АПРЕЛЬ", "МАЙ", "ИЮНЬ", "ИЮЛЬ", "АВГУСТ", "СЕНТЯБРЬ", "ОКТЯБРЬ", "НОЯБРЬ", "ДЕКАБРЬ"];

/** «АВГУСТ 2026» → 202608; не месяц — 0 (встаёт в конец). */
function monthOrder(label: string): number {
  const [word, year] = label.trim().toUpperCase().split(/\s+/);
  const index = MONTHS.indexOf(word ?? "");
  return index >= 0 && Number(year) ? Number(year) * 100 + index + 1 : 0;
}

function numberOf(raw: unknown): number {
  const value = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[\s  ]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

/** Сколько последних месяцев показывать колонками; раньше — одной «Раньше». */
const RECENT = 4;

function tallies(
  contracts: Contract[],
  schema: RegistrySchema,
  people: Readonly<Record<string, { name: string }>>,
  parties: Readonly<Record<string, { name: string }>>,
  summary: Readonly<Record<string, SummaryEntry>> | null,
): { rows: Tally[]; months: string[]; older: boolean } {
  const byPerson = new Map<string, Tally>();
  const monthSet = new Set<string>();
  for (const contract of contracts) {
    const ids = Array.isArray(contract.values.people) ? (contract.values.people as string[]) : [];
    const names = ids.length ? ids.map((id) => people[id]?.name ?? "—") : ["Без ответственного"];
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
  return {
    rows: [...byPerson.values()].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ru")),
    months: all.slice(0, RECENT),
    older: all.length > RECENT,
  };
}

/**
 * Две сводки книги «Разовые» по сотрудникам: общая (все договоры) и «на
 * исполнении» с разбивкой суммы по месяцу строки в сводке. Договор с двумя
 * ответственными считается у каждого — как у каждого он и висит в работе.
 */
export function OneoffStaff() {
  const schema = useRegistry((s) => s.schema);
  const byId = useRegistry((s) => s.byId);
  const order = useRegistry((s) => s.order);
  const people = useRegistry((s) => s.people);
  const parties = useRegistry((s) => s.parties);
  const summary = useRegistry((s) => s.summary);

  const main = useMemo(
    () =>
      [...(schema?.views ?? [])]
        .filter((view) => inBook(view, "oneoff"))
        .sort((a, b) => a.position - b.position)[0] ?? null,
    [schema],
  );
  const contracts = useMemo(
    () =>
      main
        ? order
            .map((id) => byId.get(id))
            .filter((item): item is Contract => !!item && !item.deleted && item.views.some((place) => place.view === main.key))
        : [],
    [order, byId, main],
  );
  const data = useMemo(
    () => (schema ? tallies(contracts, schema, people, parties, summary) : null),
    [contracts, schema, people, parties, summary],
  );
  if (!schema || !main || !data) return null;
  const { rows, months, older } = data;
  const recent = new Set(months);
  const total = (pick: (row: Tally) => number) => rows.reduce((sum, row) => sum + pick(row), 0);
  const olderOf = (row: Tally) =>
    [...row.byMonth].reduce((sum, [month, value]) => (month && !recent.has(month) ? sum + value : sum), 0);

  return (
    <div className="creg-staff">
      <h2 className="creg-staff-title">
        По сотрудникам · {rows.length} {plural(rows.length, "человек", "человека", "человек")}
      </h2>
      <div className="creg-staff-scroll">
        <table className="fin-table creg-staff-table">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th className="fin-num">Клиентов</th>
              <th className="fin-num">Договоров</th>
              <th className="fin-num">Сумма</th>
              <th className="fin-num">Остаток</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td className="fin-num">{row.clients.size}</td>
                <td className="fin-num">{row.contracts}</td>
                <td className="fin-num">{formatMoney(row.amount)}</td>
                <td className="fin-num">{formatMoney(row.remaining)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Итого</td>
              <td className="fin-num" />
              <td className="fin-num">{total((row) => row.contracts)}</td>
              <td className="fin-num">{formatMoney(total((row) => row.amount))}</td>
              <td className="fin-num">{formatMoney(total((row) => row.remaining))}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h2 className="creg-staff-title">На исполнении — по месяцу в сводке</h2>
      <div className="creg-staff-scroll">
        <table className="fin-table creg-staff-table">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th className="fin-num">Клиентов</th>
              <th className="fin-num">Договоров</th>
              <th className="fin-num">Сумма</th>
              <th className="fin-num">Нет в сводке</th>
              {older ? <th className="fin-num">Раньше</th> : null}
              {[...months].reverse().map((month) => (
                <th key={month} className="fin-num">
                  {month.toLowerCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((row) => row.openContracts > 0)
              .map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td className="fin-num">{row.openClients.size}</td>
                  <td className="fin-num">{row.openContracts}</td>
                  <td className="fin-num">{formatMoney(row.openAmount)}</td>
                  <td className="fin-num">{formatMoney(row.byMonth.get("") ?? 0)}</td>
                  {older ? <td className="fin-num">{formatMoney(olderOf(row))}</td> : null}
                  {[...months].reverse().map((month) => (
                    <td key={month} className="fin-num">
                      {formatMoney(row.byMonth.get(month) ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
