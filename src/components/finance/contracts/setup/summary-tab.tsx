"use client";

/**
 * «Сводка оплат»: книга Google, откуда «Разовые» берут «Оплачено».
 *
 * У BBC это «Осн.Общая сводка BBC 2026», лист «Сводка все ЮР лица» — туда
 * сходятся книги всех юрлиц, и «Сумма Факт Поступ.» там — факт оплаты.
 * Договор находится по номеру и клиенту (`contracts/summary.py`); колонки
 * книги — по названиям, поэтому вставленная в сводку колонка ничего не сдвигает.
 *
 * Подключается, только если читается: сервер читает книгу сразу и отвечает
 * отказом словами («у сервисного аккаунта нет доступа», «нет колонки
 * „№ Договора“»), а не сохраняет ссылку, которая молча ничего не даст.
 */
import { useState } from "react";

import { contractsApi } from "@/components/finance/api";
import { ensureSummary, useRegistry } from "@/components/finance/contracts/store";
import { useSetupAction } from "@/components/finance/contracts/setup/use-setup-action";
import { formatTime } from "@/components/finance/format";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { useSessionState } from "@/components/session-state";

export function SummaryTab() {
  const source = useRegistry((s) => s.schema?.summary ?? null);
  const action = useSetupAction();
  const [link, setLink] = useSessionState("setup.summary.link", "");
  const [sheet, setSheet] = useSessionState("setup.summary.sheet", "Сводка все ЮР лица");
  const [ask, setAsk] = useState(false);
  const [result, setResult] = useState("");

  const connect = async () => {
    setResult("");
    const ok = await action.run("connect", async () => {
      const done = await contractsApi.setup.connectSummary(link.trim(), sheet.trim());
      setResult(`Прочитано строк: ${done.rows}${done.drift ? ` · книгу поправили: ${done.drift}` : ""}`);
    });
    if (ok) {
      setLink("");
      void ensureSummary(true);
    }
  };

  return (
    <section className="setup-pane setup-summary" aria-label="Сводка оплат">
      {source ? (
        <div className="setup-summary-now">
          <p className="setup-summary-title">
            <a href={source.url} target="_blank" rel="noreferrer" className="fin-link-btn">
              {source.title || source.spreadsheet_id}
            </a>
            <span> · лист «{source.worksheet}»</span>
          </p>
          <p className="setup-summary-meta">
            {source.read_at ? `прочитана в ${formatTime(source.read_at)}, строк: ${source.rows}` : "ещё не читалась"}
            {source.drift ? ` · книгу поправили: ${source.drift}` : ""}
          </p>
          {source.error ? (
            <p className="setup-error" role="alert">
              {source.error}
            </p>
          ) : null}
          <button type="button" className="fin-link-btn setup-quiet" onClick={() => setAsk(true)}>
            Отключить
          </button>
          {action.error("disconnect") ? (
            <p className="setup-error" role="alert">
              {action.error("disconnect")}
            </p>
          ) : null}
        </div>
      ) : null}

      <form
        className="setup-summary-form"
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <label className="setup-summary-field">
          <span>{source ? "Другая книга" : "Ссылка на книгу"}</span>
          <input
            type="url"
            className="setup-input"
            value={link}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            onChange={(event) => setLink(event.target.value)}
          />
        </label>
        <label className="setup-summary-field">
          <span>Лист</span>
          <input type="text" className="setup-input" value={sheet} onChange={(event) => setSheet(event.target.value)} />
        </label>
        <button
          type="submit"
          className="btn-primary btn-sm"
          disabled={!link.trim() || !sheet.trim() || action.busy("connect")}
        >
          {action.busy("connect") ? "Читаем книгу…" : "Подключить"}
        </button>
        {action.error("connect") ? (
          <p className="setup-error" role="alert">
            {action.error("connect")}
          </p>
        ) : result ? (
          <p className="setup-summary-meta">{result}</p>
        ) : null}
      </form>

      <ConfirmDialog
        open={ask}
        title="Отключить сводку оплат?"
        text="«Оплачено» и «Остаток» в «Разовых» опустеют, лист «Остатки» — тоже. Договоры не меняются."
        confirm="Отключить"
        danger
        onCancel={() => setAsk(false)}
        onConfirm={async () => {
          setAsk(false);
          const ok = await action.run("disconnect", () => contractsApi.setup.disconnectSummary(), "all");
          if (ok) void ensureSummary(true);
        }}
      />
    </section>
  );
}
