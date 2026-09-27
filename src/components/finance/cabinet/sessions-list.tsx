"use client";

import { useCallback, useEffect, useState } from "react";

import { type SessionRow, financeApi, peopleApi } from "@/components/finance/api";
import { ago, deviceOf, when } from "@/components/finance/cabinet/status";

/**
 * Сеансы: устройство, адрес, последнее действие, «Завершить» (фронт-план, 6.9).
 *
 * Свои (`employeeId` пуст) — текущий помечен « · этот», и «Завершить» у него
 * нет: выйти можно кнопкой «Выйти». Сеансы сотрудника — у каждого
 * «Завершить», и один «Завершить все» для всех разом (сервер закрывает все
 * сеансы человека в компании).
 */
export function SessionsList({ employeeId, onChanged }: { employeeId?: string; onChanged?: () => void }) {
  const [items, setItems] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = employeeId ? await peopleApi.employees.sessions(employeeId) : await financeApi.sessions();
      setItems(data.items);
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Сеансы не прочитались");
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError("");
    try {
      await action();
      await load();
      onChanged?.();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не получилось");
    } finally {
      setBusy(null);
    }
  };

  if (!items) return error ? <p className="cab-error fin-fail">{error}</p> : <p className="cab-wait">Читаем сеансы…</p>;
  if (items.length === 0) return <p className="cab-empty">Открытых сеансов нет.</p>;

  const others = items.filter((item) => !item.current);
  return (
    <div className="cab-list">
      {items.map((item) => (
        <div key={item.id} className="cab-row cab-session">
          <span className="cab-row-main">
            {deviceOf(item.user_agent)}
            {item.current ? <span className="fin-soft"> · этот</span> : null}
          </span>
          <span className="fin-mono fin-soft cab-session-ip">{item.ip || "—"}</span>
          <span className="cab-row-note fin-soft">
            {item.last_seen_at ? `последнее действие ${ago(item.last_seen_at)}` : `вход ${when(item.created_at)}`}
          </span>
          <span className="cab-row-act">
            {item.current ? null : (
              <button
                type="button"
                className="btn-ghost btn-sm"
                disabled={busy !== null}
                onClick={() =>
                  run(item.id, () =>
                    employeeId ? peopleApi.employees.endSessions(employeeId) : financeApi.revokeSession(item.id),
                  )
                }
              >
                {busy === item.id ? "Завершаем…" : "Завершить"}
              </button>
            )}
          </span>
        </div>
      ))}
      {!employeeId && others.length >= 2 ? (
        <button
          type="button"
          className="btn-ghost btn-sm cab-list-foot"
          disabled={busy !== null}
          onClick={() => run("others", () => peopleApi.self.endOtherSessions())}
        >
          {busy === "others" ? "Завершаем…" : "Завершить все, кроме этого"}
        </button>
      ) : null}
      {error ? <p className="cab-error fin-fail">{error}</p> : null}
    </div>
  );
}
