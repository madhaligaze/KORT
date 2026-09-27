"use client";

/**
 * Пункты протокола, кроме карты колонок и наших юрлиц: листы и блоки,
 * статусы, даты окончания, номера, строки вне главного листа, расхождения,
 * правила.
 *
 * Не блокирующие пункты видны и меняются, но «Завести» не держат: их
 * умолчание ничего не теряет (статус сохраняется как написан, дата — со
 * смыслом «не ясен», строка вне главного листа заводится, в расхождении верен
 * главный лист). Правила листов держат «Завести» там, где предложенное
 * правило приносит лишних или теряет строк больше допуска: лист, который после
 * загрузки вчетверо больше, чем в файле, молча не заводится.
 */
import { useState } from "react";

import { ChoiceSelect } from "@/components/choice-select";
import type { ViewFilter } from "@/components/finance/api";
import { plural } from "@/components/finance/format";

import { ChoiceLine } from "./choice-line";
import styles from "./registry-import.module.css";
import { RolesText } from "./roles-text";
import { RuleEditor, type ValueOption } from "./rule-editor";
import {
  BILLING_LABELS,
  ECONOMIC_LABELS,
  PHASE_LABELS,
  blockLabel,
  cellDate,
  dictOf,
  splitRef,
  text,
  type BlockItem,
  type Brief,
  type Decide,
  type Decisions,
  type DiffItem,
  type EndDateItem,
  type LooseItem,
  type NumberItem,
  type OrphanItem,
  type RuleAction,
  type RuleItem,
  type StatusItem,
} from "./types";

// ── 01 Листы, блоки и стороны ────────────────────────────────────────────────

