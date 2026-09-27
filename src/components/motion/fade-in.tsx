"use client";

import { useRef, type ReactNode } from "react";

import { gsap, prefersReducedMotion, useGSAP } from "./gsap";

/**
 * Проявление содержимого при монтировании: дети выходят из прозрачности
 * по очереди. Сменить содержимое с проявлением — пересоздать обёртку
 * через `key`.
 *
 * Только прозрачность, без сдвига и размытия, и это не скромность, а
 * безопасность. `transform` и `filter` на предке делают его контейнером для
 * `position: fixed` потомков: лист Univer, раскрытый во весь экран внутри
 * раздела, на время анимации оказался бы заперт в рамке раздела. И замеры
 * холста Univer через getBoundingClientRect во время сдвига врали бы.
 * Прозрачность ни того, ни другого не делает. В конце стили снимаются.
 */
export function FadeIn({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      // Пусто — раздел ещё ждёт данных; проявлять нечего.
      if (!el || !el.children.length || prefersReducedMotion()) return;
      gsap.fromTo(
        el.children,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.7, ease: "power2.out", stagger: 0.06, clearProps: "opacity,visibility" },
      );
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
