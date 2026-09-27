"use client";

import { useCallback, useEffect, useState } from "react";

import { ChoiceSelect } from "@/components/choice-select";
import { useSessionDrop, useSessionState } from "@/components/session-state";
import {
  type Dictionaries,
  type Recurrence,
  financeApi,
  formatDate,
  formatMoney,
  todayIso,
} from "@/components/finance/api";

/**
 * Повторяющиеся операции: аренда, зарплата, подписки.
 *
 * Правило порождает настоящие ожидания на горизонт вперёд — их видно в
 * календаре и в долгах, их можно оплатить, поправить или удалить по одному.
 * Виртуальная строка, которую экран дорисовывает, ничего из этого не умеет.
 */
export function RecurrencesPanel({
  dictionaries,
  onChanged,
}: {
  dictionaries: Dictionaries;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Recurrence[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  // Открытая форма и набранное в ней переживают перезагрузку
  // (`session-state.tsx`); заведённое повторение черновик стирает.
  const [form, setForm] = useSessionState("rec.form", false);
  const dropDraft = useSessionDrop();

  const [title, setTitle] = useSessionState("rec.new.title", "");
  const [kind, setKind] = useSessionState<"income" | "expense">("rec.new.kind", "expense");
  const [amount, setAmount] = useSessionState("rec.new.amount", "");
  const [period, setPeriod] = useSessionState("rec.new.period", "month");
  const [day, setDay] = useSessionState("rec.new.day", "5");
  const [startAt, setStartAt] = useSessionState("rec.new.start", todayIso);
  const [until, setUntil] = useSessionState("rec.new.until", "");
  const [accountId, setAccountId] = useSessionState("rec.new.account", "");
  const [categoryId, setCategoryId] = useSessionState("rec.new.category", "");
  const [counterpartyId, setCounterpartyId] = useSessionState("rec.new.counterparty", "");

  const load = useCallback(async () => {
    try {
      const data = await financeApi.recurrences();
      setItems(data.items);
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Повторения не пришли");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const said = await action();
      if (said) setResult(said);
      await load();
      onChanged();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      const done = await financeApi.createRecurrence({
        title,
        kind,
        amount: amount.replace(/\s/g, "").replace(",", "."),
        period,
        day: Number(day || 1),
        start_at: startAt,
        until: until || null,
        account_from_id: kind === "expense" ? accountId || null : null,
        account_to_id: kind === "income" ? accountId || null : null,
        category_id: categoryId || null,
        counterparty_id: counterpartyId || null,
      });
      setForm(false);
      setTitle("");
      setAmount("");
      dropDraft("rec.new");
      return `Создано ожиданий: ${done.created}`;
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" onClick={() => setForm((was) => !was)}>
          {form ? "Свернуть" : "Новое повторение"}
        </button>
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const done = await financeApi.materializeRecurrences();
              return done.created ? `Продлено: ${done.created}` : "Горизонт уже заполнен";
            })
          }
        >
          Продлить на три месяца вперёд
        </button>
        {result ? (
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {result}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
          {error}
        </p>
      ) : null}

      {form ? (
        <div className="fin-card p-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 flex-1 min-w-[12rem]">
            <span className="fin-label">Название</span>
            <input className="input-field" value={title} placeholder="Аренда офиса" onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="fin-label">Вид</span>
            <select className="input-field" value={kind} onChange={(e) => setKind(e.target.value as "income" | "expense")}>
              <option value="expense">расход</option>
              <option value="income">доход</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="fin-label">Сумма</span>
            <input className="input-field fin-num" style={{ width: "9rem" }} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="fin-label">Как часто</span>
            <select className="input-field" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="month">каждый месяц</option>
              <option value="week">каждую неделю</option>
              <option value="quarter">раз в квартал</option>
              <option value="year">раз в год</option>
            </select>
          </label>
          {period !== "week" ? (
            <label className="flex flex-col gap-1">
              <span className="fin-label">Число</span>
              <input
                className="input-field fin-num"
                style={{ width: "4.5rem" }}
                value={day}
                onChange={(e) => setDay(e.target.value)}
              />
            </label>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="fin-label">С</span>
            <input className="input-field" type="date" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="fin-label">По</span>
            <input className="input-field" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 min-w-[10rem]">
            <span className="fin-label">Счёт</span>
            <ChoiceSelect className="input-field" value={accountId} onChange={setAccountId} placeholder="выберем при оплате" clearable>
              {dictionaries.accounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </ChoiceSelect>
          </label>
          <label className="flex flex-col gap-1 min-w-[10rem]">
            <span className="fin-label">Статья</span>
            <ChoiceSelect className="input-field" value={categoryId} onChange={setCategoryId} placeholder="не указана" clearable>
              {dictionaries.categories
                .filter((item) => item.side === kind)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </ChoiceSelect>
          </label>
          <label className="flex flex-col gap-1 min-w-[10rem]">
            <span className="fin-label">Контрагент</span>
            <ChoiceSelect className="input-field" value={counterpartyId} onChange={setCounterpartyId} placeholder="не указан" clearable>
              {dictionaries.counterparties.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </ChoiceSelect>
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !title.trim() || !Number(amount.replace(/\s/g, "").replace(",", "."))}
            onClick={() => void submit()}
          >
            {busy ? "Создаём…" : "Создать"}
          </button>
        </div>
      ) : null}

      <div className="fin-card overflow-x-auto">
        <table className="fin-table">
          <thead>
            <tr>
              <th>Название</th>
              <th>Как часто</th>
              <th style={{ textAlign: "right" }}>Сумма</th>
              <th>Следующее</th>
              <th>Статья</th>
              <th>Ожиданий</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={item.active ? undefined : { opacity: 0.55 }}>
                <td className="fin-strong">{item.title}</td>
                <td>
                  {item.period_title}
                  {item.period !== "week" ? `, ${item.day}-го` : ""}
                </td>
                <td className={`fin-num ${item.kind === "income" ? "fin-in" : "fin-out"}`}>{formatMoney(item.amount)}</td>
                <td>{formatDate(item.next_at)}</td>
                <td>{item.category || "—"}</td>
                <td className="fin-num">{item.waiting}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button
                    type="button"
                    className="fin-chip"
                    disabled={busy}
                    onClick={() => void run(() => financeApi.toggleRecurrence(item.id, !item.active).then(() => undefined))}
                  >
                    {item.active ? "пауза" : "включить"}
                  </button>{" "}
                  <button
                    type="button"
                    className="fin-chip"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const done = await financeApi.deleteRecurrence(item.id);
                        return `Удалено, снято будущих ожиданий: ${done.removed}`;
                      })
                    }
                  >
                    удалить
                  </button>
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                  Повторений пока нет
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
