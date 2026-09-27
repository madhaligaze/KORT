"use client";

import { useState } from "react";

import { type Dictionaries, financeApi, formatMoney } from "@/components/finance/api";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";

type Props = {
  dictionaries: Dictionaries;
  onChanged: () => void;
};

const ROLES: { value: string; title: string }[] = [
  { value: "client", title: "Клиент" },
  { value: "supplier", title: "Поставщик" },
  { value: "staff", title: "Сотрудник" },
  { value: "owner", title: "Владелец" },
  { value: "creditor", title: "Кредитор" },
  { value: "borrower", title: "Заёмщик" },
  { value: "tax", title: "Налоги" },
];

const KINDS: { value: string; title: string }[] = [
  { value: "bank", title: "Банковский счёт" },
  { value: "cash", title: "Касса" },
  { value: "card", title: "Карта" },
  { value: "safe", title: "Сейф" },
  { value: "other", title: "Другое" },
];

/**
 * Справочники: счета, статьи, контрагенты, проекты, теги.
 *
 * Счета стоят первыми и отделены от остального, потому что они единственные,
 * что не создаётся само. Причина записана в импортёре: категория, появившаяся
 * из опечатки, — мусор в списке, а счёт, появившийся из опечатки, — деньги,
 * лежащие неизвестно где.
 */