export function BlocksStep({ items, mainSheet, decide }: { items: BlockItem[]; mainSheet: string; decide: Decide }) {
  const sheets: { sheet: string; blocks: BlockItem[] }[] = [];
  for (const block of items) {
    const last = sheets[sheets.length - 1];
    if (last && last.sheet === block.sheet) last.blocks.push(block);
    else sheets.push({ sheet: block.sheet, blocks: [block] });
  }
  return (
    <table className="proto-table">
      <thead>
        <tr>
          <th>Лист и блок</th>
          <th className={styles.num}>Строк</th>
          <th>Стороны по шапке блока</th>
        </tr>
      </thead>
      <tbody>
        {sheets.map(({ sheet, blocks }) =>
          blocks.map((block, index) => (
            <tr key={block.id}>
              <td>
                {blockLabel(block.sheet, block.title)}
                {index === 0 && sheet === mainSheet ? (
                  <>
                    {" "}
                    <span className="annot">главный лист</span>
                  </>
                ) : null}
                {index === 0 && sheet !== mainSheet ? (
                  <>
                    {" "}
                    <button type="button" className={`fin-link-btn fin-soft ${styles.small}`} onClick={() => decide({ main_sheet: sheet })}>
                      сделать главным
                    </button>
                  </>
                ) : null}
              </td>
              <td className={styles.num}>{block.rows}</td>
              <td>
                <RolesText roles={block.roles} />
              </td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}

// ── 04 Статусы и списки ──────────────────────────────────────────────────────

function meaningText(field: StatusItem["field"], meaning: Record<string, unknown>): string {
  if (field === "status") {
    if (meaning.handover) return "передача бухгалтеру";
    return meaning.phase ? `фаза: ${PHASE_LABELS[String(meaning.phase)] ?? meaning.phase}` : "";
  }
  const parts: string[] = [];
  if (meaning.billing) parts.push(`начисление: ${BILLING_LABELS[String(meaning.billing)] ?? meaning.billing}`);
  if (meaning.economic_role) parts.push(`смысл: ${ECONOMIC_LABELS[String(meaning.economic_role)] ?? meaning.economic_role}`);
  if (!parts.length && meaning.kind === "other") parts.push("иное, без начисления");
  return parts.join(" · ");
}

export function StatusesStep({ items, decisions, decide }: { items: StatusItem[]; decisions: Decisions; decide: Decide }) {
  const chosen = dictOf<Record<string, unknown>>(decisions, "statuses");
  const statuses = items.filter((item) => item.field === "status");
  const types = items.filter((item) => item.field === "type");
  const departments = items.filter((item) => item.field === "department");

  const row = (item: StatusItem) => {
    const spec = `${item.field}:${item.value}`;
    const decided = spec in chosen;
    const meaning = decided ? chosen[spec] ?? {} : item.meaning;
    const editable = decided || !item.known;
    const empty = !meaningText(item.field, meaning);
    return (
      <tr key={spec}>
        <td>{item.value}</td>
        <td className={styles.num}>{item.count}</td>
        <td>
          {!editable ? (
            <span className="fin-soft">{meaningText(item.field, meaning)}</span>
          ) : item.field === "status" ? (
            <ChoiceSelect
              className={styles.select}
              aria-label={`Смысл статуса «${item.value}»`}
              value={meaning.handover ? "handover" : String(meaning.phase ?? "")}
              onChange={(value) => {
                decide({
                  statuses: { [spec]: value === "handover" ? { handover: "accounting" } : value ? { phase: value } : {} },
                });
              }}
              placeholder="смысл не назначен"
              clearable
            >
              {Object.entries(PHASE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  фаза: {label}
                </option>
              ))}
              <option value="handover">передача бухгалтеру</option>
            </ChoiceSelect>
          ) : (
            <span className={styles.inline}>
              <ChoiceSelect
                className={styles.select}
                aria-label={`Начисление вида «${item.value}»`}
                value={String(meaning.billing ?? "")}
                onChange={(value) => decide({ statuses: { [spec]: pick({ ...meaning, billing: value }) } })}
                placeholder="начисление не назначено"
                clearable
              >
                {Object.entries(BILLING_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </ChoiceSelect>
              <ChoiceSelect
                className={styles.select}
                aria-label={`Смысл вида «${item.value}»`}
                value={String(meaning.economic_role ?? "")}
                onChange={(value) => decide({ statuses: { [spec]: pick({ ...meaning, economic_role: value }) } })}
                placeholder="смысл не назначен"
                clearable
              >
                {Object.entries(ECONOMIC_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </ChoiceSelect>
            </span>
          )}
        </td>
        <td>{!item.known && empty ? <span className="annot">незнакомый</span> : null}</td>
      </tr>
    );
  };

  return (
    <div className={styles.stack}>
      <table className="proto-table">
        <thead>
          <tr>
            <th>Статус как в файле</th>
            <th className={styles.num}>Договоров</th>
            <th>Смысл</th>
            <th />
          </tr>
        </thead>
        <tbody>{statuses.map(row)}</tbody>
      </table>
      {types.length ? (
        <table className="proto-table">
          <thead>
            <tr>
              <th>Вид как в файле</th>
              <th className={styles.num}>Договоров</th>
              <th>Начисление и смысл</th>
              <th />
            </tr>
          </thead>
          <tbody>{types.map(row)}</tbody>
        </table>
      ) : null}
      {departments.length ? (
        <p className={styles.line}>
          <span className="fin-soft">Отделы: </span>
          {departments.map((item, index) => (
            <span key={item.value}>
              {index ? " · " : ""}
              {item.value} {item.count}
              {item.odd ? (
                <>
                  {" "}
                  <span className="annot">не отдел, сохранится текстом</span>
                </>
              ) : null}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

/** Пустые смыслы не отправляются: «не назначено» — это отсутствие ключа. */
function pick(meaning: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(meaning).filter(([, value]) => value !== "" && value !== undefined && value !== null));
}

export function statusesSummary(items: StatusItem[], decisions: Decisions): string {
  const chosen = dictOf<Record<string, unknown>>(decisions, "statuses");
  const known = (item: StatusItem) => {
    const spec = `${item.field}:${item.value}`;
    return spec in chosen ? Boolean(meaningText(item.field, chosen[spec] ?? {})) : item.known;
  };
  const statuses = items.filter((item) => item.field === "status");
  const unknownStatuses = statuses.filter((item) => !known(item)).length;
  const unknownTypes = items.filter((item) => item.field === "type" && !known(item)).length;
  const head = `${statuses.length} ${plural(statuses.length, "статус", "статуса", "статусов")}`;
  const tail = unknownStatuses
    ? ` · без смысла: ${unknownStatuses}`
    : ", все со смыслом";
  return head + tail + (unknownTypes ? ` · ${unknownTypes} ${plural(unknownTypes, "вид", "вида", "видов")} без смысла` : "");
}

// ── 05 Даты окончания ────────────────────────────────────────────────────────

type EndKind = "terminated" | "fulfilled" | "unknown";

function lineOf(ref: string): number {
  return Number(splitRef(ref).line) || 0;
}

export function EndDatesStep({
  items,
  counts,
  decisions,
  decide,
}: {
  items: EndDateItem[];
  counts: Record<string, number>;
  decisions: Decisions;
  decide: Decide;
}) {
  const chosen = dictOf<EndKind>(decisions, "end_dates");
  // Решённая строка уходит из отчёта (у неё больше нет «не ясно»), но с
  // экрана не пропадает: иначе ответ нельзя было бы поправить.
  const [seen, setSeen] = useState<Record<string, EndDateItem>>({});
  const byRef = new Map<string, EndDateItem>();
  for (const item of items) byRef.set(item.ref, item);
  for (const [ref, item] of Object.entries(seen)) if (!byRef.has(ref) && chosen[ref]) byRef.set(ref, item);
  const rows = [...byRef.values()].sort(
    (a, b) => splitRef(a.ref).sheet.localeCompare(splitRef(b.ref).sheet, "ru") || lineOf(a.ref) - lineOf(b.ref),
  );

  return (
    <div className={styles.stack}>
      <p className={styles.line}>
        расторжение {counts.terminated ?? 0} · исполнение {counts.fulfilled ?? 0} · не ясно {counts.unknown ?? 0}
      </p>
      <p className={`${styles.line} fin-soft`}>
        Смысл даты — по статусу и виду: недействующий — расторжение; исполнен и разовая — исполнение.
      </p>
      {rows.length ? (
        <table className="proto-table">
          <thead>
            <tr>
              <th>Номер</th>
              <th>Контрагент</th>
              <th>Статус</th>
              <th>Дата</th>
              <th>Что это за дата</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ref}>
                <td className="fin-mono">{text(row.number)}</td>
                <td>{text(row.customer)}</td>
                <td>{text(row.status)}</td>
                <td className="fin-mono">{cellDate(row.end_date)}</td>
                <td>
                  <ChoiceLine
                    label={`Дата ${text(row.number)}`}
                    items={[
                      { value: "terminated", label: "Расторжение" },
                      { value: "fulfilled", label: "Исполнение" },
                      { value: "unknown", label: "Оставить неясным" },
                    ]}
                    value={chosen[row.ref] ?? null}
                    onChange={(value) => {
                      setSeen((current) => ({ ...current, [row.ref]: row }));
                      decide({ end_dates: { [row.ref]: value } });
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

// ── 06 Номера у разных контрагентов ─────────────────────────────────────────

export function NumbersStep({ items }: { items: NumberItem[] }) {
  if (!items.length) return <p className="fin-soft">Повторов нет</p>;
  return (
    <div className={styles.stack}>
      <p className={styles.line}>
        Все договоры заведутся, у каждого в карточке будет замечание «этот номер уже есть у другого контрагента».
      </p>
      <ul className={styles.rows}>
        {items.map((item) => (
          <li key={item.number} className={styles.row}>
            <span className={`fin-mono ${styles.grow}`}>{item.number}</span>
            <span className="fin-soft">
              {item.contracts} {plural(item.contracts, "договор", "договора", "договоров")}
            </span>
            <span className={`fin-mono fin-muted ${styles.refs}`}>{item.refs.join(" · ")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── 07 Строки, которых нет в главном листе ───────────────────────────────────

export function OrphansStep({
  items,
  loose,
  numberOnly,
  blocks,
  mainSheet,
  decisions,
  decide,
}: {
  items: OrphanItem[];
  loose: LooseItem[];
  numberOnly: LooseItem[];
  blocks: BlockItem[];
  mainSheet: string;
  decisions: Decisions;
  decide: Decide;
}) {
  const chosen = dictOf<boolean>(decisions, "orphans");
  const separate = dictOf<string>(decisions, "loose");
  const titleOf = (id: string) => {
    const block = blocks.find((item) => item.id === id);
    return block ? blockLabel(block.sheet, block.title) : id;
  };
  const creates = (item: OrphanItem) => (item.ref in chosen ? chosen[item.ref] !== false : item.create);
  const all = (value: boolean) => decide({ orphans: Object.fromEntries(items.map((item) => [item.ref, value])) });

  return (
    <div className={styles.stack}>
      {items.length ? (
        <>
          <p className={styles.line}>
            {items.length} {plural(items.length, "строка есть", "строки есть", "строк есть")} в листах, но нет в «{mainSheet}».
            Правило листа такие строки само не заведёт.
          </p>
          <div className={styles.actions}>
            <button type="button" className="fin-link-btn" onClick={() => all(true)}>
              Отметить все
            </button>
            <button type="button" className="fin-link-btn" onClick={() => all(false)}>
              Снять все
            </button>
          </div>
          <table className="proto-table">
            <thead>
              <tr>
                <th>Завести</th>
                <th>Номер</th>
                <th>Стороны</th>
                <th>Лист и блок</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.ref}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Завести ${text(item.number)}`}
                      checked={creates(item) && !item.existing}
                      disabled={Boolean(item.existing)}
                      onChange={(event) => decide({ orphans: { [item.ref]: event.target.checked } })}
                    />
                  </td>
                  <td className="fin-mono">{text(item.number)}</td>
                  <td>
                    {text(item.executor)} → {text(item.customer)}
                    {item.existing ? <span className="fin-muted"> · уже в реестре</span> : null}
                    {separate[item.ref] === "separate" ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          className={`fin-link-btn fin-soft ${styles.small}`}
                          onClick={() => decide({ loose: { [item.ref]: "same" } })}
                        >
                          это тот же договор
                        </button>
                      </>
                    ) : null}
                  </td>
                  <td className="fin-mono fin-muted">{titleOf(item.block)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="fin-soft">Все строки листов есть в «{mainSheet}»</p>
      )}
      {loose.length ? (
        <div>
          <p className={styles.subhead}>Сведены с «{mainSheet}» не по всем признакам</p>
          <PairTable
            items={loose}
            mainSheet={mainSheet}
            action="Разные договоры"
            onAction={(item) => decide({ loose: { [item.ref]: "separate" } })}
          />
        </div>
      ) : null}
      {numberOnly.length ? (
        <div>
          <p className={styles.subhead}>Тот же номер, но стороны другие — заведутся отдельно</p>
          <PairTable
            items={numberOnly}
            mainSheet={mainSheet}
            action="Это он"
            onAction={(item) => decide({ loose: { [item.ref]: "same" } })}
          />
        </div>
      ) : null}
    </div>
  );
}

const LOOSE_WORDS: Record<string, string> = {
  swapped: "стороны переставлены",
  number_party: "номер и одна сторона",
  number: "по номеру, решение человека",
};

function parties(executor: unknown, customer: unknown): string {
  return `${text(executor) || "—"} → ${text(customer) || "—"}`;
}

/** Пара «строка листа ↔ строка главного»: стороны обеих рядом, чтобы сравнить глазами. */
function PairTable({
  items,
  mainSheet,
  action,
  onAction,
}: {
  items: LooseItem[];
  mainSheet: string;
  action: string;
  onAction: (item: LooseItem) => void;
}) {
  return (
    <table className="proto-table">
      <thead>
        <tr>
          <th>Номер</th>
          <th>В листе</th>
          <th>В «{mainSheet}»</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.ref}>
            <td className="fin-mono">
              {text(item.number)}
              {item.kind ? (
                <>
                  <br />
                  <span className="annot">{LOOSE_WORDS[item.kind] ?? item.kind}</span>
                </>
              ) : null}
            </td>
            <td>
              {parties(item.sheet_executor, item.sheet_customer)} <span className="fin-mono fin-muted">{item.ref}</span>
            </td>
            <td>
              {parties(item.main_executor, item.main_customer)} <span className="fin-mono fin-muted">{item.main}</span>
            </td>
            <td>
              <button type="button" className="fin-link-btn" onClick={() => onAction(item)}>
                {action}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function orphansSummary(items: OrphanItem[], loose: LooseItem[], numberOnly: LooseItem[], decisions: Decisions): string {
  const chosen = dictOf<boolean>(decisions, "orphans");
  const create = items.filter((item) => !item.existing && (item.ref in chosen ? chosen[item.ref] !== false : item.create)).length;
  const head = items.length ? `${create} из ${items.length} будут заведены` : "все строки листов есть в главном";
  return (
    head +
    (loose.length ? ` · сведены не по всем признакам: ${loose.length}` : "") +
    (numberOnly.length ? ` · тот же номер, другие стороны: ${numberOnly.length}` : "")
  );
}

// ── 08 Расхождения листов с главным ─────────────────────────────────────────

function valueText(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? cellDate(raw) : raw;
}

export function DiffsStep({
  items,
  mainSheet,
  decisions,
  decide,
}: {
  items: DiffItem[];
  mainSheet: string;
  decisions: Decisions;
  decide: Decide;
}) {
  const chosen = dictOf<"main" | "sheet">(decisions, "diffs");
  if (!items.length) return <p className="fin-soft">Листы совпадают с «{mainSheet}»</p>;

  const byField = new Map<string, number>();
  for (const item of items) byField.set(item.title, (byField.get(item.title) ?? 0) + 1);
  const groups: { ref: string; head: string; items: DiffItem[] }[] = [];
  for (const item of items) {
    const last = groups.find((group) => group.ref === item.main_ref);
    if (last) last.items.push(item);
    else groups.push({ ref: item.main_ref, head: [text(item.number), text(item.customer)].filter(Boolean).join(" · "), items: [item] });
  }
  const all = (take: "main" | "sheet") => decide({ diffs: Object.fromEntries(items.map((item) => [item.id, take])) });

  return (
    <div className={styles.stack}>
      <p className={styles.line}>
        {[...byField.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([title, count]) => `${title} ${count}`)
          .join(" · ")}
      </p>
      <div className={styles.actions}>
        <button type="button" className="fin-link-btn" onClick={() => all("main")}>
          Везде верна «{mainSheet}»
        </button>
        <button type="button" className="fin-link-btn" onClick={() => all("sheet")}>
          Везде верен лист
        </button>
      </div>
      {groups.map((group) => (
        <div key={group.ref} className={styles.diffGroup}>
          <p className={styles.diffHead}>{group.head || group.ref}</p>
          {group.items.map((item) => (
            <div key={item.id} className={styles.diffRow}>
              <span className="fin-soft">{item.title}</span>
              <ChoiceLine
                label={item.title}
                stacked
                items={[
                  {
                    value: "main",
                    label: (
                      <>
                        <span className={styles.diffSource}>{mainSheet}</span>
                        <span className={styles.diffValue}>{valueText(item.main) || "пусто"}</span>
                      </>
                    ),
                  },
                  {
                    value: "sheet",
                    label: (
                      <>
                        <span className={styles.diffSource}>{splitRef(item.sheet_ref).sheet}</span>
                        <span className={styles.diffValue}>{valueText(item.sheet)}</span>
                      </>
                    ),
                  },
                ]}
                value={chosen[item.id] ?? item.take}
                onChange={(value) => decide({ diffs: { [item.id]: value } })}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function diffsSummary(items: DiffItem[], mainSheet: string, decisions: Decisions): string {
  if (!items.length) return "листы совпадают с главным";
  const chosen = dictOf<"main" | "sheet">(decisions, "diffs");
  const fromSheet = items.filter((item) => (chosen[item.id] ?? item.take) === "sheet").length;
  const head = `${items.length} ${plural(items.length, "поле", "поля", "полей")}`;
  if (!fromSheet) return `${head} · верна «${mainSheet}»`;
  if (fromSheet === items.length) return `${head} · верны листы`;
  return `${head} · из листа: ${fromSheet}`;
}

// ── 09 Правила листов и блоков ───────────────────────────────────────────────

function briefText(brief: Brief): string {
  const why = [brief.type ? `вид — ${text(brief.type)}` : "", brief.subject ? `предмет — ${text(brief.subject)}` : ""]
    .filter(Boolean)
    .join(", ");
  return `${text(brief.number) || brief.ref}${why ? ` (${why})` : ""}`;
}

/** Правило держится не на виде, а на предмете: без пометки оно выглядело бы ошибкой. */
function bySubject(rule: RuleItem): boolean {
  const fields = (rule.filter.any ?? []).flatMap((group) => group.all.map((condition) => condition.field));
  return fields.includes("subject") && !fields.includes("type");
}

const SOURCE_WORDS: Record<RuleItem["source"], string> = {
  suggested: "предложено",
  accepted: "принято",
  manual: "своё правило",
  empty: "пустой блок",
};

type RuleChoice = { action?: RuleAction; filter?: ViewFilter } | null;

/** Решение по блоку, как его видит экран: принятое сервером или ещё летящее. */
export function ruleChoice(decisions: Decisions, block: string): RuleAction | null {
  const raw = dictOf<RuleChoice>(decisions, "rules")[block];
  if (!raw || typeof raw !== "object") return null;
  if (raw.action) return raw.action;
  return raw.filter ? "rule" : null;
}

/** Блоки, которые держат «Завести»: сервер назвал, а решения по ним ещё нет. */
export function pendingRules(pending: string[], decisions: Decisions): string[] {
  return pending.filter((block) => ruleChoice(decisions, block) === null);
}

/**
 * Написания из файла для фразы правила: виды, статусы, отделы — из пункта 04,
 * предметы — полным списком из того же пункта (`subjects`); у старого отчёта
 * без него — из правил и примеров строк.
 */
function valueOptions(
  items: RuleItem[],
  statuses: StatusItem[],
  listed: { value: string; count: number }[],
): Record<string, ValueOption[]> {
  const out: Record<string, ValueOption[]> = { type: [], subject: [], department: [], status: [] };
  for (const item of statuses) out[item.field]?.push({ value: item.value, count: item.count });
  if (listed.length) {
    out.subject = listed.map((item) => ({ value: item.value, count: item.count }));
    return out;
  }
  const subjects = new Set<string>();
  for (const rule of items) {
    for (const group of rule.filter.any ?? [])
      for (const condition of group.all)
        if (condition.field === "subject" && Array.isArray(condition.value)) for (const value of condition.value) subjects.add(String(value));
    for (const brief of [...rule.missing, ...rule.extra_sample]) if (text(brief.subject)) subjects.add(text(brief.subject));
  }
  out.subject = [...subjects].sort((a, b) => a.localeCompare(b, "ru")).map((value) => ({ value }));
  return out;
}

export function RulesStep({
  items,
  statuses,
  subjects = [],
  decisions,
  decide,
}: {
  items: RuleItem[];
  statuses: StatusItem[];
  subjects?: { value: string; count: number }[];
  decisions: Decisions;
  decide: Decide;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  if (!items.length) return <p className="fin-soft">Других листов нет</p>;
  const options = valueOptions(items, statuses, subjects);

  return (
    <div className={styles.stack}>
      {items.map((rule) => {
        const choice = ruleChoice(decisions, rule.block);
        const asks = rule.needs_decision && choice === null;
        const missingMore = rule.missing_count - rule.missing.length;
        return (
          <div key={rule.block} className={styles.rule9}>
            <p className={styles.subhead}>
              {blockLabel(rule.sheet, rule.title)} <span className="annot">{SOURCE_WORDS[rule.source] ?? rule.source}</span>
              {bySubject(rule) && rule.source !== "empty" ? (
                <>
                  {" "}
                  <span className="annot">по предмету, не по виду</span>
                </>
              ) : null}
            </p>
            {asks ? <p className={`${styles.line} ${styles.wait}`}>Ждёт решения: {rule.reason}</p> : null}
            <p className="proto-rule">{rule.sentence}</p>
            <p className={styles.line}>
              <span className="proto-count">
                {rule.caught} из {rule.in_sheet}
              </span>{" "}
              <span className="fin-soft">
                {plural(rule.in_sheet, "строки", "строк", "строк")} листа
                {rule.extra ? ` · лишних ${rule.extra}` : ""}
              </span>
            </p>
            {rule.missing.length ? (
              <p className={styles.line}>
                <span className="fin-soft">Не попадут в лист: </span>
                {rule.missing.map(briefText).join(" · ")}
                {missingMore > 0 ? ` и ещё ${missingMore}` : ""}
                <br />
                <span className="fin-soft">В реестре они останутся, в листе их не будет.</span>
              </p>
            ) : null}
            {rule.extra ? (
              <p className={styles.line}>
                <span className="fin-soft">Попадут сюда из других листов: </span>
                {rule.extra_sample.map(briefText).join(" · ")}
                {rule.extra > rule.extra_sample.length ? ` и ещё ${rule.extra - rule.extra_sample.length}` : ""}
              </p>
            ) : null}
            <div className={styles.actions}>
              <ChoiceLine<RuleAction>
                label={`Правило · ${blockLabel(rule.sheet, rule.title)}`}
                items={[
                  { value: "accept", label: "Принять правило" },
                  { value: "rule", label: "Поправить правило" },
                  { value: "empty", label: "Оставить пустым" },
                ]}
                value={choice}
                onChange={(value) => {
                  if (value === "rule") {
                    setEditing(rule.block);
                    return;
                  }
                  setEditing(null);
                  decide({ rules: { [rule.block]: { action: value } } });
                }}
              />
              {choice ? (
                <button
                  type="button"
                  className={`fin-link-btn fin-soft ${styles.small}`}
                  onClick={() => decide({ rules: { [rule.block]: null } })}
                >
                  вернуть предложенное
                </button>
              ) : null}
            </div>
            {editing === rule.block ? (
              <RuleEditor
                filter={rule.filter}
                options={options}
                onCancel={() => setEditing(null)}
                onApply={(filter) => {
                  setEditing(null);
                  decide({ rules: { [rule.block]: { action: "rule", filter } } });
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function rulesSummary(items: RuleItem[]): string {
  if (!items.length) return "других листов нет";
  const caught = items.reduce((sum, item) => sum + item.caught, 0);
  const total = items.reduce((sum, item) => sum + item.in_sheet, 0);
  const extra = items.reduce((sum, item) => sum + item.extra, 0);
  return (
    `${items.length} ${plural(items.length, "правило", "правила", "правил")} · в листы попадут ${caught} из ${total} строк` +
    (extra ? ` · лишних ${extra}` : "")
  );
}
