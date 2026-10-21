"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChoiceSelect } from "@/components/choice-select";
import { useSessionState } from "@/components/session-state";
import {
  type OnecBase,
  type OnecDoc,
  type OnecLoose,
  type OnecMonth,
  type OnecRow,
  financeApi,
  formatMoney,
  formatMonth,
} from "@/components/finance/api";
import { formatDay, formatTime } from "@/components/finance/format";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";

/**
 * Базы 1С: подключение и месяц по договорам.
 *
 * Месяц повторяет колонки книг BBC, которые финансисты заполняли из 1С
 * руками: «Счёт», «Факт оплата», «АВР (наша)», «АВР (клиент принял)», «ЭСФ
 * (отпр.)». Строка - договор реестра; документы, которые не легли ни на один
 * договор, - отдельной таблицей с причиной, и решает человек.
 */

type Overview = {
  bases: OnecBase[];
  entities: Array<{ id: string; name: string; bin: string }>;
  secrets_ready: boolean;
  sync_minutes: number;
};

const KIND_TITLE: Record<OnecDoc["kind"], string> = {
  invoice: "Счёт",
  sale: "АВР",
  sf: "Счёт-фактура",
  esf: "ЭСФ",
  payment: "Поступление",
};

const COUNT_TITLE: Array<[OnecDoc["kind"], string]> = [
  ["invoice", "счетов"],
  ["sale", "АВР"],
  ["sf", "с-ф"],
  ["esf", "ЭСФ"],
  ["payment", "поступлений"],
];

const WHY: Record<OnecLoose["state"], string> = {
  missing: "у клиента нет такого договора",
  other_client: "номер у другого клиента",
  other_entity: "договор записан на другое юрлицо",
  ambiguous: "подходят несколько договоров",
  no_entity: "база не привязана к юрлицу",
};

