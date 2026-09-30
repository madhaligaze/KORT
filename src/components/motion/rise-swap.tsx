"use client";

/**
 * Подъём: «здесь теперь другой текст» (фронт-план, раздел 5). Старое уходит
 * вверх из своей строки, новое поднимается снизу - то же движение, что у
 * заголовков `SplitReveal`.
 *
 * Не перебор цифр: число, которое «гуляет», нельзя читать в момент показа.
 * Не подсветка цветом: цвет в продукте - только у отказа. Быстрые смены
 * подряд перебивают друг друга, а не выстраиваются в очередь.
 *
 * `value` - что стоит в строке; движение - только при его смене. `children` -
 * как это показать (число с «/мес», подпись), по умолчанию сам `value`. Оба
 * текста стоят в одной клетке сетки (`.rise-swap`): ширина окна на время
 * смены - по большему, и в колонке, выровненной вправо (`align="end"`),
 * уходящее не сдвигается к левому краю нового.
 *
 * Ушедшее снимается из DOM, а не остаётся невидимым: иначе текст строки при
 * копировании или чтении читался бы «10» вместо «1». SplitText здесь не
 * режет: React остаётся хозяином текста.
 */
import { type ReactNode, useRef, useState } from "react";

import { gsap, prefersReducedMotion, useGSAP } from "./gsap";

type Turn = { value: string; node: ReactNode; was: ReactNode; n: number };

/**
 * Новое выходит на 0,12 с позже старого. Со стартом разом первые ~150 мс оба
 * текста стояли друг на друге: новое (`expo.out`) влетает сразу, а старое
 * (`power3.in`) только трогается - «Общая сумма» поверх «Сумма», 348 000
 * поверх 104 400 (кадры `pw-finmap/kort/total-1001/d4-frames.cjs`).
 */
const LAG = 0.12;

export function RiseSwap({
  value,
  children,
  className,
  align = "start",
}: {
  value: string;
  children?: ReactNode;
  className?: string;
  align?: "start" | "end";
}) {
  const node = children ?? value;
  const [turn, setTurn] = useState<Turn>({ value, node, was: null, n: 0 });
  if (turn.value !== value) setTurn({ value, node, was: turn.node, n: turn.n + 1 });
  const box = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const root = box.current;
      if (turn.n === 0 || !root) return;
      const incoming = root.querySelector<HTMLElement>("[data-rise='in']");
      const outgoing = root.querySelector<HTMLElement>("[data-rise='out']");
      const n = turn.n;
      const drop = () => setTurn((now) => (now.n === n && now.was !== null ? { ...now, was: null } : now));
      if (prefersReducedMotion()) {
        // Мгновенная замена: уходящее снимается до отрисовки. Спрятать его
        // `autoAlpha` мало - при «меньше движения» у всего `transition` 1 мс
        // (globals.css), и кадр оба текста стояли бы друг на друге.
        drop();
        return;
      }
      const timeline = gsap.timeline({ onComplete: drop });
      if (outgoing) {
        timeline.fromTo(outgoing, { yPercent: 0 }, { yPercent: -110, autoAlpha: 0, duration: 0.24, ease: "power3.in" }, 0);
      }
      if (incoming) {
        timeline.fromTo(
          incoming,
          { yPercent: 110 },
          { yPercent: 0, duration: 0.52, ease: "expo.out", clearProps: "transform" },
          outgoing ? LAG : 0,
        );
      }
    },
    { scope: box, dependencies: [turn.n], revertOnUpdate: true },
  );

  return (
    <span ref={box} className={`rise-swap${className ? ` ${className}` : ""}`} data-align={align}>
      <span data-rise="in" key={`in-${turn.n}`}>
        {node}
      </span>
      {turn.was !== null ? (
        <span data-rise="out" key={`out-${turn.n}`} aria-hidden="true">
          {turn.was}
        </span>
      ) : null}
    </span>
  );
}
