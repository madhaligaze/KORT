"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { type AutotagPreview, financeApi, formatMoney } from "@/components/finance/api";

/**
 * Авторазметка статей — первый проход по неразмеченному.
 *
 * Группы, а не строки: две тысячи строк никто не проверит, а «Такси и
 * каршеринг — 519 операций, 800 568 ₸, например TTP*ANYTIME.KZ» проверяется
 * одним взглядом. Широкие группы («Покупки без уточнения») предлагаются, но
 * не отмечены: они правдивы и ничего не сообщают — в отчёте такая статья
 * занимает место «Без категории», не объясняя больше.
 *
 * Отменяется целиком из «Истории» — одна запись на всю разметку.
 */
export function AutotagCard({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<AutotagPreview | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await financeApi.autotagPreview();
      setData(next);
      // Широкие группы по умолчанию выключены — человек включает их сам.
      setOff(new Set(next.groups.filter((group) => group.broad).map((group) => `${group.side}|${group.category}`)));
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Разметка не прочиталась");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chosen = useMemo(
    () => (data?.groups ?? []).filter((group) => !off.has(`${group.side}|${group.category}`)),
    [data, off],
  );
  const count = chosen.reduce((sum, group) => sum + group.count, 0);

  const apply = async () => {
    setBusy(true);
    setError("");
    try {
      const done = await financeApi.autotagApply(chosen.map(({ side, category }) => ({ side, category })));
      setResult(`Размечено операций: ${done.updated}`);
      onChanged();
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Разметка не записалась");
    } finally {
      setBusy(false);
    }
  };

  if (!data || (!data.groups.length && !result)) return null;

  return (
    <div className="fin-card p-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="fin-label" style={{ flex: 1 }}>
          Авторазметка · без статьи {data.uncategorized}
        </p>
        {data.groups.length ? (
          <button type="button" className="btn-primary text-sm" disabled={busy || !count} onClick={() => void apply()}>
            {busy ? "Размечаем…" : `Разметить ${count} ${plural(count, "операцию", "операции", "операций")}`}
          </button>
        ) : null}
      </div>
      {result ? (
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {result}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
          {error}
        </p>
      ) : null}
      {data.groups.map((group) => {
        const key = `${group.side}|${group.category}`;
        const on = !off.has(key);
        return (
          <label key={key} className="fin-acc-row" style={{ cursor: "pointer", alignItems: "flex-start" }}>
            <span className="flex items-start gap-2 min-w-0" style={{ flex: 1 }}>
              <input
                type="checkbox"
                checked={on}
                onChange={() =>
                  setOff((was) => {
                    const next = new Set(was);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                style={{ marginTop: 3 }}
              />
              <span className="fin-acc-name" style={{ whiteSpace: "normal" }}>
                <b style={{ color: on ? "var(--text-primary)" : "var(--text-secondary)", fontWeight: on ? 600 : 500 }}>
                  {group.category}
                </b>
                <span style={{ color: "var(--text-muted)" }}>
                  {" · "}
                  {group.side === "income" ? "поступления" : "списания"} · {group.count}{" "}
                  {plural(group.count, "операция", "операции", "операций")}
                  {group.exists ? "" : " · новая статья"}
                  {" · "}
                  {group.examples.slice(0, 2).join(" · ")}
                </span>
              </span>
            </span>
            <span className="fin-num" style={{ color: on ? "var(--text-primary)" : "var(--text-muted)" }}>
              {formatMoney(group.amount)}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
