"use client";

/**
 * «Общая сумма» на три секунды (01.10.2026).
 *
 * В «Разовых ЮО» сумма строки - доля ЮО (`book-share.ts`): у №ОКР/59 стоит
 * 104 400, а договор - на 348 000 (HR 70% / ЮО 30%). Юристам нужна и вся
 * сумма, не открывая карточку. Поэтому, когда такой договор оказывается на
 * экране - докрутили до него, нашли поиском, открыли лист, - подпись колонки
 * поднимается в «Общая сумма», доля в его строке - во всю сумму договора, а
 * через три секунды всё возвращается тем же подъёмом.
 *
 * Подпись колонки одна на весь список, поэтому и показ один на весь список:
 * пока в шапке «Общая сумма», всю сумму показывает каждая строка с долей -
 * иначе шапка врала бы соседней строке. У строк без доли сумма и так вся, им
 * меняться нечему.
 *
 * Что значит «оказался на экране»:
 * - середина суммы не под липкой шапкой (раздела, колонок, части листа) и не
 *   за краем окна; карточка поверх списка строку не прячет: закрыли карточку -
 *   это не новое появление, и показ не повторяется;
 * - и строка простояла так `DWELL_MS`: пролистнутая мимо показ не запускает,
 *   а найденная поиском сначала читается долей и только потом поднимается во
 *   всю сумму - иначе подмену не заметить;
 * - смена листа или поиска - новое появление для всех видимых строк: «вбили
 *   название и нашли» - появление, даже если строка уже стояла на экране;
 * - вход в раздел ждёт, пока поднимется занавес перехода (`whenStageClear`),
 *   иначе показ отыграл бы за ним.
 * Строка, появившаяся во время показа, продлевает его на свои три секунды.
 * Бесконечного чередования нет (фронт-план 5.2: ничего не движется само):
 * повтор - только когда строка ушла с экрана и вернулась.
 */
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";

import { contractMoney } from "@/components/finance/format";
import { whenStageClear } from "@/components/motion/stage-bus";
import { RiseSwap } from "@/components/motion/rise-swap";

/** Сколько стоит «Общая сумма» - просьба юротдела. */
const SHOW_MS = 3000;
/** Сколько строка стоит на виду, прежде чем показ начнётся. */
const DWELL_MS = 700;
/** Как скоро перепроверить строку под липкой шапкой. */
const RECHECK_MS = 200;
/** Что липнет к верху окна и закрывает строки под собой. */
const COVERS = ".fin-head, .creg-head, .creg-block-head";

type Watch = (row: HTMLElement) => () => void;

const Preview = createContext<{ on: boolean; watch: Watch }>({ on: false, watch: () => () => {} });

/** Строка с долей: в окне ли она, видна ли, с какого момента и был ли по ней показ. */
type Spot = { near: boolean; shown: boolean; since: number; done: boolean };

