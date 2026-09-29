"use client";

/**
 * «Все · Мои» под «Новый договор» — договоры, где вошедший стоит
 * ответственным (29.09.2026: «одной кнопкой нажать — чтобы отображались
 * только его договора»).
 *
 * Это отбор вида, а не право: договоры коллег остаются открыты, их просто не
 * видно. Закрыть человеку чужие договоры — право «Договоры → Какие договоры →
 * где ответственный» в кабинете; у такого человека переключателя нет, все
 * его договоры и так его.
 *
 * Выбор один на «Карточки» и «Таблицу» одного реестра и помнится в браузере
 * у каждой учётки: юрист, работающий только со своими, не включает его
 * каждое утро. Рядом — сколько договоров в каждом положении: иначе включённый
 * отбор выглядел бы пропавшими договорами.
 */
import { useCallback, useMemo, useSyncExternalStore } from "react";

import type { Contract, Me } from "@/components/finance/api";
import { inBook, useRegistry } from "@/components/finance/contracts/store";

const STORE = "kort_mine";
const listeners = new Set<() => void>();

function keyOf(me: Me, book: string): string {
  return `${STORE}:${me.user?.id ?? ""}:${me.company?.id ?? ""}:${book || "registry"}`;
}

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function write(key: string, on: boolean): void {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* выбор живёт до перезагрузки */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export type Mine = {
  /** Переключатель имеет смысл: есть запись сотрудника и открыты не только свои. */
  available: boolean;
  on: boolean;
  set: (on: boolean) => void;
  /** Отбор договоров при включённом «Мои»; `null` — показываются все. */
  only: ((contract: Contract) => boolean) | null;
};

export function useMine(me: Me, book: string): Mine {
  const employee = me.employee?.id ?? null;
  const available = Boolean(employee) && me.contracts_scope?.rows !== "own";
  const key = keyOf(me, book);
  const stored = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => false,
  );
  const on = available && stored;
  const set = useCallback((next: boolean) => write(key, next), [key]);
  const only = useMemo(
    () => (on && employee ? (contract: Contract) => isMine(contract, employee) : null),
    [on, employee],
  );
  return { available, on, set, only };
}

export function isMine(contract: Contract, employee: string): boolean {
  const people = contract.values.people;
  return Array.isArray(people) && people.includes(employee);
}

/** Сколько договоров в книге и сколько из них своих. */
function useMineCounts(me: Me, book: string): { all: number; own: number; ready: boolean } {
  const schema = useRegistry((s) => s.schema);
  const byId = useRegistry((s) => s.byId);
  const phase = useRegistry((s) => s.phase);
  const employee = me.employee?.id ?? "";
  const counts = useMemo(() => {
    const views = new Set((schema?.views ?? []).filter((view) => inBook(view, book)).map((view) => view.key));
    let all = 0;
    let own = 0;
    for (const contract of byId.values()) {
      if (contract.deleted || !contract.views.some((place) => views.has(place.view))) continue;
      all += 1;
      if (isMine(contract, employee)) own += 1;
    }
    return { all, own };
  }, [schema, byId, book, employee]);
  return { ...counts, ready: phase === "ready" };
}

/**
 * «Только мои» — тумблер в конце ленты таблицы (29.09.2026: «как тумблер:
 * нажат — остаётся нажатым, пока ещё раз не нажмёшь»). Действует на все
 * листы книги сразу; включённый помнится. Нажатый — весом и чертой, как
 * выбранный вид, без заливки.
 */
export function MineToggle({ me, book }: { me: Me; book: string }) {
  const mine = useMine(me, book);
  const counts = useMineCounts(me, book);
  if (!mine.available || !counts.ready) return null;
  return (
    <button
      type="button"
      className="usheet-toggle"
      aria-pressed={mine.on}
      title={
        mine.on
          ? "Показаны только договоры, где вы — ответственное лицо. Нажмите ещё раз — покажутся все"
          : "Показать на всех листах только договоры, где вы — ответственное лицо"
      }
      // Фокус остаётся в листе: иначе Enter после щелчка ушёл бы кнопке.
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => mine.set(!mine.on)}
    >
      Только мои <span className="fin-mine-n">{counts.own}</span>
    </button>
  );
}

/** Третье положение переключателя — «С долями» (отбор держит `Registry`). */
export type SharesPick = { on: boolean; set: (on: boolean) => void; count: number; title: string };

/**
 * «Все 468 · Мои 12 · С долями 6» — под «Новый договор» в «Карточках».
 *
 * Одно положение из трёх: «С долями» выключает «Мои», «Мои» — «С долями».
 * До 30.09.2026 «Все · Мои» стояли в строке заголовка, а «С долями» — мелкой
 * подписью под вкладками, и его было не найти.
 */
export function MineSwitch({ me, book, shares, className }: { me: Me; book: string; shares?: SharesPick | null; className?: string }) {
  const mine = useMine(me, book);
  const counts = useMineCounts(me, book);
  if ((!mine.available && !shares) || !counts.ready) return null;
  const pick = (next: "all" | "mine" | "shares") => {
    if (mine.available) mine.set(next === "mine");
    shares?.set(next === "shares");
  };
  const sharesOn = Boolean(shares?.on);
  return (
    <div className={`fin-mine${className ? ` ${className}` : ""}`} role="radiogroup" aria-label="Какие договоры показывать">
      <button
        type="button"
        role="radio"
        aria-checked={!mine.on && !sharesOn}
        className="fin-view"
        onClick={() => pick("all")}
      >
        Все <span className="fin-mine-n">{counts.all}</span>
      </button>
      {mine.available ? (
        <button
          type="button"
          role="radio"
          aria-checked={mine.on && !sharesOn}
          className="fin-view"
          title="Договоры, где вы — ответственное лицо"
          onClick={() => pick("mine")}
        >
          Мои <span className="fin-mine-n">{counts.own}</span>
        </button>
      ) : null}
      {shares ? (
        <button
          type="button"
          role="radio"
          aria-checked={sharesOn}
          className="fin-view"
          title={shares.title}
          onClick={() => pick("shares")}
        >
          С долями <span className="fin-mine-n">{shares.count}</span>
        </button>
      ) : null}
    </div>
  );
}
