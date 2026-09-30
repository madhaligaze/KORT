"use client";

/**
 * Доли в карточке договора: кто из исполнителей и какие отделы сколько
 * получают от договора (29.09.2026).
 *
 * Над одним договором работают несколько человек, и доли у них разные:
 * договор на 700 000 - у одного 500 000, у другого 200 000. Людей сколько
 * угодно: у каждого своя строка. Доля - суммой или процентом, одно на блок;
 * второе число выводится из суммы договора (`shares.py`).
 *
 * Кто что видит, решает сервер: сотрудник получает только свою строку,
 * начальник отдела, администратор и владелец - все и правят их. Доли отделов
 * приходят только тем, кому открыты. Здесь ничего не прячется - чего нет в
 * ответе, того нет и на экране.
 *
 * Полоса над строками - пропорции одной тушью: цвет в продукте только у
 * отказа, поэтому перебор суммы - розой, а «всё распределено» ничем не
 * отмечено, кроме полной полосы.
 *
 * Отделы долей - это поле «Отдел» договора (30.09.2026): главного отдела нет,
 * строк столько, сколько отделов в поле. Убрать отдел может только владелец
 * или администратор (`can_remove`), дописать - тот, кому доли открыты.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type ContractShares,
  type ShareSummary,
  type ShareUnit,
  contractsApi,
} from "@/components/finance/api";
import { ensureShares, refreshOne, useRegistry } from "@/components/finance/contracts/store";
import { contractMoney, plural } from "@/components/finance/format";

type Row = {
  id: string;
  name: string;
  sub: string;
  amount: string | null;
  percent: string | null;
  entered: ShareUnit | null;
  mine?: boolean;
};

function num(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const clean = String(raw).replace(/[\s  %₸]/g, "").replace(",", ".");
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

/** «71.4286» → «71,43 %». */
export function percentText(raw: string | number | null | undefined): string {
  const value = typeof raw === "number" ? raw : num(raw ?? null);
  if (value === null) return "";
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} %`;
}

function moneyText(raw: string | number | null | undefined, monthly: boolean): string {
  if (raw === null || raw === undefined || raw === "") return "";
  const text = contractMoney(raw);
  return monthly ? `${text} /мес` : text;
}

/** Черновик правки: значение строки в выбранной единице, как напечатано. */
type Draft = { unit: ShareUnit; values: Record<string, string>; order: string[] };

function toDraft(rows: Row[], unit: ShareUnit): Draft {
  const values: Record<string, string> = {};
  for (const row of rows) {
    const value = unit === "amount" ? num(row.amount) : num(row.percent);
    values[row.id] = value === null ? "" : unit === "amount" ? String(Math.round(value * 100) / 100) : String(Math.round(value * 100) / 100);
  }
  return { unit, values, order: rows.map((row) => row.id) };
}

/** Перевести черновик в другую единицу по сумме договора; суммы нет - пусто. */
function convert(draft: Draft, unit: ShareUnit, total: number | null): Draft {
  if (draft.unit === unit) return draft;
  const values: Record<string, string> = {};
  for (const id of draft.order) {
    const value = num(draft.values[id]);
    if (value === null || !total) {
      values[id] = "";
      continue;
    }
    values[id] = unit === "percent"
      ? String(Math.round((value / total) * 10000) / 100)
      : String(Math.round((total * value) / 100));
  }
  return { unit, values, order: draft.order };
}

/** «Поровну»: последнему - остаток, чтобы вместе ровно 100% или вся сумма. */
function evenly(draft: Draft, total: number | null): Draft {
  const count = draft.order.length;
  if (!count) return draft;
  const whole = draft.unit === "percent" ? 100 : total;
  if (!whole) return draft;
  const step = draft.unit === "percent" ? Math.floor((whole / count) * 100) / 100 : Math.floor(whole / count);
  const values: Record<string, string> = {};
  draft.order.forEach((id, index) => {
    const value = index === count - 1 ? Math.round((whole - step * (count - 1)) * 100) / 100 : step;
    values[id] = String(value);
  });
  return { ...draft, values };
}

function Bar({ rows, total, over }: { rows: { id: string; share: number | null; mine?: boolean }[]; total: number | null; over: boolean }) {
  const known = rows.filter((row) => row.share !== null && row.share > 0);
  if (!known.length || total === null) return null;
  return (
    <div className="share-bar" data-over={over ? "true" : undefined} aria-hidden="true">
      {known.map((row) => (
        <span
          key={row.id}
          className="share-seg"
          data-mine={row.mine ? "true" : undefined}
          style={{ flexBasis: `${Math.min(100, (row.share as number))}%` }}
        />
      ))}
    </div>
  );
}

function Foot({ summary, total, monthly, unit }: { summary: ShareSummary | undefined; total: number | null; monthly: boolean; unit: ShareUnit | null }) {
  if (!summary || !summary.given) return null;
  if (summary.over) {
    const beyond =
      unit === "percent" && summary.allocated_percent
        ? `Вместе ${percentText(summary.allocated_percent)} - больше 100%`
        : `Вместе ${moneyText(summary.allocated_amount, monthly)} - больше суммы договора ${moneyText(total, monthly)}`;
    return <p className="share-foot fin-fail">{beyond}</p>;
  }
  const rest = num(summary.rest_amount);
  const restPercent = num(summary.rest_percent);
  if ((rest !== null && Math.abs(rest) < 0.5) || (rest === null && restPercent !== null && Math.abs(restPercent) < 0.01)) {
    return <p className="share-foot">Распределено всё{total !== null ? ` - ${moneyText(total, monthly)}` : ""}</p>;
  }
  const parts: string[] = [];
  if (summary.allocated_amount && total !== null) parts.push(`Распределено ${moneyText(summary.allocated_amount, monthly)} из ${moneyText(total, monthly)}`);
  else if (summary.allocated_percent) parts.push(`Распределено ${percentText(summary.allocated_percent)}`);
  if (rest !== null) parts.push(`не распределено ${moneyText(rest, monthly)}${restPercent !== null ? ` · ${percentText(restPercent)}` : ""}`);
  else if (restPercent !== null) parts.push(`не распределено ${percentText(restPercent)}`);
  return <p className="share-foot">{parts.join(" · ")}</p>;
}

type BlockProps = {
  title: string;
  rows: Row[];
  unit: ShareUnit | null;
  summary: ShareSummary | undefined;
  total: number | null;
  monthly: boolean;
  canEdit: boolean;
  /** Можно ли убрать сохранённую строку (отдел из договора); добавленную в правке - всегда. */
  removable?: (id: string) => boolean;
  /** Какие ещё строки можно добавить (отделы); `null` - набор строк задан (люди). */
  choices: { id: string; name: string; sub: string }[] | null;
  editLabel: string;
  onSave: (unit: ShareUnit, items: { id: string; value: string | null }[]) => Promise<void>;
  /** Открыть сразу в правке (новое разделение между отделами). */
  startOpen?: boolean;
  /** Правка закрыта - сохранением или отменой. */
  onClose?: () => void;
};

function ShareBlock({ title, rows, unit, summary, total, monthly, canEdit, removable, choices, editLabel, onSave, startOpen, onClose }: BlockProps) {
  const [draft, setDraft] = useState<Draft | null>(() =>
    startOpen ? toDraft(rows, unit ?? (total ? "amount" : "percent")) : null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = unit ?? "amount";

  const start = () => {
    const first: ShareUnit = unit ?? (total ? "amount" : "percent");
    setDraft(toDraft(rows, first));
    setError("");
  };
  const cancel = useCallback(() => {
    setDraft(null);
    setError("");
    onClose?.();
  }, [onClose]);
  useEffect(() => {
    if (!draft) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.stopPropagation();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [draft, cancel]);

  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const draftSum = draft ? draft.order.reduce((sum, id) => sum + (num(draft.values[id]) ?? 0), 0) : 0;
  const draftOver = draft
    ? draft.unit === "percent"
      ? draftSum > 100.0001
      : total !== null && draftSum > total + 0.5
    : false;

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await onSave(
        draft.unit,
        draft.order.map((id) => ({ id, value: draft.values[id]?.trim() ? draft.values[id] : null })),
      );
      setDraft(null);
      onClose?.();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Доли не сохранились");
    } finally {
      setBusy(false);
    }
  };

  if (draft) {
    const other = (id: string) => {
      const value = num(draft.values[id]);
      if (value === null || !total) return "";
      return draft.unit === "amount" ? percentText((value / total) * 100) : moneyText(Math.round((total * value) / 100), monthly);
    };
    const free = choices?.filter((choice) => !draft.order.includes(choice.id)) ?? [];
    const rest = draft.unit === "percent" ? 100 - draftSum : total !== null ? total - draftSum : null;
    return (
      <div className="share-block" data-editing="true">
        <div className="share-head">
          <span className="share-title">{title}</span>
          <span className="share-units" role="group" aria-label="Доля">
            {(["amount", "percent"] as ShareUnit[]).map((option) => (
              <button
                key={option}
                type="button"
                className="fin-link-btn"
                aria-pressed={draft.unit === option}
                disabled={option === "amount" && total === null && draft.order.some((id) => num(draft.values[id]) !== null) && draft.unit === "percent"}
                onClick={() => setDraft(convert(draft, option, total))}
              >
                {option === "amount" ? "в цифрах" : "в процентах"}
              </button>
            ))}
          </span>
        </div>
        {draft.order.map((id) => {
          const row = byId.get(id) ?? choices?.map((choice) => ({ ...choice, amount: null, percent: null, entered: null } as Row)).find((choice) => choice.id === id);
          return (
            <div key={id} className="share-row share-edit-row">
              <span className="share-name">
                {row?.name ?? "-"}
                {row?.sub ? <span className="share-sub">{row.sub}</span> : null}
              </span>
              <span className="share-input">
                <input
                  inputMode="decimal"
                  aria-label={`Доля: ${row?.name ?? ""}`}
                  value={draft.values[id] ?? ""}
                  placeholder={draft.unit === "percent" ? "0" : "0"}
                  onChange={(event) => setDraft({ ...draft, values: { ...draft.values, [id]: event.target.value } })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void save();
                  }}
                />
                <span className="share-unit">{draft.unit === "percent" ? "%" : "₸"}</span>
              </span>
              <span className="share-pct">{other(id)}</span>
              {choices && (!byId.has(id) || removable?.(id)) ? (
                <button
                  type="button"
                  className="fin-link-btn share-drop"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      order: draft.order.filter((item) => item !== id),
                      values: Object.fromEntries(Object.entries(draft.values).filter(([key]) => key !== id)),
                    })
                  }
                >
                  убрать
                </button>
              ) : null}
            </div>
          );
        })}
        {free.length ? (
          <label className="share-add">
            <span>Добавить отдел</span>
            <select
              value=""
              onChange={(event) => {
                const id = event.target.value;
                if (!id) return;
                setDraft({ ...draft, order: [...draft.order, id], values: { ...draft.values, [id]: "" } });
              }}
            >
              <option value="">-</option>
              {free.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name}
                  {choice.sub ? ` · ${choice.sub}` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p className={draftOver ? "share-foot fin-fail" : "share-foot"}>
          {draftOver
            ? draft.unit === "percent"
              ? `Вместе ${percentText(draftSum)} - больше 100%`
              : `Вместе ${moneyText(draftSum, monthly)} - больше суммы договора ${moneyText(total, monthly)}`
            : rest !== null
              ? rest > 0.004
                ? `Не распределено ${draft.unit === "percent" ? percentText(rest) : moneyText(rest, monthly)}`
                : "Распределено всё"
              : `Вместе ${moneyText(draftSum, monthly)} - сумма договора не указана`}
        </p>
        {error ? <p className="ifield-error">{error}</p> : null}
        <div className="share-actions">
          <button type="button" className="btn-primary btn-sm" disabled={busy || draftOver} onClick={() => void save()}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
          <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={cancel}>
            Отмена
          </button>
          {draft.order.length > 1 && (draft.unit === "percent" || total) ? (
            <button type="button" className="fin-link-btn" disabled={busy} onClick={() => setDraft(evenly(draft, total))}>
              Поровну
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const shares = rows.map((row) => {
    const percent = num(row.percent);
    return { id: row.id, share: percent, mine: row.mine };
  });
  return (
    <div className="share-block">
      <div className="share-head">
        <span className="share-title">{title}</span>
        {canEdit ? (
          <button type="button" className="fin-link-btn share-edit" onClick={start}>
            {editLabel}
          </button>
        ) : null}
      </div>
      <Bar rows={shares} total={total} over={Boolean(summary?.over)} />
      {rows.map((row) => (
        <div key={row.id} className="share-row" data-mine={row.mine ? "true" : undefined}>
          <span className="share-name">
            {row.name}
            {row.sub ? <span className="share-sub">{row.sub}</span> : null}
          </span>
          <span className="share-val">{row.entered ? moneyText(row.amount, monthly) || "-" : "не задана"}</span>
          <span className="share-pct">{row.entered ? percentText(row.percent) : ""}</span>
        </div>
      ))}
      <Foot summary={summary} total={total} monthly={monthly} unit={shown} />
    </div>
  );
}

type DepartmentsValue = NonNullable<ContractShares["departments"]>;

function departmentChoices(value: DepartmentsValue): { id: string; name: string; sub: string }[] {
  return value.choices.map((choice) => ({ id: choice.id, name: choice.code, sub: choice.title !== choice.code ? choice.title : "" }));
}

export function Shares({ contractId, seq }: { contractId: string; seq: number }) {
  const [data, setData] = useState<{ id: string; value: ContractShares } | null>(null);
  const [splitting, setSplitting] = useState(false);
  const me = useRegistry((s) => s.me);
  const addedBy = useRegistry((s) => s.byId.get(contractId)?.departments_by);
  useEffect(() => {
    let alive = true;
    contractsApi.shares
      .of(contractId)
      .then((value) => alive && setData({ id: contractId, value }))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [contractId, seq]);
  const value = data?.id === contractId ? data.value : null;
  if (!value) return null;
  const total = num(value.amount);
  const monthly = value.billing === "month";
  const people = value.people;
  const departments = value.departments;

  const personRows: Row[] = people.rows.map((row) => ({
    id: row.employee_id,
    name: row.name,
    sub: row.department,
    amount: row.amount,
    percent: row.percent,
    entered: row.entered,
    mine: row.mine,
  }));
  const showPeople =
    people.scope === "all" ? people.count >= 2 || personRows.some((row) => row.entered) : people.scope === "own" && people.count >= 2;
  const departmentRows: Row[] = (departments?.rows ?? []).map((row) => ({
    id: row.department_id,
    name: row.code,
    sub: row.title && row.title !== row.code ? row.title : "",
    amount: row.amount,
    percent: row.percent,
    entered: row.entered,
  }));
  const showDepartments = Boolean(departments && (departmentRows.length || departments.can_edit));
  // Убрать отдел: администратор - любой, сотрудник - вписанный им самим и без доли.
  const removableDepartment = (id: string) =>
    Boolean(departments?.can_remove) ||
    (me !== null && addedBy?.[id] === me && !departmentRows.find((row) => row.id === id)?.entered);
  const saveDepartments = async (unit: ShareUnit, items: { id: string; value: string | null }[]) => {
    const next = await contractsApi.shares.setDepartments(
      contractId,
      unit,
      items.map((item) => ({ department_id: item.id, value: item.value })),
    );
    setData({ id: contractId, value: next });
    // Отделы долей - это и поле «Отдел»: карточка и лист показывают его сразу,
    // не дожидаясь опроса.
    void refreshOne(contractId);
  };
  if (!showPeople && !showDepartments) return null;

  const others = people.count - personRows.length;
  return (
    <section>
      <div className="card-section">
        <span>Доли</span>
        <span className="card-section-line" />
      </div>
      {showPeople ? (
        people.scope === "own" ? (
          <div className="share-block">
            <Bar rows={personRows.map((row) => ({ id: row.id, share: num(row.percent), mine: true }))} total={total} over={false} />
            {personRows.map((row) => (
              <div key={row.id} className="share-row" data-mine="true">
                <span className="share-name">Ваша доля</span>
                <span className="share-val">{row.entered ? moneyText(row.amount, monthly) || "-" : "не задана"}</span>
                <span className="share-pct">{row.entered ? percentText(row.percent) : ""}</span>
              </div>
            ))}
            <p className="share-foot">
              {total !== null ? `из ${moneyText(total, monthly)} · ` : ""}
              ещё {others} {plural(others, "исполнитель", "исполнителя", "исполнителей")}
            </p>
          </div>
        ) : (
          <ShareBlock
            title="Исполнители"
            rows={personRows}
            unit={people.unit}
            summary={people.summary}
            total={total}
            monthly={monthly}
            canEdit={people.can_edit}
            choices={null}
            editLabel={personRows.some((row) => row.entered) ? "Изменить" : "Распределить"}
            onSave={async (unit, items) => {
              const next = await contractsApi.shares.setPeople(
                contractId,
                unit,
                items.map((item) => ({ employee_id: item.id, value: item.value })),
              );
              setData({ id: contractId, value: next });
              // «По сотрудникам» считает по долям - перечитать сразу.
              void ensureShares(true);
            }}
          />
        )
      ) : null}
      {showDepartments && departments ? (
        departmentRows.length ? (
          <ShareBlock
            title="Отделы"
            rows={departmentRows}
            unit={departments.unit}
            summary={departments.summary}
            total={total}
            monthly={monthly}
            canEdit={departments.can_edit}
            removable={removableDepartment}
            choices={departmentChoices(departments)}
            editLabel={departmentRows.some((row) => row.entered) ? "Изменить" : "Распределить"}
            onSave={saveDepartments}
          />
        ) : splitting ? (
          <ShareBlock
            title="Отделы"
            rows={[]}
            unit={null}
            summary={undefined}
            total={total}
            monthly={monthly}
            canEdit
            removable={removableDepartment}
            choices={departmentChoices(departments)}
            editLabel="Распределить"
            startOpen
            onClose={() => setSplitting(false)}
            onSave={saveDepartments}
          />
        ) : (
          <p className="share-foot">
            <button type="button" className="fin-link-btn" onClick={() => setSplitting(true)}>
              Разделить между отделами
            </button>
          </p>
        )
      ) : null}
    </section>
  );
}
