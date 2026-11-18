"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useSessionState } from "@/components/session-state";
import {
  type JournalAccepted,
  type JournalDictionaries,
  type JournalPage,
  type JournalPreview,
  type JournalRecord,
  financeApi,
  formatMoney,
} from "@/components/finance/api";
import { JournalCard } from "@/components/finance/journal-card";
import { ATTENTION_TITLES, monthOf } from "@/components/finance/journal-format";
import { JournalPreviewDialog } from "@/components/finance/journal-preview";
import { JournalRecords } from "@/components/finance/journal-records";

/**
 * Лист Univer - только по требованию: он тянет канвас и при импорте
 * обращается к `window`, серверная отрисовка его роняет.
 */
const TableView = dynamic(() => import("./table-view").then((m) => m.TableView), {
  ssr: false,
  loading: () => <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>Готовим лист…</div>,
});

type Props = {
  revision: number;
  onChanged: () => void;
  canEdit: boolean;
  /** Табличный вид - своё право «Таблица», как и раньше. */
  canTable: boolean;
  canTableEdit: boolean;
};

type View = "records" | "table";
type Attention = "" | "uncategorized" | "no_contract" | "question" | "half" | "split";

const PAGE = 400;
const ALL = "all";
const UPLOADS = ".pdf,.xlsx,.xls,.xlsm,.csv,.txt,.xml,.html,.htm";

/** Скачать файл из памяти браузера: ссылка на миг, имя - от сервера. */
function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Журнал - главный лист финансистов: строка выписки банка - строка журнала.
 *
 * Два вида на одни и те же записи. «Записи» - лента по дням для разбора:
 * статья, договор юристов, месяц ОПиУ, вопрос - и карточка с «Сохранить и
 * дальше». «Таблица» - тот же журнал колонками журнала BBC в листе Univer,
 * для тех, кто привык к таблице. Правка в одном виде сразу видна в другом:
 * это один сервер и один журнал (`app/finance/journal.py`).
 *
 * Выписка любого банка или заполненный шаблон грузятся одной кнопкой; до
 * «Принять» ничего не пишется - окно показывает, каким станет журнал.
 */
