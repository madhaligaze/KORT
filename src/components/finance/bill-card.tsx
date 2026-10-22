"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { CloseIcon } from "@/components/icons";
import { useScrollLock } from "@/components/use-scroll-lock";
import {
  type Bill,
  type BillBook,
  type BillCard,
  type BillField,
  financeApi,
  formatMoney,
  todayIso,
} from "@/components/finance/api";

type Form = Record<BillField, string>;

/** «22.10.2026» → «2026-10-22»; непонятное - пусто: дату, которой не понял, KORT не перезаписывает. */
function isoOf(shown: string): string {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(shown.trim());
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** «2026-10-22» → «22.10.2026». */
function shownOf(iso: string | null): string {
  const [year, month, day] = (iso ?? "").split("-");
  return year && month && day ? `${day}.${month}.${year}` : "";
}

/** «с 22.10.2026 года по 21.11.2026 года» - так «Счет за Период» пишут в книгах. */
function periodText(bill: Bill): string {
  if (!bill.period_from) return "";
  const from = `с ${shownOf(bill.period_from)} года`;
  return bill.period_to ? `${from} по ${shownOf(bill.period_to)} года` : from;
}

/**
 * Поля формы из книги. Пока счёт не выставлен, дата - сегодняшняя, а период -
 * из «Периода с/по»: так их заполняют руками. Уйдут в книгу они только вместе
 * с номером (`changes`).
 */
function formOf(book: BillBook, bill: Bill): Form {
  const issued = Boolean(book.fields.bill_no);
  return {
    bill_no: book.fields.bill_no,
    bill_date: isoOf(book.fields.bill_date) || (issued || book.fields.bill_date ? "" : todayIso()),
    bill_period: book.fields.bill_period || (issued ? "" : periodText(bill)),
    note: book.fields.note,
  };
}

/** Что записать: только изменённое - и подставленные дату с периодом, если счёт отмечают выставленным. */
function changes(form: Form, start: Form, book: BillBook): Partial<Form> {
  const out: Partial<Form> = {};
  const number = form.bill_no.trim();
  if (number !== book.fields.bill_no.trim()) out.bill_no = number;
  const issuing = Boolean(out.bill_no) && !book.fields.bill_no;
  if (form.bill_date !== start.bill_date || (issuing && form.bill_date && !book.fields.bill_date)) {
    out.bill_date = form.bill_date;
  }
  const period = form.bill_period.trim();
  if (period !== start.bill_period.trim() || (issuing && period && !book.fields.bill_period)) {
    if (period !== book.fields.bill_period.trim()) out.bill_period = period;
  }
  const note = form.note.trim();
  if (note !== book.fields.note.trim()) out.note = note;
  return out;
}

const PAID: Record<Bill["paid"], string> = { paid: "пришла", part: "пришла частью", "": "-" };

const LABELS: Record<BillField, string> = {
  bill_no: "№ счёта",
  bill_date: "Дата выставления",
  bill_period: "Счёт за период",
  note: "Комментарий",
};

/**
 * Карточка счёта: строка книги-сводки и строка книги юрлица, где счёт отмечают.
 *
 * Отметку KORT ставит туда же, куда человек: «№ Счета» и «Дата выстав. Счета»
 * в помесячной вкладке книги юрлица, а «Счет» книга ставит сама
 * (`contracts/bill_book.py`). В книгу уходит только изменённое и только если
 * в книге оно всё ещё такое, каким его показала карточка: иначе отказ, а не
 * затёртая чужая правка. Открывается из списка и по ссылке из канала
 * (`?s=invoices&bill=<id>`). Много счетов разом - шаблоном Excel раздела
 * (`bills-template.tsx`): его строки пишет та же запись.
 */
export function BillCardDialog({
  id,
  onClose,
  onSaved,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [card, setCard] = useState<BillCard | null>(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [start, setStart] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  useScrollLock(true);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const data = await financeApi.bill(id);
      setCard(data);
      if (data.book) {
        const initial = formOf(data.book, data.bill);
        setForm(initial);
        setStart(initial);
      }
    } catch (exc) {
      setLoadError(exc instanceof Error ? exc.message : "Карточка не открылась");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const bill = card?.bill ?? null;
  const book = card?.book ?? null;
  const editable = Boolean(card?.can_edit && book);
  const issued = Boolean(book?.fields.bill_no);
  const pending = form && start && book ? changes(form, start, book) : {};
  const dirty = Object.keys(pending).length > 0;

  const write = async (values: Partial<Form>, what: "save" | "clear") => {
    if (!book || !bill) return;
    setBusy(true);
    setError("");
    setDone("");
    try {
      const saved = await financeApi.saveBill(id, { values, expect: book.fields });
      const next = { ...card!, book: { ...saved.book, blocked: book.blocked } };
      setCard(next);
      const initial = formOf(next.book, bill);
      setForm(initial);
      setStart(initial);
      setConfirmClear(false);
      const after = saved.book.fields;
      const line = !saved.changed.length
        ? "В книге уже так - записывать нечего."
        : what === "clear"
          ? "Отметка снята: «№ Счета» и дата в книге стёрты."
          : after.bill_no && !book.fields.bill_no
            ? `Записано в книгу: счёт № ${after.bill_no}${after.bill_date ? ` от ${after.bill_date}` : ""}.`
            : "Записано в книгу.";
      setDone(saved.warning ? `${line} ${saved.warning}` : line);
      if (saved.changed.length) onSaved();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "В книгу не записалось");
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (!form) return;
    if (!issued && !form.bill_no.trim()) {
      setError("Впишите № счёта - по нему книга ставит «Счет»");
      return;
    }
    if (form.bill_no.trim() && !form.bill_date) {
      setError("Укажите дату выставления");
      return;
    }
    void write(pending, "save");
  };

  const set =(field: BillField) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setForm((was) => (was ? { ...was, [field]: value } : was));
    setDone("");
    setError("");
  };

  const title = bill?.customer || "Счёт";
  const facts: Array<[string, string]> = bill
    ? [
        ["Период", [shownOf(bill.period_from), shownOf(bill.period_to)].filter(Boolean).join(" - ") || "-"],
        ["Сумма договора", bill.amount !== null && bill.amount !== "" ? formatMoney(bill.amount, { whole: true }) : "-"],
        ["Сотрудник", bill.staff || "-"],
        ...(bill.onec_name ? ([["В 1С", bill.onec_name]] as Array<[string, string]>) : []),
        ...(bill.signed_at ? ([["Договор от", bill.signed_at]] as Array<[string, string]>) : []),
        ["Оплата", PAID[bill.paid]],
        ...(bill.status ? ([["Статус договора", bill.status]] as Array<[string, string]>) : []),
        ["«Счет» в книге", book ? book.state || "-" : bill.text || "-"],
      ]
    : [];

  return createPortal(
    <div
      className="fin-dialog-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="fin-dialog fin-bill-card" role="dialog" aria-modal="true" aria-label={title}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {title}
          </h2>
          <button type="button" onClick={onClose} className="btn-ghost p-1.5" aria-label="Закрыть">
            <CloseIcon size={16} />
          </button>
        </div>

        {loadError ? (
          <p className="text-sm fin-bill-fail">{loadError}</p>
        ) : !card || !bill ? (
          <p className="text-sm fin-muted">Ищем строку в книге юрлица…</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs fin-bill-sub">
              {[bill.number, bill.own, bill.kind, bill.department, bill.month].filter(Boolean).join(" · ")}
            </p>

            <dl className="fin-bill-facts">
              {facts.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>

            {book ? (
              <p className="text-xs fin-bill-sub">
                {book.place.book} · вкладка «{book.place.tab}» ·{" "}
                <a href={book.place.url} target="_blank" rel="noreferrer" className="fin-link-btn">
                  строка {book.place.row}
                </a>
              </p>
            ) : (
              <p className="text-sm fin-bill-fail">{card.problem}</p>
            )}

            {book && form ? (
              <div className="flex flex-col gap-2">
                {(Object.keys(LABELS) as BillField[]).map((field) => {
                  const blocked = book.blocked[field];
                  const value = form[field];
                  if (!editable) {
                    return (
                      <div key={field} className="fin-bill-field">
                        <span className="fin-label">{LABELS[field]}</span>
                        <span className="text-sm">{book.fields[field] || "-"}</span>
                      </div>
                    );
                  }
                  return (
                    <label key={field} className="flex flex-col gap-1">
                      <span className="fin-label">{LABELS[field]}</span>
                      <input
                        className="input-field"
                        type={field === "bill_date" ? "date" : "text"}
                        inputMode={field === "bill_no" ? "numeric" : undefined}
                        value={value}
                        disabled={busy || Boolean(blocked)}
                        maxLength={field === "bill_no" ? 40 : 300}
                        onChange={set(field)}
                      />
                      {blocked ? <span className="text-xs fin-bill-fail">{blocked}</span> : null}
                    </label>
                  );
                })}

                {editable ? (
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy || !dirty}
                      onClick={submit}
                    >
                      {busy ? "Записываем…" : "Записать в книгу"}
                    </button>
                    {issued ? (
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={busy || Boolean(book.blocked.bill_no)}
                        onClick={() =>
                          confirmClear
                            ? void write(book.fields.bill_date ? { bill_no: "", bill_date: "" } : { bill_no: "" }, "clear")
                            : setConfirmClear(true)
                        }
                        onBlur={() => setConfirmClear(false)}
                      >
                        {confirmClear ? "Стереть № и дату в книге?" : "Снять отметку"}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs fin-muted">Отмечать счета могут те, у кого право «Счета: правка».</p>
                )}

                {error ? <p className="text-sm fin-bill-fail">{error}</p> : null}
                {done ? <p className="text-sm">{done}</p> : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
