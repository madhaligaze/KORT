"use client";

/**
 * «Сумма» ↔ «Общая сумма» (01.10.2026).
 *
 * В «Разовых ЮО» сумма строки - доля ЮО (`book-share.ts`): у №ОКР/59 стоит
 * 104 400, а договор - на 348 000 (HR 70% / ЮО 30%). Юристам нужна и вся
 * сумма, не открывая карточку. Пока такой договор на экране, подпись колонки
 * и число в его строке сменяются подъёмом каждые три секунды: «Общая сумма»
 * и вся сумма договора, «Сумма» и доля, и снова.
 *
 * По кругу, а не один раз - решение владельца. Сначала показ был один на
 * появление, как велит фронт-план (5.2: «бесконечных повторов на рабочих
 * экранах нет»), и владелец, играя уставшего работника, его пропустил:
 * «один раз показал, и теперь жду - ничего не происходит». Исключение узкое:
 * круг идёт, только пока на экране договор, у которого в «Сумме» доля.
 *
 * Подпись колонки одна на весь список, поэтому и круг один на весь список:
 * пока в шапке «Общая сумма», всю сумму показывает каждая строка с долей -
 * иначе шапка врала бы соседней строке. У строк без доли сумма и так вся, им
 * меняться нечему.
 *
 * «На экране» - середина суммы в окне и не под липкой шапкой (раздела,
 * колонок, части листа). Первая смена - через `DWELL_MS` после появления:
 * сначала читается доля и только потом поднимается во всю сумму, а
 * пролистнутая мимо строка круг не запускает. Ушли с экрана все такие
 * строки, открыта карточка договора или не видна вкладка браузера - круг
 * встаёт на «Сумме»; вернулись - начинается заново. Вход в раздел ждёт, пока
 * поднимется занавес перехода (`whenStageClear`), иначе круг начался бы за
 * ним.
 */
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";

import { contractMoney } from "@/components/finance/format";
import { whenStageClear } from "@/components/motion/stage-bus";
import { RiseSwap } from "@/components/motion/rise-swap";

/** Сколько стоит каждая из двух сумм - просьба юротдела. */
const SHOW_MS = 3000;
/** Сколько договор стоит на виду, прежде чем суммы начнут сменяться. */
const DWELL_MS = 700;
/** Что липнет к верху окна и закрывает строки под собой. */
const COVERS = ".fin-head, .creg-head, .creg-block-head";

type Watch = (row: HTMLElement) => () => void;

const Preview = createContext<{ on: boolean; watch: Watch }>({ on: false, watch: () => () => {} });

function createEngine(setOn: (on: boolean) => void) {
  /**
   * Строки с долей. Видна ли строка, решает её рамка в миг проверки, а не
   * флаг IntersectionObserver: событие прокрутки приходит раньше его ответа,
   * и проверка по флагам видела «A в окне, B нет», когда A уже уехала, а B
   * пришла, - круг вставал и начинался заново (`t5-many-cycle.cjs`). Строк с
   * долей единицы, рамка каждой - дёшево. Наблюдатель только будит проверку,
   * когда строка сдвинулась без прокрутки (отбор, строка выше пришла живьём).
   */
  const rows = new Set<HTMLElement>();
  let io: IntersectionObserver | null = null;
  let live = false;
  let paused = false;
  let on = false;
  let cycling = false;
  let armedAt = 0;
  let waitTimer = 0;
  let turnTimer = 0;
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

  const flip = (next: boolean) => {
    if (on === next) return;
    on = next;
    setOn(next);
  };

  /** Круг встаёт на «Сумме». */
  const stop = () => {
    cycling = false;
    armedAt = 0;
    window.clearTimeout(waitTimer);
    window.clearTimeout(turnTimer);
    flip(false);
  };

  const turn = () => {
    flip(!on);
    turnTimer = window.setTimeout(turn, SHOW_MS);
  };

  const check = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    window.clearTimeout(waitTimer);
    let any = false;
    if (live && !paused && document.visibilityState === "visible") {
      for (const row of rows) {
        if (seen(row)) {
          any = true;
          break;
        }
      }
    }
    if (!any) {
      stop();
      return;
    }
    if (cycling) return;
    const now = performance.now();
    if (!armedAt) armedAt = now;
    const left = DWELL_MS - (now - armedAt);
    if (left > 0) {
      waitTimer = window.setTimeout(check, left);
      return;
    }
    cycling = true;
    turn();
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(check);
  };

  const observer = () => {
    io ??= new IntersectionObserver(schedule);
    return io;
  };

  const watch: Watch = (row) => {
    rows.add(row);
    observer().observe(row);
    return () => {
      rows.delete(row);
      io?.unobserve(row);
      schedule();
    };
  };

  const start = () => {
    let stopped = false;
    void whenStageClear().then(() => {
      if (stopped) return;
      live = true;
      for (const row of rows) observer().observe(row);
      schedule();
    });
    // Строки без доли (реестр без книги отдела) прокрутку не слушают.
    const onScroll = () => {
      if (rows.size) schedule();
    };
    // Скрытая вкладка кадров не рисует: круг встаёт сразу, а не на следующем
    // кадре, которого не будет, - иначе он крутился бы в фоне.
    const onVisibility = () => {
      if (document.visibilityState === "visible") schedule();
      else stop();
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      live = false;
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      cancelAnimationFrame(frame);
      frame = 0;
      stop();
      io?.disconnect();
      io = null;
    };
  };

  /** Карточка договора поверх списка: круг под ней стоит. */
  const pause = (value: boolean) => {
    paused = value;
    schedule();
  };

  return { watch, start, pause };
}

/**
 * Круг «Сумма» ↔ «Общая сумма» на один список. `paused` - поверх открыта
 * карточка договора: под ней ничего не сменяется.
 */
export function TotalPreview({ paused, children }: { paused: boolean; children: ReactNode }) {
  const [on, setOn] = useState(false);
  const [engine] = useState(() => createEngine(setOn));
  useEffect(() => engine.start(), [engine]);
  useEffect(() => engine.pause(paused), [engine, paused]);
  const value = useMemo(() => ({ on, watch: engine.watch }), [on, engine]);
  return <Preview.Provider value={value}>{children}</Preview.Provider>;
}

/** Подпись колонки: «Сумма», в круге - по очереди с «Общая сумма». */
export function AmountTitle() {
  const { on } = useContext(Preview);
  return <RiseSwap value={on ? "Общая сумма" : "Сумма"} align="end" />;
}

/**
 * Сумма строки с долей: доля, в круге - по очереди со всей суммой договора.
 * На телефоне шапки колонок нет, и «общая» стоит у самого числа.
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