/** Состояние ЭСФ в ИС ЭСФ - словами, как в 1С. */
const ESF_STATE: Record<string, string> = {
  ДоставленПолучателю: "доставлен",
  ПринятОтПоставщика: "принят",
  ПринятСервером: "принят сервером",
  ОтклоненПолучателем: "отклонён",
  ОтклоненСервером: "отклонён сервером",
  Аннулирован: "аннулирован",
  Отозван: "отозван",
  Сформирован: "не отправлен",
  Доставленный: "доставлен",
  Отклоненный: "отклонён",
  Черновик: "не отправлен",
};

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split("-").map(Number);
  const date = new Date(year, index - 1 + by, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** «2026-09-29» → «29.09». Год стоит в заголовке месяца. */
function dayShort(iso: string | null | undefined): string {
  return iso ? formatDay(iso).slice(0, 5) : "";
}

function money(value: string | null | undefined): string {
  return value ? formatMoney(value) : "";
}

function counts(base: OnecBase): string {
  const parts = COUNT_TITLE.filter(([kind]) => base.counts[kind]).map(([kind, title]) => `${title} ${base.counts[kind]}`);
  return parts.join(" · ");
}

function DocLines({ docs, withAmount = true }: { docs: OnecDoc[]; withAmount?: boolean }) {
  if (!docs.length) return <span className="onec-none">-</span>;
  return (
    <>
      {docs.map((doc) => (
        <span key={doc.id} className="onec-doc" title={[doc.content, doc.posted ? "" : "не проведён"].filter(Boolean).join(" · ")}>
          <span>
            {doc.number} · {dayShort(doc.date)}
            {doc.posted ? null : <span className="onec-draft"> · не проведён</span>}
          </span>
          {withAmount && doc.amount ? <small>{money(doc.amount)}</small> : null}
        </span>
      ))}
    </>
  );
}

function EsfCell({ row }: { row: OnecRow }) {
  if (!row.esf.length) return <span className="onec-none">-</span>;
  return (
    <>
      {row.esf.map((doc) => (
        <span
          key={doc.id}
          className="onec-doc"
          title={row.esf_kind === "esf" ? [doc.reg_number, doc.status].filter(Boolean).join(" · ") : "счёт-фактура выписан электронно"}
        >
          <span>{dayShort(doc.date)}</span>
          {row.esf_kind === "esf" && doc.status ? <small>{ESF_STATE[doc.status] ?? doc.status}</small> : null}
        </span>
      ))}
    </>
  );
}

function PaidCell({ row }: { row: OnecRow }) {
  if (!row.payments.length) return <span className="onec-none">-</span>;
  return (
    <span className="onec-doc" title={row.payments.map((item) => item.content).filter(Boolean).join("\n")}>
      <span className="fin-in">{money(row.paid)}</span>
      <small>{row.payments.map((item) => dayShort(item.date)).join(", ")}</small>
    </span>
  );
}

/** Отнести документ к договору: кандидаты сопоставления и поиск по договорам юрлица базы. */
function Picker({
  doc,
  candidates,
  onPick,
  onClose,
}: {
  doc: OnecLoose;
  candidates: Array<{ contract_id: string; number: string; customer: string; executor?: string }>;
  onPick: (contractId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  // Ответ поиска помнит, на какой запрос он пришёл: устаревший не показывается.
  const [found, setFound] = useState<{
    query: string;
    items: Array<{ contract_id: string; number: string; customer: string; executor?: string }>;
  }>({ query: "", items: [] });
  useEffect(() => {
    const text = query.trim();
    if (!text) return;
    const timer = window.setTimeout(() => {
      financeApi
        .onecChoices(doc.base_id, text)
        .then((data) => setFound({ query: text, items: data.items }))
        .catch(() => setFound({ query: text, items: [] }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, doc.base_id]);
  const text = query.trim();
  const list = text ? (found.query === text ? found.items : []) : candidates;
  return (
    <div className="onec-picker">
      <input
        className="input-field"
        autoFocus
        placeholder="№ договора или клиент"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      />
      <div className="onec-picker-list">
        {list.map((item) => (
          <button key={item.contract_id} type="button" className="fin-chip" onClick={() => onPick(item.contract_id)}>
            {item.number || "без номера"} · {item.customer}
            {doc.state === "other_entity" && item.executor ? ` · ${item.executor}` : ""}
          </button>
        ))}
        {!list.length ? <span className="onec-none">{query.trim() ? "Не нашлось" : "Найдите договор по номеру или клиенту"}</span> : null}
      </div>
    </div>
  );
}

export function OnecPanel({ canEdit }: { canEdit: boolean }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [month, setMonth] = useSessionState("onec.month", currentMonth());
  const [baseFilter, setBaseFilter] = useSessionState("onec.base", "");
  const [view, setView] = useState<OnecMonth | null>(null);
  const [viewError, setViewError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [draft, setDraft] = useSessionState("onec.new", { url: "", login: "odata.user" });
  const [password, setPassword] = useState("");
  const [picking, setPicking] = useState<string>("");
  const [removing, setRemoving] = useState<OnecBase | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await financeApi.onec());
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Базы 1С не пришли");
    }
  }, []);

  // На экран попадает только ответ на последний запрос: месяц, открытый при
  // входе, иначе приходил позже выбранного стрелкой и затирал его - заголовок
  // говорил «сентябрь», а в таблице стоял октябрь.
  const asked = useRef(0);
  const loadMonth = useCallback(async () => {
    const ticket = ++asked.current;
    try {
      const data = await financeApi.onecMonth(month, baseFilter || null);
      if (ticket !== asked.current) return;
      setView(data);
      setViewError("");
    } catch (exc) {
      if (ticket !== asked.current) return;
      setViewError(exc instanceof Error ? exc.message : "Месяц не пришёл");
    }
  }, [month, baseFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const bases = overview?.bases ?? [];
  useEffect(() => {
    if (bases.length) void loadMonth();
  }, [bases.length, loadMonth]);

  const act = async (key: string, action: () => Promise<unknown>, after?: () => Promise<void>) => {
    setBusy(key);
    setError("");
    try {
      await action();
      await load();
      if (after) await after();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не получилось");
    } finally {
      setBusy("");
    }
  };

  const connect = () =>
    act(
      "connect",
      async () => {
        const base = await financeApi.connectOnec({ url: draft.url, login: draft.login, password });
        setPassword("");
        setDraft({ url: "", login: "odata.user" });
        setConnecting(false);
        // Документы - сразу: человек подключил базу, чтобы увидеть их.
        const result = await financeApi.syncOnec(base.id);
        if (!result.ok) throw new Error(result.error);
      },
      loadMonth,
    );

  const sync = (base: OnecBase) =>
    act(
      `sync:${base.id}`,
      async () => {
        const result = await financeApi.syncOnec(base.id);
        if (!result.ok) throw new Error(result.error);
      },
      loadMonth,
    );

  const decide = async (doc: OnecLoose, body: { action: "link" | "none"; contract_id?: string }) => {
    setBusy(`doc:${doc.id}`);
    try {
      await financeApi.onecDecide(doc.id, body);
      setPicking("");
      await loadMonth();
    } catch (exc) {
      setViewError(exc instanceof Error ? exc.message : "Не получилось");
    } finally {
      setBusy("");
    }
  };

  // Пока ответ за выбранный месяц не пришёл, прежний месяц не показывается.
  const shown = view && view.month === month ? view : null;
  const totals = shown?.totals;
  const showForm = canEdit && (connecting || (overview !== null && !bases.length));
  const knownMonths = useMemo(() => new Set(view?.months ?? []), [view?.months]);

  return (
    <div className="onec">
      {error ? <p className="onec-error">{error}</p> : null}

      {bases.length ? (
        <div className="fin-card overflow-x-auto">
          <table className="fin-table onec-bases">
            <thead>
              <tr>
                <th>База 1С</th>
                <th>Юрлицо в реестре</th>
                <th>Прочитано</th>
                <th>Документы</th>
                {canEdit ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {bases.map((base) => (
                <tr key={base.id} style={base.state === "active" ? undefined : { opacity: 0.55 }}>
                  <td className="fin-strong">
                    <span className="onec-doc">
                      <span>{base.title}</span>
                      <small>
                        {[base.organization_name !== base.title ? base.organization_name : "", base.organization_bin, base.url.replace("https://", "")]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                    {base.organizations.length > 1 && canEdit ? (
                      <ChoiceSelect
                        className="input-field onec-select"
                        value={base.organization_ref}
                        placeholder="организация базы"
                        onChange={(value) => void act(`org:${base.id}`, () => financeApi.updateOnec(base.id, { organization_ref: value }))}
                      >
                        {base.organizations.map((item) => (
                          <option key={item.ref} value={item.ref}>
                            {item.name}
                          </option>
                        ))}
                      </ChoiceSelect>
                    ) : null}
                    {base.last_error ? <p className="onec-error">{base.last_error}</p> : null}
                    {base.warnings.map((item) => (
                      <p key={item} className="onec-note">
                        {item}
                      </p>
                    ))}
                  </td>
                  <td>
                    {canEdit ? (
                      <ChoiceSelect
                        className="input-field onec-select"
                        value={base.group_entity_id ?? ""}
                        placeholder="не выбрано"
                        clearable
                        onChange={(value) =>
                          void act(
                            `entity:${base.id}`,
                            () =>
                              financeApi.updateOnec(
                                base.id,
                                value ? { group_entity_id: value } : { clear_group_entity: true },
                              ),
                            loadMonth,
                          )
                        }
                      >
                        {(overview?.entities ?? []).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </ChoiceSelect>
                    ) : (
                      base.group_entity || "-"
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {base.last_ok_at ? `${formatDay(base.last_ok_at)} ${formatTime(base.last_ok_at)}` : "ещё не читалась"}
                  </td>
                  <td>{counts(base) || "-"}</td>
                  {canEdit ? (
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={Boolean(busy)}
                        onClick={() => void sync(base)}
                      >
                        {busy === `sync:${base.id}` ? "Читаем…" : "Обновить"}
                      </button>{" "}
                      <button
                        type="button"
                        className="fin-chip"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void act(`state:${base.id}`, () =>
                            financeApi.updateOnec(base.id, { state: base.state === "active" ? "off" : "active" }),
                          )
                        }
                      >
                        {base.state === "active" ? "выключить" : "включить"}
                      </button>{" "}
                      <button type="button" className="fin-chip" disabled={Boolean(busy)} onClick={() => setRemoving(base)}>
                        отключить
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {canEdit && bases.length && !connecting ? (
        <button type="button" className="btn-ghost btn-sm onec-add" onClick={() => setConnecting(true)}>
          Подключить ещё базу 1С
        </button>
      ) : null}

      {showForm ? (
        <form
          className="fin-card onec-form"
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <label className="onec-field onec-field-wide">
            <span className="fin-label">Адрес базы</span>
            <input
              className="input-field"
              required
              placeholder="https://1cfresh.kz/a/ea201/284171"
              value={draft.url}
              onChange={(event) => setDraft({ ...draft, url: event.target.value })}
            />
          </label>
          <label className="onec-field">
            <span className="fin-label">Пользователь REST-сервиса</span>
            <input
              className="input-field"
              required
              autoComplete="off"
              value={draft.login}
              onChange={(event) => setDraft({ ...draft, login: event.target.value })}
            />
          </label>
          <label className="onec-field">
            <span className="fin-label">Пароль</span>
            <input
              className="input-field"
              required
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <div className="onec-form-go">
            <button
              type="submit"
              className="btn-primary"
              disabled={Boolean(busy) || overview?.secrets_ready === false}
            >
              {busy === "connect" ? "Подключаем…" : "Подключить"}
            </button>
            {bases.length ? (
              <button type="button" className="btn-ghost" onClick={() => setConnecting(false)}>
                Отмена
              </button>
            ) : null}
          </div>
          {overview?.secrets_ready === false ? (
            <p className="onec-error onec-form-note">
              На сервере не задан ключ FINANCE_SECRETS_KEY - пароль подключения сохранить нечем
            </p>
          ) : null}
        </form>
      ) : null}

      {!bases.length && overview && !canEdit ? <p className="onec-none">Баз 1С пока нет</p> : null}

      {bases.length ? (
        <section className="onec-month">
          <div className="onec-month-head">
            <div className="onec-month-nav">
              <button type="button" className="btn-ghost btn-sm" aria-label="Предыдущий месяц" onClick={() => setMonth(shiftMonth(month, -1))}>
                ‹
              </button>
              <h3 className="onec-month-title">{formatMonth(month)}</h3>
              <button type="button" className="btn-ghost btn-sm" aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(month, 1))}>
                ›
              </button>
            </div>
            {bases.length > 1 ? (
              <ChoiceSelect className="input-field onec-select" value={baseFilter} placeholder="все базы" clearable onChange={setBaseFilter}>
                {bases.map((base) => (
                  <option key={base.id} value={base.id}>
                    {base.title}
                  </option>
                ))}
              </ChoiceSelect>
            ) : null}
            {totals ? (
              <p className="onec-totals">
                договоров {totals.contracts} · счёт {totals.invoices} · оплата {totals.paid} · АВР {totals.sales} · подписан{" "}
                {totals.signed} · ЭСФ {totals.esf}
              </p>
            ) : null}
          </div>
          {viewError ? <p className="onec-error">{viewError}</p> : null}
          {shown && !shown.rows.length && !shown.unmatched.length ? (
            <p className="onec-none">
              {knownMonths.size ? "В этом месяце документов 1С нет" : "Документов 1С пока нет - нажмите «Обновить» у базы"}
            </p>
          ) : null}
          {shown && shown.rows.length ? (
            <div className="fin-card overflow-x-auto">
              <table className="fin-table onec-table">
                <thead>
                  <tr>
                    <th>Клиент</th>
                    <th>Договор</th>
                    <th>Счёт</th>
                    <th>Оплата</th>
                    <th>АВР</th>
                    <th>Подписан</th>
                    <th>ЭСФ</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.rows.map((row) => (
                    <tr key={row.contract_id}>
                      <td className="fin-strong">{row.customer || "-"}</td>
                      <td>
                        <span className="onec-doc">
                          <span>{row.number || "без номера"}</span>
                          {row.amount ? <small>{money(row.amount)}</small> : null}
                        </span>
                      </td>
                      <td>
                        <DocLines docs={row.invoices} />
                      </td>
                      <td>
                        <PaidCell row={row} />
                      </td>
                      <td>
                        <DocLines docs={row.sales} />
                      </td>
                      <td>{row.signed_at ? dayShort(row.signed_at) : <span className="onec-none">-</span>}</td>
                      <td>
                        <EsfCell row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {shown && shown.unmatched.length ? (
            <>
              <h3 className="onec-sub">Без договора в реестре · {shown.unmatched.length}</h3>
              <div className="fin-card overflow-x-auto">
                <table className="fin-table onec-table">
                  <thead>
                    <tr>
                      <th>Документ</th>
                      <th>Клиент в 1С</th>
                      <th>Договор в 1С</th>
                      <th className="fin-num">Сумма</th>
                      <th>Почему</th>
                      {canEdit ? <th /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.unmatched.map((doc) => (
                      <tr key={doc.id}>
                        <td className="fin-strong" style={{ whiteSpace: "nowrap" }}>
                          {KIND_TITLE[doc.kind]} {doc.number} · {formatDay(doc.date)}
                        </td>
                        <td>
                          <span className="onec-doc">
                            <span>{doc.party || "-"}</span>
                            {doc.party_bin ? <small>{doc.party_bin}</small> : null}
                          </span>
                        </td>
                        <td>{doc.contract_number || "-"}</td>
                        <td className="fin-num">{money(doc.amount) || "-"}</td>
                        <td>
                          {WHY[doc.state]}
                          {picking === doc.id ? (
                            <Picker
                              doc={doc}
                              candidates={doc.candidates.map((id) => shown.candidates[id]).filter(Boolean)}
                              onPick={(contractId) => void decide(doc, { action: "link", contract_id: contractId })}
                              onClose={() => setPicking("")}
                            />
                          ) : null}
                        </td>
                        {canEdit ? (
                          <td style={{ whiteSpace: "nowrap" }}>
                            {doc.state !== "no_entity" ? (
                              <button
                                type="button"
                                className="fin-chip"
                                disabled={busy === `doc:${doc.id}`}
                                onClick={() => setPicking(picking === doc.id ? "" : doc.id)}
                              >
                                {picking === doc.id ? "закрыть" : "к договору"}
                              </button>
                            ) : null}{" "}
                            <button
                              type="button"
                              className="fin-chip"
                              disabled={busy === `doc:${doc.id}`}
                              onClick={() => void decide(doc, { action: "none" })}
                            >
                              не по договору
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title={`Отключить «${removing?.title ?? ""}»?`}
        text="Документы этой базы уйдут из KORT. В самой 1С ничего не изменится."
        confirm="Отключить"
        danger
        busy={Boolean(busy)}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (target) void act(`remove:${target.id}`, () => financeApi.deleteOnec(target.id), loadMonth);
        }}
      />
    </div>
  );
}
