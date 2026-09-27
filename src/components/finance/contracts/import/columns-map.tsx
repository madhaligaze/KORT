"use client";

/**
 * 02 Колонки — карта «колонка файла → поле реестра».
 *
 * Карта строится по блоку, а не по листу: у каждого блока своя шапка, и в
 * «Заказчик ГК» соседние блоки держат стороны в колонках наоборот. Блоки с
 * одинаковой шапкой свёрнуты в одну вкладку, и решение по колонке ложится
 * сразу на все блоки вкладки — иначе колонку T «Сводной» и «Исполнителя ГК»
 * пришлось бы решать дважды.
 *
 * Линия и есть решение, её отсутствие — вопрос. Точное совпадение шапки —
 * сплошная линия; мягкое (`layout.py`: одно начало другого) — пунктир и
 * `{ похоже }`; два кандидата — две розовые пунктирные линии и выбор под
 * колонкой. На узком месте карта становится списком «колонка → поле».
 *
 * Координаты линий пишутся в DOM напрямую, а не через состояние React: они
 * зависят от раскладки, которую React не знает, и пересчитываются по
 * `ResizeObserver` без лишних рендеров.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { gsap, prefersReducedMotion, useGSAP } from "@/components/motion/gsap";
import { plural } from "@/components/finance/format";
import { PlaceholderOption } from "@/components/placeholder-option";

import { ChoiceLine, type Choice } from "./choice-line";
import styles from "./registry-import.module.css";
import { RolesText } from "./roles-text";
import {
  CUSTOM_TYPES,
  blockLabel,
  dictOf,
  type ColumnDecision,
  type ColumnItem,
  type ColumnsBlock,
  type Decide,
  type Decisions,
} from "./types";

export type FieldRef = { key: string; title: string; position: number };

type Group = { key: string; blocks: ColumnsBlock[]; label: string };

/** Вкладки карты: блоки с одной и той же шапкой — одна вкладка. */
function groupBlocks(blocks: ColumnsBlock[]): Group[] {
  const bySignature = new Map<string, ColumnsBlock[]>();
  for (const block of blocks) {
    const signature = JSON.stringify(block.columns.map((column) => [column.index, column.header, column.key, column.how]));
    const list = bySignature.get(signature);
    if (list) list.push(block);
    else bySignature.set(signature, [block]);
  }
  return [...bySignature.values()].map((list) => {
    const head = blockLabel(list[0].sheet, list[0].title);
    const more = list.length - 1;
    return {
      key: list[0].block,
      blocks: list,
      label: more ? `${head} и ещё ${more} с той же шапкой` : head,
    };
  });
}

export function decisionOf(column: ColumnItem, decisions: Decisions): ColumnDecision {
  return dictOf<ColumnDecision>(decisions, "columns")[column.id] ?? column.decision;
}

/** Сколько колонок блока ждут решения — с учётом ещё летящих решений. */
export function openColumns(blocks: ColumnsBlock[], decisions: Decisions): number {
  let count = 0;
  for (const block of blocks) for (const column of block.columns) if (decisionOf(column, decisions).action === "ask") count += 1;
  return count;
}

const FUZZY = new Set(["squashed", "loose"]);

type Edge = { k: string; from: number; to: string; kind: "solid" | "loose" | "ask" };
type Node = { key: string; label: string; order: number };

function titleOf(fields: FieldRef[], key: string): string {
  if (key === "row_number") return "№ по порядку";
  return fields.find((field) => field.key === key)?.title ?? key;
}

function targetOf(column: ColumnItem, decision: ColumnDecision, fields: FieldRef[]): { node: string; label: string } | null {
  switch (decision.action) {
    case "field":
      return { node: `f:${decision.field}`, label: titleOf(fields, decision.field) };
    case "custom":
      return { node: `c:${column.index}`, label: `своё поле «${decision.title || "Колонка без названия"}»` };
    case "note":
      return { node: "note", label: "в примечание" };
    default:
      return null;
  }
}

