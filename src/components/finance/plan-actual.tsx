"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type PlanActual,
  type PlanItem,
  financeApi,
  formatMoney,
  formatMonth,
} from "@/components/finance/api";

/**
 * План против факта по статьям.
 *
 * Два способа считать факт — деньгами и начислением — переключаются, а планы
 * для них хранятся отдельно. Это не удвоение ради удвоения: бюджет платежей
 * («когда заплатим») и бюджет расходов («когда возникнет обязательство») —
 * разные документы, и складывать их значит спорить о цифрах на планёрке.
 *
 * Процент выполнения не показывается при нулевом плане. «∞%» или «—» на месте
 * процента читается как ошибка расчёта; отсутствие плана честнее показать
 * пустотой и дать поставить план тут же, в ячейке.
 */
export function PlanActualReport({ revision, onChanged }: { revision: number; onChanged: () => void }) {
  const [method, setMethod] = useState<"cash" | "accrual">("cash");
  const [data, setData] = useState<PlanActual | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ key: string; month: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await financeApi.planActual({ method }));
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Отчёт не посчитался");
    }
  }, [method]);

  // Первое чтение и перечитывание по ревизии — прямо в эффекте, с отменой:
  // ответ, пришедший после смены способа учёта, не должен перезаписать отчёт
  // уже по другому способу.
  useEffect(() => {
    let alive = true;
    financeApi
      .planActual({ method })
      .then((next) => {
        if (!alive) return;
        setData(next);
        setError("");
      })
      .catch((exc) => alive && setError(exc instanceof Error ? exc.message : "Отчёт не посчитался"));
    return () => {
      alive = false;
    };
  }, [method, revision]);

  const savePlan = async (item: PlanItem, month: string, amount: string) => {
    try {
      await financeApi.upsertPlan({
        month: `${month}-01`,
        side: item.side,
        method,
        amount: amount.replace(/\s/g, "").replace(",", "."),
        category_id: item.key === "none" ? null : item.key,
      });
      setEditing(null);
      onChanged();
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "План не сохранился");
    }
  };

  if (error && !data) {
    return (
      <p className="text-sm p-6" style={{ color: "var(--accent-rose)" }}>
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="text-sm p-6" style={{ color: "var(--text-muted)" }}>
        Считаем…
      </p>
    );
  }

  const sides = [
    { key: "income", title: "Доходы" },
    { key: "expense", title: "Расходы" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="fin-label">Факт считаем</span>
          <select
            className="input-field"
            style={{ width: "auto" }}
            value={method}
            onChange={(event) => setMethod(event.target.value as "cash" | "accrual")}
          >
            <option value="cash">по деньгам</option>
            <option value="accrual">по начислению</option>
          </select>
        </label>
      </div>

      {error ? (
        <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
          {error}
        </p>
      ) : null}

      {sides.map((side) => {
        const items = data.items.filter((item) => item.side === side.key);
        if (!items.length) return null;
        return (
          <div key={side.key} className="fin-card fin-report-scroll">
            <p className="fin-label p-3 pb-0">{side.title}</p>
            <table className="fin-report">
              <thead>
                <tr>
                  <th>Статья</th>
                  {data.months.map((month) => (
                    <th key={month}>{formatMonth(month, true)}</th>
                  ))}
                  <th>Факт всего</th>
                  <th>План всего</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={`${item.side}|${item.key}`}>
                    <td>{item.name}</td>
                    {item.cells.map((cell) => {
                      const active = editing?.key === item.key && editing?.month === cell.month;
                      return (
                        <td key={cell.month} className="fin-num">
                          <span style={{ color: "var(--text-primary)" }}>
                            {Number(cell.fact) ? formatMoney(cell.fact) : "—"}
                          </span>
                          <br />
                          {active ? (
                            <input
                              className="input-field fin-num"
                              style={{ width: "6.5rem", textAlign: "right", padding: "0.15rem 0.35rem" }}
                              autoFocus
                              defaultValue={Number(cell.plan) ? cell.plan : ""}
                              onBlur={(event) => savePlan(item, cell.month, event.target.value || "0")}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                                if (event.key === "Escape") setEditing(null);
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className="fin-chip"
                              onClick={() => setEditing({ key: item.key, month: cell.month })}
                              title="Поставить план на месяц"
                            >
                              {Number(cell.plan)
                                ? `план ${formatMoney(cell.plan)}${cell.done_pct ? ` · ${cell.done_pct}%` : ""}`
                                : "план не задан"}
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className="fin-num" style={{ color: "var(--text-primary)" }}>
                      {formatMoney(item.fact_total)}
                    </td>
                    <td className="fin-num">{formatMoney(item.plan_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {!data.items.length ? (
        <p className="text-sm p-6" style={{ color: "var(--text-muted)" }}>
          Ни операций, ни планов за период
        </p>
      ) : null}
    </div>
  );
}
