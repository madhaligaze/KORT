"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CloseIcon } from "@/components/icons";
import { useScrollLock } from "@/components/use-scroll-lock";
import {
  type JournalDictionaries,
  type JournalRecord,
  FinanceApiError,
  financeApi,
  formatMoney,
} from "@/components/finance/api";
import { KIND_TITLES, dotted, isoOf, money } from "@/components/finance/journal-format";

type Kind = JournalRecord["kind"];

type Props = {
  /** Правится запись - или заводится новая этого вида. */
  record: JournalRecord | null;
  kind?: Kind;
  dictionaries: JournalDictionaries;
  canEdit: boolean;
  /** Есть ли следующая запись в списке - для «Сохранить и дальше». */
  hasNext: boolean;
  onClose: () => void;
  /** Запись сохранена; `next` - открыть следующую. */
  onSaved: (record: JournalRecord | null, next: boolean) => void;
  onDelete: (record: JournalRecord) => void;
};

type Form = {
  kind: Kind;
  paid_at: string;
  amount: string;
  account: string;
  account_from: string;
  account_to: string;
  counterparty: string;
  category: string;
  contract_ref: string;
  pnl: string;
  details: string;
  project: string;
  comment: string;
  note: string;
};

type Part = { amount: string; pnl: string; contract_ref: string; category: string; note: string };

function today(): string {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
}

function formOf(record: JournalRecord | null, kind: Kind): Form {
  if (!record) {
    return {
      kind, paid_at: today(), amount: "", account: "", account_from: "", account_to: "", counterparty: "",
      category: "", contract_ref: "", pnl: "", details: "", project: "", comment: "", note: "",
    };
  }
  return {
    kind: record.kind,
    paid_at: dotted(record.paid_at),
    amount: record.amount.replace(".", ","),
    account: record.kind === "income" ? record.account_to : record.account_from,
    account_from: record.account_from,
    account_to: record.account_to,
    counterparty: record.counterparty,
    category: record.category,
    contract_ref: record.contract_ref,
    pnl: record.pnl ? record.pnl_title : "",
    details: record.details,
    project: record.project,
    comment: record.comment,
    note: record.note,
  };
}

const plain = (value: string) => value.replace(/\s/g, "").replace(",", ".");

/**
 * Карточка записи журнала - по центру, поверх журнала, закрывается щелчком мимо.
 *
 * Здесь запись «свапается»: сторону меняют одной кнопкой (приход, расход,
 * перевод), счёт остаётся при записи; статья-перемещение делает приход
 * половинкой перевода - то же правило, что у листа, потому что это один и
 * тот же сервер (`journal.edit`). «Сохранить и дальше» открывает следующую
 * запись: месяц разбирают подряд, а не по одной с возвратом к списку.
 */
