"use client";

import { useState } from "react";

import {
  type Account,
  type ImportAnswer,
  type ImportPreview,
  type ImportRow,
  type SuggestedAccount,
  financeApi,
  formatDate,
  formatMoney,
} from "@/components/finance/api";
import { PlaceholderOption } from "@/components/placeholder-option";

/**
 * Предпросмотр разбора — общий для файла и для книги Google.
 *
 * Экран устроен вокруг одного решения: **источник не отвергается целиком.**
 * Поэтому здесь три вещи, которых нет у импортёров, что мы разбирали 17 сентября
 * 2026:
 *
 * 1. Сводка «готово / отложено / пропущено» вместо «загрузить не удалось».
 *    Двести строк с одной испорченной — это 199 готовых и одна отложенная.
 * 2. Замечание на строке называет поле и показывает, что стояло в ячейке.
 *    Отложенную строку правят здесь же, не перезагружая источник.
 * 3. Решения видны: какая строка признана шапкой, как прочитан порядок частей
 *    даты и чем это доказано, какие колонки не использованы. Если порядок из
 *    данных не выводится — раздел спрашивает, один раз, а не угадывает построчно.
 *
 * Общий компонент, а не две копии: книга из Google и скачанный файл обязаны
 * показывать одно и то же. Разъехавшись, они показывали бы разное число
 * отложенных строк на одних и тех же данных.
 */
