"use client";

/**
 * Правило блока — предложением по-русски, а не конструктором из чипов:
 *
 *   Показывать договоры, где вид услуги входит в Абонентское, Разовая
 *   и исполнитель — наше юрлицо
 *   или предмет договора — Агентский                 + условие · + или
 *
 * Части одной группы соединены «и», группы — «или» с новой строки (правило
 * сервера `{any:[{all:[…]}]}`, `views.py`). Кликабельные части подчёркнуты
 * пунктиром и раскрывают маленький список. Общий с протоколом загрузки.
 *
 * Условия — только те, что сервер умеет исполнить (`views.OPS`): «входит в»,
 * «не входит в», «пусто», «не пусто», «содержит», «равно», «да / нет».
 * «Больше», «меньше», «до», «после» фраза не предлагает: сервер их не знает,
 * и правило молча не отобрало бы ни одного договора. По той же причине в
 * списке полей нет суммы и дат — их нет среди фактов, по которым сервер
 * отбирает (`service.facts_of`).
 *
 * «Исполнитель — наше юрлицо» записывается виртуальным полем
 * `executor_is_own`, а «исполнитель — ТОО «Альфа»» — самим полем `executor`:
 * человеку это одна часть фразы «исполнитель», и выбор между ними — выбор
 * условия, а не поля.
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  type FilterCondition,
  type Party,
  type PersonRef,
  type RegistrySchema,
  type ViewFilter,
  contractsApi,
} from "@/components/finance/api";
import { useRegistry } from "@/components/finance/contracts/store";
import { shortName } from "@/components/finance/format";
import { ChoicePop, MultiPop, type PopOption } from "@/components/finance/contracts/setup/popover";
import { Rise } from "@/components/finance/contracts/setup/rise";
import { errorText } from "@/components/finance/contracts/setup/use-setup-action";
import { ECONOMIC_WORDS, PHASE_WORDS, lowerFirst } from "@/components/finance/contracts/setup/words";

// ── Каталог полей ────────────────────────────────────────────────────────────

type Kind = "list" | "party" | "person" | "text" | "bool" | "flag" | "number";

/**
 * `archived` — значения в архиве: их не предлагают, но условие, написанное до
 * архива, должно читаться словом, а не «убранным значением».
 */
type Entry = { key: string; title: string; kind: Kind; options: PopOption[]; archived?: PopOption[] };

/** Системные поля, по которым сервер отбирает (`facts_of`). */
const FILTERABLE_SYSTEM = new Set([
  "status", "type", "subject", "economic_role", "department", "executor", "customer", "people",
  "billing", "end_kind", "number", "note", "amount_terms",
  // Числа: «Срок, мес < 2» (листы «до 2 мес»), «Остаток (сводка) > 0» («Остатки»).
  "amount", "age_months", "summary_paid", "summary_remaining",
]);

const VIRTUAL_TITLES: Record<string, string> = {
  phase: "фаза статуса",
  economic: "системный смысл",
  intra_group: "обе стороны",
};

type Ctx = {
  schema: RegistrySchema | null;
  parties: Readonly<Record<string, Party>>;
  people: Readonly<Record<string, PersonRef>>;
};