function createEngine(setOn: (on: boolean) => void) {
  const rows = new Map<HTMLElement, Spot>();
  let io: IntersectionObserver | null = null;
  let live = false;
  let on = false;
  let end = 0;
  let offTimer = 0;
  let checkTimer = 0;
  let frame = 0;

  const seen = (row: HTMLElement): boolean => {
    const box = (row.querySelector<HTMLElement>("[data-total-swap]") ?? row).getBoundingClientRect();
    if (!box.width || !box.height) return false;
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    if (!hit) return false;
    return row.contains(hit) || !hit.closest(COVERS);
  };

  const off = () => {
    on = false;
    setOn(false);
  };

  /** Показ идёт ещё `SHOW_MS` от этого мига - начать или продлить. */
  const hold = (now: number) => {
    end = Math.max(end, now + SHOW_MS);
    if (!on) {
      on = true;
      setOn(true);
    }
    window.clearTimeout(offTimer);
    offTimer = window.setTimeout(off, end - now);
  };

  const check = () => {
    frame = 0;
    window.clearTimeout(checkTimer);
    checkTimer = 0;
    // Во вкладке, которую не видно, ничего не решается: вернулись - те же строки
    // на тех же местах, и это не новое появление.
    if (!live || document.visibilityState !== "visible") return;
    const now = performance.now();
    let next = Infinity;
    for (const [row, spot] of rows) {
      if (!spot.near) {
        spot.shown = false;
        continue;
      }
      if (!seen(row)) {
        spot.shown = false;
        next = Math.min(next, RECHECK_MS);
        continue;
      }
      if (!spot.shown) {
        spot.shown = true;
        spot.since = now;
        // Во время показа строка уже стоит всей суммой - продлить сразу, иначе
        // она вернулась бы к доле и через миг поднялась обратно.
        spot.done = on;
        if (on) hold(now);
      }
      if (spot.done) continue;
      const left = DWELL_MS - (now - spot.since);
      if (left > 0) {
        next = Math.min(next, left);
        continue;
      }
      spot.done = true;
      hold(now);
    }
    if (next < Infinity) checkTimer = window.setTimeout(check, next);
  };

  // В реестре без книги отдела строк с долей нет - прокрутка ничего не заказывает.
  const schedule = () => {
    if (live && !frame && rows.size) frame = requestAnimationFrame(check);
  };

  const observer = () => {
    io ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const spot = rows.get(entry.target as HTMLElement);
        if (spot) spot.near = entry.isIntersecting;
      }
      schedule();
    });
    return io;
  };

  const watch: Watch = (row) => {
    rows.set(row, { near: false, shown: false, since: 0, done: false });
    observer().observe(row);
    return () => {
      rows.delete(row);
      io?.unobserve(row);
    };
  };

  const start = () => {
    let stopped = false;
    void whenStageClear().then(() => {
      if (stopped) return;
      live = true;
      for (const row of rows.keys()) observer().observe(row);
      schedule();
    });
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      stopped = true;
      live = false;
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
      cancelAnimationFrame(frame);
      frame = 0;
      window.clearTimeout(checkTimer);
      window.clearTimeout(offTimer);
      io?.disconnect();
      io = null;
      end = 0;
      if (on) off();
    };
  };

  /** Сменился лист или поиск: видимые строки появляются заново. */
  const reset = () => {
    for (const spot of rows.values()) {
      spot.shown = false;
      spot.done = false;
    }
    schedule();
  };

  return { watch, start, reset };
}

/**
 * Показ «Общей суммы» на один список. `reset` - лист и отбор: сменился -
 * видимые строки с долей появляются заново.
 */
export function TotalPreview({ reset, children }: { reset: string; children: ReactNode }) {
  const [on, setOn] = useState(false);
  const [engine] = useState(() => createEngine(setOn));
  useEffect(() => engine.start(), [engine]);
  useEffect(() => engine.reset(), [engine, reset]);
  const value = useMemo(() => ({ on, watch: engine.watch }), [on, engine]);
  return <Preview.Provider value={value}>{children}</Preview.Provider>;
}

/** Подпись колонки: «Сумма», на время показа - «Общая сумма». */
export function AmountTitle() {
  const { on } = useContext(Preview);
  return <RiseSwap value={on ? "Общая сумма" : "Сумма"} align="end" />;
}

/**
 * Сумма строки с долей: доля, на время показа - вся сумма договора. На
 * телефоне шапки колонок нет, и «общая» стоит у самого числа.
 */
export function ShareAmount({ part, whole, monthly }: { part: unknown; whole: number; monthly: boolean }) {
  const { on, watch } = useContext(Preview);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const row = ref.current?.closest<HTMLElement>(".creg-row");
    return row ? watch(row) : undefined;
  }, [watch]);
  const money = contractMoney(on ? whole : part);
  return (
    <span ref={ref} data-total-swap="">
      <RiseSwap value={`${on ? "whole" : "part"} ${money}`} align="end">
        {on ? <small className="creg-whole-tag">общая </small> : null}
        {money}
        {monthly ? <small> /мес</small> : null}
      </RiseSwap>
    </span>
  );
}
