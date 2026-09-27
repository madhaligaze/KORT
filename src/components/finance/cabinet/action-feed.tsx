"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChoiceSelect } from "@/components/choice-select";
import { type AuditItem, type AuditQuery, type EmployeeRow, peopleApi } from "@/components/finance/api";
import { dayTitle, formatTime } from "@/components/finance/format";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { SelectLine } from "@/components/finance/ui/select-line";
import { useSessionState } from "@/components/session-state";

/**
 * Лента действий (фронт-план, 6.9 «Журнал действий»).
 *
 * Одна для трёх мест: журнал компании (все люди, с поиском и фильтрами),
 * «Моё · Действия» (только свои) и вкладка «Действия» в карточке
 * сотрудника. Отличаются только закреплённым фильтром.
 *
 * * Строка: время · человек · что сделано · действие. Кто сделал, уже в
 *   колонке «человек», поэтому текст называет само действие: «выгрузка
 *   реестра», «открыт раздел «Долги»» — без глаголов с родом.
 * * Цвет — только у неудач входа и отказов; категории цветом не различаются.
 * * «Показать ещё» — явная кнопка по 100 записей: бесконечной прокрутки нет,
 *   чтобы было видно, где конец.
 */
type Props = {
  /** Закреплённый фильтр: свои действия или действия сотрудника. */
  fixed?: Pick<AuditQuery, "user_id" | "employee_id">;
  /** Поиск и фильтры по людям — только в журнале компании. */
  full?: boolean;
  people?: EmployeeRow[];
  /** За сколько дней по умолчанию. */
  days?: number;
  /** Номер договора в тексте открывает карточку договора. */
  onOpenContract?: (id: string) => void;
};

const CATEGORIES = [
  { key: "all", label: "Все" },
  { key: "data", label: "Данные" },
  { key: "auth", label: "Входы" },
  { key: "admin", label: "Администрирование" },
  { key: "view", label: "Просмотры" },
  { key: "export", label: "Выгрузки" },
  { key: "import", label: "Загрузки" },
] as const;
type CategoryKey = (typeof CATEGORIES)[number]["key"];

const PERIODS = [
  { key: "1", label: "Сегодня" },
  { key: "7", label: "Неделя" },
  { key: "31", label: "Месяц" },
  { key: "all", label: "Всё время" },
] as const;

