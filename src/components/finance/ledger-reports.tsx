"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type Account,
  type BalanceData,
  type HistoryEntry,
  type IndicatorsData,
  type StatementData,
  financeApi,
  formatDate,
  formatMoney,
  monthEdges,
  todayIso,
} from "@/components/finance/api";

function Muted({ text }: { text: string }) {
  return (
    <p className="text-sm p-6" style={{ color: "var(--text-muted)" }}>
      {text}
    </p>
  );
}

/**
 * Баланс.
 *
 * Считается из того, что в учёте есть: деньги, дебиторка, кредиторка.
 * Неучтённое (основные средства, запасы, кредиты) перечислено строкой, а не
 * подставлено нулями: баланс с молчаливыми нулями сходится идеально и не
 * значит ничего.
 */
export function BalanceReport({ revision }: { revision: number }) {
  const [asOf, setAsOf] = useState(todayIso());
  const [data, setData] = useState<BalanceData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    financeApi
      .balance(asOf)
      .then((next) => alive && setData(next))
      .catch((exc) => alive && setError(exc instanceof Error ? exc.message : "Баланс не посчитался"));
    return () => {
      alive = false;
    };
  }, [asOf, revision]);

  if (error) return <Muted text={error} />;
  if (!data) return <Muted text="Считаем…" />;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
        на дату
        <input className="input-field" style={{ width: "auto" }} type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
      </label>
      <div className="fin-kpis">
        <div className="fin-kpi">
          <span className="fin-kpi-label">Активы</span>
          <span className="fin-kpi-value">{formatMoney(data.assets.total)}</span>
        </div>
        <div className="fin-kpi">
          <span className="fin-kpi-label">Обязательства</span>
          <span className="fin-kpi-value">{formatMoney(data.liabilities.total)}</span>
        </div>
        <div className="fin-kpi">
          <span className="fin-kpi-label">Собственные средства</span>
          <span className={`fin-kpi-value ${Number(data.equity) < 0 ? "fin-out" : ""}`}>{formatMoney(data.equity)}</span>
        </div>
      </div>
      <div className="fin-card fin-report-scroll">
        <table className="fin-report">
          <tbody>
            <tr>
              <td className="fin-strong">Активы</td>
              <td />
            </tr>
            {data.assets.rows.map((row) => (
              <tr key={row.name}>
                <td style={{ paddingLeft: "1.25rem" }}>{row.name}</td>
                <td className="fin-num">{formatMoney(row.amount)}</td>
              </tr>
            ))}
            {(data.assets.rows[0]?.details ?? []).map((row) => (
              <tr key={`d-${row.name}`}>
                <td style={{ paddingLeft: "2.25rem", color: "var(--text-muted)" }}>{row.name}</td>
                <td className="fin-num" style={{ color: "var(--text-muted)" }}>
                  {formatMoney(row.amount)}
                </td>
              </tr>
            ))}
            <tr>
              <td className="fin-strong">Обязательства</td>
              <td />
            </tr>
            {data.liabilities.rows.map((row) => (
              <tr key={row.name}>
                <td style={{ paddingLeft: "1.25rem" }}>{row.name}</td>
                <td className="fin-num">{formatMoney(row.amount)}</td>
              </tr>
            ))}
            <tr>
              <td className="fin-strong">Собственные средства</td>
              <td className="fin-num fin-strong">{formatMoney(data.equity)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Не учтено: {data.not_counted.join(", ")}
      </p>
    </div>
  );
}

/**
 * Финансовые показатели.
 *
 * Считаются из природы статей, а не из их названий. Показатель, для которого
 * нет данных, не показывается нулём: «маржа 0%» там, где нет выручки, — это не
 * ноль, а неправда.
 */
