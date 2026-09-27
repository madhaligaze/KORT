"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ChoiceSelect } from "@/components/choice-select";
import { CloseIcon } from "@/components/icons";
import { PlaceholderOption } from "@/components/placeholder-option";
import { useSessionDrop, useSessionState } from "@/components/session-state";
import { useScrollLock } from "@/components/use-scroll-lock";
import {
  type Dictionaries,
  type Operation,
  type OperationKind,
  financeApi,
  formatMoney,
  todayIso,
} from "@/components/finance/api";

type Props = {
  kind: OperationKind;
  /** Открыть сразу как ожидание: из раздела «Долги». */
  plan?: boolean;
  dictionaries: Dictionaries;
  /** Правка существующей операции; пусто — создание новой. */
  operation?: Operation | null;
  onClose: () => void;
  onSaved: () => void;
};

const TITLES: Record<OperationKind, string> = {
  income: "Поступление",
  expense: "Списание",
  transfer: "Перевод между счетами",
};

/**
 * Карточка операции.
 *
 * Полей много, но открыто ровно четыре: счёт, сумма, категория, контрагент, и
 * дата. Остальное — за строкой «Ещё»: дата сделки, период начисления, проект,
 * теги, состояние «это ожидание». Так устроены формы во всех продуктах учёта, и
 * причина не в экономии места: человек заводит операцию десятки раз в день, и
 * каждое лишнее поле в поле зрения — это лишняя пауза.
 *
 * Дата сделки не «дополнительное поле для порядка». Она разводит два отчёта:
 * деньги считаются по дате платежа, прибыль — по дате сделки. Поэтому под ней
 * стоит подпись, объясняющая последствие, а не название.
 */