export function DictionariesPanel({ dictionaries, onChanged }: Props) {
  const [error, setError] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountKind, setAccountKind] = useState("bank");
  const [accountStart, setAccountStart] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [busy, setBusy] = useState(false);

  const addAccount = async () => {
    setBusy(true);
    setError("");
    try {
      await financeApi.createAccount({
        name: accountName,
        kind: accountKind,
        starting_balance: accountStart.replace(/\s/g, "").replace(",", ".") || "0",
        number: accountNumber,
      });
      setAccountName("");
      setAccountStart("");
      setAccountNumber("");
      onChanged();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Счёт не завёлся");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="fin-card p-4 flex flex-col gap-3">
        <div>
          <p className="fin-label">Счета</p>
        </div>
        {dictionaries.accounts.map((account) => (
          <div key={account.id} className="fin-acc-row">
            <span className="fin-acc-name">
              {account.name}
              <span style={{ color: "var(--text-muted)" }}>
                {" · "}
                {KINDS.find((item) => item.value === account.kind)?.title ?? account.kind}
                {account.excluded_from_reports ? " · вне отчётов" : ""}
              </span>
              {account.kind === "bank" || account.kind === "card" || account.number ? (
                <AccountNumber account={account} onSaved={onChanged} onError={setError} />
              ) : null}
            </span>
            <StartingBalance account={account} onSaved={onChanged} onError={setError} />
            <RemoveEntry kind="accounts" id={account.id} name={account.name} onDone={onChanged} onError={setError} />
          </div>
        ))}

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="fin-label">Название</span>
            <input
              className="input-field"
              style={{ width: "12rem" }}
              value={accountName}
              onChange={(event) => setAccountName(event.target.value)}
              placeholder="Kaspi Business"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="fin-label">Тип</span>
            <select
              className="input-field"
              style={{ width: "auto" }}
              value={accountKind}
              onChange={(event) => setAccountKind(event.target.value)}
            >
              {KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="fin-label">Начальный остаток</span>
            <input
              className="input-field fin-num"
              style={{ width: "10rem", textAlign: "left" }}
              value={accountStart}
              onChange={(event) => setAccountStart(event.target.value)}
              placeholder="0"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="fin-label">Номер счёта (IBAN)</span>
            <input
              className="input-field fin-num"
              style={{ width: "15rem", textAlign: "left" }}
              value={accountNumber}
              onChange={(event) => setAccountNumber(event.target.value)}
              placeholder="KZ…"
            />
          </label>
          <button type="button" className="btn-primary" disabled={busy || !accountName.trim()} onClick={addAccount}>
            Завести счёт
          </button>
        </div>
        {error ? (
          <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
            {error}
          </p>
        ) : null}
      </div>

      <EntryList
        title="Статьи доходов"
        kind="categories"
        extra={{ side: "income" }}
        withNature="income"
        items={dictionaries.categories.filter((item) => item.side === "income")}
        onChanged={onChanged}
      />
      <EntryList
        title="Статьи расходов"
        kind="categories"
        extra={{ side: "expense" }}
        withNature="expense"
        items={dictionaries.categories.filter((item) => item.side === "expense")}
        onChanged={onChanged}
      />
      <EntryList
        title="Контрагенты"
        kind="counterparties"
        withRole
        items={dictionaries.counterparties}
        onChanged={onChanged}
      />
      <EntryList title="Проекты" kind="projects" items={dictionaries.projects} onChanged={onChanged} />
      <EntryList title="Теги" kind="tags" items={dictionaries.tags} onChanged={onChanged} />
    </div>
  );
}

/**
 * Природа статьи — чем она является в отчётности.
 *
 * От неё зависят показатели: без неё «Закуп товара» и «Аренда» — просто два
 * расхода, и ни валовую прибыль, ни EBITDA посчитать нечем. «Капитал» —
 * кредиты, их погашение, дивиденды: не доход и не расход.
 */
const NATURES: Record<"income" | "expense", { value: string; title: string }[]> = {
  income: [
    { value: "revenue", title: "выручка" },
    { value: "other", title: "прочий доход" },
    { value: "capital", title: "капитал: кредит, взнос" },
  ],
  expense: [
    { value: "cogs", title: "себестоимость" },
    { value: "operating", title: "операционный" },
    { value: "financial", title: "проценты" },
    { value: "depreciation", title: "амортизация" },
    { value: "tax", title: "налог" },
    { value: "capital", title: "капитал: погашение, дивиденды" },
    { value: "other", title: "прочий" },
  ],
};

function EntryList({
  title,
  kind,
  items,
  extra,
  withRole,
  withNature,
  onChanged,
}: {
  title: string;
  kind: "categories" | "counterparties" | "projects" | "tags";
  items: { id: string; name: string; role?: string; system_key?: string; nature?: string }[];
  extra?: Record<string, string>;
  withRole?: boolean;
  withNature?: "income" | "expense";
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("client");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const add = async () => {
    setBusy(true);
    setError("");
    try {
      await financeApi.createEntry(kind, { name, ...(extra ?? {}), ...(withRole ? { role } : {}) });
      setName("");
      onChanged();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не завелось");
    } finally {
      setBusy(false);
    }
  };

  const setNature = async (id: string, nature: string) => {
    setBusy(true);
    setError("");
    try {
      await financeApi.setCategoryNature(id, nature);
      onChanged();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не сохранилось");
    } finally {
      setBusy(false);
    }
  };

  if (withNature) {
    return (
      <div className="fin-card p-4 flex flex-col gap-2">
        <p className="fin-label">{title}</p>
        <div className="flex flex-col">
          {items.map((item) => (
            <div key={item.id} className="fin-acc-row">
              <span className="fin-acc-name">{item.name}</span>
              <RemoveEntry kind={kind} id={item.id} name={item.name} onDone={onChanged} onError={setError} />
              <select
                className="input-field"
                style={{ width: "auto" }}
                value={item.nature ?? (withNature === "income" ? "revenue" : "operating")}
                disabled={busy}
                onChange={(event) => void setNature(item.id, event.target.value)}
              >
                {NATURES[withNature].map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.title}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {!items.length ? (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Пока пусто
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <input
            className="input-field"
            style={{ width: "14rem" }}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Название"
          />
          <button type="button" className="btn-ghost" disabled={busy || !name.trim()} onClick={() => void add()}>
            Добавить
          </button>
        </div>
        {error ? (
          <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="fin-card p-4 flex flex-col gap-2">
      <p className="fin-label">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.length ? (
          items.map((item) => (
            <span key={item.id} className="badge badge-slate">
              {item.name}
              {withRole && item.role ? (
                <span style={{ opacity: 0.7 }}>
                  {" · "}
                  {ROLES.find((entry) => entry.value === item.role)?.title ?? item.role}
                </span>
              ) : null}
              <RemoveEntry kind={kind} id={item.id} name={item.name} onDone={onChanged} onError={setError} compact />
            </span>
          ))
        ) : (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Пока пусто
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <input
          className="input-field"
          style={{ width: "14rem" }}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Название"
        />
        {withRole ? (
          <select
            className="input-field"
            style={{ width: "auto" }}
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            {ROLES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.title}
              </option>
            ))}
          </select>
        ) : null}
        <button type="button" className="btn-ghost" disabled={busy || !name.trim()} onClick={add}>
          Добавить
        </button>
      </div>
      {error ? (
        <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}


/**
 * «Удалить» у записи справочника: запись уходит в корзину (личный кабинет →
 * «Корзина»), операции с ней остаются как были — удаление мягкое, как и
 * прежний «архив», только теперь его видно и откуда вернуть.
 */
function RemoveEntry({
  kind,
  id,
  name,
  onDone,
  onError,
  compact,
}: {
  kind: string;
  id: string;
  name: string;
  onDone: () => void;
  onError: (text: string) => void;
  compact?: boolean;
}) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        type="button"
        className={compact ? "fin-dict-x" : "fin-link-btn fin-dict-remove"}
        aria-label={`Удалить «${name}»`}
        title="Удалить — в корзину"
        disabled={busy}
        onClick={() => setAsk(true)}
      >
        {compact ? "×" : "Удалить"}
      </button>
      <ConfirmDialog
        open={ask}
        title={`Удалить «${name}»?`}
        text="Запись уйдёт из списков в корзину, операции с ней останутся как были. Вернуть — из корзины в личном кабинете."
        confirm="Удалить"
        danger
        busy={busy}
        onCancel={() => setAsk(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await financeApi.archiveEntry(kind, id);
            setAsk(false);
            onDone();
          } catch (exc) {
            onError(exc instanceof Error ? exc.message : "Не удалилось");
            setAsk(false);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

/**
 * Номер счёта в банке — щелчком, как начальный остаток.
 *
 * По номеру выписка сама находит свой счёт, а перевод на свой депозит
 * отличается от расхода. Номер записывается и сам — при первой заводке
 * выписки на счёт без номера; здесь его видно и можно поправить.
 */
function AccountNumber({
  account,
  onSaved,
  onError,
}: {
  account: Dictionaries["accounts"][number];
  onSaved: () => void;
  onError: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await financeApi.setAccountNumber(account.id, value.trim());
      setEditing(false);
      onError("");
      onSaved();
    } catch (exc) {
      onError(exc instanceof Error ? exc.message : "Номер не записался");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="fin-num text-xs"
        style={{
          display: "block",
          color: "var(--text-muted)",
          textDecoration: "underline dotted",
          textUnderlineOffset: 3,
        }}
        onClick={() => {
          setValue(account.number ?? "");
          setEditing(true);
        }}
        title="Номер счёта в банке"
      >
        {account.number || "номер счёта не указан"}
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1 pt-1">
      <input
        className="input-field fin-num"
        style={{ width: "15rem" }}
        value={value}
        autoFocus
        placeholder="KZ…"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void save();
          if (event.key === "Escape") setEditing(false);
        }}
        aria-label={`Номер счёта «${account.name}»`}
      />
      <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void save()}>
        Сохранить
      </button>
    </span>
  );
}

/**
 * Начальный остаток — щелчком по цифре.
 *
 * Раньше он задавался только при создании счёта, а «Банковский счёт» и
 * «Касса» создаются при регистрации сами, с нулём. Загрузил в них выписку —
 * и остаток навсегда с минусом: учёт начинается с нуля, а карта нет.
 */
function StartingBalance({
  account,
  onSaved,
  onError,
}: {
  account: Dictionaries["accounts"][number];
  onSaved: () => void;
  onError: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await financeApi.setStartingBalance(account.id, value.replace(/\s/g, "").replace(",", ".") || "0");
      setEditing(false);
      onError("");
      onSaved();
    } catch (exc) {
      onError(exc instanceof Error ? exc.message : "Остаток не записался");
    } finally {
      setBusy(false);
    }
  };

  // Справочники открывают остатки сами, так что здесь цифра приходит всегда;
  // проверка — чтобы «null» не стал надписью, если сервер решит иначе.
  if (account.starting_balance === null) return null;
  const start = account.starting_balance;

  if (!editing) {
    return (
      <button
        type="button"
        className="fin-num"
        style={{ color: "var(--text-secondary)", textDecoration: "underline dotted", textUnderlineOffset: 3 }}
        onClick={() => {
          setValue(String(start).replace(".", ","));
          setEditing(true);
        }}
        title="Изменить начальный остаток"
      >
        начальный {formatMoney(start)}
      </button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <input
        className="input-field fin-num"
        style={{ width: "9rem" }}
        value={value}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void save();
          if (event.key === "Escape") setEditing(false);
        }}
        aria-label={`Начальный остаток «${account.name}»`}
      />
      <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void save()}>
        Сохранить
      </button>
    </span>
  );
}
