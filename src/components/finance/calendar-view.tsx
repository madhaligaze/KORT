"use client";

import { useEffect, useState } from "react";

import {
  type CalendarMonth,
  financeApi,
  formatDate,
  formatMoney,
  formatMonth,
} from "@/components/finance/api";

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/**
 * Платёжный календарь: движение по дням и остаток на конец дня.
 *
 * Зачем он нужен отдельно от отчёта о движении денег: месячный отчёт говорит
 * «в октябре хватило», а разрыв случается двенадцатого, когда платить аренду
 * нечем, хотя к концу месяца придёт оплата. Разрыв — свойство дня, и увидеть
 * его можно только по дням.
 *
 * Цвет здесь один и означает отказ: денег в этот день не хватит. Всё
 * остальное — вес и положение цифры, по правилу об индикаторах в `CLAUDE.md`.
 */
export function CalendarView({ revision }: { revision: number }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [data, setData] = useState<CalendarMonth | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const next = await financeApi.calendar(year, month);
        if (alive) {
          setData(next);
          setError("");
        }
      } catch (exc) {
        if (alive) setError(exc instanceof Error ? exc.message : "Календарь не посчитался");
      }
    })();
    return () => {
      alive = false;
    };
  }, [year, month, revision]);

  const shift = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
  };

  // Пустые клетки перед первым числом: в неделе, начинающейся с понедельника,
  // первое число может быть любым днём, и без сдвига числа съезжают на чужие
  // дни недели.
  const firstWeekday = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost text-xs" onClick={() => shift(-1)}>
          ← Прошлый
        </button>
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {formatMonth(`${year}-${String(month).padStart(2, "0")}`)}
        </span>
        <button type="button" className="btn-ghost text-xs" onClick={() => shift(1)}>
          Следующий →
        </button>
        {data ? (
          <span className="mono-meta ml-auto">
            остаток на начало месяца {formatMoney(data.opening_balance)}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
          {error}
        </p>
      ) : null}

      {data && data.cash_gaps.length ? (
        <div
          className="fin-card p-3 text-xs"
          style={{ borderColor: "var(--outflow-border)", background: "var(--outflow-bg)", color: "var(--text-primary)" }}
        >
          Кассовый разрыв: с {data.cash_gaps[0]} остатка не хватает на запланированные
          платежи. Дней в разрыве — {data.cash_gaps.length}.
        </div>
      ) : null}

      <div className="fin-cal">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="fin-label only-desktop"
            style={{ textAlign: "center", padding: "0.25rem 0" }}
          >
            {day}
          </div>
        ))}
        {Array.from({ length: firstWeekday }).map((_, index) => (
          <div key={`pad-${index}`} className="fin-cal-day fin-cal-pad" data-out="true" />
        ))}
        {(data?.days ?? []).map((day) => {
          const number = Number(day.date.slice(-2));
          const income = Number(day.income) + Number(day.income_plan);
          const expense = Number(day.expense) + Number(day.expense_plan);
          return (
            <div key={day.date} className="fin-cal-day" data-gap={day.negative}>
              <span
                className="fin-cal-num only-desktop"
                style={day.date === todayIso ? { color: "var(--text-primary)", fontWeight: 600 } : undefined}
              >
                {number}
              </span>
              <span
                className="fin-cal-num only-mobile"
                style={day.date === todayIso ? { color: "var(--text-primary)", fontWeight: 600 } : undefined}
              >
                {formatDate(day.date)}
              </span>
              {income ? <span className="fin-in fin-num">+{formatMoney(income)}</span> : null}
              {expense ? <span className="fin-out fin-num">−{formatMoney(expense)}</span> : null}
              <span className="fin-cal-bal">{formatMoney(day.balance)}</span>
            </div>
          );
        })}
      </div>

    </div>
  );
}
