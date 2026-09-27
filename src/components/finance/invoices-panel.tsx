"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ChoiceSelect } from "@/components/choice-select";
import { useSessionDrop, useSessionState } from "@/components/session-state";
import {
  type Dictionaries,
  type Invoice,
  type InvoiceSide,
  financeApi,
  formatDate,
  formatMoney,
  todayIso,
} from "@/components/finance/api";

type Line = { title: string; quantity: string; price: string };

/**
 * Счета-фактуры.
 *
 * Здесь появляется долг: выставили счёт — дебиторка есть сразу, вместе со
 * сроком, а не тогда, когда кто-то вспомнит отметить ожидание. Счёт держит
 * ссылку на это ожидание, поэтому оплата закрывается в «Долгах», и сумма долга
 * не может разойтись с суммой счёта.
 */
export function InvoicesPanel({
  dictionaries,
  onChanged,
}: {
  dictionaries: Dictionaries;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<Invoice[]>([]);
  const [summary, setSummary] = useState<{ receivable: InvoiceSide; payable: InvoiceSide } | null>(null);
  // Вкладка, открытая форма и набранный счёт переживают перезагрузку
  // (`session-state.tsx`); выставленный счёт черновик стирает.
  const [side, setSide] = useSessionState<"out" | "in">("inv.side", "out");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useSessionState("inv.form", false);
  const dropDraft = useSessionDrop();

  const [lines, setLines] = useSessionState<Line[]>("inv.new.lines", [{ title: "", quantity: "1", price: "" }]);
  const [issuedAt, setIssuedAt] = useSessionState("inv.new.issued", todayIso);
  const [dueAt, setDueAt] = useSessionState("inv.new.due", todayIso);
  const [vatRate, setVatRate] = useSessionState("inv.new.vat", "12");
  const [counterpartyId, setCounterpartyId] = useSessionState("inv.new.counterparty", "");
  const [projectId, setProjectId] = useSessionState("inv.new.project", "");
  const [categoryId, setCategoryId] = useSessionState("inv.new.category", "");
  const [comment, setComment] = useSessionState("inv.new.comment", "");

  const load = useCallback(async () => {
    try {
      const data = await financeApi.invoices();
      setItems(data.items);
      setSummary(data.summary);
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Счета не пришли");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const net = lines.reduce(
      (sum, line) => sum + Number(line.quantity || 0) * Number((line.price || "0").replace(",", ".")),
      0,
    );
    const vat = (net * Number(vatRate || 0)) / 100;
    return { net, vat, gross: net + vat };
  }, [lines, vatRate]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await financeApi.createInvoice({
        kind: side,
        issued_at: issuedAt,
        due_at: dueAt,
        vat_rate: vatRate || "0",
        counterparty_id: counterpartyId || null,
        project_id: projectId || null,
        category_id: categoryId || null,
        comment,
        lines: lines
          .filter((line) => Number(line.price || 0) !== 0)
          .map((line) => ({ title: line.title, quantity: line.quantity || "1", price: line.price })),
      });
      setForm(false);
      setLines([{ title: "", quantity: "1", price: "" }]);
      setComment("");
      dropDraft("inv.new");
      await load();
      onChanged();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Счёт не выставился");
    } finally {
      setBusy(false);
    }
  };

  const drop = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      await financeApi.voidInvoice(id);
      await load();
      onChanged();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Счёт не отменился");
    } finally {
      setBusy(false);
    }
  };

  const shown = items.filter((item) => item.kind === side);
  const money = side === "out" ? summary?.receivable : summary?.payable;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="fin-chip" data-on={side === "out" ? "" : undefined} onClick={() => setSide("out")}>
          Мы выставили
        </button>
        <button type="button" className="fin-chip" data-on={side === "in" ? "" : undefined} onClick={() => setSide("in")}>
          Нам выставили
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn-primary" onClick={() => setForm((was) => !was)}>
          {form ? "Свернуть" : "Новый счёт"}
        </button>
      </div>

      {money ? (
        <div className="fin-kpis">
          <div className="fin-kpi">
            <span className="fin-kpi-label">Выставлено</span>
            <span className="fin-kpi-value">{formatMoney(money.total)}</span>
          </div>
          <div className="fin-kpi">
            <span className="fin-kpi-label">Не оплачено</span>
            <span className="fin-kpi-value">{formatMoney(money.open)}</span>
          </div>
          <div className="fin-kpi">
            <span className="fin-kpi-label">Просрочено</span>
            <span className={`fin-kpi-value ${Number(money.overdue) ? "fin-out" : ""}`}>
              {formatMoney(money.overdue)}
            </span>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
          {error}
        </p>
      ) : null}

      {form ? (
        <div className="fin-card p-3 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <label className="flex flex-col gap-1">
              <span className="fin-label">Дата счёта</span>
              <input className="input-field" type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="fin-label">Срок оплаты</span>
              <input className="input-field" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="fin-label">НДС, %</span>
              <input
                className="input-field fin-num"
                style={{ width: "5rem" }}
                value={vatRate}
                onChange={(e) => setVatRate(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 min-w-[12rem]">
              <span className="fin-label">Контрагент</span>
              <ChoiceSelect className="input-field" value={counterpartyId} onChange={setCounterpartyId} placeholder="не указан" clearable>
                {dictionaries.counterparties.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </ChoiceSelect>
            </label>
            <label className="flex flex-col gap-1 min-w-[12rem]">
              <span className="fin-label">Статья</span>
              <ChoiceSelect className="input-field" value={categoryId} onChange={setCategoryId} placeholder="не указана" clearable>
                {dictionaries.categories
                  .filter((item) => item.side === (side === "out" ? "income" : "expense"))
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </ChoiceSelect>
            </label>
            <label className="flex flex-col gap-1 min-w-[10rem]">
              <span className="fin-label">Проект</span>
              <ChoiceSelect className="input-field" value={projectId} onChange={setProjectId} placeholder="без проекта" clearable>
                {dictionaries.projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </ChoiceSelect>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            {lines.map((line, index) => (
              <div key={index} className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 flex-1 min-w-[12rem]">
                  <span className="fin-label">Позиция</span>
                  <input
                    className="input-field"
                    value={line.title}
                    placeholder="что продаём"
                    onChange={(e) =>
                      setLines((was) => was.map((item, i) => (i === index ? { ...item, title: e.target.value } : item)))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="fin-label">Кол-во</span>
                  <input
                    className="input-field fin-num"
                    style={{ width: "5rem" }}
                    value={line.quantity}
                    onChange={(e) =>
                      setLines((was) => was.map((item, i) => (i === index ? { ...item, quantity: e.target.value } : item)))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="fin-label">Цена</span>
                  <input
                    className="input-field fin-num"
                    style={{ width: "8rem" }}
                    value={line.price}
                    onChange={(e) =>
                      setLines((was) => was.map((item, i) => (i === index ? { ...item, price: e.target.value } : item)))
                    }
                  />
                </label>
                <span className="fin-num" style={{ minWidth: "7rem", color: "var(--text-primary)" }}>
                  {formatMoney(Number(line.quantity || 0) * Number((line.price || "0").replace(",", ".")))}
                </span>
                {lines.length > 1 ? (
                  <button
                    type="button"
                    className="fin-chip"
                    onClick={() => setLines((was) => was.filter((_, i) => i !== index))}
                  >
                    удалить
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              className="fin-chip self-start"
              onClick={() => setLines((was) => [...was, { title: "", quantity: "1", price: "" }])}
            >
              + позиция
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Без НДС <b className="fin-num">{formatMoney(totals.net)}</b>
            </span>
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
              НДС <b className="fin-num">{formatMoney(totals.vat)}</b>
            </span>
            <span className="text-sm" style={{ color: "var(--text-primary)" }}>
              К оплате <b className="fin-num">{formatMoney(totals.gross)}</b>
            </span>
            <input
              className="input-field flex-1 min-w-[10rem]"
              placeholder="комментарий"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <button type="button" className="btn-primary" disabled={busy || totals.gross <= 0} onClick={() => void submit()}>
              {busy ? "Выставляем…" : "Выставить счёт"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="fin-card overflow-x-auto">
        <table className="fin-table">
          <thead>
            <tr>
              <th>Номер</th>
              <th>Дата</th>
              <th>Срок</th>
              <th>Контрагент</th>
              <th style={{ textAlign: "right" }}>Без НДС</th>
              <th style={{ textAlign: "right" }}>НДС</th>
              <th style={{ textAlign: "right" }}>К оплате</th>
              <th>Состояние</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((item) => (
              <tr key={item.id}>
                <td className="fin-strong">{item.number}</td>
                <td>{formatDate(item.issued_at)}</td>
                <td>{formatDate(item.due_at)}</td>
                <td>{item.counterparty || "—"}</td>
                <td className="fin-num">{formatMoney(item.amount_net)}</td>
                <td className="fin-num">{formatMoney(item.vat_amount)}</td>
                <td className={`fin-num ${item.kind === "out" ? "fin-in" : "fin-out"}`}>
                  {formatMoney(item.amount_gross)}
                </td>
                <td>
                  {item.paid ? (
                    "оплачен"
                  ) : item.status === "void" ? (
                    "отменён"
                  ) : item.overdue_days ? (
                    <span className="fin-out">просрочен {item.overdue_days} дн.</span>
                  ) : (
                    "ждём оплату"
                  )}
                </td>
                <td>
                  {!item.paid && item.status !== "void" ? (
                    <button type="button" className="fin-chip" disabled={busy} onClick={() => void drop(item.id)}>
                      отменить
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!shown.length ? (
              <tr>
                <td colSpan={9} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                  Счетов пока нет
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