export function PreviewView({
  preview,
  setPreview,
  accounts,
  reload,
  onApplied,
  onReset,
  resetLabel,
  onNext,
}: {
  preview: ImportPreview;
  setPreview: (next: ImportPreview) => void;
  accounts: Account[];
  /** Перечитать источник с ответом на вопрос раздела. */
  reload: (answer: ImportAnswer) => Promise<ImportPreview>;
  onApplied: () => void;
  onReset: () => void;
  resetLabel: string;
  /** Куда идти после того, как операции заведены: разметка статей. */
  onNext?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [showAll, setShowAll] = useState(false);
  /**
   * Строки, поправленные прямо здесь.
   *
   * Они уже готовы, но остаются на экране до следующего чтения источника.
   * Иначе правка выглядит как пропажа: человек выбрал счёт, строка исчезла, и
   * приняли её или потеряли — непонятно.
   */
  const [fixed, setFixed] = useState<Set<number>>(new Set());
  /** Счёт для разом всех отложенных строк, которым его не хватает. */
  const [bulkAccount, setBulkAccount] = useState("");

  const answer = async (patch: ImportAnswer) => {
    setBusy(true);
    setError("");
    try {
      setPreview(await reload(patch));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не прочиталось");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Завести счёт с номером из выписки и перечитать источник.
   *
   * `pick` — сделать новый счёт счётом выписки (ответ на вопрос «на какой
   * счёт»). Без него это второй свой счёт из переводов: депозит, на который
   * уходили деньги, — перечитывание превращает отложенные строки в переводы.
   */
  const createAccount = async (entry: { name: string; number: string; currency?: string }, pick: boolean) => {
    const name = entry.name.trim();
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      await financeApi.createAccount({
        name,
        kind: "bank",
        number: entry.number,
        ...(entry.currency ? { currency: entry.currency } : {}),
      });
      onApplied();
      setPreview(await reload(pick ? { default_account: name } : {}));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Счёт не завёлся");
    } finally {
      setBusy(false);
    }
  };

  const apply = async (lines?: number[]) => {
    setBusy(true);
    setError("");
    try {
      const done = await financeApi.applyBatch(preview.batch_id, lines ? { lines } : {});
      setResult(
        `Завели ${done.imported} ${plural(done.imported, "операцию", "операции", "операций")}` +
          (done.failed ? `, отложено ${done.failed}` : "") +
          (done.duplicate ? `, повторов ${done.duplicate}` : "") +
          (done.skipped ? `, пропущено ${done.skipped}` : "") +
          // Номер записан счёту сам — это решение раздела, и оно должно быть
          // видно: иначе следующая выписка «сама» ляжет на счёт без объяснений.
          (done.remembered ? ` · счёту «${done.remembered.account}» записан номер ${done.remembered.number}` : ""),
      );
      const fresh = await financeApi.importBatch(preview.batch_id);
      setPreview({ ...preview, rows: fresh.rows as ImportRow[] });
      onApplied();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не удалось завести операции");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Завести счета, которых не хватило источнику, и перечитать его.
   *
   * Перечитывание обязательно: отложенные строки ждали именно счёта, и без
   * второго разбора человек увидел бы прежние «счёт не найден» на уже
   * заведённых счетах.
   */
  const addMissingAccounts = async () => {
    setBusy(true);
    setError("");
    try {
      for (const name of preview.accounts_missing) {
        await financeApi.createAccount({ name, kind: "bank" });
      }
      setPreview(await reload({}));
      onApplied();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Счета не завелись");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Поставить счёт всем отложенным строкам, которым его не хватает.
   *
   * У выписки счёт один на весь файл, и спрашивать его в каждой строке — это
   * сотня одинаковых выборов там, где нужен один.
   */
  const setAccountForAll = async (name: string) => {
    if (!name) return;
    setBusy(true);
    setError("");
    try {
      const lines = needAccount.map((row) => row.line);
      for (const row of needAccount) {
        await financeApi.fixImportRow(preview.batch_id, row.line, { [accountField(row)]: name });
      }
      const fresh = await financeApi.importBatch(preview.batch_id);
      setPreview({ ...preview, rows: fresh.rows as ImportRow[] });
      setFixed((was) => {
        const next = new Set(was);
        for (const line of lines) next.add(line);
        return next;
      });
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Счёт не проставился");
    } finally {
      setBusy(false);
    }
  };

  const fixRow = async (line: number, patch: Record<string, unknown>) => {
    try {
      const done = await financeApi.fixImportRow(preview.batch_id, line, patch);
      setPreview({
        ...preview,
        rows: preview.rows.map((row) =>
          row.line === line
            ? { ...row, state: done.state as ImportRow["state"], problems: done.problems, values: done.values }
            : row,
        ),
      });
      if (done.state === "imported") setFixed((was) => new Set(was).add(line));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Правка не сохранилась");
    }
  };

  const failed = preview.rows.filter((row) => row.state === "failed" || fixed.has(row.line));
  /** Отложенные, которым не хватает именно счёта, — их правят одним действием. */
  const needAccount = preview.rows.filter(
    (row) =>
      row.state === "failed" &&
      row.problems.some((problem) => problem.field === "account_from" || problem.field === "account_to"),
  );
  const ready = preview.rows.filter((row) => row.state === "imported");
  const skipped = preview.rows.filter((row) => row.state === "skipped" || row.state === "duplicate");
  /**
   * Повторы считаем отдельно от прочих пропущенных.
   *
   * «Пропущено 2050» на повторной загрузке того же файла читается как поломка
   * разбора. Причина другая и она хорошая: эти операции уже в учёте. Разница
   * между «не понял файл» и «этот файл уже заводили» — это разница между
   * «загружу ещё раз» и «всё на месте».
   */
  const duplicate = preview.rows.filter((row) => row.state === "duplicate");

  return (
    <>
      {/* Вопрос задаётся один раз на источник — и только когда ответа в данных нет. */}
      {preview.question ? (
        <div className="fin-card p-4 flex flex-col gap-2" style={{ borderColor: "var(--accent-line)" }}>
          <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {preview.question.title}
          </p>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {preview.question.text}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {preview.question.options.map((option) => (
              <button
                key={option.value}
                type="button"
                className="btn-ghost text-xs"
                disabled={busy}
                onClick={() =>
                  void answer(
                    preview.question?.kind === "account"
                      ? { default_account: option.value }
                      : { date_order: option.value },
                  )
                }
              >
                {option.label}
                {option.example ? ` · ${option.example}` : ""}
              </button>
            ))}
          </div>
          {preview.question.kind === "account" && preview.question.create ? (
            <NewAccount
              key={preview.question.create.number || "new"}
              suggestion={preview.question.create}
              busy={busy}
              label="Завести и загрузить"
              onCreate={(entry) => void createAccount(entry, true)}
            />
          ) : null}
        </div>
      ) : null}

      {/* Главное действие — до списка строк и прилипшее к верху.
          Раньше оно стояло только под таблицей: человек видел «готово завести
          2050», считал дело сделанным и уходил, а в учёте не появлялось ничего.
          Именно так и вышло на проде 18 сентября. */}
      <div className="fin-apply-bar">
        <button type="button" className="btn-primary" disabled={busy || !ready.length} onClick={() => apply()}>
          {busy
            ? "Заводим…"
            : `Завести ${ready.length} ${plural(ready.length, "операцию", "операции", "операций")}`}
        </button>
        {result ? (
          // Без цвета: «заведено» — это «всё хорошо», а цвет в разделе только
          // у отказа (CLAUDE.md, «Индикаторы состояния»).
          <span className="text-sm" style={{ color: "var(--text-primary)" }}>
            {result}
          </span>
        ) : ready.length === 0 && duplicate.length ? (
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {duplicate.length === preview.rows.length
              ? "этот файл уже заводили — всё есть в учёте"
              : `${duplicate.length} ${plural(duplicate.length, "операция", "операции", "операций")} уже в учёте`}
          </span>
        ) : (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            в учёт ещё не записано
          </span>
        )}
        <span style={{ flex: 1 }} />
        {result && onNext ? (
          <button type="button" className="btn-ghost text-xs" onClick={onNext}>
            Разметить статьи
          </button>
        ) : null}
        <button type="button" className="btn-ghost text-xs" onClick={onReset}>
          {resetLabel}
        </button>
      </div>

      <div className="fin-kpis">
        <div className="fin-kpi">
          <span className="fin-kpi-label">Строк в источнике</span>
          <span className="fin-kpi-value">{preview.counts.total}</span>
        </div>
        <div className="fin-kpi">
          <span className="fin-kpi-label">Готово завести</span>
          <span className="fin-kpi-value fin-in">{ready.length}</span>
        </div>
        <div className="fin-kpi">
          <span className="fin-kpi-label">Отложено</span>
          <span className={`fin-kpi-value ${failed.length ? "fin-out" : ""}`}>{failed.length}</span>
        </div>
        <div className="fin-kpi">
          <span className="fin-kpi-label">{duplicate.length ? "Уже в учёте" : "Пропущено"}</span>
          <span className="fin-kpi-value">{duplicate.length || skipped.length}</span>
        </div>
      </div>

      {/* Что разметят правила — до записи. Сервер считал это всегда, а экран
          не показывал, и человек узнавал о разметке уже в отчёте. */}
      {Object.keys(preview.rules_applied ?? {}).length ? (
        <div className="fin-card p-4 flex flex-col gap-1">
          <p className="fin-label mb-1">Правила разметят</p>
          {Object.entries(preview.rules_applied ?? {})
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => (
              <div key={name} className="fin-acc-row">
                <span className="fin-acc-name">{name}</span>
                <span className="fin-num">
                  {count} {plural(count, "строку", "строки", "строк")}
                </span>
              </div>
            ))}
        </div>
      ) : null}

      {preview.bank ? (
        <BankCard
          check={preview.bank}
          busy={busy}
          onSetStart={async () => {
            const bank = preview.bank;
            if (!bank?.account_id || !bank.opening_balance) return;
            setBusy(true);
            setError("");
            try {
              await financeApi.setStartingBalance(bank.account_id, bank.opening_balance);
              setPreview({
                ...preview,
                bank: {
                  ...bank,
                  starting_balance: bank.opening_balance,
                  ledger_opening: bank.opening_balance,
                  can_set_start: false,
                },
              });
              onApplied();
            } catch (exc) {
              setError(exc instanceof Error ? exc.message : "Остаток не записался");
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}

      {preview.accounts_suggested?.length ? (
        <div className="fin-card p-3 flex flex-col gap-2">
          <p className="fin-issue-text">Переводы на свои счета, которых нет в справочнике</p>
          {preview.accounts_suggested.map((entry) => (
            <SuggestedRow key={entry.number} entry={entry} busy={busy} onCreate={(next) => void createAccount(next, false)} />
          ))}
        </div>
      ) : null}

      {preview.accounts_missing.length ? (
        <div className="fin-card p-3 flex flex-col gap-2">
          <p className="fin-issue-text">Счетов нет в справочнике: {preview.accounts_missing.join(", ")}</p>
          {/* Счёт из файла сам не заводится — место, где лежат деньги, не должно
              появляться из опечатки. Но и вбивать двадцать два счёта книги
              руками незачем: список перед глазами, решение за человеком. */}
          <button
            type="button"
            className="btn-ghost text-xs self-start"
            disabled={busy}
            onClick={() => void addMissingAccounts()}
          >
            {busy
              ? "Заводим…"
              : `Завести ${preview.accounts_missing.length} ${plural(
                  preview.accounts_missing.length,
                  "счёт",
                  "счёта",
                  "счетов",
                )}`}
          </button>
        </div>
      ) : null}

      {failed.length ? (
        <div className="fin-card">
          <div
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <p className="fin-label">Отложенные строки — что в них не сошлось</p>
            {needAccount.length > 1 ? (
              <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                Счёт для всех {needAccount.length}
                <select
                  className="input-field"
                  style={{ width: "auto" }}
                  value={bulkAccount}
                  disabled={busy}
                  onChange={(event) => {
                    setBulkAccount(event.target.value);
                    void setAccountForAll(event.target.value);
                  }}
                >
                  <PlaceholderOption>выберите счёт</PlaceholderOption>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.name}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <div>
            {failed.slice(0, showAll ? failed.length : 25).map((row) => (
              <FailedRow
                key={row.line}
                row={row}
                accounts={accounts}
                onFix={fixRow}
                done={row.state === "imported"}
              />
            ))}
          </div>
          {failed.length > 25 && !showAll ? (
            <button type="button" className="btn-ghost m-3 text-xs" onClick={() => setShowAll(true)}>
              Показать все {failed.length}
            </button>
          ) : null}
        </div>
      ) : null}

      {skipped.length ? (
        <details className="fin-card p-3">
          <summary className="text-xs cursor-pointer" style={{ color: "var(--text-secondary)" }}>
            Пропущенные строки — {skipped.length} (итоги, пустые, служебные, повторы)
          </summary>
          <div className="pt-2">
            {skipped.slice(0, 40).map((row) => (
              <div key={row.line} className="fin-row-issue">
                <span className="fin-issue-line">стр. {row.line}</span>
                <span className="fin-issue-skip">{row.problems.map((problem) => problem.text).join("; ")}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {ready.length ? (
        <div className="fin-card overflow-x-auto">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Стр.</th>
                <th>Дата</th>
                <th style={{ textAlign: "right" }}>Сумма</th>
                <th>Вид</th>
                <th>Счёт</th>
                <th>Категория</th>
                <th>Контрагент</th>
                <th>Комментарий</th>
              </tr>
            </thead>
            <tbody>
              {ready.slice(0, 50).map((row) => {
                const values = row.values as Record<string, string | null>;
                return (
                  <tr key={row.line}>
                    <td className="fin-num">{row.line}</td>
                    <td className="fin-strong">{values.paid_at ? formatDate(values.paid_at) : "—"}</td>
                    <td
                      className={`fin-num ${
                        values.kind === "income" ? "fin-in" : values.kind === "expense" ? "fin-out" : ""
                      }`}
                    >
                      {values.amount ? formatMoney(values.amount) : "—"}
                    </td>
                    <td>
                      {values.kind === "income"
                        ? "поступление"
                        : values.kind === "expense"
                          ? "списание"
                          : "перевод"}
                    </td>
                    <td>
                      {values.kind === "transfer"
                        ? `${values.account_from || "—"} → ${values.account_to || "—"}`
                        : values.account_to || values.account_from || "—"}
                    </td>
                    <td>{values.category || "—"}</td>
                    <td>{values.counterparty || "—"}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: "16rem" }}>{values.comment || ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {ready.length > 50 ? (
            <p className="text-xs p-3" style={{ color: "var(--text-muted)" }}>
              Показаны первые 50 строк из {ready.length}
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
          {error}
        </p>
      ) : null}
    </>
  );
}

/**
 * Одна отложенная строка: чего не хватило и поле, чтобы это дописать.
 *
 * Правка идёт по той же строке источника, а не «загрузите исправленный файл»: в
 * книге на двести строк перезагрузка ради одной ячейки — это потеря места, на
 * котором человек остановился.
 */
function FailedRow({
  row,
  accounts,
  onFix,
  done,
}: {
  row: ImportRow;
  accounts: Account[];
  onFix: (line: number, patch: Record<string, unknown>) => void;
  /** Строку уже поправили: она остаётся на месте, но говорит, что готова. */
  done?: boolean;
}) {
  const values = row.values as Record<string, string | null>;
  const fields = new Set(row.problems.map((problem) => problem.field));

  return (
    <div className="fin-row-issue" data-done={done ? "true" : undefined}>
      <span className="fin-issue-line">стр. {row.line}</span>
      <div className="flex flex-col gap-1.5 min-w-0">
        <span className={done ? "text-xs" : "fin-issue-text"} style={done ? { color: "var(--fin-income)" } : undefined}>
          {done
            ? `готово: ${[values.paid_at, values.amount, values.account_to || values.account_from]
                .filter(Boolean)
                .join(" · ")}`
            : row.problems.map((problem) => problem.text).join("; ")}
        </span>
        <span className="text-xs break-words" style={{ color: "var(--text-muted)" }}>
          {Object.entries(row.raw)
            .map(([key, value]) => `${key} = ${String(value)}`)
            .join(" · ") || "пусто"}
        </span>
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {fields.has("paid_at") ? (
            <input
              type="date"
              className="input-field"
              style={{ width: "auto" }}
              defaultValue={values.paid_at ?? ""}
              onChange={(event) => onFix(row.line, { paid_at: event.target.value })}
            />
          ) : null}
          {fields.has("amount") ? (
            <input
              className="input-field fin-num"
              style={{ width: "8rem", textAlign: "left" }}
              placeholder="сумма"
              defaultValue={values.amount ?? ""}
              onBlur={(event) =>
                onFix(row.line, { amount: event.target.value.replace(/\s/g, "").replace(",", ".") })
              }
            />
          ) : null}
          {fields.has("kind") ? (
            <select
              className="input-field"
              style={{ width: "auto" }}
              defaultValue={values.kind ?? ""}
              onChange={(event) => onFix(row.line, { kind: event.target.value })}
            >
              <PlaceholderOption>вид операции</PlaceholderOption>
              <option value="income">поступление</option>
              <option value="expense">списание</option>
              <option value="transfer">перевод</option>
            </select>
          ) : null}
          {fields.has("account_from") || fields.has("account_to") ? (
            <select
              className="input-field"
              style={{ width: "auto" }}
              defaultValue=""
              onChange={(event) => onFix(row.line, { [accountField(row)]: event.target.value })}
            >
              <PlaceholderOption>выберите счёт</PlaceholderOption>
              {accounts.map((account) => (
                <option key={account.id} value={account.name}>
                  {account.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Какое поле счёта дописать в отложенной строке — то, на которое указывает
 * замечание.
 *
 * Раньше поле выводилось из вида операции: поступлению — «на счёт», остальному
 * — «со счёта». У перевода на свой депозит не хватает счёта «куда», и выбор
 * счёта в строке записывался не в то поле: строка так и оставалась отложенной.
 */
function accountField(row: ImportRow): "account_from" | "account_to" {
  const problem = row.problems.find((item) => item.field === "account_from" || item.field === "account_to");
  if (problem) return problem.field as "account_from" | "account_to";
  return row.values.kind === "income" ? "account_to" : "account_from";
}

/** Новый счёт с номером из выписки: имя — подсказка, его можно переписать. */
function NewAccount({
  suggestion,
  busy,
  label,
  onCreate,
}: {
  suggestion: { name: string; number: string; currency: string };
  busy: boolean;
  label: string;
  onCreate: (entry: { name: string; number: string; currency: string }) => void;
}) {
  const [name, setName] = useState(suggestion.name);
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <input
        className="input-field"
        style={{ width: "14rem" }}
        value={name}
        placeholder="Название нового счёта"
        aria-label="Название нового счёта"
        onChange={(event) => setName(event.target.value)}
      />
      {suggestion.number ? (
        <span className="fin-num text-xs" style={{ color: "var(--text-muted)" }}>
          {suggestion.number}
        </span>
      ) : null}
      <button
        type="button"
        className="btn-ghost text-xs"
        disabled={busy || !name.trim()}
        onClick={() => onCreate({ ...suggestion, name })}
      >
        {label}
      </button>
    </div>
  );
}

function SuggestedRow({
  entry,
  busy,
  onCreate,
}: {
  entry: SuggestedAccount;
  busy: boolean;
  onCreate: (entry: { name: string; number: string; currency: string }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2">
      <span className="fin-num text-xs pt-1" style={{ color: "var(--text-secondary)" }}>
        {entry.rows} {plural(entry.rows, "строка", "строки", "строк")}
      </span>
      <NewAccount suggestion={entry} busy={busy} label="Завести счёт" onCreate={onCreate} />
    </div>
  );
}

export function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}


/**
 * Сверка выписки с банком.
 *
 * Банк печатает в выписке остаток на начало и на конец периода. Разобранные
 * строки обязаны пройти ровно этот путь: начало плюс движение — это конец.
 * Сходится — при разборе не потерялось ни одной операции. Не сходится — это
 * видно до того, как операции легли в учёт, а не через месяц в отчёте.
 *
 * Здесь же — начальный остаток счёта из выписки. Без него счёт, в который
 * загрузили выписку за год, показывал минус: учёт начинался с нуля, а карта —
 * нет. Кнопка появляется, только если раньше периода по счёту ничего не было:
 * иначе остаток на начало задают прежние операции, и подгонять его нельзя.
 */
function BankCard({
  check,
  busy,
  onSetStart,
}: {
  check: NonNullable<ImportPreview["bank"]>;
  busy: boolean;
  onSetStart: () => void;
}) {
  const start = check.period_start ? formatDate(check.period_start) : "начало";
  const end = check.period_end ? formatDate(check.period_end) : "конец";
  const gap = check.gap === null ? null : Number(check.gap);
  // Остаток счёта в учёте на начало периода — против банка. Показываем, как
  // только счёт выбран и начальный остаток из выписки не предлагается: тогда
  // именно эта строка говорит, сойдётся ли счёт с банком после загрузки.
  const ledgerGap =
    check.ledger_opening !== null && check.opening_balance !== null && !check.can_set_start
      ? Number(check.ledger_opening) - Number(check.opening_balance)
      : null;
  const who = [check.bank_name, check.card_number, check.account_number, check.owner].filter(Boolean).join(" · ");

  return (
    <div className="fin-card p-4 flex flex-col gap-1">
      <p className="fin-label mb-1">Сверка с банком{who ? ` · ${who}` : ""}</p>
      {/* Решение раздела видно, а не подразумевается: счёт выбран не человеком,
          а по номеру из выписки. Ошибись справочник — это место, где видно. */}
      {check.account && check.account_by === "number" ? (
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          счёт «{check.account}» узнан по номеру
        </span>
      ) : null}
      {check.opening_balance !== null ? (
        <div className="fin-acc-row">
          <span className="fin-acc-name">Банк на {start}</span>
          <span className="fin-num">{formatMoney(check.opening_balance)}</span>
        </div>
      ) : null}
      <div className="fin-acc-row">
        <span className="fin-acc-name">Движение по строкам выписки</span>
        <span className="fin-num">{formatMoney(check.file_net, { sign: true })}</span>
      </div>
      {check.expected_closing !== null ? (
        <div className="fin-acc-row">
          <span className="fin-acc-name">Выходит на {end}</span>
          <span className="fin-num">{formatMoney(check.expected_closing)}</span>
        </div>
      ) : null}
      {check.closing_balance !== null ? (
        <div className="fin-acc-row">
          <span className="fin-acc-name">Банк на {end}</span>
          <span className="fin-num">{formatMoney(check.closing_balance)}</span>
        </div>
      ) : null}
      {gap !== null ? (
        <div className="fin-acc-row">
          <span className="fin-acc-name" style={{ fontWeight: 600 }}>
            {Math.abs(gap) < 0.005 ? "Сошлось с банком" : "Расхождение с банком"}
          </span>
          <span className={`fin-num ${Math.abs(gap) < 0.005 ? "" : "fin-out"}`} style={{ fontWeight: 600 }}>
            {Math.abs(gap) < 0.005 ? "0,00" : formatMoney(gap, { sign: true })}
          </span>
        </div>
      ) : null}
      {ledgerGap !== null ? (
        <div className="fin-acc-row">
          <span className="fin-acc-name">
            В учёте на {start} ({check.account}) — {formatMoney(check.ledger_opening ?? "0")}
          </span>
          <span className={`fin-num ${Math.abs(ledgerGap) < 0.005 ? "" : "fin-out"}`}>
            {Math.abs(ledgerGap) < 0.005 ? "сходится" : formatMoney(ledgerGap, { sign: true })}
          </span>
        </div>
      ) : null}
      {check.can_set_start && check.opening_balance !== null ? (
        <button type="button" className="btn-ghost text-xs self-start mt-2" disabled={busy} onClick={onSetStart}>
          Начальный остаток «{check.account}» — {formatMoney(check.opening_balance)}
        </button>
      ) : null}
    </div>
  );
}
