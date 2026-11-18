"use client";

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CloseIcon } from "@/components/icons";
import { useScrollLock } from "@/components/use-scroll-lock";
import {
  type JournalAccepted,
  type JournalDictionaries,
  type JournalPreview,
  type JournalPreviewRow,
  financeApi,
  formatMoney,
} from "@/components/finance/api";
import { dotted } from "@/components/finance/journal-format";

type Props = {
  preview: JournalPreview;
  dictionaries: JournalDictionaries | null;
  /**
   * Ответ на вопрос разбора (порядок дат, счёт выписки) - тот же файл
   * разбирается заново. `create` - завести счёт с номером из выписки и
   * разобрать на него.
   */
  onAnswer: (params: { date_order?: string; default_account?: string; create?: { name: string; number: string } }) => void;
  onClose: () => void;
  onAccepted: (done: JournalAccepted) => void;
  onRejected: () => void;
};

/** Строка таблицы окна: новая из файла или запись журнала, которая уже есть. */
type Line =
  | { kind: "new"; key: string; day: string; row: JournalPreviewRow }
  | { kind: "old"; key: string; day: string; cells: Record<string, string> };

const ROW_H = 34;
const OVERSCAN = 12;
/** Ширина колонок окна - узкие колонки журнала BBC, длинный текст обрезается и виден целиком в подсказке. */
const WIDTHS: Record<string, number> = {
  pnl: 128, paid_at: 92, account: 210, income: 116, expense: 116, counterparty: 190, split: 118,
  contract_ref: 104, category: 160, details: 130, project: 96, group: 104, comment: 300, note: 170,
};
const EDITABLE = new Set([
  "pnl", "paid_at", "account", "income", "expense", "counterparty", "contract_ref", "category", "details", "project", "comment", "note",
]);
const STATE_TITLES: Record<JournalPreviewRow["state"], string> = {
  imported: "новая",
  failed: "отложена",
  duplicate: "повтор",
  skipped: "не запись",
};

/**
 * Окно загрузки выписки или шаблона - широкое, с журналом внутри.
 *
 * Показывает не голый список из файла, а журнал, каким он станет после
 * «Принять»: строки журнала тех же дней и счетов стоят на своих местах, а
 * новые встают между ними по датам и подсвечиваются зелёным несколько раз
 * (решение владельца 04.11.2026 - единственное место, где зелёный значит не
 * приход денег, а «эта строка добавится»). После вспышки у новой строки
 * остаётся черта слева: где новое, видно и через минуту.
 *
 * «Отредактировать» превращает ячейки новых строк в поля: правка ложится в
 * строку загрузки на сервере (`PATCH …/rows/{line}`) и проверяется так же,
 * как правка записи. Повтор и возможный повтор не заводятся без решения
 * человека - «Завести всё равно» у строки.
 *
 * Строк бывает тысячи (журнал за полгода шаблоном), поэтому рисуются только
 * видимые - высота строки постоянная, остальное - пустое место прокрутки.
 */
