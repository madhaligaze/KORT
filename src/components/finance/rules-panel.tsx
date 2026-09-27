"use client";

import { useCallback, useEffect, useState } from "react";

import { type Dictionaries, type Rule, type RuleSuggestion, financeApi, formatMoney } from "@/components/finance/api";
import { AutotagCard } from "@/components/finance/autotag-card";
import { PlaceholderOption } from "@/components/placeholder-option";
import { useSessionState } from "@/components/session-state";

const FIELD_TITLES: Record<string, string> = {
  comment: "комментарий",
  counterparty: "контрагент",
  account: "счёт",
  amount: "сумма",
  kind: "вид операции",
};

const OP_TITLES: Record<string, string> = {
  contains: "содержит",
  not_contains: "не содержит",
  equals: "равен",
  starts_with: "начинается с",
  regex: "совпадает с выражением",
  gt: "больше",
  lt: "меньше",
};

/**
 * Автоправила разметки.
 *
 * Экран устроен от задачи, а не от сущности: сверху — «с чего начать»,
 * подсказки по неразмеченным операциям с суммами, и рядом кнопка, которая
 * превращает подсказку в правило одним нажатием. Список правил ниже.
 *
 * У каждого правила стоит счётчик срабатываний. Он важнее, чем кажется:
 * правило, не совпавшее ни разу, выглядит работающим, и человек уверен, что
 * разметка идёт, — а в отчёте продолжает расти «Без категории».
 */