function catalog({ schema, parties, people }: Ctx): Entry[] {
  if (!schema) return [];
  const own = schema.own_entities.map((entity) => ({ value: entity.id, label: entity.name, hint: entity.code || "наше" }));
  const ownIds = new Set(own.map((item) => item.value));
  const others = Object.values(parties)
    .filter((party) => !ownIds.has(party.id))
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .map((party) => ({ value: party.id, label: party.name, hint: party.bin || undefined }));
  const partyOptions = [...own, ...others];
  const personOptions = Object.values(people)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .map((person) => ({ value: person.id, label: shortName(person.name) || person.name }));

  const out: Entry[] = [];
  for (const field of schema.fields) {
    if (field.system && !FILTERABLE_SYSTEM.has(field.key)) continue;
    const title = lowerFirst(field.title);
    switch (field.type) {
      case "list":
      case "multi_list":
        out.push({
          key: field.key,
          title,
          kind: "list",
          options: (schema.lists[field.key] ?? []).map((item) => ({ value: item.id, label: item.value })),
          archived: (schema.archived_values?.[field.key] ?? []).map((item) => ({
            value: item.id,
            label: item.value,
            hint: "в корзине",
          })),
        });
        break;
      case "department":
        out.push({
          key: field.key,
          title,
          kind: "list",
          options: schema.departments.map((item) => ({
            value: item.id,
            label: item.code || item.title,
            hint: item.title && item.title !== item.code ? item.title : undefined,
          })),
        });
        break;
      case "choice":
        out.push({
          key: field.key,
          title,
          kind: "list",
          options: (field.choices ?? []).map((item) => ({ value: item.value, label: lowerFirst(item.label) })),
        });
        break;
      case "party":
        out.push({ key: field.key, title, kind: "party", options: partyOptions });
        break;
      case "person":
        out.push({ key: field.key, title, kind: "person", options: personOptions });
        break;
      case "bool":
        out.push({ key: field.key, title, kind: "bool", options: [] });
        break;
      case "money":
      case "number":
        out.push({ key: field.key, title, kind: "number", options: [] });
        break;
      default:
        out.push({ key: field.key, title, kind: "text", options: [] });
    }
  }
  out.push({
    key: "phase",
    title: VIRTUAL_TITLES.phase,
    kind: "list",
    options: schema.status_phases.map((item) => ({ value: item, label: PHASE_WORDS[item] ?? item })),
  });
  out.push({
    key: "economic",
    title: VIRTUAL_TITLES.economic,
    kind: "list",
    options: schema.economic_roles.map((item) => ({ value: item, label: ECONOMIC_WORDS[item] ?? item })),
  });
  out.push({ key: "intra_group", title: VIRTUAL_TITLES.intra_group, kind: "flag", options: [] });
  return out;
}

// ── Условия: запись сервера ↔ часть фразы ────────────────────────────────────

type OpKey =
  | "in" | "not_in" | "empty" | "not_empty" | "contains" | "eq" | "neq" | "own" | "not_own" | "yes" | "no"
  | "lt" | "lte" | "gt" | "gte";

const NUMBER_OPS = new Set<OpKey>(["lt", "lte", "gt", "gte"]);

const OP_MENU: Record<Kind, { key: OpKey; label: string }[]> = {
  list: [
    { key: "in", label: "входит в" },
    { key: "not_in", label: "не входит в" },
    { key: "empty", label: "пусто" },
    { key: "not_empty", label: "не пусто" },
  ],
  party: [
    { key: "own", label: "наше юрлицо" },
    { key: "not_own", label: "не наше юрлицо" },
    { key: "in", label: "это" },
    { key: "not_in", label: "не это" },
    { key: "empty", label: "пусто" },
    { key: "not_empty", label: "не пусто" },
  ],
  person: [
    { key: "in", label: "это" },
    { key: "not_in", label: "не это" },
    { key: "empty", label: "пусто" },
    { key: "not_empty", label: "не пусто" },
  ],
  text: [
    { key: "contains", label: "содержит" },
    { key: "eq", label: "равно" },
    { key: "neq", label: "не равно" },
    { key: "empty", label: "пусто" },
    { key: "not_empty", label: "не пусто" },
  ],
  bool: [
    { key: "yes", label: "да" },
    { key: "no", label: "нет" },
  ],
  flag: [
    { key: "yes", label: "наши юрлица" },
    { key: "no", label: "не обе наши" },
  ],
  number: [
    { key: "lt", label: "меньше" },
    { key: "lte", label: "не больше" },
    { key: "gt", label: "больше" },
    { key: "gte", label: "не меньше" },
    { key: "empty", label: "пусто" },
    { key: "not_empty", label: "не пусто" },
  ],
};