export function IndicatorsReport({ revision }: { revision: number }) {
  const [shift, setShift] = useState(0);
  const [data, setData] = useState<IndicatorsData | null>(null);
  const [error, setError] = useState("");
  const edges = monthEdges(shift);

  useEffect(() => {
    let alive = true;
    financeApi
      .indicators({ date_from: edges.from, date_to: edges.to })
      .then((next) => alive && setData(next))
      .catch((exc) => alive && setError(exc instanceof Error ? exc.message : "Показатели не посчитались"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift, revision]);

  if (error) return <Muted text={error} />;
  if (!data) return <Muted text="Считаем…" />;

  const rows: Array<[string, string, boolean?]> = [
    ["Выручка", data.revenue, true],
    ["Себестоимость", data.cogs],
    ["Валовая прибыль", data.gross_profit, true],
    ["Операционные расходы", data.operating_costs],
    ["EBITDA", data.ebitda, true],
    ["Амортизация", data.depreciation],
    ["Операционная прибыль", data.operating_profit, true],
    ["Проценты и финансовые расходы", data.financial_costs],
    ["Налоги", data.tax],
    ["Чистая прибыль", data.net_profit, true],
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" className="btn-ghost text-xs" onClick={() => setShift((was) => was - 1)}>
          ←
        </button>
        <span className="text-sm" style={{ color: "var(--text-primary)" }}>
          {formatDate(edges.from)} — {formatDate(edges.to)}
        </span>
        <button type="button" className="btn-ghost text-xs" onClick={() => setShift((was) => was + 1)}>
          →
        </button>
      </div>
      <div className="fin-kpis">
        {[
          ["Валовая маржа", data.gross_margin],
          ["Маржа EBITDA", data.ebitda_margin],
          ["Рентабельность", data.net_margin],
        ].map(([label, value]) => (
          <div key={label} className="fin-kpi">
            <span className="fin-kpi-label">{label}</span>
            <span className="fin-kpi-value">{value === null ? "—" : `${String(value).replace(".", ",")}%`}</span>
          </div>
        ))}
      </div>
      <div className="fin-card fin-report-scroll">
        <table className="fin-report">
          <tbody>
            {rows.map(([name, value, strong]) => (
              <tr key={name}>
                <td className={strong ? "fin-strong" : undefined} style={strong ? undefined : { paddingLeft: "1.25rem" }}>
                  {name}
                </td>
                <td className={`fin-num ${strong ? "fin-strong" : ""}`}>{formatMoney(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.not_counted.length ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Не учтено: {data.not_counted.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

/** Выписка по счёту — для сверки с банком: только факт и только один счёт. */
export function StatementReport({ accounts, revision }: { accounts: Account[]; revision: number }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [shift, setShift] = useState(0);
  const [data, setData] = useState<StatementData | null>(null);
  const [error, setError] = useState("");
  const edges = monthEdges(shift);

  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    financeApi
      .accountStatement({ account_id: accountId, date_from: edges.from, date_to: edges.to })
      .then((next) => {
        if (!alive) return;
        setData(next);
        setError("");
      })
      .catch((exc) => alive && setError(exc instanceof Error ? exc.message : "Выписка не собралась"));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, shift, revision]);

  if (!accounts.length) return <Muted text="Счетов пока нет" />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input-field" style={{ width: "auto" }} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn-ghost text-xs" onClick={() => setShift((was) => was - 1)}>
          ←
        </button>
        <span className="text-sm" style={{ color: "var(--text-primary)" }}>
          {formatDate(edges.from)} — {formatDate(edges.to)}
        </span>
        <button type="button" className="btn-ghost text-xs" onClick={() => setShift((was) => was + 1)}>
          →
        </button>
      </div>
      {error ? <Muted text={error} /> : null}
      {data ? (
        <>
          <div className="fin-kpis">
            <div className="fin-kpi">
              <span className="fin-kpi-label">На начало</span>
              <span className="fin-kpi-value">{formatMoney(data.opening_balance)}</span>
            </div>
            <div className="fin-kpi">
              <span className="fin-kpi-label">Пришло</span>
              <span className="fin-kpi-value fin-in">{formatMoney(data.income)}</span>
            </div>
            <div className="fin-kpi">
              <span className="fin-kpi-label">Ушло</span>
              <span className="fin-kpi-value fin-out">{formatMoney(data.expense)}</span>
            </div>
            <div className="fin-kpi">
              <span className="fin-kpi-label">На конец</span>
              <span className="fin-kpi-value">{formatMoney(data.closing_balance)}</span>
            </div>
          </div>
          <div className="fin-card overflow-x-auto">
            <table className="fin-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th style={{ textAlign: "right" }}>Сумма</th>
                  <th style={{ textAlign: "right" }}>Остаток</th>
                  <th>Контрагент</th>
                  <th>Статья</th>
                  <th>Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDate(row.paid_at)}</td>
                    <td className={`fin-num ${row.direction === "in" ? "fin-in" : "fin-out"}`}>
                      {row.direction === "in" ? "+" : "−"}
                      {formatMoney(row.amount)}
                    </td>
                    <td className="fin-num">{formatMoney(row.balance)}</td>
                    <td>{row.counterparty || "—"}</td>
                    <td>{row.category || "—"}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: "18rem" }}>{row.comment}</td>
                  </tr>
                ))}
                {!data.rows.length ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                      За этот месяц движения нет
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** История действий с отменой: вернуть состояние «до», а не сделать обратное. */
export function HistoryPanel({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const [items, setItems] = useState<HistoryEntry[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await financeApi.history();
      setItems(data.items);
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "История не пришла");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, revision]);

  const undo = async (id: string) => {
    setBusy(id);
    setError("");
    try {
      await financeApi.undo(id);
      await load();
      onChanged();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не отменилось");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
          {error}
        </p>
      ) : null}
      <div className="fin-card overflow-x-auto">
        <table className="fin-table">
          <thead>
            <tr>
              <th>Когда</th>
              <th>Кто</th>
              <th>Что</th>
              <th>Сумма</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const amount = (item.after?.amount ?? item.before?.amount) as string | undefined;
              return (
                <tr key={item.id} style={item.undone_at ? { opacity: 0.55 } : undefined}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {item.at ? `${formatDate(item.at.slice(0, 10))} ${item.at.slice(11, 16)}` : ""}
                  </td>
                  <td>{item.actor || "—"}</td>
                  <td style={{ whiteSpace: "normal" }}>
                    {item.title}
                    {item.undone_at ? " · отменено" : ""}
                  </td>
                  <td className="fin-num">{amount ? formatMoney(amount) : ""}</td>
                  <td>
                    {item.can_undo ? (
                      <button type="button" className="fin-chip" disabled={busy === item.id} onClick={() => void undo(item.id)}>
                        {busy === item.id ? "…" : "отменить"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {!items.length ? (
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                  Действий пока не было
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
