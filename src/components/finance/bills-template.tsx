"use client";

import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CloseIcon } from "@/components/icons";
import { RiseSwap } from "@/components/motion/rise-swap";
import { useSessionState } from "@/components/session-state";
import { useScrollLock } from "@/components/use-scroll-lock";
import {
  type BillsTemplateRead,
  type BillsTemplateRow,
  FinanceApiError,
  financeApi,
  formatDate,
} from "@/components/finance/api";

/**
 * Google пускает сервисный аккаунт на 60 обращений в минуту, а запись строки -
 * это пять обращений. Шаблон на полсотни строк упирается в предел; Google тогда
 * отвечает «подождите» (429), ничего не записав. Строка ждёт полминуты и
 * пишется снова - повтор безопасен: в книге либо пусто, либо уже то же самое.
 */
const QUOTA_PAUSE_MS = 30_000;
const QUOTA_RETRIES = 3;

/**
 * Шаг шаблона: одна кнопка на весь путь - скачать, загрузить, принят.
 * Шаг помнится на время сессии: скачали, заполнили файл в Excel, вернулись -
 * кнопка уже ждёт загрузку.
 */
type Step = "download" | "upload" | "accepted";
const STEP_LABELS: Record<Step, string> = {
  download: "Скачать шаблон",
  upload: "Загрузить шаблон",
  accepted: "Принят",
};

/** Чем кончилась запись строки: записано (или уже было) - или отказ словами сервера. */
type Outcome = { state: "done" | "failed"; text: string };

const keyOf = (row: BillsTemplateRow) => `${row.sheet}:${row.row}`;

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

/** «2026-10-22» → «22.10.2026». */
function shownOf(iso: string | undefined | null): string {
  const [year, month, day] = (iso ?? "").split("-");
  return year && month && day ? `${day}.${month}.${year}` : "";
}

/**
 * Шаблон счетов Excel в разделе «Счета» (`contracts/bill_template.py`).
 *
 * «Скачать шаблон» отдаёт счета постов бота в формате финансистов: «Общий
 * реестр», «Аренда», «Абонентские услуги» и лист на каждое юрлицо, где
 * их и вписывают (общие листы тянут сами); после скачивания кнопка подъёмом
 * становится «Загрузить шаблон». Заполненный файл
 * KORT разбирает в строки и показывает окном - в книги сам ничего не пишет;
 * кнопка становится «Принят». «Записать в книги» пишет строку за строкой той
 * же записью, что у карточки счёта (`POST /bills/{id}`), каждую - в книгу её
 * юрлица. Без права «Счета: правка» - только скачать.
 */