export function ColumnsMap({
  blocks,
  decisions,
  decide,
  fields,
}: {
  blocks: ColumnsBlock[];
  decisions: Decisions;
  decide: Decide;
  fields: FieldRef[];
}) {
  const groups = useMemo(() => groupBlocks(blocks), [blocks]);
  const [active, setActive] = useState<string>(
    () => groups.find((group) => openColumns(group.blocks, decisions) > 0)?.key ?? groups[0]?.key ?? "",
  );
  const group = groups.find((item) => item.key === active) ?? groups[0];
  if (!group) return <p className="fin-muted">Колонок нет</p>;

  const tabs: Choice<string>[] = groups.map((item) => {
    const open = openColumns(item.blocks.slice(0, 1), decisions);
    return {
      value: item.key,
      label: (
        <>
          {item.label}
          {open ? <span className={styles.wait}> · {open}</span> : null}
        </>
      ),
    };
  });

  return (
    <div className={styles.mapWrap}>
      {groups.length > 1 ? <ChoiceLine label="Блок" items={tabs} value={group.key} onChange={setActive} /> : null}
      <p className={styles.mapRoles}>
        <RolesText roles={group.blocks[0].roles} />
      </p>
      <MapBody key={group.key} group={group} decisions={decisions} decide={decide} fields={fields} />
    </div>
  );
}

/** Пути линий: от середины строки колонки к середине поля справа. */
function layoutPaths(root: HTMLElement): SVGPathElement[] {
  const svg = root.querySelector<SVGSVGElement>("svg[data-map]");
  if (!svg) return [];
  const box = svg.getBoundingClientRect();
  const width = box.width;
  const paths = [...svg.querySelectorAll<SVGPathElement>("path[data-k]")];
  if (!width) return paths;
  for (const path of paths) {
    const from = root.querySelector<HTMLElement>(`[data-anchor="${path.dataset.from}"]`);
    const to = root.querySelector<HTMLElement>(`[data-node="${CSS.escape(path.dataset.to ?? "")}"]`);
    if (!from || !to) continue;
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const y0 = a.top + a.height / 2 - box.top;
    const y1 = b.top + b.height / 2 - box.top;
    const bend = width * 0.5;
    path.setAttribute("d", `M 0 ${y0.toFixed(1)} C ${bend.toFixed(1)} ${y0.toFixed(1)}, ${(width - bend).toFixed(1)} ${y1.toFixed(1)}, ${width.toFixed(1)} ${y1.toFixed(1)}`);
  }
  return paths;
}

