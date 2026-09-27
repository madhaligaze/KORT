"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ChoiceSelect } from "@/components/choice-select";
import { useSessionState } from "@/components/session-state";
import {
  type Dictionaries,
  type Operation,
  type OperationPage,
  financeApi,
  formatDate,
  formatMoney,
  monthEdges,
} from "@/components/finance/api";
import { OperationDialog } from "@/components/finance/operation-dialog";

type Props = {
  dictionaries: Dictionaries;
  revision: number;
  onChanged: () => void;
};

const PERIODS = [
  { key: "this", title: "Этот месяц" },
  { key: "prev", title: "Прошлый месяц" },
  { key: "quarter", title: "Три месяца" },
  { key: "all", title: "Всё время" },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

/** Строк на одну страницу журнала и сколько раскрывается на экране всего. */
const PAGE = 250;
const PAGE_CEILING = 5000;

function periodRange(key: PeriodKey): { from?: string; to?: string } {
  if (key === "all") return {};
  if (key === "this") return { date_from: monthEdges(0).from, date_to: monthEdges(0).to } as never;
  if (key === "prev") return { date_from: monthEdges(-1).from, date_to: monthEdges(-1).to } as never;
  return { date_from: monthEdges(-2).from, date_to: monthEdges(0).to } as never;
}

/**
 * Журнал операций.
 *
 * Порядок строк — от новых к старым, и это не вкусовщина: работают в конце
 * книги. Урок «Книг», где список открывался на операциях трёхлетней давности.
 *
 * Ожидания (план) не выносятся в отдельный список, а стоят в общем потоке
 * приглушённой строкой. Отдельный список означал бы, что о запланированном
 * платеже узнают, только если в него зайти; в потоке он попадается на глаза
 * тому, кто просто смотрит журнал.
 */
export function Journal({ dictionaries, revision, onChanged }: Props) {
  // Отбор и открытая правка переживают перезагрузку (`session-state.tsx`).
  const [period, setPeriod] = useSessionState<PeriodKey>("journal.period", "this");
  const [kinds, setKinds] = useSessionState<string>("journal.kinds", "");
  const [accountId, setAccountId] = useSessionState("journal.account", "");
  const [categoryId, setCategoryId] = useSessionState("journal.category", "");
  const [search, setSearch] = useSessionState("journal.search", "");
  const [page, setPage] = useState<OperationPage | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useSessionState<Operation | null>("journal.editing", null);
  /**
   * Сколько страниц по 250 уже раскрыто.
   *
   * Раньше «Показать ещё» сдвигало смещение, и вместо добавления строк
   * страница подменялась следующей: первые 250 исчезали, вернуться к ним было
   * нечем. А смена фильтра смещение не сбрасывала — фильтр, под который
   * попадает десять операций, открывался на «второй странице» и показывал
   * «операций нет». Теперь раскрытие копится, а любой фильтр начинает с начала.
   */
  const [pages, setPages] = useState(1);

  const filters = useMemo(
    () => ({
      ...periodRange(period),
      kinds: kinds || undefined,
      account_id: accountId || undefined,
      category_id: categoryId || undefined,
      search: search || undefined,
    }),
    [period, kinds, accountId, categoryId, search],
  );
  useEffect(() => {
    setPages(1);
  }, [filters]);

  const params = useMemo(() => ({ ...filters, limit: Math.min(PAGE * pages, PAGE_CEILING) }), [filters, pages]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const next = await financeApi.operations(params as Record<string, string | number | undefined>);
      setPage(next);
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не удалось прочитать журнал");
    } finally {
      setBusy(false);
    }
  }, [params]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  const remove = async (operation: Operation) => {
    try {
      await financeApi.deleteOperation(operation.id);
      onChanged();
      await load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не удалось удалить операцию");
    }
  };

  const items = page?.items ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="fin-filters flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="fin-label">Период</span>
          <select
            className="input-field"
            style={{ width: "auto" }}
            value={period}
            onChange={(event) => setPeriod(event.target.value as PeriodKey)}
          >
            {PERIODS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.title}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="fin-label">Вид</span>
          <ChoiceSelect
            className="input-field"
            style={{ width: "auto" }}
            value={kinds}
            onChange={setKinds}
            placeholder="Все"
            clearable
          >
            <option value="income">Поступления</option>
            <option value="expense">Списания</option>
            <option value="transfer">Переводы</option>
          </ChoiceSelect>
        </label>

        <label className="flex flex-col gap-1">
          <span className="fin-label">Счёт</span>
          <ChoiceSelect
            className="input-field"
            style={{ width: "auto" }}
            value={accountId}
            onChange={setAccountId}
            placeholder="Все счета"
            clearable
          >
            {dictionaries.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </ChoiceSelect>
        </label>

        <label className="flex flex-col gap-1">
          <span className="fin-label">Категория</span>
          <ChoiceSelect
            className="input-field"
            style={{ width: "auto" }}
            value={categoryId}
            onChange={setCategoryId}
            placeholder="Все категории"
            clearable
          >
            {dictionaries.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </ChoiceSelect>
        </label>

        <label className="flex flex-col gap-1 flex-1 min-w-[10rem]">
          <span className="fin-label">Поиск по комментарию</span>
          <input
            className="input-field"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="номер договора, назначение"
          />
        </label>
        <a className="btn-ghost text-xs" href={financeApi.exportJournalUrl(filters)} download>
          Скачать в Excel
        </a>
      </div>

      {page ? (
        <div className="fin-kpis">
          <div className="fin-kpi">
            <span className="fin-kpi-label">Операций</span>
            <span className="fin-kpi-value">{page.total}</span>
          </div>
          <div className="fin-kpi">
            <span className="fin-kpi-label">Поступило</span>
            <span className="fin-kpi-value fin-in">{formatMoney(page.sums.income)}</span>
          </div>
          <div className="fin-kpi">
            <span className="fin-kpi-label">Списано</span>
            <span className="fin-kpi-value fin-out">{formatMoney(page.sums.expense)}</span>
          </div>
          <div className="fin-kpi">
            <span className="fin-kpi-label">Разница</span>
            <span className="fin-kpi-value">
              {formatMoney(Number(page.sums.income) - Number(page.sums.expense), { sign: true })}
            </span>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
          {error}
        </p>
      ) : null}

      <div className="fin-card overflow-x-auto">
        <table className="fin-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th style={{ textAlign: "right" }}>Сумма</th>
              <th>Счёт</th>
              <th>Контрагент</th>
              <th>Категория</th>
              <th>Проект</th>
              <th>Комментарий</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((operation) => {
              const plan = operation.status === "plan";
              const sign = operation.kind === "income" ? "+" : operation.kind === "expense" ? "−" : "⇄";
              const account =
                operation.kind === "transfer"
                  ? `${operation.account_from} → ${operation.account_to}`
                  : operation.account_to || operation.account_from;
              return (
                <tr key={operation.id} data-plan={plan}>
                  <td className="fin-strong">
                    {formatDate(operation.paid_at)}
                    {plan ? (
                      <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                        ожидание
                      </span>
                    ) : null}
                    {operation.accrued_at && operation.accrued_at !== operation.paid_at ? (
                      <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                        сделка {formatDate(operation.accrued_at)}
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={`fin-num ${
                      operation.kind === "income" ? "fin-in" : operation.kind === "expense" ? "fin-out" : ""
                    }`}
                  >
                    {sign} {formatMoney(operation.amount)}
                  </td>
                  <td>{account}</td>
                  <td>{operation.counterparty || "—"}</td>
                  <td>{operation.category || (operation.kind === "transfer" ? "перевод" : "—")}</td>
                  <td>
                    {operation.projects.length ? (
                      operation.projects.map((project) => project.name).join(", ")
                    ) : (
                      <span style={{ color: "var(--text-muted)" }}>—</span>
                    )}
                    {operation.split_state === "mismatch" ? (
                      <span className="block text-xs fin-out">разнесено больше суммы</span>
                    ) : null}
                  </td>
                  <td style={{ whiteSpace: "normal", maxWidth: "18rem" }}>{operation.comment}</td>
                  <td>
                    <div className="flex gap-1 justify-end">
                      <button
                        type="button"
                        className="fin-chip"
                        onClick={() => setEditing(operation)}
                        title="Открыть карточку"
                      >
                        Править
                      </button>
                      <button
                        type="button"
                        className="fin-chip"
                        onClick={() => remove(operation)}
                        title="Удалить операцию — в корзину"
                      >
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!items.length && !busy ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: "2rem" }}>
                  За этот период операций нет
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {page && page.total > items.length && items.length < PAGE_CEILING ? (
        <button type="button" className="btn-ghost self-start" onClick={() => setPages((was) => was + 1)}>
          Показать ещё {Math.min(PAGE, page.total - items.length)}
        </button>
      ) : null}

      {editing ? (
        <OperationDialog
          kind={editing.kind}
          operation={editing}
          dictionaries={dictionaries}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
