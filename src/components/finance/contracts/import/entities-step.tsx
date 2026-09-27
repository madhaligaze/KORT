"use client";

/**
 * 03 Наши юрлица и написания.
 *
 * Наши юрлица система предлагает по колонке исполнителя главного листа (кто
 * стоит там в большинстве договоров), а человек подтверждает список: от него
 * зависят правила листов («исполнитель — наше юрлицо») и смысл договоров,
 * поэтому пункт держит «Завести», пока список не подтверждён.
 *
 * Похожие написания контрагентов («Бергауф Астана» и «ТОО Бергауф Астана»)
 * не сводятся сами — правило «не угадывать». Пока не выбрано ничего, линии
 * выбора нет. «Объединить все предложенные» — явное действие человека.
 *
 * `merge_names` и `keep_apart` — служебные ключи решений: сервер их не читает,
 * но хранит вместе с партией. Первый держит названия сведённых написаний
 * (после слияния сервер их больше не показывает), второй — ответ «не
 * объединять», чтобы он пережил перезагрузку страницы.
 */
import { plural } from "@/components/finance/format";

import { ChoiceLine } from "./choice-line";
import styles from "./registry-import.module.css";
import { dictOf, type Decide, type Decisions, type EntityItem, type SimilarGroup } from "./types";

type Row = { id: string; keys: string[]; names: string[]; state: "merge" | "apart" | null };

export function EntitiesStep({
  items,
  similar,
  decisions,
  decide,
}: {
  items: EntityItem[];
  similar: SimilarGroup[];
  decisions: Decisions;
  decide: Decide;
}) {
  const entities = dictOf(decisions, "entities");
  const confirmed = Boolean(entities.confirmed);
  const chosen = Array.isArray(entities.own) ? (entities.own as string[]) : null;
  const own = new Set(chosen ?? items.filter((item) => item.own).map((item) => item.key));

  const merges = Array.isArray(decisions.merges) ? (decisions.merges as string[][]) : [];
  const names = dictOf<string>(decisions, "merge_names");
  const apart = dictOf<boolean>(decisions, "keep_apart");

  const toggle = (key: string) => {
    const next = new Set(own);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    decide({ entities: { own: [...next] } });
  };

  const mergedIds = new Set(merges.map((keys) => keys.join("|")));
  const rows: Row[] = [
    ...merges.map((keys) => ({ id: keys.join("|"), keys, names: keys.map((key) => names[key] ?? key), state: "merge" as const })),
    ...similar
      .filter((group) => !mergedIds.has(group.keys.join("|")))
      .map((group) => ({
        id: group.keys.join("|"),
        keys: group.keys,
        names: group.names,
        state: apart[group.keys.join("|")] ? ("apart" as const) : null,
      })),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const undecided = rows.filter((row) => row.state === null);

  const nameMap = (list: Row[]) =>
    Object.fromEntries(list.flatMap((row) => row.keys.map((key, index) => [key, row.names[index] ?? key])));

  const setRow = (row: Row, value: "merge" | "apart") => {
    if (value === row.state) return;
    if (value === "merge") {
      decide({ merges: [...merges, row.keys], merge_names: nameMap([row]), keep_apart: { [row.id]: false } });
    } else {
      decide({ merges: merges.filter((keys) => keys.join("|") !== row.id), keep_apart: { [row.id]: true } });
    }
  };

  return (
    <div className={styles.stack}>
      <div>
        <p className={styles.subhead}>
          Наши юрлица {confirmed ? null : <span className="annot">предложено</span>}
        </p>
        <ul className={styles.rows}>
          {items.map((item) => (
            <li key={item.key} className={styles.row}>
              <label className={styles.check}>
                <input type="checkbox" checked={own.has(item.key)} onChange={() => toggle(item.key)} />
                <span className={styles.grow}>
                  {item.names[0]}
                  {item.names.length > 1 ? <span className="fin-muted"> · {item.names.slice(1).join(" · ")}</span> : null}
                </span>
              </label>
              <span className={`${styles.nums} fin-soft`}>
                исполнитель {item.executor}
                {item.customer ? ` · заказчик ${item.customer}` : ""}
              </span>
            </li>
          ))}
        </ul>
        <div className={styles.actions}>
          <button
            type="button"
            className="btn-ghost"
            disabled={confirmed}
            onClick={() => decide({ entities: { confirmed: true, own: [...own] } })}
          >
            {confirmed ? "Список подтверждён" : `Подтвердить список (${own.size})`}
          </button>
        </div>
      </div>

      {rows.length ? (
        <div>
          <p className={styles.subhead}>
            Похожие написания контрагентов
            <span className="fin-soft"> · {rows.length}</span>
          </p>
          <ul className={styles.rows}>
            {rows.map((row) => (
              <li key={row.id} className={styles.row}>
                <span className={styles.grow}>{row.names.join(" · ")}</span>
                <ChoiceLine
                  label={row.names.join(" и ")}
                  items={[
                    { value: "merge", label: "Объединить" },
                    { value: "apart", label: "Не объединять" },
                  ]}
                  value={row.state}
                  onChange={(value) => setRow(row, value)}
                />
              </li>
            ))}
          </ul>
          {undecided.length ? (
            <div className={styles.actions}>
              <button
                type="button"
                className="fin-link-btn"
                onClick={() =>
                  decide({
                    merges: [...merges, ...undecided.map((row) => row.keys)],
                    merge_names: nameMap(undecided),
                  })
                }
              >
                Объединить все предложенные ({undecided.length})
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function entitiesSummary(items: EntityItem[], decisions: Decisions): string {
  const entities = dictOf(decisions, "entities");
  const chosen = Array.isArray(entities.own) ? (entities.own as string[]) : null;
  const own = chosen ? chosen.length : items.filter((item) => item.own).length;
  return `${own} ${plural(own, "юрлицо", "юрлица", "юрлиц")} из ${items.length} ${plural(items.length, "кандидата", "кандидатов", "кандидатов")}`;
}
