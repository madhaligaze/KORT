"use client";

import { useRef, type CSSProperties, type ElementType, type ReactNode } from "react";

import { gsap, prefersReducedMotion, SplitText, useGSAP } from "./gsap";
import { whenStageClear } from "./stage-bus";

type Props = {
  as?: ElementType;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  id?: string;
  /** На что резать: буквы — для коротких крупных надписей, строки — для абзацев. */
  by?: "chars" | "words" | "lines";
  delay?: number;
  stagger?: number;
  duration?: number;
};

/**
 * Надпись, которая поднимается из-под собственной строки.
 *
 * Каждая строка — окно с обрезкой, буквы выезжают снизу вверх. Это приём
 * GSAP-овского сайта, и держится он на двух вещах, которые легко потерять:
 *
 * 1. **Резать после загрузки шрифта.** Разрезанная на запасном шрифте строка
 *    переносится иначе, и после подмены шрифта буквы стоят не там. Поэтому
 *    ждём `document.fonts.ready`, а `autoSplit` перерезает при смене ширины.
 * 2. **Не показывать текст до разрезки.** Сервер отдаёт надпись целиком, и
 *    без скрытия она мелькнула бы на месте, пропала и выехала заново. Прячет
 *    её CSS (`.motion [data-split]`), и только пока на <html> стоит класс
 *    `motion`, — его ставит скрипт темы, если человек не просил меньше
 *    движения, и сам же снимает через четыре секунды: если GSAP не доедет,
 *    текст не может остаться невидимым из-за анимации. После гидратации
 *    надпись держит скрытой уже инлайновый стиль — чтобы снятие класса не
 *    показало её раньше, чем она разрезана.
 *
 * Вход ждёт, пока поднимется занавес перехода (`whenStageClear`), иначе он
 * отыграл бы за занавесом.
 *
 * Текст надписи на месте не меняется: SplitText переписал её DOM, и React
 * обновить его уже не сможет. Сменился текст — пересоздать надпись через
 * `key={текст}`.
 */
export function SplitReveal({
  as: Tag = "span",
  children,
  className,
  style,
  id,
  by = "chars",
  delay = 0,
  stagger,
  duration = 1.15,
}: Props) {
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (prefersReducedMotion()) {
        el.setAttribute("data-split-ready", "");
        return;
      }

      let cancelled = false;
      let split: SplitText | null = null;
      let tween: gsap.core.Tween | null = null;
      el.style.visibility = "hidden";

      void (async () => {
        await document.fonts?.ready;
        await whenStageClear();
        if (cancelled || !el.isConnected) return;

        split = SplitText.create(el, {
          // Слова обязательны и при разрезке на буквы: без обёртки слова
          // буквы — отдельные строчные блоки, и строка переносится между
          // любыми двумя буквами. «Управленчески / й» — ровно это.
          type: by === "lines" ? "lines" : by === "words" ? "lines,words" : "lines,words,chars",
          linesClass: "sr-line",
          // По этому классу жидкая сцена находит буквы, чтобы заполнять их.
          charsClass: "sr-char",
          mask: "lines",
          autoSplit: true,
          onSplit(self) {
            el.setAttribute("data-split-ready", "");
            el.style.visibility = "";
            const targets = by === "lines" ? self.lines : by === "words" ? self.words : self.chars;
            tween = gsap.from(targets, {
              yPercent: 118,
              duration,
              ease: "expo.out",
              stagger: stagger ?? (by === "chars" ? 0.016 : by === "words" ? 0.05 : 0.09),
              delay,
            });
            return tween;
          },
        });
      })();

      return () => {
        cancelled = true;
        tween?.kill();
        split?.revert();
        el.style.visibility = "";
      };
    },
    { scope: ref },
  );

  return (
    <Tag ref={ref} className={className} style={style} id={id} data-split="">
      {children}
    </Tag>
  );
}
