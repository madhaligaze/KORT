"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type Me,
  type MemberRow,
  type SessionRow,
  financeApi,
  formatDate,
} from "@/components/finance/api";

const ROLE_TITLES: Record<string, string> = {
  owner: "Владелец",
  admin: "Администратор",
  accountant: "Бухгалтер",
  viewer: "Смотрит",
};

const ROLE_HINTS: Record<string, string> = {
  admin: "всё, кроме удаления компании",
  accountant: "ведёт учёт: операции, импорт, справочники",
  viewer: "только смотрит отчёты",
};

/**
 * Команда компании и свои сессии.
 *
 * Пароль приглашённому задаёт владелец и передаёт лично. Это сказано прямо, а
 * не спрятано: писем мы пока не отправляем, и делать вид, что приглашение
 * уходит по почте, — хуже, чем честно назвать порядок.
 */
export function TeamPanel({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("accountant");
  const [busy, setBusy] = useState(false);
  const canManage = (me.abilities ?? []).includes("people");

  const load = useCallback(async () => {
    try {
      if (canManage) setRows((await financeApi.members()).items);
      setSessions((await financeApi.sessions()).items);
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не удалось прочитать команду");
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      await financeApi.invite({ email, password, role });
      setEmail("");
      setPassword("");
      await load();
      onChanged();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не удалось добавить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <div className="fin-card p-4 flex flex-col gap-3">
          <div>
            <p className="fin-label">Люди в компании</p>
          </div>

          {rows.map((row) => (
            <div key={row.id} className="fin-acc-row">
              <span className="fin-acc-name">
                {row.full_name || row.email}
                <span style={{ color: "var(--text-muted)" }}>
                  {" · "}
                  {row.full_name ? row.email : ""}
                  {row.last_login_at ? ` · заходил ${formatDate(row.last_login_at.slice(0, 10))}` : " · ещё не заходил"}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {row.role === "owner" ? (
                  <span className="badge badge-slate">{ROLE_TITLES.owner}</span>
                ) : (
                  <>
                    <select
                      className="input-field"
                      style={{ width: "auto", padding: "0.2rem 1.6rem 0.2rem 0.5rem", fontSize: "0.75rem" }}
                      value={row.role}
                      onChange={async (event) => {
                        try {
                          await financeApi.changeRole(row.id, event.target.value);
                          await load();
                        } catch (exc) {
                          setError(exc instanceof Error ? exc.message : "Роль не сменилась");
                        }
                      }}
                    >
                      {["admin", "accountant", "viewer"].map((value) => (
                        <option key={value} value={value}>
                          {ROLE_TITLES[value]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="fin-chip"
                      onClick={async () => {
                        try {
                          await financeApi.removeMember(row.id);
                          await load();
                        } catch (exc) {
                          setError(exc instanceof Error ? exc.message : "Не удалился");
                        }
                      }}
                    >
                      Удалить
                    </button>
                  </>
                )}
              </span>
            </div>
          ))}

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="fin-label">Почта</span>
              <input
                className="input-field"
                style={{ width: "13rem" }}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="buh@company.kz"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="fin-label">Временный пароль</span>
              <input
                className="input-field"
                style={{ width: "11rem" }}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="от 8 символов"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="fin-label">Роль</span>
              <select
                className="input-field"
                style={{ width: "auto" }}
                value={role}
                onChange={(event) => setRole(event.target.value)}
              >
                {["admin", "accountant", "viewer"].map((value) => (
                  <option key={value} value={value}>
                    {ROLE_TITLES[value]} — {ROLE_HINTS[value]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !email.trim() || password.length < 8}
              onClick={add}
            >
              Добавить
            </button>
          </div>
          {error ? (
            <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="fin-card p-4 flex flex-col gap-2">
        <div>
          <p className="fin-label">Ваши входы</p>
        </div>
        {sessions.map((row) => (
          <div key={row.id} className="fin-acc-row">
            <span className="fin-acc-name" title={row.user_agent}>
              {row.user_agent || "неизвестное устройство"}
            </span>
            <span className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              {row.last_seen_at ? formatDate(row.last_seen_at.slice(0, 10)) : ""}
              <button
                type="button"
                className="fin-chip"
                onClick={async () => {
                  try {
                    await financeApi.revokeSession(row.id);
                    await load();
                  } catch (exc) {
                    setError(exc instanceof Error ? exc.message : "Не закрылась");
                  }
                }}
              >
                Закрыть
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
