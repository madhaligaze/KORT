"use client";

/**
 * «Поправить правило» блока прямо в протоколе.
 *
 * Фраза та же, что в настройке листа: условия группы через «и», группы через
 * «или». Но значения здесь — написания из файла, а не значения списков: на
 * разборе списков ещё нет, и правило проверяется на строках файла. Поэтому и
 * поля только те, что разбор умеет проверить (`importer.RULE_CONDITION_OPS`):
 * вид, предмет, отдел, статус и «сторона — наше юрлицо». Остальное сервер
 * отверг бы, и правило молча считалось бы не тем.
 *
 * Пустое значение условия не отправляется: сервер принял бы его как «ни
 * одного значения», и блок остался бы без договоров без ведома человека.
 */
import { useState } from "react";

import type { FilterCondition, ViewFilter } from "@/components/finance/api";

import styles from "./registry-import.module.css";
import { RULE_FIELD_WORDS, RULE_FLAG_FIELDS, RULE_LIST_FIELDS } from "./types";

export type ValueOption = { value: string; count?: number };

type Condition = { field: string; values: string[]; flag: boolean };

const FIELDS = [...RULE_LIST_FIELDS, ...RULE_FLAG_FIELDS] as string[];
const isFlag = (field: string) => (RULE_FLAG_FIELDS as readonly string[]).includes(field);

function fromFilter(filter: ViewFilter): Condition[][] {
  const groups = (filter.any ?? [])
    .map((group) =>
      group.all
        .filter((condition) => FIELDS.includes(condition.field))
        .map((condition) => ({
          field: condition.field,
          values: Array.isArray(condition.value) ? condition.value.map(String) : [],
          flag: condition.value === true,
        })),
    )
    .filter((group) => group.length);
  return groups.length ? groups : [[{ field: "type", values: [], flag: true }]];
}

function toFilter(groups: Condition[][]): ViewFilter {
  return {
    any: groups.map((group) => ({
      all: group.map(
        (condition): FilterCondition =>
          isFlag(condition.field)
            ? { field: condition.field, op: "is", value: condition.flag }
            : { field: condition.field, op: "in", value: condition.values },
      ),
    })),
  };
}

export function RuleEditor({
  filter,
  options,
  onApply,
  onCancel,
}: {
  filter: ViewFilter;
  options: Record<string, ValueOption[]>;
  onApply: (filter: ViewFilter) => void;
  onCancel: () => void;
}) {
  const [groups, setGroups] = useState<Condition[][]>(() => fromFilter(filter));

  const update = (g: number, c: number, patch: Partial<Condition>) =>
    setGroups((current) =>
      current.map((group, gi) => (gi === g ? group.map((item, ci) => (ci === c ? { ...item, ...patch } : item)) : group)),
    );
  const remove = (g: number, c: number) =>
    setGroups((current) =>
      current.map((group, gi) => (gi === g ? group.filter((_, ci) => ci !== c) : group)).filter((group) => group.length),
    );

  const empty = groups.flatMap((group) => group).find((item) => !isFlag(item.field) && !item.values.length);
  const problem = !groups.length
    ? "Нет ни одного условия"
    : empty
      ? `У условия «${RULE_FIELD_WORDS[empty.field]}» не выбрано ни одного значения`
      : "";

  return (
    <div className={styles.ruleEditor}>
      {groups.map((group, g) => (
        <div key={g} className={styles.ruleGroup}>
          <p className={styles.ruleLead}>{g === 0 ? "Показывать договоры, где" : "или где"}</p>
          {group.map((condition, c) => (
            <div key={c} className={styles.ruleCond}>
              <span className={styles.inline}>
                {c > 0 ? <span className="fin-soft">и</span> : null}
                <select
                  className={styles.select}
                  aria-label="Поле условия"
                  value={condition.field}
                  onChange={(event) => update(g, c, { field: event.target.value, values: [], flag: true })}
                >
                  {FIELDS.map((field) => (
                    <option key={field} value={field}>
                      {RULE_FIELD_WORDS[field]}
                    </option>
                  ))}
                </select>
                {isFlag(condition.field) ? (
                  <select
                    className={styles.select}
                    aria-label="Да или нет"
                    value={condition.flag ? "yes" : "no"}
                    onChange={(event) => update(g, c, { flag: event.target.value === "yes" })}
                  >
                    <option value="yes">да</option>
                    <option value="no">нет</option>
                  </select>
                ) : (
                  <span className="fin-soft">входит в</span>
                )}
                <button type="button" className={`fin-link-btn fin-soft ${styles.small}`} onClick={() => remove(g, c)}>
                  убрать
                </button>
              </span>
              {isFlag(condition.field) ? null : (
                <ValuePicker
                  options={options[condition.field] ?? []}
                  values={condition.values}
                  onChange={(values) => update(g, c, { values })}
                />
              )}
            </div>
          ))}
          <button
            type="button"
            className={`fin-link-btn ${styles.small}`}
            onClick={() =>
              setGroups((current) =>
                current.map((item, gi) => (gi === g ? [...item, { field: "subject", values: [], flag: true }] : item)),
              )
            }
          >
            + условие
          </button>
        </div>
      ))}
      <button
        type="button"
        className={`fin-link-btn ${styles.small}`}
        onClick={() => setGroups((current) => [...current, [{ field: "type", values: [], flag: true }]])}
      >
        + или
      </button>
      <div className={styles.actions}>
        <button type="button" className="btn-primary" disabled={Boolean(problem)} onClick={() => onApply(toFilter(groups))}>
          Применить правило
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Отмена
        </button>
        {problem ? <span className="fin-soft">{problem}</span> : null}
      </div>
    </div>
  );
}

function ValuePicker({
  options,
  values,
  onChange,
}: {
  options: ValueOption[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const known = new Set(options.map((option) => option.value));
  const all: ValueOption[] = [...options, ...values.filter((value) => !known.has(value)).map((value) => ({ value }))];
  const toggle = (value: string) =>
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if (!values.includes(value)) onChange([...values, value]);
    setDraft("");
  };
  return (
    <div className={styles.ruleValues}>
      {all.map((option) => (
        <label key={option.value} className={styles.ruleValue}>
          <input type="checkbox" checked={values.includes(option.value)} onChange={() => toggle(option.value)} />
          <span>
            {option.value}
            {option.count !== undefined ? <span className="fin-muted"> {option.count}</span> : null}
          </span>
        </label>
      ))}
      <span className={styles.inline}>
        <input
          type="text"
          className={styles.input}
          aria-label="Другое написание"
          placeholder="другое написание"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className={`fin-link-btn ${styles.small}`} onClick={add} disabled={!draft.trim()}>
          добавить
        </button>
      </span>
    </div>
  );
}