type Read = { entry: Entry | null; key: string; op: OpKey; values: string[]; text: string };

function asList(value: unknown): string[] {
  if (value === null || value === undefined || value === "") return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function readCondition(condition: FilterCondition, entries: Map<string, Entry>): Read {
  const { field, op, value } = condition;
  if (field === "executor_is_own" || field === "customer_is_own") {
    const slot = field === "executor_is_own" ? "executor" : "customer";
    return { entry: entries.get(slot) ?? null, key: slot, op: value ? "own" : "not_own", values: [], text: "" };
  }
  const entry = entries.get(field) ?? null;
  if (op === "is") return { entry, key: field, op: value ? "yes" : "no", values: [], text: "" };
  if (entry && (entry.kind === "list" || entry.kind === "party" || entry.kind === "person")) {
    const mapped: OpKey = op === "eq" ? "in" : op === "neq" ? "not_in" : (op as OpKey);
    return { entry, key: field, op: mapped, values: asList(value), text: "" };
  }
  return { entry, key: field, op: op as OpKey, values: [], text: value === null || value === undefined ? "" : String(value) };
}

function writeCondition(key: string, kind: Kind, op: OpKey, values: string[], text: string): FilterCondition {
  if (kind === "party" && (op === "own" || op === "not_own")) {
    return { field: `${key}_is_own`, op: "is", value: op === "own" };
  }
  if (op === "yes" || op === "no") return { field: key, op: "is", value: op === "yes" };
  if (op === "empty" || op === "not_empty") return { field: key, op, value: null };
  if (NUMBER_OPS.has(op)) {
    const number = Number(text.replace(/[\s  ]/g, "").replace(",", "."));
    return { field: key, op, value: text.trim() && Number.isFinite(number) ? number : null };
  }
  if (op === "contains" || op === "eq" || op === "neq") {
    if (kind === "text") return { field: key, op, value: text };
  }
  return { field: key, op, value: values };
}

function defaultCondition(entry: Entry): FilterCondition {
  switch (entry.kind) {
    case "party":
      return writeCondition(entry.key, "party", "own", [], "");
    case "text":
      return writeCondition(entry.key, "text", "contains", [], "");
    case "number":
      return writeCondition(entry.key, "number", "gt", [], "");
    case "bool":
    case "flag":
      return writeCondition(entry.key, entry.kind, "yes", [], "");
    default:
      return writeCondition(entry.key, entry.kind, "in", [], "");
  }
}

/** Условие, у которого не выбрано значение: сервер его примет, но оно не отберёт ничего. */
function incomplete(condition: FilterCondition): boolean {
  if (condition.op === "in" || condition.op === "not_in") return asList(condition.value).length === 0;
  if (NUMBER_OPS.has(condition.op as OpKey)) return typeof condition.value !== "number";
  if (condition.op === "contains" || condition.op === "eq" || condition.op === "neq") {
    return !String(condition.value ?? "").trim();
  }
  return false;
}

/** Чего не хватает правилу, чтобы его можно было применить. Пусто — хватает всего. */
export function ruleProblem(filter: ViewFilter): string {
  const count = filter.any.reduce((sum, group) => sum + group.all.filter(incomplete).length, 0);
  if (!count) return "";
  return count === 1 ? "В одном условии не выбрано значение" : `Не выбраны значения в условиях: ${count}`;
}

function valuesText(values: string[], options: PopOption[], archived: PopOption[] = []): string {
  const labels = values.map((id) => {
    const live = options.find((item) => item.value === id);
    if (live) return live.label;
    const gone = archived.find((item) => item.value === id);
    return gone ? `${gone.label} (в корзине)` : "удалённое значение";
  });
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.slice(0, 3).join(", ")} и ещё ${labels.length - 3}`;
}

function opWord(kind: Kind, op: OpKey, count: number): string {
  switch (op) {
    case "in":
      if (kind === "list") return count === 1 ? "—" : "входит в";
      return count > 1 ? "— один из" : "—";
    case "not_in":
      if (kind === "list") return count === 1 ? "— не" : "не входит в";
      return count > 1 ? "— ни один из" : "— не";
    case "empty":
      return "— пусто";
    case "not_empty":
      return "— не пусто";
    case "contains":
      return "содержит";
    case "eq":
      return "равно";
    case "neq":
      return "не равно";
    case "own":
      return "— наше юрлицо";
    case "not_own":
      return "— не наше юрлицо";
    case "yes":
      return kind === "flag" ? "— наши юрлица" : "— да";
    case "no":
      return kind === "flag" ? "— не обе наши" : "— нет";
    case "lt":
      return "меньше";
    case "lte":
      return "не больше";
    case "gt":
      return "больше";
    case "gte":
      return "не меньше";
    default:
      return op;
  }
}

// ── Счётчик ──────────────────────────────────────────────────────────────────

/**
 * Сколько договоров подходит под правило. Запрос — через 300 мс после
 * последней правки: человек щёлкает три значения подряд, и три запроса с
 * промежуточными числами только мигали бы.
 */
export function usePreviewCount(filter: ViewFilter, enabled = true): { count: number | null; error: string } {
  const [result, setResult] = useState<{ count: number | null; error: string }>({ count: null, error: "" });
  const key = JSON.stringify(filter);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const answer = await contractsApi.setup.preview(JSON.parse(key) as ViewFilter);
        if (alive) setResult({ count: answer.count, error: "" });
      } catch (exc) {
        if (alive) setResult((value) => ({ count: value.count, error: errorText(exc) }));
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, enabled]);
  return result;
}

export function RuleCount({ filter }: { filter: ViewFilter }) {
  const { count, error } = usePreviewCount(filter);
  if (error) return <span className="setup-count fin-fail">не посчитать: {error}</span>;
  return (
    <span className="setup-count" aria-live="polite">
      {count === null ? "" : (
        <>
          подходит <Rise text={String(count)} className="setup-count-num" />
        </>
      )}
    </span>
  );
}

// ── Фраза ────────────────────────────────────────────────────────────────────

type Props = {
  value: ViewFilter;
  onChange?: (next: ViewFilter) => void;
  lead?: string;
  /**
   * Что значит правило без условий. Сервер (`views.place`) читает его так:
   * у обычного листа — ни одного договора, у главного — все договоры (или
   * те, что не подошли другим блокам). Какой это лист, знает вызывающий.
   */
  emptyText?: string;
  /** Подпись кнопки первого условия на пустом правиле. */
  emptyAdd?: string;
  readOnly?: boolean;
  /** Схема не из хранилища — для протокола загрузки до заведения реестра. */
  schema?: RegistrySchema | null;
  aside?: ReactNode;
};

export function FilterSentence({
  value,
  onChange,
  lead = "Показывать договоры, где",
  emptyText = "Пока ни одного договора",
  emptyAdd = "задайте условие",
  readOnly,
  schema: schemaProp,
  aside,
}: Props) {
  const stored = useRegistry((s) => s.schema);
  const parties = useRegistry((s) => s.parties);
  const people = useRegistry((s) => s.people);
  const schema = schemaProp ?? stored;
  const entries = useMemo(() => catalog({ schema, parties, people }), [schema, parties, people]);
  const byKey = useMemo(() => new Map(entries.map((item) => [item.key, item])), [entries]);
  const [fresh, setFresh] = useState<string | null>(null);
  const groups = value.any;
  const editable = !readOnly && !!onChange;

  const fieldOptions: PopOption[] = entries.map((item) => ({ value: item.key, label: item.title }));

  const setGroups = (next: { all: FilterCondition[] }[]) => onChange?.({ any: next.filter((group) => group.all.length) });

  const put = (gi: number, ci: number, condition: FilterCondition) =>
    setGroups(groups.map((group, g) => (g === gi ? { all: group.all.map((item, c) => (c === ci ? condition : item)) } : group)));

  const drop = (gi: number, ci: number) =>
    setGroups(groups.map((group, g) => (g === gi ? { all: group.all.filter((_, c) => c !== ci) } : group)));

  const add = (gi: number | null, key: string) => {
    const entry = byKey.get(key);
    if (!entry) return;
    const condition = defaultCondition(entry);
    // Новое условие без значения сразу раскрывает выбор значения: иначе
    // человек видит «вид услуги входит в выбрать…» и должен догадаться нажать.
    const path = gi === null ? `${groups.length}:0` : `${gi}:${groups[gi].all.length}`;
    if (gi === null) setGroups([...groups, { all: [condition] }]);
    else setGroups(groups.map((group, g) => (g === gi ? { all: [...group.all, condition] } : group)));
    setFresh(incomplete(condition) ? path : null);
  };

  const adder = (gi: number | null, text: string) => (
    <ChoicePop
      value={null}
      options={fieldOptions}
      onPick={(key) => add(gi, key)}
      text={text}
      // На пустом правиле первая группа для человека — просто «+ условие».
      label={gi === null && groups.length ? "Новая группа условий: поле" : "Новое условие: поле"}
      className="setup-rule-add"
    />
  );

  if (!groups.length) {
    return (
      <div className="setup-rule">
        <p className="setup-rule-line">
          {emptyText}
          {editable ? (
            <>
              <span className="fin-muted"> · </span>
              {adder(null, emptyAdd)}
            </>
          ) : null}
          {aside ? <span className="setup-rule-aside">{aside}</span> : null}
        </p>
      </div>
    );
  }

  return (
    <div className="setup-rule">
      {groups.map((group, gi) => (
        <p className="setup-rule-line" key={gi}>
          {gi === 0 ? <span>{lead} </span> : <span className="setup-rule-or">или </span>}
          {group.all.map((condition, ci) => (
            <Fragment key={ci}>
              {ci > 0 ? <span className="setup-rule-and"> и </span> : null}
              <Condition
                condition={condition}
                byKey={byKey}
                fieldOptions={fieldOptions}
                editable={editable}
                autoOpen={fresh === `${gi}:${ci}`}
                onSettled={() => setFresh(null)}
                onChange={(next) => put(gi, ci, next)}
                onRemove={() => drop(gi, ci)}
              />
            </Fragment>
          ))}
          {editable ? (
            <span className="setup-rule-tools">
              {adder(gi, "+ условие")}
              {gi === groups.length - 1 ? (
                <>
                  <span className="fin-muted"> · </span>
                  {adder(null, "+ или")}
                </>
              ) : null}
            </span>
          ) : null}
          {gi === 0 && aside ? <span className="setup-rule-aside">{aside}</span> : null}
        </p>
      ))}
    </div>
  );
}

type ConditionProps = {
  condition: FilterCondition;
  byKey: Map<string, Entry>;
  fieldOptions: PopOption[];
  editable: boolean;
  autoOpen: boolean;
  onSettled: () => void;
  onChange: (next: FilterCondition) => void;
  onRemove: () => void;
};

function Condition({ condition, byKey, fieldOptions, editable, autoOpen, onSettled, onChange, onRemove }: ConditionProps) {
  const read = readCondition(condition, byKey);
  const entry = read.entry;
  if (!entry) {
    // Поле убрали из реестра после того, как правило написали: условие видно
    // словами сервера, чтобы его можно было убрать, а не пропадало молча.
    return (
      <span className="setup-cond">
        <span className="fin-fail">поле «{condition.field}», которого больше нет</span>
        {editable ? (
          <button type="button" className="setup-rule-x" aria-label="Убрать условие" onClick={onRemove}>
            ×
          </button>
        ) : null}
      </span>
    );
  }
  const kind = entry.kind;
  const withValues = (op: OpKey) => op === "in" || op === "not_in";
  const withText = (op: OpKey) =>
    (kind === "text" && (op === "contains" || op === "eq" || op === "neq")) || (kind === "number" && NUMBER_OPS.has(op));
  const missing = incomplete(condition);
  const label = `${entry.title} ${opWord(kind, read.op, read.values.length)}`;

  const fieldPart = editable ? (
    <ChoicePop
      value={entry.key}
      options={fieldOptions}
      onPick={(key) => {
        const next = byKey.get(key);
        if (next) onChange(defaultCondition(next));
      }}
      label="Поле условия"
    />
  ) : (
    <span>{entry.title}</span>
  );

  const opPart = editable ? (
    <ChoicePop
      value={read.op}
      options={OP_MENU[kind].map((item) => ({ value: item.key, label: item.label }))}
      text={opWord(kind, read.op, read.values.length)}
      onPick={(op) => onChange(writeCondition(entry.key, kind, op as OpKey, read.values, read.text))}
      label={`Условие для поля «${entry.title}»`}
    />
  ) : (
    <span>{opWord(kind, read.op, read.values.length)}</span>
  );

  let valuePart: ReactNode = null;
  if (withValues(read.op)) {
    const text = read.values.length ? valuesText(read.values, entry.options, entry.archived) : "выбрать…";
    // Архивное значение, уже стоящее в условии, остаётся в списке отметок —
    // иначе его нельзя было бы снять, не удаляя всё условие.
    const options = [
      ...entry.options,
      ...(entry.archived ?? []).filter((item) => read.values.includes(item.value)),
    ];
    valuePart = editable ? (
      <MultiPop
        values={read.values}
        options={options}
        onChange={(values) => onChange(writeCondition(entry.key, kind, read.op, values, ""))}
        label={`Значения: ${entry.title}`}
        text={text}
        autoOpen={autoOpen}
        onClosed={onSettled}
        className={missing ? "setup-rule-missing" : undefined}
      />
    ) : (
      <span>{text}</span>
    );
  } else if (withText(read.op)) {
    valuePart = editable ? (
      <TextPart
        value={read.text}
        autoOpen={autoOpen}
        onSettled={onSettled}
        label={`Текст условия: ${entry.title}`}
        onCommit={(text) => onChange(writeCondition(entry.key, kind, read.op, [], text))}
      />
    ) : (
      <span>{kind === "number" ? read.text : `«${read.text}»`}</span>
    );
  }

  return (
    <span className="setup-cond">
      {fieldPart} {opPart}
      {valuePart ? <> {valuePart}</> : null}
      {editable ? (
        <button type="button" className="setup-rule-x" aria-label={`Убрать условие «${label}»`} onClick={onRemove}>
          ×
        </button>
      ) : null}
    </span>
  );
}

function TextPart({
  value,
  onCommit,
  label,
  autoOpen,
  onSettled,
}: {
  value: string;
  onCommit: (text: string) => void;
  label: string;
  autoOpen: boolean;
  onSettled: () => void;
}) {
  const [editing, setEditing] = useState(autoOpen);
  const [draft, setDraft] = useState(value);
  const finish = (save: boolean) => {
    setEditing(false);
    onSettled();
    if (save && draft.trim() !== value) onCommit(draft.trim());
  };
  if (editing) {
    return (
      <input
        className="setup-rule-input"
        value={draft}
        aria-label={label}
        autoFocus
        size={Math.max(6, draft.length + 1)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish(true);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setDraft(value);
            finish(false);
          }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className={`fin-link-btn ${value ? "" : "setup-rule-missing"}`}
      aria-label={label}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      {value ? `«${value}»` : "написать…"}
    </button>
  );
}