export function JournalPreviewDialog({ preview, dictionaries, onAnswer, onClose, onAccepted, onRejected }: Props) {
  // Новая загрузка - новое окно (`key` - партия), строки живут здесь до «Принять».
  const [rows, setRows] = useState<JournalPreviewRow[]>(preview.rows);
  const [editing, setEditing] = useState(false);
  const [withContext, setWithContext] = useState(true);
  const [only, setOnly] = useState<"" | "failed" | "duplicate">("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [createAccounts, setCreateAccounts] = useState(true);
  useScrollLock(true);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const counts = useMemo(() => {
    const out = { ready: 0, failed: 0, duplicate: 0, skipped: 0 };
    for (const row of rows) {
      if (row.state === "imported") out.ready += 1;
      else if (row.state === "failed") out.failed += 1;
      else if (row.state === "duplicate") out.duplicate += 1;
      else out.skipped += 1;
    }
    return out;
  }, [rows]);
  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const row of rows) {
      if (row.state !== "imported") continue;
      income += Number(row.cells.income || 0);
      expense += Number(row.cells.expense || 0);
    }
    return { income, expense };
  }, [rows]);

  const lines = useMemo<Line[]>(() => {
    const fresh: Line[] = rows
      .filter((row) => (only ? row.state === only : withContext ? row.state !== "skipped" : true))
      .map((row) => ({ kind: "new", key: `n${row.line}`, day: row.cells.paid_at || "", row }));
    if (!withContext || only) return fresh;
    const old: Line[] = preview.context.map((item) => ({ kind: "old", key: `o${item.id}`, day: item.cells.paid_at || "", cells: item.cells }));
    // По дням, внутри дня - сначала то, что уже в журнале, потом новое в порядке файла.
    return [...old, ...fresh].sort((a, b) => (a.day === b.day ? (a.kind === b.kind ? 0 : a.kind === "old" ? -1 : 1) : a.day < b.day ? -1 : 1));
  }, [rows, preview.context, withContext, only]);

  const columns = preview.columns;
  // Последняя колонка - «Замечание»: почему строка отложена или не заведётся.
  const template = `5.5rem ${columns.map((column) => `${WIDTHS[column.key] ?? column.width}px`).join(" ")} 22rem`;

  // Видимое окно строк.
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const onScroll = useCallback(() => {
    const box = scroller.current;
    if (box) setView({ top: box.scrollTop, height: box.clientHeight });
  }, []);
  useEffect(() => {
    onScroll();
    window.addEventListener("resize", onScroll);
    return () => window.removeEventListener("resize", onScroll);
  }, [onScroll]);
  const first = Math.max(0, Math.floor(view.top / ROW_H) - OVERSCAN);
  const last = Math.min(lines.length, Math.ceil((view.top + view.height) / ROW_H) + OVERSCAN);

  // К первой новой строке - сразу: человек открыл окно ради неё.
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const at = lines.findIndex((line) => line.kind === "new");
    box.scrollTop = at > 4 ? (at - 3) * ROW_H : 0;
    onScroll();
    // Только при открытии и смене вида, а не на каждую правку строки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withContext, only, preview.batch_id]);

  const fix = async (line: number, fields: Record<string, unknown>) => {
    setError("");
    try {
      const next = await financeApi.journalPreviewFix(preview.batch_id, line, fields);
      setRows((list) => list.map((row) => (row.line === line ? next : row)));
    } catch (exc) {
      setError(`строка ${line}: ${exc instanceof Error ? exc.message : "не сохранилось"}`);
    }
  };

  const accept = async () => {
    setBusy("accept");
    setError("");
    try {
      onAccepted(await financeApi.journalAccept(preview.batch_id, createAccounts));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не приняли");
    } finally {
      setBusy("");
    }
  };
  const reject = async () => {
    setBusy("reject");
    try {
      await financeApi.journalReject(preview.batch_id);
      onRejected();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не отклонили");
    } finally {
      setBusy("");
    }
  };

  const source =
    preview.source === "template" ? "Журнал из шаблона" : preview.source === "statement" ? "Выписка банка" : "Таблица";
  const statementAccount = preview.statement_account?.account;
  const question = preview.question;

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fin-dialog-scrim jr-preview-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="jr-preview" role="dialog" aria-modal="true" aria-label={`Загрузка ${preview.file_name}`}>
        <div className="jr-preview-head">
          <div className="jr-preview-title">
            <h2>{preview.file_name}</h2>
            <span className="jr-soft">
              {source}
              {statementAccount ? ` · счёт ${statementAccount}` : ""}
            </span>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost p-1.5" aria-label="Закрыть" disabled={Boolean(busy)}>
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="jr-preview-facts">
          <span>
            <b className="fin-num">{counts.ready}</b> новых записей
          </span>
          <span className="fin-num">
            <span className="fin-in">+ {formatMoney(totals.income)}</span> · − {formatMoney(totals.expense)}
          </span>
          {counts.failed ? (
            <button type="button" className="fin-chip" data-on={only === "failed" ? "" : undefined} onClick={() => setOnly(only === "failed" ? "" : "failed")}>
              Отложено {counts.failed}
            </button>
          ) : null}
          {counts.duplicate ? (
            <button type="button" className="fin-chip" data-on={only === "duplicate" ? "" : undefined} onClick={() => setOnly(only === "duplicate" ? "" : "duplicate")}>
              Повторы {counts.duplicate}
            </button>
          ) : null}
          {counts.skipped ? <span className="jr-soft">не записи и вторые стороны переводов: {counts.skipped}</span> : null}
          <span className="jr-preview-views fin-views">
            <button type="button" className="fin-view" aria-current={withContext ? "page" : undefined} onClick={() => setWithContext(true)}>
              Как будет в журнале
            </button>
            <button type="button" className="fin-view" aria-current={!withContext ? "page" : undefined} onClick={() => setWithContext(false)}>
              Только файл
            </button>
          </span>
        </div>

        {preview.accounts_new.length ? (
          <div className="jr-preview-note">
            <label className="jr-check">
              <input type="checkbox" checked={createAccounts} onChange={(event) => setCreateAccounts(event.target.checked)} />
              Завести счета, которых ещё нет: {preview.accounts_new.length}
            </label>
            {/* Длинный список - под словом «какие», иначе он отнимает у таблицы полэкрана. */}
            <details className="jr-accounts" open={preview.accounts_new.length <= 4}>
              <summary className="fin-link-btn">{preview.accounts_new.length <= 4 ? "" : "какие"}</summary>
            <span className="jr-soft">
              {preview.accounts_new
                .map((item) => {
                  const firm = dictionaries?.firms.find((one) => one.id === item.firm_id)?.name;
                  return firm ? `${item.name} (${firm})` : `${item.name} (юрлицо не узнано)`;
                })
                .join("; ")}
            </span>
            </details>
          </div>
        ) : null}

        {question ? (
          <div className="jr-preview-note">
            <b>{question.title}</b> <span className="jr-soft">{question.text}</span>
            <span className="jr-question-options">
              {question.kind === "date_order"
                ? (question.options ?? []).map((option) => (
                    <button key={option.value} type="button" className="btn-ghost text-xs" onClick={() => onAnswer({ date_order: option.value })}>
                      {option.label}
                      {option.example ? ` · ${option.example}` : ""}
                    </button>
                  ))
                : (question.options ?? []).map((option) => (
                    <button key={option.value} type="button" className="btn-ghost text-xs" onClick={() => onAnswer({ default_account: option.value })}>
                      {option.label}
                    </button>
                  ))}
              {question.kind === "account" && question.create?.number ? (
                <NewAccount suggested={question.create.name} number={question.create.number} onCreate={(name) => onAnswer({ create: { name, number: question.create?.number ?? "" } })} />
              ) : null}
            </span>
          </div>
        ) : null}

        <div className="jr-grid-box" ref={scroller} onScroll={onScroll}>
          <div className="jr-grid" style={{ "--jr-cols": template } as CSSProperties}>
            <div className="jr-grid-row jr-grid-head" role="row">
              <span>Строка</span>
              {columns.map((column) => (
                <span key={column.key} className={column.kind === "money" ? "jr-r" : undefined}>
                  {column.title}
                </span>
              ))}
              <span>Замечание</span>
            </div>
            <div style={{ height: lines.length * ROW_H, position: "relative" }}>
              {lines.slice(first, last).map((line, offset) => {
                const top = (first + offset) * ROW_H;
                if (line.kind === "old") {
                  return (
                    <div key={line.key} className="jr-grid-row" data-old="true" style={{ top }}>
                      <span className="jr-soft">в журнале</span>
                      {columns.map((column) => (
                        <Cell key={column.key} kind={column.kind} value={line.cells[column.key] ?? ""} />
                      ))}
                      <span />
                    </div>
                  );
                }
                const row = line.row;
                const problem = row.problems.map((item) => item.text).join("; ");
                return (
                  <div
                    key={line.key}
                    className="jr-grid-row"
                    data-state={row.state}
                    data-new={row.state === "imported" ? "true" : undefined}
                    style={{ top }}
                    title={problem || undefined}
                  >
                    <span className="jr-line">
                      <span className="fin-mono">{row.line}</span>{" "}
                      <span className={row.state === "failed" ? "jr-bad" : "jr-soft"}>{STATE_TITLES[row.state]}</span>
                      {editing && row.state === "duplicate" ? (
                        <button type="button" className="fin-link-btn" onClick={() => void fix(row.line, { force: true })}>
                          завести
                        </button>
                      ) : null}
                    </span>
                    {columns.map((column) =>
                      editing && row.state !== "skipped" && EDITABLE.has(column.key) ? (
                        <EditCell
                          key={`${column.key}:${row.cells[column.key] ?? ""}`}
                          column={column.key}
                          kind={column.kind}
                          value={row.cells[column.key] ?? ""}
                          list={column.key === "account" ? "jrp-accounts" : column.key === "category" ? "jrp-categories" : column.key === "pnl" ? "jr-periods-p" : column.key === "contract_ref" ? "jrp-contracts" : undefined}
                          onSave={(value) => void fix(row.line, { [column.key]: value })}
                        />
                      ) : (
                        <Cell
                          key={column.key}
                          kind={column.kind}
                          value={row.cells[column.key] ?? ""}
                          hint={column.key === "contract_ref" && row.contract_auto ? row.contract_auto : undefined}
                        />
                      ),
                    )}
                    <span className={row.state === "failed" ? "jr-bad" : "jr-soft"}>{problem}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <datalist id="jrp-accounts">
          {(dictionaries?.accounts ?? []).map((item) => (
            <option key={item.id} value={item.name} />
          ))}
          {preview.accounts_new.map((item) => (
            <option key={item.name} value={item.name} />
          ))}
        </datalist>
        <datalist id="jrp-categories">
          {(dictionaries?.categories ?? []).map((item) => (
            <option key={item.id} value={item.name}>
              {item.group}
            </option>
          ))}
        </datalist>
        <datalist id="jr-periods-p">
          {(dictionaries?.periods ?? []).map((item) => (
            <option key={item.value} value={item.title} />
          ))}
        </datalist>
        <datalist id="jrp-contracts">
          {(dictionaries?.contracts ?? []).map((item) => (
            <option key={item.id} value={item.number}>
              {item.customer}
            </option>
          ))}
        </datalist>

        {error ? <p className="jr-bad text-xs" role="alert">{error}</p> : null}
        <div className="jr-preview-foot">
          <button type="button" className="btn-ghost" disabled={Boolean(busy)} onClick={() => void reject()}>
            {busy === "reject" ? "Отклоняем…" : "Отклонить"}
          </button>
          <span className="jr-card-buttons">
            <button type="button" className="btn-ghost" aria-pressed={editing} disabled={Boolean(busy)} onClick={() => setEditing((was) => !was)}>
              {editing ? "Готово" : "Отредактировать"}
            </button>
            <button type="button" className="btn-primary" disabled={Boolean(busy) || counts.ready === 0} onClick={() => void accept()}>
              {busy === "accept" ? "Принимаем…" : `Принять ${counts.ready}`}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function NewAccount({ suggested, number, onCreate }: { suggested: string; number: string; onCreate: (name: string) => void }) {
  const [name, setName] = useState(suggested);
  return (
    <span className="jr-new-account">
      <input className="input-field" value={name} onChange={(event) => setName(event.target.value)} aria-label="Название нового счёта" />
      <button type="button" className="btn-ghost text-xs" disabled={!name.trim()} onClick={() => onCreate(name.trim())}>
        Завести счёт {number}
      </button>
    </span>
  );
}

function Cell({ kind, value, hint }: { kind: string; value: string; hint?: string }) {
  const shown = kind === "money" ? (value ? formatMoney(value) : "") : kind === "date" ? dotted(value) : value;
  return (
    <span className={kind === "money" ? "jr-r fin-num" : undefined} title={hint ? `${value} · ${hint}` : value || undefined}>
      {shown}
      {hint ? <span className="jr-soft"> · авто</span> : null}
    </span>
  );
}

function EditCell({
  column,
  kind,
  value,
  list,
  onSave,
}: {
  column: string;
  kind: string;
  value: string;
  list?: string;
  onSave: (value: string) => void;
}) {
  const initial = kind === "date" ? dotted(value) : kind === "money" && value ? value.replace(".", ",") : value;
  // Свежее значение с сервера пересоздаёт поле (`key` у вызова), а не переписывает его эффектом.
  const [text, setText] = useState(initial);
  const commit = () => {
    if (text.trim() !== initial.trim()) onSave(text);
  };
  return (
    <input
      className="jr-edit"
      aria-label={column}
      list={list}
      value={text}
      inputMode={kind === "money" ? "decimal" : undefined}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        if (event.key === "Escape") {
          event.stopPropagation();
          setText(initial);
        }
      }}
    />
  );
}
