"use client";

/**
 * «Разовые» - книга листов тех же договоров вида «Разовая услуга».
 *
 * Повторяет книгу юротдела BBC «Разовые» (27.09.2026): весь список, отборы
 * незавершённых по сроку («до 2 мес» … «6+ мес»), «Остатки» и две сводки по
 * сотрудникам. Листы - обычные листы реестра книги `oneoff` (правятся в
 * «Настроить реестр» → «Листы»), сводки по сотрудникам - здесь, из того же
 * хранилища: в книге это были формулы над листом «Разовые», и отдельного
 * хранения у них нет.
 *
 * «Оплачено» - из книги-сводки компании («Осн.Общая сводка BBC 2026»), как
 * колонка Q книги: по номеру договора и клиенту (`contracts/summary.py`).
 */
import { useEffect, useMemo, useState } from "react";

import type { SummarySource } from "@/components/finance/api";
import { staffTable } from "@/components/finance/contracts/staff";
import { ensureShares, ensureSummary, useRegistry } from "@/components/finance/contracts/store";
import { formatTime, plural } from "@/components/finance/format";
import { formatMoney } from "@/components/finance/api";

/** Сводка свежеет сама: раз в минуту, пока вкладка на виду, и сразу при возвращении на неё. */
export function useSummaryRefresh(): void {
  useEffect(() => {
    void ensureSummary();
    const refresh = () => {
      if (document.visibilityState === "visible") void ensureSummary();
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
}

/**
 * Над «Разовыми» - одна кнопка «Обновить» (29.09.2026).
 *
 * Прежде здесь стояла строка «„Оплачено“ - из книги „Осн.Общая сводка BBC
 * 2026“, лист …, прочитана в …» - внутренняя логика, которую «знать и
 * читать никому не надо». Сводка перечитывается сама (`useSummaryRefresh`,
 * сервер держит книгу две минуты); кнопка - перечитать сейчас. Когда книга
 * прочитана, видно в подсказке кнопки. Отказ чтения - словами и розой:
 * иначе «Оплачено» стояло бы старым молча.
 */
export function SummaryLine({ onSetup }: { onSetup?: () => void }) {
  const source = useRegistry((s) => s.summarySource);
  const schemaSource = useRegistry((s) => s.schema?.summary ?? null);
  const ready = useRegistry((s) => s.phase === "ready");
  const [busy, setBusy] = useState(false);
  useSummaryRefresh();
  const shown: SummarySource | null = source ?? schemaSource;
  if (!ready) return null;
  if (!shown) {
    // Не подключена - действие только тому, кто может подключить.
    return onSetup ? (
      <p className="creg-oneoff-line">
        <button type="button" className="fin-link-btn" onClick={onSetup}>
          Подключить сводку оплат
        </button>
      </p>
    ) : null;
  }
  return (
    <p className="creg-oneoff-line">
      {shown.error ? <span className="fin-fail">{shown.error}</span> : null}
      <button
        type="button"
        className="fin-link-btn"
        disabled={busy}
        title={shown.read_at ? `Оплаты прочитаны в ${formatTime(shown.read_at)}` : undefined}
        onClick={async () => {
          setBusy(true);
          try {
            await ensureSummary(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Читаем…" : "Обновить"}
      </button>
    </p>
  );
}

/**
 * Две сводки книги «Разовые» по сотрудникам: общая (все договоры) и «на
 * исполнении» с разбивкой суммы по месяцу строки в сводке. Считает
 * `staffTable` - тот же подсчёт, что у листа «По сотрудникам» в таблице.
 */
export function OneoffStaff() {
  const schema = useRegistry((s) => s.schema);
  const byId = useRegistry((s) => s.byId);
  const order = useRegistry((s) => s.order);
  const people = useRegistry((s) => s.people);
  const parties = useRegistry((s) => s.parties);
  const summary = useRegistry((s) => s.summary);
  const shares = useRegistry((s) => s.shares);
  useEffect(() => {
    void ensureShares();
  }, []);

  const data = useMemo(
    () => staffTable({ schema, byId, order, people, parties, summary, shares }),
    [schema, byId, order, people, parties, summary, shares],
  );
  if (!schema || !data) return null;
  const { rows, totals, months, older, olderOf } = data;
  // Договор на нескольких ответственных - в строке каждого, а в итоге один
  // раз: иначе строки не сходились бы с итогом без объяснения.
  const sharedNote = (count: number) =>
    `${count} ${plural(count, "договор", "договора", "договоров")} на нескольких ответственных - в строке каждого, в итоге один раз`;

  return (
    <div className="creg-staff">
      <h2 className="creg-staff-title">
        По сотрудникам · {rows.length} {plural(rows.length, "человек", "человека", "человек")}
      </h2>
      <div className="creg-staff-scroll">
        <table className="fin-table creg-staff-table">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th className="fin-num">Клиентов</th>
              <th className="fin-num">Договоров</th>
              <th className="fin-num">Сумма</th>
              <th className="fin-num">Остаток</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td className="fin-num">{row.clients.size}</td>
                <td className="fin-num">{row.contracts}</td>
                <td className="fin-num">{formatMoney(row.amount)}</td>
                <td className="fin-num">{formatMoney(row.remaining)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Итого</td>
              <td className="fin-num" />
              <td className="fin-num">{totals.contracts}</td>
              <td className="fin-num">{formatMoney(totals.amount)}</td>
              <td className="fin-num">{formatMoney(totals.remaining)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {totals.shared ? <p className="creg-staff-note">{sharedNote(totals.shared)}</p> : null}

      <h2 className="creg-staff-title">На исполнении - по месяцу в сводке</h2>
      <div className="creg-staff-scroll">
        <table className="fin-table creg-staff-table">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th className="fin-num">Клиентов</th>
              <th className="fin-num">Договоров</th>
              <th className="fin-num">Сумма</th>
              <th className="fin-num">Нет в сводке</th>
              {older ? <th className="fin-num">Раньше</th> : null}
              {months.map((month) => (
                <th key={month} className="fin-num">
                  {month.toLowerCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows
              .filter((row) => row.openContracts > 0)
              .map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td className="fin-num">{row.openClients.size}</td>
                  <td className="fin-num">{row.openContracts}</td>
                  <td className="fin-num">{formatMoney(row.openAmount)}</td>
                  <td className="fin-num">{formatMoney(row.byMonth.get("") ?? 0)}</td>
                  {older ? <td className="fin-num">{formatMoney(olderOf(row))}</td> : null}
                  {months.map((month) => (
                    <td key={month} className="fin-num">
                      {formatMoney(row.byMonth.get(month) ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Итого</td>
              <td className="fin-num" />
              <td className="fin-num">{totals.openContracts}</td>
              <td className="fin-num">{formatMoney(totals.openAmount)}</td>
              <td className="fin-num">{formatMoney(totals.byMonth.get("") ?? 0)}</td>
              {older ? <td className="fin-num">{formatMoney(olderOf(totals))}</td> : null}
              {months.map((month) => (
                <td key={month} className="fin-num">
                  {formatMoney(totals.byMonth.get(month) ?? 0)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {totals.openShared ? <p className="creg-staff-note">{sharedNote(totals.openShared)}</p> : null}
    </div>
  );
}