export function JournalCard({ record, kind = "income", dictionaries, canEdit, hasNext, onClose, onSaved, onDelete }: Props) {
  const initial = useMemo(() => formOf(record, kind), [record, kind]);
  // Другая запись - другая карточка (`key` у вызова): форма собирается заново, без эффекта.
  const [form, setForm] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [parts, setParts] = useState<Part[] | null>(null);
  const first = useRef<HTMLInputElement>(null);
  useScrollLock(true);
  useEffect(() => {
    first.current?.focus();
  }, [record]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (key: keyof Form) => (value: string) => setForm((was) => ({ ...was, [key]: value }));
  const side = form.kind === "income" ? "income" : form.kind === "expense" ? "expense" : "transfer";
  const categories = dictionaries.categories.filter((item) => item.side === side);
  const groups = useMemo(() => {
    const out = new Map<string, typeof categories>();
    for (const item of categories) {
      if (dictionaries.categories.some((other) => other.parent_id === item.id)) continue; // группа - не статья
      const key = item.group || "";
      out.set(key, [...(out.get(key) ?? []), item]);
    }
    return out;
  }, [categories, dictionaries.categories]);
  const contracts = dictionaries.contracts;

  const changed = (): Record<string, string> => {
    const out: Record<string, string> = {};
    const keys: (keyof Form)[] = ["paid_at", "counterparty", "category", "contract_ref", "pnl", "details", "project", "comment", "note"];
    for (const key of keys) if (form[key] !== initial[key]) out[key] = form[key];
    if (form.kind !== initial.kind) out.kind = form.kind;
    if (form.kind === "transfer") {
      if (form.account_from !== initial.account_from || form.kind !== initial.kind) out.account_from = form.account_from;
      if (form.account_to !== initial.account_to || form.kind !== initial.kind) out.account_to = form.account_to;
      if (plain(form.amount) !== plain(initial.amount)) out.amount = form.amount;
    } else {
      if (form.account !== initial.account) out.account = form.account;
      if (plain(form.amount) !== plain(initial.amount) || form.kind !== initial.kind) out[form.kind] = form.amount;
    }
    if (out.paid_at) out.paid_at = isoOf(out.paid_at).split("-").reverse().join(".");
    return out;
  };

  const save = async (next: boolean) => {
    setBusy(true);
    setError("");
    try {
      if (!record) {
        const fields: Record<string, string> = { ...form };
        if (form.kind === "transfer") delete fields.account;
        const out = await financeApi.journalCreate(fields);
        onSaved(out.record, next);
        return;
      }
      const fields = changed();
      if (!Object.keys(fields).length) {
        onSaved(record, next);
        return;
      }
      const out = await financeApi.journalEdit(record.id, fields, record.version);
      onSaved(out.record, next);
    } catch (exc) {
      setError(
        exc instanceof FinanceApiError && exc.status === 409
          ? "Запись уже изменили - закройте карточку, журнал покажет свежие значения"
          : exc instanceof Error
            ? exc.message
            : "Не сохранилось",
      );
    } finally {
      setBusy(false);
    }
  };

  const splitTotal = record ? Number(record.amount) : 0;
  const partsSum = (parts ?? []).reduce((sum, part) => sum + (Number(plain(part.amount)) || 0), 0);
  const left = Math.round((splitTotal - partsSum) * 100) / 100;

  const saveSplit = async () => {
    if (!record || !parts) return;
    setBusy(true);
    setError("");
    try {
      await financeApi.journalSplit(
        record.id,
        parts.map((part) => ({
          amount: part.amount,
          ...(part.pnl ? { pnl: part.pnl } : {}),
          ...(part.contract_ref ? { contract_ref: part.contract_ref } : {}),
          ...(part.category ? { category: part.category } : {}),
          ...(part.note ? { note: part.note } : {}),
        })),
        record.version,
      );
      onSaved(null, false);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не разбилось");
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (!record?.split) return;
    setBusy(true);
    try {
      await financeApi.journalJoin(record.split.group);
      onSaved(null, false);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не собралось");
    } finally {
      setBusy(false);
    }
  };

  const readOnly = !canEdit;
  const title = record ? `${KIND_TITLES[form.kind]} · ${dotted(record.paid_at)}` : `Новая запись: ${KIND_TITLES[form.kind].toLowerCase()}`;

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fin-dialog-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="fin-dialog jr-card" role="dialog" aria-modal="true" aria-label={title}>
        <div className="jr-card-head">
          <h2 className="jr-card-title">{title}</h2>
          <button type="button" onClick={onClose} className="btn-ghost p-1.5" aria-label="Закрыть">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="fin-views jr-kinds" role="radiogroup" aria-label="Сторона записи">
          {(["income", "expense", "transfer"] as Kind[]).map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={form.kind === item}
              className="fin-view"
              aria-current={form.kind === item ? "page" : undefined}
              disabled={readOnly || Boolean(record?.split)}
              onClick={() => set("kind")(item)}
            >
              {KIND_TITLES[item]}
            </button>
          ))}
        </div>

        <div className="jr-form">
          <label className="jr-field">
            <span className="fin-label">Дата</span>
            <input ref={first} className="input-field" value={form.paid_at} readOnly={readOnly} onChange={(event) => set("paid_at")(event.target.value)} placeholder="01.06.2026" />
          </label>
          <label className="jr-field">
            <span className="fin-label">Сумма</span>
            <input
              className="input-field fin-num"
              style={{ textAlign: "left" }}
              inputMode="decimal"
              value={form.amount}
              readOnly={readOnly || Boolean(record?.split)}
              onChange={(event) => set("amount")(event.target.value)}
              placeholder="0"
            />
          </label>
          <label className="jr-field">
            <span className="fin-label">ОПиУ период</span>
            <input
              className="input-field"
              list="jr-periods"
              value={form.pnl}
              readOnly={readOnly}
              onChange={(event) => set("pnl")(event.target.value)}
              placeholder="месяц платежа"
            />
          </label>
          {form.kind === "transfer" ? (
            <>
              <label className="jr-field">
                <span className="fin-label">Со счёта</span>
                <AccountSelect value={form.account_from} onChange={set("account_from")} dictionaries={dictionaries} disabled={readOnly} empty="вторая сторона не загружена" />
              </label>
              <label className="jr-field">
                <span className="fin-label">На счёт</span>
                <AccountSelect value={form.account_to} onChange={set("account_to")} dictionaries={dictionaries} disabled={readOnly} empty="вторая сторона не загружена" />
              </label>
            </>
          ) : (
            <label className="jr-field jr-span2">
              <span className="fin-label">Счёт</span>
              <AccountSelect value={form.account} onChange={set("account")} dictionaries={dictionaries} disabled={readOnly} empty="выберите счёт" />
            </label>
          )}
          {form.kind !== "transfer" ? (
            <label className="jr-field jr-span2">
              <span className="fin-label">Контрагент</span>
              <input className="input-field" value={form.counterparty} readOnly={readOnly} onChange={(event) => set("counterparty")(event.target.value)} />
            </label>
          ) : null}
          <label className="jr-field">
            <span className="fin-label">Подкатегория</span>
            <select className="input-field" value={form.category} disabled={readOnly} onChange={(event) => set("category")(event.target.value)}>
              <option value="">{form.kind === "transfer" ? "без статьи" : "без статьи - выберите"}</option>
              {[...groups.entries()].map(([group, items]) =>
                group ? (
                  <optgroup key={group} label={group}>
                    {items.map((item) => (
                      <option key={item.id} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                ) : (
                  items.map((item) => (
                    <option key={item.id} value={item.name}>
                      {item.name}
                    </option>
                  ))
                ),
              )}
              {form.category && !categories.some((item) => item.name === form.category) ? (
                <option value={form.category}>{form.category}</option>
              ) : null}
            </select>
          </label>
          {form.kind !== "transfer" ? (
            <label className="jr-field">
              <span className="fin-label">№Дог.</span>
              <input
                className="input-field"
                list="jr-contracts"
                value={form.contract_ref}
                readOnly={readOnly}
                onChange={(event) => set("contract_ref")(event.target.value)}
                placeholder="номер из реестра"
              />
            </label>
          ) : null}
          <label className="jr-field">
            <span className="fin-label">ФОТ/Детали</span>
            <input className="input-field" value={form.details} readOnly={readOnly} onChange={(event) => set("details")(event.target.value)} />
          </label>
          <label className="jr-field">
            <span className="fin-label">Проект</span>
            <input className="input-field" value={form.project} readOnly={readOnly} onChange={(event) => set("project")(event.target.value)} />
          </label>
          <label className="jr-field jr-wide">
            <span className="fin-label">Комментарии</span>
            <textarea className="input-field" rows={2} value={form.comment} readOnly={readOnly} onChange={(event) => set("comment")(event.target.value)} />
          </label>
          <label className="jr-field jr-wide">
            <span className="fin-label">Доп. комменты / Вопросы</span>
            <textarea className="input-field" rows={1} value={form.note} readOnly={readOnly} onChange={(event) => set("note")(event.target.value)} placeholder="что уточнить" />
          </label>
        </div>
        <datalist id="jr-periods">
          {dictionaries.periods.map((item) => (
            <option key={item.value} value={item.title} />
          ))}
        </datalist>
        <datalist id="jr-contracts">
          {contracts.map((item) => (
            <option key={item.id} value={item.number}>
              {[item.customer, item.department].filter(Boolean).join(" · ")}
            </option>
          ))}
        </datalist>

        {record?.contract ? (
          <div className="jr-contract-box">
            <span className="fin-label">Договор в реестре</span>
            <span>
              {record.contract.number} · {record.contract.customer || "-"}
              {record.contract.department ? ` · ${record.contract.department}` : ""}
            </span>
            <span className="jr-soft">
              {record.contract.status ? `${record.contract.status} · ` : ""}
              сумма {money(record.contract.amount)} · оплачено {money(record.contract.paid)}
              {record.contract.how === "auto" ? " · отнесено по плательщику" : ""}
              {record.contract.how === "refund" ? " · возврат клиенту" : ""}
            </span>
          </div>
        ) : null}

        {record && record.kind !== "transfer" && canEdit ? (
          record.split ? (
            <div className="jr-split">
              <span>
                Часть дробления: {record.split.parts} части, общий {formatMoney(record.split.total)}
                {record.split.ok ? "" : ` - части дают ${formatMoney(record.split.sum)}`}
              </span>
              <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void join()}>
                Собрать обратно
              </button>
            </div>
          ) : parts ? (
            <div className="jr-split jr-split-edit">
              <span className="fin-label">Дробление 1 суммы: части дают сумму выписки {formatMoney(record.amount)}</span>
              {parts.map((part, index) => (
                <div key={index} className="jr-part">
                  <input className="input-field fin-num" style={{ textAlign: "left" }} value={part.amount} placeholder="сумма" onChange={(event) => setParts((list) => list && list.map((item, at) => (at === index ? { ...item, amount: event.target.value } : item)))} />
                  <input className="input-field" list="jr-periods" value={part.pnl} placeholder="ОПиУ" onChange={(event) => setParts((list) => list && list.map((item, at) => (at === index ? { ...item, pnl: event.target.value } : item)))} />
                  <input className="input-field" list="jr-contracts" value={part.contract_ref} placeholder="№Дог." onChange={(event) => setParts((list) => list && list.map((item, at) => (at === index ? { ...item, contract_ref: event.target.value } : item)))} />
                  <input className="input-field" value={part.category} placeholder="статья" onChange={(event) => setParts((list) => list && list.map((item, at) => (at === index ? { ...item, category: event.target.value } : item)))} />
                  <button type="button" className="btn-ghost p-1.5" aria-label="Убрать часть" disabled={parts.length <= 2} onClick={() => setParts((list) => list && list.filter((_, at) => at !== index))}>
                    <CloseIcon size={12} />
                  </button>
                </div>
              ))}
              <div className="jr-split-foot">
                <button type="button" className="fin-link-btn" onClick={() => setParts((list) => list && [...list, { amount: "", pnl: "", contract_ref: form.contract_ref, category: form.category, note: "" }])}>
                  Добавить часть
                </button>
                <span className={left === 0 ? "jr-soft" : "jr-bad"} role="status">
                  {left === 0 ? "сходится до копейки" : left > 0 ? `осталось распределить ${formatMoney(left)}` : `части больше выписки на ${formatMoney(-left)}`}
                </span>
                <button type="button" className="btn-ghost text-xs" onClick={() => setParts(null)}>
                  Не дробить
                </button>
                <button type="button" className="btn-primary text-xs" disabled={busy || left !== 0} onClick={() => void saveSplit()}>
                  Разбить
                </button>
              </div>
            </div>
          ) : (
            <div className="jr-split">
              <span className="jr-soft">Одна сумма выписки за несколько месяцев или договоров</span>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() =>
                  setParts([
                    { amount: "", pnl: form.pnl, contract_ref: form.contract_ref, category: form.category, note: "" },
                    { amount: "", pnl: "", contract_ref: form.contract_ref, category: form.category, note: "" },
                  ])
                }
              >
                Разделить сумму
              </button>
            </div>
          )
        ) : null}

        {error ? <p className="jr-bad text-xs" role="alert">{error}</p> : null}

        <div className="jr-card-foot">
          {record && canEdit ? (
            <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => onDelete(record)}>
              Удалить
            </button>
          ) : (
            <span />
          )}
          <span className="jr-card-buttons">
            <button type="button" className="btn-ghost" onClick={onClose}>
              {canEdit ? "Отмена" : "Закрыть"}
            </button>
            {canEdit ? (
              <>
                {record && hasNext ? (
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => void save(true)}>
                    Сохранить и дальше
                  </button>
                ) : null}
                <button type="button" className="btn-primary" disabled={busy} onClick={() => void save(false)}>
                  {busy ? "Сохраняем…" : "Сохранить"}
                </button>
              </>
            ) : null}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AccountSelect({
  value,
  onChange,
  dictionaries,
  disabled,
  empty,
}: {
  value: string;
  onChange: (value: string) => void;
  dictionaries: JournalDictionaries;
  disabled: boolean;
  empty: string;
}) {
  return (
    <select className="input-field" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      <option value="">{empty}</option>
      {dictionaries.accounts.map((item) => (
        <option key={item.id} value={item.name}>
          {item.name}
          {item.firm ? ` · ${item.firm}` : ""}
        </option>
      ))}
    </select>
  );
}