export function OperationDialog({ kind, plan, dictionaries, operation, onClose: closeDialog, onSaved: savedDialog }: Props) {
  const isTransfer = kind === "transfer";
  const side = kind === "income" ? "income" : "expense";
  const categories = useMemo(
    () => dictionaries.categories.filter((item) => item.side === side),
    [dictionaries.categories, side],
  );

  /**
   * Черновик окна (`session-state.tsx`): перезагрузка страницы возвращает окно
   * с тем, что в нём успели набрать. Стирается, когда окно закрыл человек или
   * операция записана.
   */
  const draft = `op.${operation?.id ?? "new"}.${kind}`;
  const dropDraft = useSessionDrop();
  const onClose = useCallback(() => {
    dropDraft(draft);
    closeDialog();
  }, [dropDraft, draft, closeDialog]);
  const onSaved = () => {
    dropDraft(draft);
    savedDialog();
  };

  const [accountFrom, setAccountFrom] = useSessionState(`${draft}.from`, operation?.account_from_id ?? "");
  const [accountTo, setAccountTo] = useSessionState(`${draft}.to`, operation?.account_to_id ?? "");
  const [amount, setAmount] = useSessionState(`${draft}.amount`, operation?.amount ?? "");
  const [categoryId, setCategoryId] = useSessionState(`${draft}.category`, operation?.category_id ?? "");
  const [counterpartyId, setCounterpartyId] = useSessionState(`${draft}.counterparty`, operation?.counterparty_id ?? "");
  const [paidAt, setPaidAt] = useSessionState(`${draft}.paid`, () => operation?.paid_at ?? todayIso());
  const [accruedAt, setAccruedAt] = useSessionState(`${draft}.accrued`, operation?.accrued_at ?? "");
  const [projectId, setProjectId] = useSessionState(`${draft}.project`, operation?.projects?.[0]?.id ?? "");
  const [comment, setComment] = useSessionState(`${draft}.comment`, operation?.comment ?? "");
  const [status, setStatus] = useSessionState<"fact" | "plan">(
    `${draft}.status`,
    operation?.status ?? (plan ? "plan" : "fact"),
  );
  const [more, setMore] = useSessionState(`${draft}.more`, Boolean(operation?.accrued_at || operation?.projects?.length));
  /**
   * Части платежа по статьям. Пусто — платёж целиком в одной статье.
   *
   * Остаток, не разнесённый по частям, остаётся на основной статье операции:
   * отчёт складывает и части, и остаток, поэтому платёж не теряется и не
   * удваивается.
   */
  const [parts, setParts] = useSessionState<Array<{ category_id: string; amount: string }>>(`${draft}.parts`, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstField = useRef<HTMLSelectElement | null>(null);
  // Какое поле ловит фокус: у поступления это «На счёт», у остальных — «Со
  // счёта». Считается здесь, а не в разметке: внутри ветки условия TypeScript
  // уже сузил `kind`, и сравнение там выглядит как заведомо ложное.
  const focusOn: "from" | "to" = kind === "income" ? "to" : "from";

  // Страница под окном стоит. Общим замком, а не `overflow: hidden` на body:
  // у `html` стоит `overflow-x: clip`, и запрет с body до окна браузера не
  // доходит — журнал под формой прокручивался колесом (проверено 27.09).
  useScrollLock(true);

  // Первое поле в фокусе: форму открывают с клавиатуры и заполняют не глядя.
  useEffect(() => {
    firstField.current?.focus();
  }, []);

  // Esc закрывает — как в остальных окнах приложения.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const body = {
        kind,
        status,
        paid_at: paidAt,
        accrued_at: accruedAt || null,
        amount: amount.replace(/\s/g, "").replace(",", "."),
        account_from_id: isTransfer || kind === "expense" ? accountFrom || null : null,
        account_to_id: isTransfer || kind === "income" ? accountTo || null : null,
        category_id: isTransfer ? null : categoryId || null,
        counterparty_id: isTransfer ? null : counterpartyId || null,
        comment,
        projects: projectId
          ? [{ project_id: projectId, amount: amount.replace(/\s/g, "").replace(",", ".") }]
          : [],
        categories: isTransfer
          ? []
          : parts
              .filter((part) => part.category_id && Number(part.amount.replace(/\s/g, "").replace(",", ".")) > 0)
              .map((part) => ({
                category_id: part.category_id,
                amount: part.amount.replace(/\s/g, "").replace(",", "."),
              })),
      };
      if (operation) await financeApi.patchOperation(operation.id, { ...body, version: operation.version });
      else await financeApi.createOperation(body);
      onSaved();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fin-dialog-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="fin-dialog" role="dialog" aria-modal="true" aria-label={TITLES[kind]}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {operation ? "Правка операции" : TITLES[kind]}
          </h2>
          <button type="button" onClick={onClose} className="btn-ghost p-1.5" aria-label="Закрыть">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          {(isTransfer || kind === "expense") && (
            <label className="flex flex-col gap-1">
              <span className="fin-label">Со счёта</span>
              <ChoiceSelect
                ref={focusOn === "from" ? firstField : undefined}
                className="input-field"
                value={accountFrom}
                onChange={setAccountFrom}
                placeholder="Выберите счёт"
              >
                {dictionaries.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </ChoiceSelect>
            </label>
          )}

          {(isTransfer || kind === "income") && (
            <label className="flex flex-col gap-1">
              <span className="fin-label">На счёт</span>
              <ChoiceSelect
                ref={focusOn === "to" ? firstField : undefined}
                className="input-field"
                value={accountTo}
                onChange={setAccountTo}
                placeholder="Выберите счёт"
              >
                {dictionaries.accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </ChoiceSelect>
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="fin-label">Сумма</span>
            <input
              className="input-field fin-num"
              style={{ textAlign: "left" }}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
            />
          </label>

          {!isTransfer && (
            <>
              <label className="flex flex-col gap-1">
                <span className="fin-label">Категория</span>
                <ChoiceSelect
                  className="input-field"
                  value={categoryId}
                  onChange={setCategoryId}
                  placeholder="Без категории"
                  clearable
                >
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </ChoiceSelect>
              </label>

              <label className="flex flex-col gap-1">
                <span className="fin-label">Контрагент</span>
                <ChoiceSelect
                  className="input-field"
                  value={counterpartyId}
                  onChange={setCounterpartyId}
                  placeholder="Без контрагента"
                  clearable
                >
                  {dictionaries.counterparties.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </ChoiceSelect>
              </label>
            </>
          )}

          <label className="flex flex-col gap-1">
            {/* Для ожидания та же дата означает срок: по ней считается
                просрочка в разделе «Долги». Подпись «Дата платежа» у операции,
                которую ещё не оплатили, вводила в заблуждение. */}
            <span className="fin-label">{status === "plan" ? "Срок оплаты" : "Дата платежа"}</span>
            <input
              className="input-field"
              type="date"
              value={paidAt}
              onChange={(event) => setPaidAt(event.target.value)}
            />
          </label>

          <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
            <input
              type="checkbox"
              checked={status === "plan"}
              onChange={(event) => setStatus(event.target.checked ? "plan" : "fact")}
            />
            Это ожидание, деньги ещё не двигались
          </label>

          {!more ? (
            <button type="button" className="fin-chip self-start" onClick={() => setMore(true)}>
              Ещё: дата сделки, проект, разбивка, комментарий
            </button>
          ) : (
            <>
              {!isTransfer && (
                <label className="flex flex-col gap-1">
                  <span className="fin-label">Дата сделки</span>
                  <input
                    className="input-field"
                    type="date"
                    value={accruedAt}
                    onChange={(event) => setAccruedAt(event.target.value)}
                  />
                </label>
              )}

              <label className="flex flex-col gap-1">
                <span className="fin-label">Проект</span>
                <ChoiceSelect
                  className="input-field"
                  value={projectId}
                  onChange={setProjectId}
                  placeholder="Без проекта"
                  clearable
                >
                  {dictionaries.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </ChoiceSelect>
              </label>

              {!isTransfer ? (
                <div className="flex flex-col gap-1.5">
                  <span className="fin-label">Разбить по статьям</span>
                  {parts.map((part, index) => (
                    <div key={index} className="flex gap-1.5">
                      <select
                        className="input-field"
                        value={part.category_id}
                        onChange={(event) =>
                          setParts((was) =>
                            was.map((item, i) => (i === index ? { ...item, category_id: event.target.value } : item)),
                          )
                        }
                      >
                        <PlaceholderOption>статья</PlaceholderOption>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input-field fin-num"
                        style={{ width: "8rem" }}
                        placeholder="сумма"
                        value={part.amount}
                        onChange={(event) =>
                          setParts((was) =>
                            was.map((item, i) => (i === index ? { ...item, amount: event.target.value } : item)),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="fin-chip"
                        onClick={() => setParts((was) => was.filter((_, i) => i !== index))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="fin-chip self-start"
                      onClick={() => setParts((was) => [...was, { category_id: "", amount: "" }])}
                    >
                      + часть
                    </button>
                    {parts.length ? (
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                        остаток на основной статье:{" "}
                        {formatMoney(
                          Number(amount.replace(/\s/g, "").replace(",", ".") || 0) -
                            parts.reduce(
                              (sum, part) => sum + Number(part.amount.replace(/\s/g, "").replace(",", ".") || 0),
                              0,
                            ),
                        )}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <label className="flex flex-col gap-1">
                <span className="fin-label">Комментарий</span>
                <textarea
                  className="input-field"
                  rows={2}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Например, номер договора"
                />
              </label>
            </>
          )}

          {error ? (
            <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
              {error}
            </p>
          ) : null}

          <div className="flex items-center gap-2 pt-1">
            <button type="button" className="btn-primary" disabled={busy} onClick={submit}>
              {busy ? "Сохраняем…" : operation ? "Сохранить" : "Записать"}
            </button>
            <button type="button" className="btn-ghost" onClick={onClose}>
              Отмена
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