function MapBody({
  group,
  decisions,
  decide,
  fields,
}: {
  group: Group;
  decisions: Decisions;
  decide: Decide;
  fields: FieldRef[];
}) {
  const root = useRef<HTMLDivElement>(null);
  const drawn = useRef<Set<string>>(new Set());
  const [hot, setHot] = useState<string | null>(null);
  const columns = group.blocks[0].columns;
  const [opened, setOpened] = useState<Set<number>>(() => new Set());
  // Вопрос, на который уже ответили, остаётся раскрытым: строка не
  // схлопывается под курсором, и ответ можно поправить (или назвать своё поле).
  const [asked] = useState<Set<number>>(
    () => new Set(columns.filter((column) => decisionOf(column, decisions).action === "ask").map((column) => column.index)),
  );
  const { contextSafe } = useGSAP({ scope: root });

  /** Решение по колонке — сразу во все блоки вкладки. */
  const choose = (column: ColumnItem, decision: ColumnDecision) => {
    const patch: Record<string, ColumnDecision> = {};
    for (const block of group.blocks) patch[`${block.block}#${column.index}`] = decision;
    decide({ columns: patch });
  };

  const { edges, nodes } = useMemo(() => {
    const edgeList: Edge[] = [];
    const nodeMap = new Map<string, Node>();
    const position = (key: string) => fields.find((field) => field.key === key)?.position ?? 1e6;
    const addField = (key: string) => {
      if (!nodeMap.has(`f:${key}`)) nodeMap.set(`f:${key}`, { key: `f:${key}`, label: titleOf(fields, key), order: key === "row_number" ? -1 : position(key) });
    };
    for (const column of columns) {
      const decision = decisionOf(column, decisions);
      if (decision.action === "ask") {
        for (const candidate of column.candidates) {
          addField(candidate);
          edgeList.push({ k: `${column.index}>f:${candidate}?`, from: column.index, to: `f:${candidate}`, kind: "ask" });
        }
        continue;
      }
      const target = targetOf(column, decision, fields);
      if (!target) continue;
      if (decision.action === "field") addField(decision.field);
      else if (decision.action === "custom") nodeMap.set(target.node, { key: target.node, label: target.label, order: 2e6 + column.index });
      else nodeMap.set("note", { key: "note", label: "в примечание", order: 3e6 });
      const auto = decision.action === "field" && decision.field === column.key;
      const kind = (auto && FUZZY.has(column.how)) || decision.action === "note" ? "loose" : "solid";
      edgeList.push({ k: `${column.index}>${target.node}`, from: column.index, to: target.node, kind });
    }
    return { edges: edgeList, nodes: [...nodeMap.values()].sort((a, b) => a.order - b.order) };
  }, [columns, decisions, fields]);

  // Каждый рендер: линии встают по месту; новые прочерчиваются.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const paths = layoutPaths(el);
    const fresh = paths.filter((path) => !drawn.current.has(path.dataset.k ?? ""));
    if (!fresh.length) return;
    const entrance = drawn.current.size === 0;
    for (const path of fresh) drawn.current.add(path.dataset.k ?? "");
    // Карта спрятана (узкое место) — рисовать нечего, линии встанут сразу.
    if (!el.querySelector("svg[data-map]")?.getBoundingClientRect().width || prefersReducedMotion()) return;
    contextSafe(() => {
      fresh.forEach((path, index) => {
        if (path.dataset.kind !== "solid") {
          gsap.fromTo(path, { opacity: 0 }, { opacity: 1, duration: 0.5, delay: entrance ? 0.3 + index * 0.025 : 0, ease: "power2.out", clearProps: "opacity" });
          return;
        }
        const length = path.getTotalLength();
        gsap.fromTo(
          path,
          { strokeDasharray: length, strokeDashoffset: length },
          {
            strokeDashoffset: 0,
            duration: entrance ? 0.9 : 0.5,
            delay: entrance ? Math.min(index * 0.025, 0.3) : 0,
            ease: "expo.inOut",
            clearProps: "strokeDasharray,strokeDashoffset",
          },
        );
      });
    })();
  });

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const observer = new ResizeObserver(() => layoutPaths(el));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const isHot = (from: number, to: string) => hot === `c${from}` || hot === `n${to}`;
  const rowHot = (index: number) =>
    hot === null ? undefined : hot === `c${index}` || edges.some((edge) => edge.from === index && hot === `n${edge.to}`) ? "on" : "off";
  const nodeHot = (key: string) =>
    hot === null ? undefined : hot === `n${key}` || edges.some((edge) => edge.to === key && hot === `c${edge.from}`) ? "on" : "off";

  return (
    <div ref={root} className={styles.map} onPointerLeave={() => setHot(null)}>
      <div className={styles.mapLeft}>
        {columns.map((column) => {
          const decision = decisionOf(column, decisions);
          const target = targetOf(column, decision, fields);
          const ask = decision.action === "ask";
          const open = ask || asked.has(column.index) || opened.has(column.index);
          const auto = decision.action === "field" && decision.field === column.key;
          return (
            <div
              key={column.index}
              className={styles.mapRow}
              data-hot={rowHot(column.index)}
              onPointerEnter={() => setHot(`c${column.index}`)}
            >
              <button
                type="button"
                className={styles.mapCol}
                data-anchor={column.index}
                aria-expanded={open}
                onClick={() =>
                  setOpened((current) => {
                    const next = new Set(current);
                    if (next.has(column.index)) next.delete(column.index);
                    else next.add(column.index);
                    return next;
                  })
                }
                onFocus={() => setHot(`c${column.index}`)}
              >
                <span className={`fin-mono ${styles.letter}`}>{column.letter}</span>
                <span className={styles.header} title={column.header || undefined}>
                  {column.header ? column.header.replace(/\s+/g, " ") : <span className="fin-muted">(без названия)</span>}
                </span>
                {auto && FUZZY.has(column.how) ? <span className="annot">похоже</span> : null}
                <span className={styles.inlineTarget}>
                  {target ? (
                    <>→ {target.label}</>
                  ) : decision.action === "skip" ? (
                    <span className="fin-muted">пропускается</span>
                  ) : null}
                </span>
                {!target && decision.action === "skip" ? <span className={`fin-muted ${styles.wideOnly}`}>пропускается</span> : null}
              </button>
              {ask && column.how === "ambiguous" ? (
                <p className={styles.question}>
                  «{column.header.replace(/\s+/g, " ")}» похожа на {column.candidates.length}{" "}
                  {plural(column.candidates.length, "поле", "поля", "полей")}
                </p>
              ) : null}
              {!column.header && column.samples.length ? (
                <p className={styles.samples}>
                  {column.samples.slice(0, 3).map((sample) => `«${sample.replace(/\s+/g, " ")}»`).join(" · ")}
                  {column.filled > 3 ? ` · ещё ${column.filled - 3}` : ""}
                </p>
              ) : null}
              {open ? <ColumnChooser column={column} decision={decision} fields={fields} onChoose={(next) => choose(column, next)} /> : null}
            </div>
          );
        })}
      </div>
      <div className={styles.mapMid}>
        <svg data-map="" aria-hidden="true">
          {edges.map((edge) => (
            <path
              key={edge.k}
              data-k={edge.k}
              data-from={edge.from}
              data-to={edge.to}
              data-kind={edge.kind}
              className={styles.edge}
              data-hot={hot === null ? undefined : isHot(edge.from, edge.to) ? "on" : "off"}
            />
          ))}
        </svg>
      </div>
      <div className={styles.mapRight}>
        {nodes.map((node) => (
          <div
            key={node.key}
            className={styles.mapNode}
            data-node={node.key}
            data-hot={nodeHot(node.key)}
            onPointerEnter={() => setHot(`n${node.key}`)}
          >
            {node.label}
          </div>
        ))}
      </div>
    </div>
  );
}