export function Journal({ revision, onChanged, canEdit, canTable, canTableEdit }: Props) {
  const [view, setView] = useSessionState<View>("journal.view", "records");
  const [month, setMonth] = useSessionState<string>("journal.month", "");
  const [firm, setFirm] = useSessionState("journal.firm", "");
  const [account, setAccount] = useSessionState("journal.account", "");
  const [category, setCategory] = useSessionState("journal.category", "");
  const [search, setSearch] = useSessionState("journal.search", "");
  const [attention, setAttention] = useSessionState<Attention>("journal.attention", "");
  const [showBalances, setShowBalances] = useSessionState("journal.balances", false);
  const [templateStep, setTemplateStep] = useSessionState<"download" | "upload">("journal.template", "download");
  const [page, setPage] = useState<JournalPage | null>(null);
  const [pages, setPages] = useState(1);
  const [dicts, setDicts] = useState<JournalDictionaries | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [uploading, setUploading] = useState("");
  const [preview, setPreview] = useState<JournalPreview | null>(null);
  const pending = useRef<File | null>(null);
  const [card, setCard] = useState<{ record: JournalRecord | null; kind: JournalRecord["kind"] } | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const [removed, setRemoved] = useState<{ record: JournalRecord; undo: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [sheetRefresh, setSheetRefresh] = useState(0);

  const shownMonth = month === ALL ? "" : month;
  const filters = useMemo(
    () => ({
      month: shownMonth || undefined,
      firm: firm || undefined,
      accounts: account || undefined,
      categories: category || undefined,
      search: search.trim() || undefined,
      attention: attention || undefined,
    }),
    [shownMonth, firm, account, category, search, attention],
  );
  useEffect(() => setPages(1), [filters]);

  const loadDicts = useCallback(async () => {
    try {
      setDicts(await financeApi.journalDictionaries());
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не прочитались справочники журнала");
    }
  }, []);
  useEffect(() => {
    void loadDicts();
  }, [loadDicts, revision]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const next = await financeApi.journal({ ...filters, limit: PAGE * pages });
      setPage(next);
      setError("");
      // Первый вход: последний месяц, в котором есть записи, - работают в конце журнала.
      if (!month && next.months.length) setMonth(next.months[next.months.length - 1].month);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Журнал не прочитался");
    } finally {
      setBusy(false);
    }
  }, [filters, pages, month, setMonth]);
  useEffect(() => {
    if (view === "records") void load();
  }, [load, revision, view]);

  // Вспышка новых записей гаснет сама; черту у строки держит CSS, пока она в наборе.
  useEffect(() => {
    if (!fresh.size) return;
    const id = window.setTimeout(() => setFresh(new Set()), 6000);
    return () => window.clearTimeout(id);
  }, [fresh]);
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(""), 9000);
    return () => window.clearTimeout(id);
  }, [notice]);

  const changed = () => {
    onChanged();
    setSheetRefresh((value) => value + 1);
  };

  const upload = async (file: File, params: { date_order?: string; default_account?: string } = {}) => {
    setUploading(file.name);
    setError("");
    try {
      pending.current = file;
      setPreview(await financeApi.journalPreview(file, params));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Файл не разобрался");
    } finally {
      setUploading("");
    }
  };

  const answer = async (params: { date_order?: string; default_account?: string; create?: { name: string; number: string } }) => {
    const file = pending.current;
    if (!file) return;
    let chosen = params.default_account;
    if (params.create) {
      try {
        await financeApi.createAccount({ name: params.create.name, kind: "bank", number: params.create.number });
        chosen = params.create.name;
        void loadDicts();
      } catch (exc) {
        setError(exc instanceof Error ? exc.message : "Счёт не завёлся");
        return;
      }
    }
    await upload(file, { date_order: params.date_order, default_account: chosen });
  };

  const accepted = (done: JournalAccepted) => {
    setPreview(null);
    pending.current = null;
    if (templateStep === "upload") setTemplateStep("download");
    setFresh(new Set(done.operation_ids));
    const parts = [`Принято записей: ${done.imported}`];
    if (done.completed) parts.push(`дописано вторых сторон переводов: ${done.completed}`);
    if (done.accounts_created.length) parts.push(`заведено счетов: ${done.accounts_created.length}`);
    if (done.failed) parts.push(`отложено: ${done.failed}`);
    setNotice(parts.join(" · "));
    void loadDicts();
    changed();
  };

  const downloadTemplate = async () => {
    try {
      const file = await financeApi.journalTemplate();
      saveFile(file.blob, file.name);
      setTemplateStep("upload");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Шаблон не скачался");
    }
  };
  const exportExcel = async () => {
    try {
      const file = await financeApi.journalExport(filters);
      saveFile(file.blob, file.name);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Журнал не выгрузился");
    }
  };

  const items = page?.items ?? [];
  const openNext = (after: JournalRecord | null) => {
    if (!after) return setCard(null);
    const index = items.findIndex((item) => item.id === after.id);
    const next = items[index + 1];
    setCard(next ? { record: next, kind: next.kind } : null);
  };

  const remove = async (record: JournalRecord) => {
    setCard(null);
    try {
      const done = await financeApi.deleteOperation(record.id);
      setRemoved(done.undo ? { record, undo: done.undo } : null);
      changed();
      void load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Запись не удалилась");
    }
  };
  const restore = async () => {
    if (!removed) return;
    try {
      await financeApi.undo(removed.undo);
      setFresh(new Set([removed.record.id]));
      setRemoved(null);
      changed();
      void load();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Запись не вернулась");
    }
  };

  const months = page?.months ?? [];
  const accounts = dicts?.accounts ?? [];
  const shownAccounts = firm ? accounts.filter((item) => item.firm_id === firm) : accounts;

  return (
    <div className="jr">
      <div className="jr-head">
        <nav className="fin-views" aria-label="Вид журнала">
          <button type="button" className="fin-view" aria-current={view === "records" ? "page" : undefined} onClick={() => setView("records")}>
            Записи
          </button>
          {canTable ? (
            <button type="button" className="fin-view" aria-current={view === "table" ? "page" : undefined} onClick={() => setView("table")}>
              Таблица
            </button>
          ) : null}
        </nav>
        <div className="jr-actions">
          {canEdit ? (
            <div className="fin-ops" role="group" aria-label="Новая запись">
              <button type="button" className="fin-op" data-kind="income" onClick={() => setCard({ record: null, kind: "income" })}>
                <span className="fin-op-sign">+</span> Приход
              </button>
              <button type="button" className="fin-op" data-kind="expense" onClick={() => setCard({ record: null, kind: "expense" })}>
                <span className="fin-op-sign">−</span> Расход
              </button>
              <button type="button" className="fin-op" onClick={() => setCard({ record: null, kind: "transfer" })}>
                <span className="fin-op-sign">⇄</span> Перевод
              </button>
            </div>
          ) : null}
          <button type="button" className="btn-ghost" onClick={() => void exportExcel()} title="Журнал по отбору - в колонках шаблона">
            Скачать Excel
          </button>
          {canEdit ? (
            <>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => (templateStep === "download" ? void downloadTemplate() : fileInput.current?.click())}
                title={templateStep === "download" ? "Шаблон журнала со справочником компании" : "Загрузить заполненный шаблон"}
              >
                {templateStep === "download" ? "Скачать шаблон" : "Загрузить шаблон"}
              </button>
              <button type="button" className="btn-primary" disabled={Boolean(uploading)} onClick={() => fileInput.current?.click()}>
                {uploading ? "Разбираем…" : "Загрузить выписку"}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept={UPLOADS}
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void upload(file);
                }}
              />
            </>
          ) : null}
        </div>
      </div>

      {/* Полоса месяцев - у листа, как вкладки месяцев в таблицах BBC; в «Записях»
          месяц - поле в ряду отборов, рядом с юрлицом и счётом (владелец, 05.11.2026). */}
      {view === "table" && canTable ? (
        <nav className="jr-months" aria-label="Месяц движения денег">
          {months.map((item) => (
            <button
              key={item.month}
              type="button"
              className="jr-month"
              aria-current={shownMonth === item.month ? "page" : undefined}
              onClick={() => setMonth(item.month)}
            >
              {item.title}
              <span className="jr-month-n fin-mono">{item.count}</span>
            </button>
          ))}
          <button type="button" className="jr-month" aria-current={month === ALL ? "page" : undefined} onClick={() => setMonth(ALL)}>
            Весь журнал
          </button>
        </nav>
      ) : null}

      {error ? <p className="jr-bad text-sm" role="alert">{error}</p> : null}
      {notice ? <p className="text-sm" role="status">{notice}</p> : null}
      {removed ? (
        <p className="text-sm" role="status">
          Запись удалена: {formatMoney(removed.record.amount)} · {removed.record.counterparty || removed.record.comment}
          {" · "}
          <button type="button" className="fin-link-btn" onClick={() => void restore()}>
            Вернуть
          </button>
        </p>
      ) : null}

      {view === "table" && canTable ? (
        <TableView onChanged={onChanged} refresh={sheetRefresh + revision} canEdit={canTableEdit} month={shownMonth} />
      ) : (
        <>
          <div className="jr-filters">
            <select className="input-field" value={month || ALL} onChange={(event) => setMonth(event.target.value)} aria-label="Месяц">
              {months.map((item) => (
                <option key={item.month} value={item.month}>
                  {item.title} · {item.count}
                </option>
              ))}
              <option value={ALL}>Весь журнал</option>
            </select>
            <select className="input-field" value={firm} onChange={(event) => { setFirm(event.target.value); setAccount(""); }} aria-label="Юрлицо">
              <option value="">Все юрлица</option>
              {(dicts?.firms ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select className="input-field" value={account} onChange={(event) => setAccount(event.target.value)} aria-label="Счёт">
              <option value="">Все счета</option>
              {shownAccounts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select className="input-field" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Статья">
              <option value="">Все статьи</option>
              {(dicts?.categories ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.group && item.group !== item.name ? `${item.group} · ${item.name}` : item.name}
                </option>
              ))}
            </select>
            <input
              className="input-field jr-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Контрагент, назначение, №Дог."
              aria-label="Поиск"
            />
          </div>

          {page ? (
            <div className="jr-sums">
              <span>
                <span className="fin-label">Приход</span>
                <span className="fin-num fin-in">{formatMoney(page.sums.income)}</span>
              </span>
              <span>
                <span className="fin-label">Расход</span>
                <span className="fin-num">{formatMoney(page.sums.expense)}</span>
              </span>
              <span>
                <span className="fin-label">Разница</span>
                <span className="fin-num">{formatMoney(page.sums.net, { sign: true })}</span>
              </span>
              <span>
                <span className="fin-label">Перемещения</span>
                <span className="fin-num">{formatMoney(page.sums.transfers)}</span>
              </span>
              <span>
                <span className="fin-label">Записей</span>
                <span className="fin-num">{page.total}</span>
              </span>
              <button type="button" className="fin-link-btn jr-balances-toggle" aria-expanded={showBalances} onClick={() => setShowBalances(!showBalances)}>
                {showBalances ? "Скрыть остатки на счетах" : "Остатки на счетах"}
              </button>
            </div>
          ) : null}

          {page && showBalances ? (
            <div className="fin-card overflow-x-auto">
              <table className="fin-table jr-balances">
                <thead>
                  <tr>
                    <th>Счёт</th>
                    <th>Юрлицо</th>
                    <th className="jr-r">{shownMonth ? `На 1 ${monthOf(shownMonth)}` : "Начало"}</th>
                    <th className="jr-r">Приход</th>
                    <th className="jr-r">Расход</th>
                    <th className="jr-r">Остаток</th>
                  </tr>
                </thead>
                <tbody>
                  {page.balances.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{item.firm || "-"}</td>
                      <td className="fin-num">{formatMoney(item.opening)}</td>
                      <td className="fin-num fin-in">{formatMoney(item.income)}</td>
                      <td className="fin-num">{formatMoney(item.expense)}</td>
                      <td className={`fin-num fin-strong ${Number(item.closing) < 0 ? "fin-out" : ""}`}>{formatMoney(item.closing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {page ? (
            <div className="jr-attention" role="group" aria-label="Требуют внимания">
              {(Object.keys(ATTENTION_TITLES) as Exclude<Attention, "">[]).map((flag) =>
                page.attention[flag] || attention === flag ? (
                  <button
                    key={flag}
                    type="button"
                    className="fin-chip"
                    data-on={attention === flag ? "" : undefined}
                    onClick={() => setAttention(attention === flag ? "" : flag)}
                  >
                    {ATTENTION_TITLES[flag]} <span className="fin-mono">{page.attention[flag]}</span>
                  </button>
                ) : null,
              )}
            </div>
          ) : null}

          <JournalRecords items={items} fresh={fresh} onOpen={(record) => setCard({ record, kind: record.kind })} />
          {page && !items.length && !busy ? (
            <div className="jr-empty">
              {page.months.length ? (
                <p>По этому отбору записей нет.</p>
              ) : (
                <>
                  <p className="jr-empty-title">Журнал пуст</p>
                  <p className="jr-soft">
                    Загрузите выписку банка - PDF или Excel любого банка, - или заполненный шаблон журнала. До «Принять» в журнал ничего не ложится.
                  </p>
                </>
              )}
            </div>
          ) : null}
          {page && page.total > items.length ? (
            <button type="button" className="btn-ghost self-start" disabled={busy} onClick={() => setPages((was) => was + 1)}>
              Показать ещё {Math.min(PAGE, page.total - items.length)} из {page.total - items.length}
            </button>
          ) : null}
        </>
      )}

      {preview ? (
        <JournalPreviewDialog
          key={preview.batch_id}
          preview={preview}
          dictionaries={dicts}
          onAnswer={(params) => void answer(params)}
          onClose={() => setPreview(null)}
          onAccepted={accepted}
          onRejected={() => {
            setPreview(null);
            pending.current = null;
            setNotice("Загрузка отклонена - в журнал ничего не легло");
          }}
        />
      ) : null}

      {card && dicts ? (
        <JournalCard
          key={card.record ? `${card.record.id}:${card.record.version}` : `new-${card.kind}`}
          record={card.record}
          kind={card.kind}
          dictionaries={dicts}
          canEdit={canEdit}
          hasNext={Boolean(card.record && items.findIndex((item) => item.id === card.record?.id) < items.length - 1)}
          onClose={() => setCard(null)}
          onDelete={(record) => void remove(record)}
          onSaved={(record, next) => {
            if (record) setFresh(new Set([record.id]));
            if (next) openNext(record);
            else setCard(null);
            changed();
            void load();
            void loadDicts();
          }}
        />
      ) : null}
    </div>
  );
}
