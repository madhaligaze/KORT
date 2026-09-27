"use client";

/**
 * Подъём: «здесь теперь другое число». Старое уходит вверх из своей строки,
 * новое поднимается снизу — то же движение, что у заголовков `SplitReveal`.
 *
 * Не перебор цифр: число, которое «гуляет», нельзя читать в момент показа.
 * Не подсветка цветом: цвет в «Финансах» — только у отказа. Быстрые смены
 * подряд перебивают друг друга, а не выстраиваются в очередь.
 *
 * Своя маленькая копия, пока в `motion/` нет общего `RiseSwap` (фронт-план
 * 5.4); когда он появится, этот файл заменяется им без правки мест вызова.
 */
import { useLayoutEffect, useRef, useState } from "react";

import { gsap, prefersReducedMotion } from "@/components/motion/gsap";

export function Rise({ text, className }: { text: string; className?: string }) {
  const [state, setState] = useState<{ now: string; was: string | null; n: number }>({ now: text, was: null, n: 0 });
  if (state.now !== text) setState({ now: text, was: state.now, n: state.n + 1 });
  const box = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const root = box.current;
    if (state.n === 0 || !root) return;
    const incoming = root.querySelector<HTMLElement>("[data-rise='in']");
    const outgoing = root.querySelector<HTMLElement>("[data-rise='out']");
    const turn = state.n;
    // Ушедшее число снимается из DOM, а не остаётся невидимым: иначе текст
    // строки при копировании или чтении читался бы «10» вместо «1».
    const drop = () => setState((value) => (value.n === turn && value.was !== null ? { ...value, was: null } : value));
    if (prefersReducedMotion()) {
      const call = gsap.delayedCall(0, drop);
      return () => {
        call.kill();
      };
    }
    const timeline = gsap.timeline({ onComplete: drop });
    if (outgoing) {
      timeline.fromTo(outgoing, { yPercent: 0 }, { yPercent: -110, autoAlpha: 0, duration: 0.24, ease: "power3.in" }, 0);
    }
    if (incoming) {
      timeline.fromTo(incoming, { yPercent: 110 }, { yPercent: 0, duration: 0.52, ease: "expo.out", clearProps: "transform" }, 0);
    }
    return () => {
      timeline.kill();
    };
  }, [state.n]);

  return (
    <span ref={box} className={`setup-rise ${className ?? ""}`}>
      <span data-rise="in" key={`in-${state.n}`}>
        {state.now}
      </span>
      {state.was !== null ? (
        <span data-rise="out" key={`out-${state.n}`} className="setup-rise-out" aria-hidden="true">
          {state.was}
        </span>
      ) : null}
    </span>
  );
}
