"use client";

import { useCallback, useEffect, useState } from "react";

import { ChoiceSelect } from "@/components/choice-select";
import { useSessionDrop, useSessionState } from "@/components/session-state";
import {
  type Account,
  type BankOption,
  type Integration,
  financeApi,
  formatDate,
} from "@/components/finance/api";

const WAY_TITLES: Record<string, string> = {
  statement: "Выписка файлом",
  api: "Приём по адресу",
  sheets: "Книга Google",
};

/**
 * Интеграции с банками.
 *
 * У каждого банка честно написано, чем он подключается. Публичного API для
 * малого бизнеса у банков Казахстана нет, и кнопка «подключить Kaspi», которая
 * ничего не подключает, — худшее, что можно сделать с учётом: человек решит,
 * что операции приходят сами, и перестанет сверять выписку.
 *
 * Что есть на самом деле: выписка файлом (у всех банков), книга Google и наш
 * адрес приёма — туда операции присылает скрипт клиента, шина или выгрузка из
 * 1С, с токеном этого подключения.
 */
export function IntegrationsPanel({
  accounts,
  onGo,
  onChanged,
}: {
  accounts: Account[];
  onGo: (section: "import" | "sheets") => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Integration[]>([]);
  const [catalog, setCatalog] = useState<BankOption[]>([]);
  // Начатое подключение переживает перезагрузку (`session-state.tsx`).
  // Токен — нет: он показывается один раз и в хранилище вкладки не ложится.
  const [picked, setPicked] = useSessionState<BankOption | null>("intg.picked", null);
  const [way, setWay] = useSessionState("intg.new.way", "statement");
  const [accountId, setAccountId] = useSessionState("intg.new.account", "");
  const dropDraft = useSessionDrop();
  const [token, setToken] = useState<{ title: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await financeApi.integrations();
      setItems(data.items);
      setCatalog(data.catalog);
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Подключения не пришли");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const inbox =
    typeof window === "undefined"
      ? "/api/backend/api/v1/finance/integrations/inbox"
      : `${window.location.origin}/api/backend/api/v1/finance/integrations/inbox`;

  const connect = async () => {
    if (!picked) return;
    setBusy(true);
    setError("");
    try {
      const created = await financeApi.createIntegration({
        slug: picked.slug,
        kind: way,
        account_id: accountId || null,
      });
      if (created.token) setToken({ title: created.title, value: created.token });
      setPicked(null);
      dropDraft("intg.new");
      await load();
      onChanged();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не подключилось");
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
          {error}
        </p>
      ) : null}

      {/* Токен показывается один раз: в базе он хранится хешем, и второй раз
          его взять неоткуда. Поэтому он стоит отдельной карточкой, а не мелким
          текстом в списке. */}
      {token ? (
        <div className="fin-card p-3 flex flex-col gap-2" style={{ borderColor: "var(--accent-line)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Токен «{token.title}» — сохраните сейчас, второй раз он не покажется
          </p>
          <code className="fin-code">{token.value}</code>
          <pre className="fin-code">{`curl -X POST ${inbox} \\
  -H "Content-Type: application/json" \\
  -H "X-Finance-Token: ${token.value}" \\
  -d '{"operations":[{"date":"2026-09-18","amount":"-15000","comment":"Magnum"}]}'`}</pre>
          <button
            type="button"
            className="btn-ghost text-xs self-start"
            onClick={() => {
              setToken(null);
              // Пока токен был на экране, по нему могли уже прислать операции:
              // счётчик «пришло» обязан это показать, а не прежний ноль.
              void load();
            }}
          >
            Сохранил
          </button>
        </div>
      ) : null}

      <div className="fin-banks">
        {catalog.map((bank) => (
          <button
            key={bank.slug}
            type="button"
            className="fin-bank"
            data-on={picked?.slug === bank.slug ? "true" : undefined}
            onClick={() => {
              setPicked(bank);
              setWay(bank.ways[0] ?? "statement");
            }}
          >
            <span className="fin-bank-logo">
              {bank.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={bank.logo} alt="" width={40} height={40} />
              ) : (
                <span className="fin-bank-mono">{bank.title.slice(0, 1)}</span>
              )}
            </span>
            <span className="fin-bank-name">{bank.title}</span>
            <span className="fin-bank-ways">{bank.ways.map((item) => WAY_TITLES[item] ?? item).join(" · ")}</span>
          </button>
        ))}
      </div>

      {picked ? (
        <div className="fin-card p-3 flex flex-wrap items-end gap-3">
          <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {picked.title}
          </span>
          <label className="flex flex-col gap-1">
            <span className="fin-label">Как подключаем</span>
            <select className="input-field" value={way} onChange={(e) => setWay(e.target.value)}>
              {picked.ways.map((item) => (
                <option key={item} value={item}>
                  {WAY_TITLES[item] ?? item}
                </option>
              ))}
            </select>
          </label>
          {picked.slug !== "sheets" ? (
            <label className="flex flex-col gap-1 min-w-[12rem]">
              <span className="fin-label">Счёт в учёте</span>
              <ChoiceSelect className="input-field" value={accountId} onChange={setAccountId} placeholder="не выбран" clearable>
                {accounts.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </ChoiceSelect>
            </label>
          ) : null}
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {picked.parser}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void connect()}>
            {busy ? "Подключаем…" : "Подключить"}
          </button>
          {way === "statement" ? (
            <button type="button" className="btn-ghost" onClick={() => onGo("import")}>
              Загрузить выписку
            </button>
          ) : null}
          {way === "sheets" ? (
            <button type="button" className="btn-ghost" onClick={() => onGo("sheets")}>
              Открыть книги
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="fin-card overflow-x-auto">
        <table className="fin-table">
          <thead>
            <tr>
              <th>Подключение</th>
              <th>Способ</th>
              <th>Счёт</th>
              <th>Пришло операций</th>
              <th>Последний раз</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={item.state === "active" ? undefined : { opacity: 0.55 }}>
                <td className="fin-strong">
                  <span className="flex items-center gap-2">
                    {item.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.logo} alt="" width={20} height={20} style={{ borderRadius: 5 }} />
                    ) : null}
                    {item.title}
                  </span>
                </td>
                <td>{WAY_TITLES[item.kind] ?? item.kind}</td>
                <td>{item.account || "—"}</td>
                <td className="fin-num">{item.received}</td>
                <td>{item.last_seen_at ? formatDate(item.last_seen_at.slice(0, 10)) : "ещё не было"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {item.kind === "api" ? (
                    <button
                      type="button"
                      className="fin-chip"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const next = await financeApi.rotateIntegrationToken(item.id);
                          setToken({ title: item.title, value: next.token });
                        })
                      }
                    >
                      новый токен
                    </button>
                  ) : null}{" "}
                  <button
                    type="button"
                    className="fin-chip"
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        financeApi.setIntegrationState(item.id, item.state === "active" ? "off" : "active"),
                      )
                    }
                  >
                    {item.state === "active" ? "выключить" : "включить"}
                  </button>{" "}
                  <button
                    type="button"
                    className="fin-chip"
                    disabled={busy}
                    onClick={() => void act(() => financeApi.deleteIntegration(item.id))}
                  >
                    удалить
                  </button>
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                  Подключений пока нет
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
