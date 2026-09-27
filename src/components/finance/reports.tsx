"use client";

import { useEffect, useState } from "react";

import {
  type BreakdownItem,
  type CashFlow,
  type Debts,
  type Profit,
  type ProjectsReport as ProjectsData,
  financeApi,
  formatDate,
  formatMoney,
  formatMonth,
} from "@/components/finance/api";

/**
 * Отчёты раздела.
 *
 * Общее правило всех четырёх: месяц без операций стоит в таблице нулём, а не
 * пропадает из ряда. Пропущенный месяц читается как «данных нет» и ломает
 * сравнение с соседним — дефект, который этот проект уже переживал на дашборде.
 */

function useReport<T>(load: () => Promise<T>, revision: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const next = await load();
        if (alive) {
          setData(next);
          setError("");
        }
      } catch (exc) {
        if (alive) setError(exc instanceof Error ? exc.message : "Отчёт не посчитался");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);
  return { data, error };
}

function Empty({ text }: { text: string }) {
  return (
    <p className="text-sm p-6" style={{ color: "var(--text-muted)" }}>
      {text}
    </p>
  );
}

export function CashFlowReport({ revision }: { revision: number }) {
  const { data, error } = useReport<CashFlow>(() => financeApi.cashFlow({}), revision);
  if (error) return <Empty text={error} />;
  if (!data) return <Empty text="Считаем…" />;
  if (!data.rows.length) return <Empty text="За выбранный период операций нет." />;

  return (
    <div className="flex flex-col gap-3">
      <div className="fin-kpis">
        <div className="fin-kpi">
          <span className="fin-kpi-label">Остаток на начало</span>
          <span className="fin-kpi-value">{formatMoney(data.opening_balance)}</span>
        </div>
        <div className="fin-kpi">
          <span className="fin-kpi-label">Остаток на конец</span>
          <span className="fin-kpi-value">{formatMoney(data.closing_balance)}</span>
        </div>
        <div className="fin-kpi">
          <span className="fin-kpi-label">Поступило за период</span>
          <span className="fin-kpi-value fin-in">
            {formatMoney(data.rows.reduce((sum, row) => sum + Number(row.income), 0))}
          </span>
        </div>
        <div className="fin-kpi">
          <span className="fin-kpi-label">Списано за период</span>
          <span className="fin-kpi-value fin-out">
            {formatMoney(data.rows.reduce((sum, row) => sum + Number(row.expense), 0))}
          </span>
        </div>
      </div>

      <div className="fin-card fin-report-scroll">
        <table className="fin-report">
          <thead>
            <tr>
              <th>Месяц</th>
              <th>Остаток на начало</th>
              <th>Поступило</th>
              <th>Списано</th>
              <th>Чистый поток</th>
              <th>Остаток на конец</th>
              <th>С учётом ожиданий</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.month}>
                <td>{formatMonth(row.month)}</td>
                <td className="fin-num">{formatMoney(row.start_balance)}</td>
                <td className="fin-num fin-in">{formatMoney(row.income)}</td>
                <td className="fin-num fin-out">{formatMoney(row.expense)}</td>
                <td className="fin-num">{formatMoney(row.net, { sign: true })}</td>
                <td className="fin-num" style={{ color: "var(--text-primary)" }}>
                  {formatMoney(row.end_balance)}
                </td>
                <td className="fin-num">{formatMoney(row.end_balance_with_plan)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Breakdown title="Поступления по категориям" items={data.breakdown.income} months={data.months} />
      <Breakdown title="Списания по категориям" items={data.breakdown.expense} months={data.months} />

      {/* Контрольные суммы показываются всегда, а не только при расхождении:
          отчёт, который доказывает свою правоту, проверяют один раз, а
          отчёту, который просто выводит числа, не верят никогда. */}
      <div className="fin-card p-3">
        <p className="fin-label mb-2">Сходимость</p>
        <div className="flex flex-col gap-1">
          {data.checks.map((check) => (
            <div key={check.name} className="flex items-baseline justify-between gap-3 text-xs">
              <span style={{ color: check.ok ? "var(--text-secondary)" : "var(--accent-rose)" }}>
                {check.name}
                {check.hint ? ` — ${check.hint}` : ""}
              </span>
              <span className="fin-num" style={{ color: check.ok ? "var(--text-muted)" : "var(--accent-rose)" }}>
                {check.ok ? "сходится" : `${formatMoney(check.left)} ≠ ${formatMoney(check.right)}`}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Разбивка по статьям.
 *
 * Числа в клетках — факт. Ожидания показаны отдельной приглушённой строкой под
 * числом, а не сложены с ним: 18 сентября 2026 на живом экране было видно, как
 * это путает — в шапке отчёта стояло «Поступило 5 117 777», а в итоге разбивки
 * 6 017 777, и разница ровно на запланированный платёж ничем не объяснялась.
 * Две верные цифры про одно и то же хуже одной.
 */
function Breakdown({
  title,
  items,
  months,
}: {
  title: string;
  items: BreakdownItem[];
  months: string[];
}) {
  if (!items.length) return null;
  const totals = months.map((month) =>
    items.reduce((sum, item) => sum + Number(item.months[month] ?? 0), 0),
  );
  const plannedTotal = items.reduce((sum, item) => sum + Number(item.planned ?? 0), 0);
  return (
    <div className="fin-card fin-report-scroll">
      <p className="fin-label p-3 pb-0">{title}</p>
      <table className="fin-report">
        <thead>
          <tr>
            <th>Статья</th>
            {months.map((month) => (
              <th key={month}>{formatMonth(month, true)}</th>
            ))}
            <th>Всего</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.name}>
              <td>{item.name}</td>
              {months.map((month) => {
                const fact = Number(item.months[month] ?? 0);
                const plan = Number(item.months_plan?.[month] ?? 0);
                return (
                  <td key={month} className="fin-num">
                    {fact ? formatMoney(fact) : "—"}
                    {plan ? (
                      <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                        ждём {formatMoney(plan)}
                      </span>
                    ) : null}
                  </td>
                );
              })}
              <td className="fin-num" style={{ color: "var(--text-primary)" }}>
                {formatMoney(item.total)}
              </td>
            </tr>
          ))}
          <tr data-total="true">
            <td>Итого — факт</td>
            {totals.map((value, index) => (
              <td key={months[index]} className="fin-num">
                {formatMoney(value)}
              </td>
            ))}
            <td className="fin-num">{formatMoney(totals.reduce((sum, value) => sum + value, 0))}</td>
          </tr>
        </tbody>
      </table>
      {plannedTotal ? (
        <p className="text-xs px-3 pb-3" style={{ color: "var(--text-muted)" }}>
          Ожидается ещё {formatMoney(plannedTotal)} — вне итога
        </p>
      ) : null}
    </div>
  );
}

export function ProfitReport({ revision }: { revision: number }) {
  const { data, error } = useReport<Profit>(() => financeApi.profit({}), revision);
  if (error) return <Empty text={error} />;
  if (!data) return <Empty text="Считаем…" />;
  if (!data.rows.length) return <Empty text="За выбранный период операций нет." />;

  return (
    <div className="flex flex-col gap-3">
      <div className="fin-card fin-report-scroll">
        <table className="fin-report">
          <thead>
            <tr>
              <th>Месяц</th>
              <th>Доходы</th>
              <th>Расходы</th>
              <th>Прибыль</th>
              <th>Маржа, %</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.month}>
                <td>{formatMonth(row.month)}</td>
                <td className="fin-num fin-in">{formatMoney(row.income)}</td>
                <td className="fin-num fin-out">{formatMoney(row.expense)}</td>
                <td className="fin-num" style={{ color: "var(--text-primary)" }}>
                  {formatMoney(row.profit, { sign: true })}
                </td>
                <td className="fin-num">{Number(row.income) ? row.margin : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Breakdown title="Доходы по категориям" items={data.breakdown.income} months={data.months} />
      <Breakdown title="Расходы по категориям" items={data.breakdown.expense} months={data.months} />
    </div>
  );
}

export function DebtsReport({
  revision,
  onChanged,
  onNewExpectation,
}: {
  revision: number;
  onChanged: () => void;
  /** Открыть карточку операции с уже отмеченным ожиданием. */
  onNewExpectation?: (kind: "income" | "expense") => void;
}) {
  const { data, error } = useReport<Debts>(() => financeApi.debts(), revision);
  const [busy, setBusy] = useState("");

  const settle = async (id: string) => {
    setBusy(id);
    try {
      // «Оплатили» — это перевод ожидания в факт, а не новая операция: иначе в
      // журнале оказались бы две строки там, где в банке одна.
      await financeApi.patchOperation(id, { status: "fact" });
      onChanged();
    } finally {
      setBusy("");
    }
  };

  if (error) return <Empty text={error} />;
  if (!data) return <Empty text="Считаем…" />;

  const sides = [
    { key: "receivable", title: "Нам должны", data: data.receivable, kind: "income" },
    { key: "payable", title: "Мы должны", data: data.payable, kind: "expense" },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      {sides.map((side) => (
        <div key={side.key} className="fin-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2 p-3">
            <p className="fin-label">{side.title}</p>
            <p className="fin-num" style={{ color: "var(--text-primary)" }}>
              {formatMoney(side.data.total)}
              {Number(side.data.overdue) > 0 ? (
                <span className="fin-out"> · просрочено {formatMoney(side.data.overdue)}</span>
              ) : null}
            </p>
          </div>
          {side.data.items.length ? (
            <div className="fin-report-scroll">
              <table className="fin-report">
                <thead>
                  <tr>
                    <th>Контрагент</th>
                    <th>Срок</th>
                    <th>Просрочка</th>
                    <th>Сумма</th>
                    <th>Комментарий</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {side.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.counterparty}</td>
                      <td className="fin-num">{formatDate(item.due)}</td>
                      <td className="fin-num">
                        {item.overdue_days ? (
                          <span className="fin-out">{item.overdue_days} дн.</span>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>ещё рано</span>
                        )}
                      </td>
                      <td className="fin-num" style={{ color: "var(--text-primary)" }}>
                        {formatMoney(item.amount)}
                      </td>
                      <td style={{ whiteSpace: "normal", maxWidth: "18rem" }}>{item.comment}</td>
                      <td>
                        <button
                          type="button"
                          className="fin-chip"
                          disabled={busy === item.id}
                          onClick={() => settle(item.id)}
                        >
                          {busy === item.id ? "…" : "Оплачено"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            // Пустая сторона не молчит, а даёт записать первое ожидание: долг
            // здесь и есть операция, деньги по которой не двигались, и узнать
            // это иначе человеку негде.
            <div className="p-3">
              {onNewExpectation ? (
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => onNewExpectation(side.kind)}
                >
                  {side.kind === "income" ? "Записать, что нам должны" : "Записать, что мы должны"}
                </button>
              ) : (
                <Empty text="Ожиданий нет" />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ProjectsReport({ revision }: { revision: number }) {
  const { data, error } = useReport<ProjectsData>(() => financeApi.projects(), revision);
  if (error) return <Empty text={error} />;
  if (!data) return <Empty text="Считаем…" />;
  if (!data.items.length && !Number(data.not_split.income) && !Number(data.not_split.expense)) {
    return <Empty text="Операции на проекты пока не разнесены." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="fin-card fin-report-scroll">
        <table className="fin-report">
          <thead>
            <tr>
              <th>Проект</th>
              <th>Доходы</th>
              <th>Расходы</th>
              <th>Прибыль</th>
              <th>Маржа, %</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.name}>
                <td>{item.name}</td>
                <td className="fin-num fin-in">{formatMoney(item.income)}</td>
                <td className="fin-num fin-out">{formatMoney(item.expense)}</td>
                <td className="fin-num" style={{ color: "var(--text-primary)" }}>
                  {formatMoney(item.profit, { sign: true })}
                </td>
                <td className="fin-num">{Number(item.income) ? item.margin : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Строка «не разнесено» обязательна: без неё сумма проектов не сходится
          с прибылью, и объяснить расхождение нечем. */}
      <div className="fin-card p-3 text-xs flex flex-col gap-1" style={{ color: "var(--text-secondary)" }}>
        <p className="fin-label">Не разнесено по проектам</p>
        <p>
          Поступления {formatMoney(data.not_split.income)}, списания{" "}
          {formatMoney(data.not_split.expense)} — {data.not_split.note}
        </p>
      </div>
    </div>
  );
}