type Option = "custom" | "note" | "skip" | `f:${string}`;

function ColumnChooser({
  column,
  decision,
  fields,
  onChoose,
}: {
  column: ColumnItem;
  decision: ColumnDecision;
  fields: FieldRef[];
  onChoose: (decision: ColumnDecision) => void;
}) {
  const current: Option | null =
    decision.action === "field"
      ? `f:${decision.field}`
      : decision.action === "custom" || decision.action === "note" || decision.action === "skip"
        ? decision.action
        : null;
  const fieldKeys = [...column.candidates];
  if (column.key && !fieldKeys.includes(column.key)) fieldKeys.push(column.key);
  if (decision.action === "field" && !fieldKeys.includes(decision.field)) fieldKeys.push(decision.field);
  const items: Choice<Option>[] = [
    ...fieldKeys.map((key) => ({ value: `f:${key}` as Option, label: titleOf(fields, key) })),
    { value: "custom", label: "Своё поле" },
    { value: "note", label: "В примечание" },
    { value: "skip", label: "Пропустить" },
  ];
  const fallbackTitle = column.header ? column.header.replace(/\s+/g, " ").trim() : `Колонка ${column.letter}`;

  const pick = (value: Option) => {
    if (value === "custom") onChoose({ action: "custom", title: fallbackTitle, type: "text" });
    else if (value === "note") onChoose({ action: "note" });
    else if (value === "skip") onChoose({ action: "skip" });
    else onChoose({ action: "field", field: value.slice(2) });
  };

  return (
    <div className={styles.chooser}>
      <ChoiceLine label={`Колонка ${column.letter}`} items={items} value={current} onChange={pick} />
      <select
        className={styles.select}
        aria-label="Другое поле"
        value=""
        onChange={(event) => {
          if (event.target.value) onChoose({ action: "field", field: event.target.value });
        }}
      >
        <PlaceholderOption>другое поле…</PlaceholderOption>
        {fields
          .filter((field) => !fieldKeys.includes(field.key))
          .map((field) => (
            <option key={field.key} value={field.key}>
              {field.title}
            </option>
          ))}
      </select>
      {decision.action === "custom" ? (
        <CustomField
          key={column.id}
          title={decision.title}
          type={decision.type}
          onChange={(title, type) => onChoose({ action: "custom", title, type })}
        />
      ) : null}
    </div>
  );
}

function CustomField({ title, type, onChange }: { title: string; type: string; onChange: (title: string, type: string) => void }) {
  // Своё состояние: набор идёт в поле, а очередь решений сама копит 300 мс.
  const [draft, setDraft] = useState(title);
  return (
    <span className={styles.custom}>
      <input
        type="text"
        className={styles.input}
        aria-label="Название своего поля"
        value={draft}
        placeholder="Название поля"
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(event.target.value, type);
        }}
      />
      <select className={styles.select} aria-label="Тип поля" value={type} onChange={(event) => onChange(draft, event.target.value)}>
        {CUSTOM_TYPES.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    </span>
  );
}
