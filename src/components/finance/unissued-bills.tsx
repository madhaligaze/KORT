"use client";

import { useMemo } from "react";

import { ChoiceSelect } from "@/components/choice-select";
import { useSessionState } from "@/components/session-state";
import {
  type Bill,
  type BillGroup,
  type BillsBoard,
  formatDate,
  formatMoney,
} from "@/components/finance/api";

const GROUP_TITLES: Record<BillGroup, string> = {
  overdue: "Просрочено",
  soon: "В ближайшие дни",
  early: "Ещё рано",
  undated: "Без срока в книге",
};

const EMPTY: Record<BillGroup, string> = {
  overdue: "Просроченных счетов нет",
  soon: "В ближайшие дни выставлять нечего",
  early: "Таких нет",
  undated: "Таких нет",
};

const PAID: Record<Bill["paid"], string> = { paid: "оплата пришла", part: "оплата пришла частью", "": "" };

function timeOf(iso: string | null): string {
  if (!iso) return "";
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ""
    : at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/**
 * «Счета → Не выставлены»: строки книги-сводки без галочки «Счет».
 *
 * Только чтение, и это намеренно. Счёт выставляют в 1С и отмечают в книге
 * своего юрлица; отметка в KORT разошлась бы с книгой, а «Новый счёт» отсюда
 * завёл бы второй долг клиента - в книге и в «Долгах». Поэтому здесь нет
 * кнопок у строк: строка уходит сама, когда в книге ставят галочку.
 *
 * Состояние - словами книги («Просрочка более 5 дней»), а не своим счётом
 * дней: тот же список и те же слова кладёт в канал бот (`bills_bot.py`).
 */
export function UnissuedBills({
  board,
  busy,
  onRefresh,
}: {
  board: BillsBoard;
  busy: boolean;
  onRefresh: () => void;
}) {
  const [group, setGroup] = useSessionState<BillGroup>("inv.bills.group", "overdue");
  const [own, setOwn] = useSessionState("inv.bills.own", "");
  const [department, setDepartment] = useSessionState("inv.bills.department", "");

  const owns = useMemo(() => [...new Set(board.items.map((item) => item.own).filter(Boolean))].sort(), [board.items]);
  const departments = useMemo(
    () => [...new Set(board.items.map((item) => item.department).filter(Boolean))].sort(),
    [board.items],
  );
  const filtered = board.items.filter(
    (item) => (!own || item.own === own) && (!department || item.department === department),
  );
  const shown = filtered.filter((item) => item.group === group);
  const count = (key: BillGroup) => filtered.filter((item) => item.group === key).length;
  const overdueSum = filtered
    .filter((item) => item.group === "overdue")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const source = board.source;
  const reading = !source?.read_at && !source?.error;

  return (
    <div className="flex flex-col gap-3">
      <div className="fin-kpis">
        {(Object.keys(GROUP_TITLES) as BillGroup[]).map((key) => {
          const value = count(key);
          return (
            <button
              key={key}
              type="button"
              className="fin-kpi fin-kpi-pick"
              data-on={group === key ? "" : undefined}
              onClick={() => setGroup(key)}
            >
              <span className="fin-kpi-label">{GROUP_TITLES[key]}</span>
              <span className={`fin-kpi-value ${key === "overdue" && value ? "fin-out" : ""}`}>{value}</span>
              {key === "overdue" && overdueSum ? (
                <span className="fin-kpi-label">{formatMoney(overdueSum, { whole: true })}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ChoiceSelect className="input-field" value={own} onChange={setOwn} placeholder="все юрлица" clearable>
          {owns.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </ChoiceSelect>
        <ChoiceSelect
          className="input-field"
          value={department}
          onChange={setDepartment}
          placeholder="все отделы"
          clearable
        >
          {departments.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </ChoiceSelect>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn-ghost" disabled={busy} onClick={onRefresh}>
          {busy ? "Читаем книгу…" : "Обновить"}
        </button>
      </div>

      {source ? (
        <p className="text-xs fin-bills-source">
          {source.url ? (
            <a href={source.url} target="_blank" rel="noreferrer" className="fin-link-btn">
              {source.title || "Книга-сводка"}
            </a>
          ) : (
            source.title || "Книга-сводка"
          )}
          {source.worksheet ? ` · ${source.worksheet}` : ""}
          {source.read_at ? ` · прочитана в ${timeOf(source.read_at)}` : ""}
          {board.channel ? (
            <>
              {" · канал "}
              {board.channel.url ? (
                <a href={board.channel.url} target="_blank" rel="noreferrer" className="fin-link-btn">
                  {board.channel.title}
                </a>
              ) : (
                board.channel.title
              )}
              {board.channel.hours.length
                ? ` - напоминания в ${board.channel.hours.map((hour) => `${String(hour).padStart(2, "0")}:00`).join(", ")}, новое сразу`
                : " - новое сразу"}
            </>
          ) : null}
        </p>
      ) : null}

      {source?.error ? (
        <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
          {source.error}
        </p>
      ) : null}

      <div className="fin-card overflow-x-auto">
        <table className="fin-table fin-bills-table">
          <thead>
            <tr>
              <th>Месяц</th>
              <th>Юрлицо</th>
              <th>Заказчик</th>
              <th>№ договора</th>
              <th>Сотрудник</th>
              <th style={{ textAlign: "right" }}>Сумма</th>
              <th>Период с</th>
              <th>Счёт по книге</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((item) => (
              <tr key={`${item.line}-${item.number}`}>
                <td>{item.month || "-"}</td>
                <td>
                  {item.own || "-"}
                  {item.department ? <span className="fin-bills-note">{item.department}</span> : null}
                </td>
                <td className="fin-strong fin-bills-customer">
                  {item.customer || "-"}
                  {item.note || item.status ? (
                    <span className="fin-bills-note">{[item.status, item.note].filter(Boolean).join(" · ")}</span>
                  ) : null}
                </td>
                <td>{item.number || "-"}</td>
                {/* У аренды книга пишет здесь юрлицо целиком - в одну строку, полностью в подсказке. */}
                <td className="fin-bills-staff" title={item.staff}>
                  {item.staff || "-"}
                </td>
                <td className="fin-num">{item.amount && Number(item.amount) ? formatMoney(item.amount) : "-"}</td>
                <td className="fin-bills-date">{item.period_from ? formatDate(item.period_from) : "-"}</td>
                <td
                  className={item.group === "overdue" ? "fin-out" : item.group === "soon" ? "fin-strong" : "fin-muted"}
                >
                  {item.text || "пусто"}
                  {/* Деньги пришли, а счёта нет - то, что выставить надо первым. */}
                  {item.paid ? <span className="fin-bills-note">{PAID[item.paid]}</span> : null}
                </td>
              </tr>
            ))}
            {!shown.length ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                  {reading ? "Читаем книгу…" : EMPTY[group]}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