export function BillsTemplate({ canEdit, onWritten }: { canEdit: boolean; onWritten: () => void }) {
  const [saved, setStep] = useSessionState<Step>("inv.bills.template", "download");
  const [read, setRead] = useSessionState<BillsTemplateRead | null>("inv.bills.template.read", null);
  // Итоги записи - рядом с файлом, а не в окне: новый файл обнуляет их тут
  // же, и строка нового файла не унаследует «записано» строки старого.
  const [outcomes, setOutcomes] = useSessionState<Record<string, Outcome>>("inv.bills.template.outcomes", {});
  const [open, setOpen] = useSessionState("inv.bills.template.open", false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const picker = useRef<HTMLInputElement | null>(null);
  const step: Step = canEdit ? saved : "download";

  const download = async () => {
    setBusy(true);
    setError("");
    try {
      const file = await financeApi.billsTemplate();
      saveFile(file.blob, file.name);
      if (canEdit) setStep("upload");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Шаблон не скачался");
    } finally {
      setBusy(false);
    }
  };

  /** Заполненный шаблон - в строки окна. В книги он не пишет: это делает «Записать в книги». */
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // тот же файл ещё раз - снова событие
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const next = await financeApi.readBillsTemplate(file);
      setOutcomes({});
      setRead(next);
      setStep("accepted");
      setOpen(true);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Шаблон не прочитался");
    } finally {
      setBusy(false);
    }
  };

  const press = () => {
    if (step === "download") void download();
    else if (step === "accepted" && read) setOpen(true);
    else picker.current?.click();
  };

  const label = busy ? (step === "download" ? "Скачиваем…" : "Читаем шаблон…") : STEP_LABELS[step];

  return (
    <>
      {/* Одна кнопка на весь путь шаблона: скачать → загрузить → принят. */}
      <button type="button" className="btn-ghost fin-bill-template" data-step={step} disabled={busy} onClick={press}>
        <RiseSwap value={label} />
      </button>
      {canEdit ? (
        <input
          ref={picker}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          style={{ display: "none" }}
          onChange={(event) => void upload(event)}
        />
      ) : null}
      {step !== "download" && !busy ? (
        <button type="button" className="fin-link-btn text-xs" onClick={() => void download()}>
          скачать заново
        </button>
      ) : null}
      {error ? <p className="text-xs fin-bill-fail fin-bills-template-fail">{error}</p> : null}
      {open && read ? (
        <TemplateRows
          read={read}
          outcomes={outcomes}
          setOutcomes={setOutcomes}
          busyUpload={busy}
          onPick={() => picker.current?.click()}
          onWritten={onWritten}
          onFinished={() => setStep("download")}
          onClose={(finished) => {
            setOpen(false);
            if (finished) {
              // Всё записано - файл своё отслужил.
              setRead(null);
              setOutcomes({});
            }
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Окно строк шаблона: что вышло из файла и что с каждой строкой. Пишет только
 * по нажатию - по одной строке, чтобы отказ одной (книгу правят, Google не
 * ответил) не остановил остальные и был виден у своей строки.
 */
function TemplateRows({
  read,
  outcomes,
  setOutcomes,
  busyUpload,
  onPick,
  onWritten,
  onFinished,
  onClose,
}: {
  read: BillsTemplateRead;
  outcomes: Record<string, Outcome>;
  setOutcomes: Dispatch<SetStateAction<Record<string, Outcome>>>;
  busyUpload: boolean;
  onPick: () => void;
  onWritten: () => void;
  onFinished: () => void;
  onClose: (finished: boolean) => void;
}) {
  const [writing, setWriting] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const running = progress !== null;

  useScrollLock(true);

  const rows = read.rows.filter((row) => row.status !== "empty");
  const ready = rows.filter((row) => row.status === "ready" && row.id);
  const pending = ready.filter((row) => outcomes[keyOf(row)]?.state !== "done");
  const failed = ready.filter((row) => outcomes[keyOf(row)]?.state === "failed").length;
  const written = ready.length - pending.length;
  const finished = ready.length > 0 && pending.length === 0;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !running) onClose(finished);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, finished, onClose]);

  const run = async () => {
    const queue = pending;
    let bad = 0;
    setProgress({ done: 0, total: queue.length });
    for (const [index, row] of queue.entries()) {
      const key = keyOf(row);
      setWriting(key);
      for (let attempt = 0; ; attempt += 1) {
        try {
          // `expect` - «№ Счета» в книге пуст: выставленный кем-то другим счёт не перезаписывается.
          const saved = await financeApi.saveBill(row.id!, {
            values: row.values,
            expect: { bill_no: "" },
            defaults: row.defaults,
          });
          const text = saved.changed.length ? "записано" : "в таблице уже так";
          setOutcomes((was) => ({
            ...was,
            [key]: { state: "done", text: saved.warning ? `${text}. ${saved.warning}` : text },
          }));
        } catch (exc) {
          if (exc instanceof FinanceApiError && exc.status === 429 && attempt < QUOTA_RETRIES) {
            setWaiting(true);
            await new Promise((resolve) => window.setTimeout(resolve, QUOTA_PAUSE_MS));
            setWaiting(false);
            continue;
          }
          bad += 1;
          const text = exc instanceof Error ? exc.message : "В таблицу не записалось";
          setOutcomes((was) => ({ ...was, [key]: { state: "failed", text } }));
        }
        break;
      }
      setProgress({ done: index + 1, total: queue.length });
    }
    setWriting(null);
    setProgress(null);
    onWritten();
    if (!bad) onFinished();
  };

  const counts = read.counts;
  const summary = [
    `к записи: ${counts.ready}`,
    counts.same ? `уже в таблице: ${counts.same}` : "",
    counts.error ? `с отказом: ${counts.error}` : "",
    counts.empty ? `не заполнены: ${counts.empty}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  const action = progress
    ? `Записываем ${Math.min(progress.done + 1, progress.total)} из ${progress.total}…`
    : failed
      ? `Повторить не записанные (${pending.length})`
      : `Записать в таблицы (${pending.length})`;

  const result = finished
    ? `Записано в таблицы: ${written} из ${ready.length}.`
    : !running && failed
      ? `Записано ${written} из ${ready.length}, не записано ${failed} - причины в строках.`
      : "";

  const state = (row: BillsTemplateRow): { text: string; tone: "" | "fail" | "strong" | "muted" } => {
    const key = keyOf(row);
    if (writing === key) {
      return { text: waiting ? "Google просит подождать - повторим через полминуты" : "записываем…", tone: "muted" };
    }
    const outcome = outcomes[key];
    if (outcome) return { text: outcome.text, tone: outcome.state === "failed" ? "fail" : "strong" };
    if (row.status === "error") return { text: row.problem, tone: "fail" };
    if (row.status === "same") return { text: row.note || "в таблице уже так", tone: "muted" };
    return { text: "к записи", tone: "" };
  };

  return createPortal(
    <div
      className="fin-dialog-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget && !running) onClose(finished);
      }}
    >
      <div className="fin-dialog fin-bills-template" role="dialog" aria-modal="true" aria-label="Шаблон счетов">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            Шаблон счетов
          </h2>
          <button
            type="button"
            onClick={() => onClose(finished)}
            className="btn-ghost p-1.5"
            aria-label="Закрыть"
            disabled={running}
          >
            <CloseIcon size={16} />
          </button>
        </div>
        <p className="text-xs fin-bill-sub mb-3">{summary}</p>

        {rows.length ? (
          <div className="fin-card overflow-x-auto">
            <table className="fin-table fin-bills-table">
              <thead>
                <tr>
                  <th>Лист, строка</th>
                  <th>Юрлицо</th>
                  <th>Заказчик</th>
                  <th className="only-desktop">Период с</th>
                  <th className="only-desktop">№ счёта</th>
                  <th className="only-desktop">Дата счёта</th>
                  <th className="only-desktop">Что с ней</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const shown = state(row);
                  const tone =
                    shown.tone === "fail" ? "fin-bill-fail" : shown.tone === "strong" ? "fin-strong" : shown.tone === "muted" ? "fin-muted" : "";
                  const bill = row.values.bill_no
                    ? `№ ${row.values.bill_no}${row.values.bill_date ? ` от ${shownOf(row.values.bill_date)}` : ""}`
                    : "";
                  return (
                    <tr key={keyOf(row)}>
                      {/* Счёт стоит на нескольких листах - здесь лист, где его вписали (обычно лист юрлица). */}
                      <td className="fin-muted fin-bills-date">
                        {row.sheet} · {row.row}
                      </td>
                      <td>{row.own || "-"}</td>
                      <td className="fin-strong fin-bills-customer">
                        {row.customer || "-"}
                        {row.number ? <span className="fin-bills-note">{row.number}</span> : null}
                        {/* Телефон: колонки справа уехали бы за край - номер счёта и что со строкой здесь. */}
                        {bill ? <span className="fin-bills-note only-mobile">{bill}</span> : null}
                        <span className={`fin-bills-note only-mobile ${tone}`}>{shown.text}</span>
                      </td>
                      <td className="fin-bills-date only-desktop">{row.period_from ? formatDate(row.period_from) : "-"}</td>
                      <td className="only-desktop">{row.values.bill_no || "-"}</td>
                      <td className="fin-bills-date only-desktop">{shownOf(row.values.bill_date) || "-"}</td>
                      <td className={`fin-bills-template-state only-desktop ${tone}`}>{shown.text}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm fin-muted">В файле не заполнено ни одной строки: впишите «№ Счета» и дату и загрузите снова.</p>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-3">
          {pending.length ? (
            <button type="button" className="btn-primary" disabled={running || busyUpload} onClick={() => void run()}>
              {action}
            </button>
          ) : null}
          <button type="button" className="btn-ghost" disabled={running || busyUpload} onClick={onPick}>
            {busyUpload ? "Читаем шаблон…" : "Загрузить другой файл"}
          </button>
          {finished ? (
            <button type="button" className="btn-ghost" onClick={() => onClose(true)}>
              Готово
            </button>
          ) : null}
        </div>
        {result ? <p className={`text-sm mt-2 ${failed && !finished ? "fin-bill-fail" : ""}`}>{result}</p> : null}
      </div>
    </div>,
    document.body,
  );
}