export function RulesPanel({
  dictionaries,
  onChanged,
}: {
  dictionaries: Dictionaries;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Rule[]>([]);
  const [suggestions, setSuggestions] = useState<RuleSuggestion[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  // Новое правило — черновик переживает перезагрузку (`session-state.tsx`).
  const [keyword, setKeyword] = useSessionState("rules.new.keyword", "");
  const [field, setField] = useSessionState("rules.new.field", "comment");
  const [op, setOp] = useSessionState("rules.new.op", "contains");
  const [category, setCategory] = useSessionState("rules.new.category", "");

  const load = useCallback(async () => {
    try {
      const [list, hints] = await Promise.all([financeApi.rules(), financeApi.ruleSuggestions()]);
      setItems(list.items);
      setSuggestions(hints.items);
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Правила не прочитались");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (name: string, value: string, categoryName: string) => {
    setBusy(true);
    setError("");
    try {
      await financeApi.createRule({
        name,
        match: "all",
        conditions: [{ field, op, value }],
        actions: { category: categoryName },
      });
      setKeyword("");
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Правило не завелось");
    } finally {
      setBusy(false);
    }
  };

  const applyAll = async () => {
    setBusy(true);
    setError("");
    try {
      const done = await financeApi.applyRules({ only_uncategorized: true });
      setResult(
        done.updated
          ? `Разметили операций: ${done.updated} — ${Object.entries(done.by_rule)
              .map(([name, count]) => `${name} — ${count}`)
              .join(", ")}`
          : "Ни одна операция не подошла под правила",
      );
      await load();
      onChanged();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не удалось применить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <AutotagCard
        onChanged={() => {
          onChanged();
          void load();
        }}
      />
      {suggestions.length ? (
        <div className="fin-card p-4 flex flex-col gap-2">
          <div>
            <p className="fin-label">С чего начать</p>
          </div>
          {suggestions.map((hint) => (
            <div key={`${hint.kind}|${hint.keyword}`} className="fin-acc-row">
              <span className="fin-acc-name">
                <b style={{ color: "var(--text-primary)" }}>{hint.keyword}</b>
                <span style={{ color: "var(--text-muted)" }}>
                  {" · "}
                  {hint.count} {operations(hint.count)} · {hint.kind === "income" ? "поступления" : "списания"}
                  {hint.examples[0] ? ` · «${hint.examples[0]}»` : ""}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="fin-num" style={{ color: "var(--text-secondary)" }}>
                  {formatMoney(hint.amount)}
                </span>
                <select
                  className="input-field"
                  style={{ width: "auto", padding: "0.2rem 1.6rem 0.2rem 0.5rem", fontSize: "0.75rem" }}
                  defaultValue=""
                  onChange={async (event) => {
                    if (!event.target.value) return;
                    await create(hint.keyword, hint.keyword, event.target.value);
                    onChanged();
                  }}
                >
                  <PlaceholderOption>в статью…</PlaceholderOption>
                  {dictionaries.categories
                    .filter((item) => item.side === (hint.kind === "income" ? "income" : "expense"))
                    .map((item) => (
                      <option key={item.id} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="fin-card p-4 flex flex-col gap-3">
        <p className="fin-label">Новое правило</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="fin-label">Если</span>
            <select
              className="input-field"
              style={{ width: "auto" }}
              value={field}
              onChange={(event) => setField(event.target.value)}
            >
              {Object.entries(FIELD_TITLES).map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="fin-label">&nbsp;</span>
            <select
              className="input-field"
              style={{ width: "auto" }}
              value={op}
              onChange={(event) => setOp(event.target.value)}
            >
              {Object.entries(OP_TITLES).map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="fin-label">Значение</span>
            <input
              className="input-field"
              style={{ width: "12rem" }}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="Magnum"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="fin-label">Тогда статья</span>
            <select
              className="input-field"
              style={{ width: "auto" }}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <PlaceholderOption>выберите статью</PlaceholderOption>
              {dictionaries.categories.map((item) => (
                <option key={item.id} value={item.name}>
                  {item.name} ({item.side === "income" ? "доход" : "расход"})
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !keyword.trim() || !category}
            onClick={() => create(keyword.trim(), keyword.trim(), category)}
          >
            Завести правило
          </button>
        </div>
        {error ? (
          <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
            {error}
          </p>
        ) : null}
      </div>

      {items.length ? (
        <div className="fin-card">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3">
            <p className="fin-label">Правила компании</p>
            <div className="flex items-center gap-2">
              {result ? (
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {result}
                </span>
              ) : null}
              <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={applyAll}>
                Применить к операциям без статьи
              </button>
            </div>
          </div>
          <div className="px-3 pb-3 flex flex-col">
            {items.map((rule) => (
              <div key={rule.id} className="fin-acc-row">
                <span className="fin-acc-name">
                  <b style={{ color: rule.active ? "var(--text-primary)" : "var(--text-muted)" }}>
                    {rule.name}
                  </b>
                  <span style={{ color: "var(--text-muted)" }}>
                    {" · если "}
                    {rule.conditions
                      .map(
                        (condition) =>
                          `${FIELD_TITLES[condition.field] ?? condition.field} ${
                            OP_TITLES[condition.op] ?? condition.op
                          } «${condition.value}»`,
                      )
                      .join(rule.match === "any" ? " или " : " и ")}
                    {" → "}
                    {Object.entries(rule.actions)
                      .map(([target, value]) => `${target === "category" ? "статья" : target} «${value}»`)
                      .join(", ")}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  {/* Счётчик срабатываний: ноль у включённого правила означает,
                      что условие не совпадает никогда. */}
                  {rule.applied_count ? `сработало ${rule.applied_count}` : "ни разу не сработало"}
                  <button
                    type="button"
                    className="fin-chip"
                    onClick={async () => {
                      await financeApi.toggleRule(rule.id, !rule.active);
                      await load();
                    }}
                  >
                    {rule.active ? "Выключить" : "Включить"}
                  </button>
                  <button
                    type="button"
                    className="fin-chip"
                    onClick={async () => {
                      await financeApi.deleteRule(rule.id);
                      await load();
                    }}
                  >
                    Удалить
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** «1 операция», «4 операции», «12 операций» — число в строке подсказки. */
function operations(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "операция";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "операции";
  return "операций";
}