function isoDay(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() - offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Неудача входа и отказы — единственное, чему в ленте положен цвет. */
function isFailure(item: AuditItem): boolean {
  return /fail|locked|denied|blocked_attempt/.test(item.kind);
}

function dayKey(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function ActionFeed({ fixed, full = false, people = [], days = 7, onOpenContract }: Props) {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "more" | "failed">("loading");
  const [error, setError] = useState("");
  // Отбор ленты переживает перезагрузку (`session-state.tsx`) — свой у общей
  // ленты, у своей и у ленты в карточке сотрудника.
  const feed = `feed.${fixed?.employee_id ?? (fixed?.user_id ? "me" : "all")}`;
  const [category, setCategory] = useSessionState<CategoryKey>(`${feed}.category`, "all");
  const [period, setPeriod] = useSessionState<string>(`${feed}.period`, String(days));
  const [who, setWho] = useSessionState(`${feed}.who`, "");
  const [search, setSearch] = useSessionState(`${feed}.search`, "");
  // Восстановленный поиск уходит на сервер сразу, а не после паузы в наборе.
  const [query, setQuery] = useState(() => search.trim());
  const [undo, setUndo] = useState<AuditItem | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const request = useRef(0);

  // Поиск уходит на сервер после паузы в наборе, а не на каждую букву.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const params = useMemo<AuditQuery>(() => {
    const out: AuditQuery = { ...fixed, limit: 100 };
    if (category !== "all") out.category = category;
    if (period !== "all") out.since = isoDay(Number(period) - 1);
    if (who) out.employee_id = who;
    if (query) out.q = query;
    return out;
  }, [fixed, category, period, who, query]);

  const load = useCallback(
    async (more: string | null) => {
      const id = ++request.current;
      setPhase(more ? "more" : "loading");
      try {
        const page = await peopleApi.audit.list(more ? { ...params, cursor: more } : params);
        if (id !== request.current) return;
        setItems((prev) => (more ? [...prev, ...page.items] : page.items));
        setCursor(page.next_cursor);
        setError("");
        setPhase("ready");
      } catch (exc) {
        if (id !== request.current) return;
        setError(exc instanceof Error ? exc.message : "Журнал не прочитался");
        setPhase("failed");
      }
    },
    [params],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  const confirmUndo = async () => {
    if (!undo) return;
    setUndoBusy(true);
    try {
      await peopleApi.audit.undo(undo.id);
      setUndo(null);
      await load(null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Откатить не получилось");
      setUndo(null);
    } finally {
      setUndoBusy(false);
    }
  };

  const withPerson = !fixed;
  let lastDay = "";

  return (
    <div className="cab-feed">
      {full ? (
        <div className="cab-feed-filters">
          <input
            className="input-field cab-feed-search"
            type="search"
            placeholder="Номер договора, человек, раздел"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Поиск по журналу"
          />
          <ChoiceSelect
            className="input-field"
            wrapClassName="cab-feed-select"
            value={who}
            onChange={setWho}
            aria-label="Чьи действия"
            placeholder="Все сотрудники"
            clearable
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name}
              </option>
            ))}
          </ChoiceSelect>
          <select
            className="input-field cab-feed-select"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            aria-label="За какой срок"
          >
            {PERIODS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {full ? (
        <SelectLine
          items={CATEGORIES.map((item) => ({ key: item.key, label: item.label }))}
          value={category}
          onChange={setCategory}
          label="Вид действий"
          size="sm"
          className="cab-feed-cats"
        />
      ) : null}

      {phase === "loading" && items.length === 0 ? <p className="cab-wait">Читаем журнал…</p> : null}
      {phase !== "loading" && items.length === 0 && !error ? (
        <p className="cab-empty">{query || category !== "all" || who ? "Ничего не нашлось." : "Действий за этот срок нет."}</p>
      ) : null}

      <div className="cab-feed-list" data-person={withPerson ? "true" : undefined} aria-busy={phase === "loading"}>
        {items.map((item) => {
          const day = dayKey(item.at);
          const head = day !== lastDay ? dayTitle(item.at) : null;
          lastDay = day;
          const failed = isFailure(item);
          const contractLink = item.entity === "contract" && item.entity_id && onOpenContract;
          return (
            <Fragment key={item.id}>
              {head ? <p className="cab-feed-day">{head}</p> : null}
              <div className="cab-feed-row" data-undone={item.undone_at ? "true" : undefined}>
                <span className="fin-mono fin-soft cab-feed-time">{formatTime(item.at)}</span>
                {withPerson ? (
                  <span className="cab-feed-who" title={item.actor?.name || item.actor_text}>
                    {item.actor?.short_name || item.actor_text || "—"}
                  </span>
                ) : null}
                <span className={`cab-feed-text ${failed ? "fin-fail" : ""}`}>
                  {contractLink ? (
                    <button type="button" className="fin-link-btn" onClick={() => onOpenContract(item.entity_id!)}>
                      {item.title}
                    </button>
                  ) : (
                    item.title
                  )}
                  {item.undone_at ? <span className="fin-soft"> · откачено</span> : null}
                </span>
                <span className="cab-feed-act">
                  {item.can_undo && !item.undone_at ? (
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setUndo(item)}>
                      Откатить
                    </button>
                  ) : null}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>

      {error ? (
        <p className="cab-error fin-fail" role="alert">
          {error}
        </p>
      ) : null}
      {cursor ? (
        <button type="button" className="btn-ghost btn-sm cab-list-foot" disabled={phase === "more"} onClick={() => load(cursor)}>
          {phase === "more" ? "Читаем…" : "Показать ещё"}
        </button>
      ) : null}

      <ConfirmDialog
        open={undo !== null}
        title="Откатить это действие?"
        text={undo ? `«${undo.title}» — значения вернутся к тому, что было до него.` : ""}
        confirm="Откатить"
        busy={undoBusy}
        onConfirm={confirmUndo}
        onCancel={() => setUndo(null)}
      />
    </div>
  );
}
