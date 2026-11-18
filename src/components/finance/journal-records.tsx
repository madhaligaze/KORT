"use client";

import { Fragment, useEffect, useMemo, useRef } from "react";

import { type JournalRecord, formatMoney } from "@/components/finance/api";
import { activates, dayTitle, placeOf, signed } from "@/components/finance/journal-format";

type Props = {
  items: JournalRecord[];
  /** Записи, только что принятые загрузкой или сохранённые, - мигнут, чтобы их нашли глазами. */
  fresh: Set<string>;
  onOpen: (record: JournalRecord) => void;
};

type Day = { day: string; items: JournalRecord[]; income: number; expense: number };

/**
 * «Записи» - журнал как лента по дням, плотно: финансист разбирает сотни
 * строк выписки за раз, и карточка на строку с воздухом вокруг превратила бы
 * месяц в прокрутку на километр.
 *
 * Строка - одна запись выписки: сумма со стороной, кто и за что, статья,
 * договор юристов, месяц ОПиУ, если он не месяц платежа, и вопрос. Пустое
 * место, которое надо заполнить («Без статьи»), подписано словами и весом, а
 * не цветом: цвет - только отказу и приходу денег.
 */
export function JournalRecords({ items, fresh, onOpen }: Props) {
  const days = useMemo(() => {
    const out: Day[] = [];
    for (const item of items) {
      let day = out[out.length - 1];
      if (!day || day.day !== item.paid_at) {
        day = { day: item.paid_at, items: [], income: 0, expense: 0 };
        out.push(day);
      }
      day.items.push(item);
      if (item.kind === "income") day.income += Number(item.amount);
      if (item.kind === "expense") day.expense += Number(item.amount);
    }
    return out;
  }, [items]);

  // Принятое загрузкой - в поле зрения: первая новая запись подъезжает к экрану.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!fresh.size) return;
    const first = list.current?.querySelector<HTMLElement>("[data-fresh='true']");
    first?.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
  }, [fresh]);

  if (!items.length) return null;
  return (
    <div className="jr-list" ref={list}>
      {days.map((day) => (
        <Fragment key={day.day}>
          <div className="jr-day">
            <span className="jr-day-title">{dayTitle(day.day)}</span>
            <span className="jr-day-sums fin-num">
              {day.income ? <span className="fin-in">+ {formatMoney(day.income)}</span> : null}
              {day.expense ? <span>− {formatMoney(day.expense)}</span> : null}
            </span>
          </div>
          {day.items.map((record) => (
            <Row key={record.id} record={record} fresh={fresh.has(record.id)} onOpen={onOpen} />
          ))}
        </Fragment>
      ))}
    </div>
  );
}

function Row({ record, fresh, onOpen }: { record: JournalRecord; fresh: boolean; onOpen: (record: JournalRecord) => void }) {
  const who =
    record.kind === "transfer"
      ? record.half
        ? record.account_to
          ? "Перевод на свой счёт - вторая сторона не загружена"
          : "Перевод со своего счёта - вторая сторона не загружена"
        : "Перевод между своими счетами"
      : record.counterparty || "Контрагент не указан";
  const contract = record.contract;
  return (
    <div
      className="jr-row"
      role="button"
      tabIndex={0}
      data-kind={record.kind}
      data-fresh={fresh ? "true" : undefined}
      onClick={() => onOpen(record)}
      onKeyDown={(event) => {
        if (activates(event)) {
          event.preventDefault();
          onOpen(record);
        }
      }}
    >
      <span className={`jr-amount fin-num ${record.kind === "income" ? "fin-in" : ""}`}>
        {signed(record.kind, record.amount)}
      </span>
      <span className="jr-main">
        <span className="jr-who" data-empty={!record.counterparty && record.kind !== "transfer" ? "true" : undefined}>
          {who}
        </span>
        {record.comment ? <span className="jr-comment">{record.comment}</span> : null}
        <span className="jr-tags">
          {record.category ? (
            <span className="jr-tag">
              {record.category}
              {record.group && record.group !== record.category ? <span className="jr-soft"> · {record.group}</span> : null}
            </span>
          ) : record.kind !== "transfer" ? (
            <span className="jr-tag jr-missing">Без статьи</span>
          ) : null}
          {contract ? (
            <span className="jr-tag jr-contract" title={contract.how === "auto" ? "Реестр отнёс оплату по плательщику" : undefined}>
              {contract.number}
              {contract.customer ? <span className="jr-soft"> · {contract.customer}</span> : null}
              {contract.how === "refund" ? <span className="jr-soft"> · возврат</span> : null}
              {contract.how === "auto" ? <span className="jr-soft"> · по плательщику</span> : null}
            </span>
          ) : record.contract_ref ? (
            <span className="jr-tag" title="Такого договора в реестре нет или он не один">
              {record.contract_ref}
              <span className="jr-soft"> · нет в реестре</span>
            </span>
          ) : record.attention.includes("no_contract") ? (
            <span className="jr-tag jr-missing">Без договора</span>
          ) : null}
          {record.pnl_differs ? <span className="jr-tag">ОПиУ: {record.pnl_title}</span> : null}
          {record.details ? <span className="jr-tag">{record.details}</span> : null}
          {record.split ? (
            <span className="jr-tag" data-bad={record.split.ok ? undefined : "true"}>
              Дробление · общий {formatMoney(record.split.total)}
              {record.split.ok ? null : ` · части дают ${formatMoney(record.split.sum)}`}
            </span>
          ) : null}
        </span>
        {record.note ? <span className="jr-note">Вопрос: {record.note}</span> : null}
      </span>
      <span className="jr-place">
        <span className="jr-account">{placeOf(record)}</span>
        {record.firm ? <span className="jr-soft">{record.firm}</span> : null}
      </span>
    </div>
  );
}
