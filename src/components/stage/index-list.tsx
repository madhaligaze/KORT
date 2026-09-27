"use client";

import { useRef } from "react";

import { ArrowRightIcon } from "@/components/icons";
import { canHover, gsap, prefersReducedMotion, useGSAP } from "@/components/motion/gsap";
import { SplitReveal } from "@/components/motion/split-reveal";
import { whenStageClear } from "@/components/motion/stage-bus";
import { StageLink } from "@/components/motion/stage-transition";

export type IndexEntry = {
  key: string;
  title: string;
  /** Короткая пометка справа: что внутри, двумя-тремя словами. */
  meta?: string;
  /** Переход в раздел через занавес. */
  href?: string;
  /** Или действие на месте — например, окно сервиса. */
  onSelect?: () => void;
};

type Props = {
  entries: IndexEntry[];
  /** hero — стартовый экран во весь рост; section — список внутри раздела. */
  size?: "hero" | "section";
  /** Через сколько секунд после открытия занавеса начинать вход. */
  delay?: number;
  /** Навели на строку (или ушли с неё) — сцена за списком может ответить. */
  onHover?: (row: HTMLElement | null) => void;
  label: string;
};

/**
 * Указатель разделов: строки крупным кеглем, разделённые волосяными линиями.
 *
 * Это форма из обоих референсов — список инструментов GSAP и меню monopo, — и
 * она заменила сетку плиток со значком в углу: плитки выглядели шаблоном, а
 * название, набранное во весь рост, само по себе и есть навигация.
 *
 * Движение:
 * - вход — линии прочерчиваются слева направо, номера и пометки проявляются,
 *   названия поднимаются буквами из-под строки;
 * - наведение — название отъезжает и набирает вес (шрифт переменный, вес
 *   твинится плавно, а не щёлкает между 400 и 600), номер перебирает цифры,
 *   стрелка выезжает; остальные строки гаснут (это CSS, `:has`).
 *
 * Наведение только там, где оно есть. Клавиатура получает то же самое по
 * фокусу — иначе с Tab список выглядел бы мёртвым.
 */
export function IndexList({ entries, size = "hero", delay = 0, onHover, label }: Props) {
  const root = useRef<HTMLElement>(null);

  const { contextSafe } = useGSAP(
    (_context, contextSafe) => {
      const el = root.current;
      if (!el) return;
      const rules = el.querySelectorAll(".ix-rule");
      const quiet = el.querySelectorAll(".ix-num, .ix-meta");
      if (prefersReducedMotion()) {
        gsap.set(rules, { scaleX: 1 });
        gsap.set(quiet, { autoAlpha: 1 });
        return;
      }

      gsap.set(rules, { scaleX: 0, transformOrigin: "0% 50%" });
      gsap.set(quiet, { autoAlpha: 0, y: 14 });

      let alive = true;
      void whenStageClear().then(
        contextSafe!(() => {
          if (!alive) return;
          gsap
            .timeline({ delay })
            .to(rules, { scaleX: 1, duration: 1.5, ease: "expo.inOut", stagger: 0.09 })
            .to(quiet, { autoAlpha: 1, y: 0, duration: 1, stagger: 0.06, ease: "expo.out" }, 0.45);
        }),
      );
      return () => {
        alive = false;
      };
    },
    { scope: root },
  );

  const enter = contextSafe((row: HTMLElement) => {
    if (prefersReducedMotion()) return;
    const title = row.querySelector(".ix-title");
    const arrow = row.querySelector(".ix-arrow");
    const num = row.querySelector<HTMLElement>(".ix-num");
    gsap.to(title, {
      x: size === "hero" ? 28 : 16,
      fontWeight: 620,
      duration: 0.9,
      ease: "expo.out",
      overwrite: "auto",
    });
    gsap.fromTo(
      arrow,
      { x: -28, rotate: -45, autoAlpha: 0 },
      { x: 0, rotate: 0, autoAlpha: 1, duration: 0.8, ease: "expo.out", overwrite: "auto" },
    );
    if (num?.dataset.n) {
      gsap.to(num, {
        duration: 0.7,
        scrambleText: { text: num.dataset.n, chars: "0123456789", speed: 0.7 },
        overwrite: "auto",
      });
    }
    onHover?.(row);
  });

  const leave = contextSafe((row: HTMLElement) => {
    if (prefersReducedMotion()) return;
    gsap.to(row.querySelector(".ix-title"), {
      x: 0,
      fontWeight: size === "hero" ? 400 : 450,
      duration: 0.9,
      ease: "expo.out",
      overwrite: "auto",
    });
    gsap.to(row.querySelector(".ix-arrow"), { x: 24, autoAlpha: 0, duration: 0.5, ease: "power2.in", overwrite: "auto" });
    onHover?.(null);
  });

  return (
    <nav ref={root} className="ix" data-size={size} aria-label={label}>
      <span className="ix-rule ix-rule-top" aria-hidden="true" />
      {entries.map((entry, index) => {
        const number = String(index + 1).padStart(2, "0");
        const body = (
          <>
            <span className="ix-num" data-n={number} aria-hidden="true">
              {number}
            </span>
            <SplitReveal className="ix-title" delay={delay + 0.15 + index * 0.08}>
              {entry.title}
            </SplitReveal>
            {entry.meta ? <span className="ix-meta">{entry.meta}</span> : <span />}
            <span className="ix-arrow" aria-hidden="true">
              <ArrowRightIcon size={size === "hero" ? 30 : 22} />
            </span>
            <span className="ix-rule" aria-hidden="true" />
          </>
        );
        const handlers = {
          onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
            if (canHover()) enter(event.currentTarget);
          },
          onPointerLeave: (event: React.PointerEvent<HTMLElement>) => {
            if (canHover()) leave(event.currentTarget);
          },
          onFocus: (event: React.FocusEvent<HTMLElement>) => enter(event.currentTarget),
          onBlur: (event: React.FocusEvent<HTMLElement>) => leave(event.currentTarget),
        };
        return entry.href ? (
          <StageLink key={entry.key} href={entry.href} label={entry.title} className="ix-row" {...handlers}>
            {body}
          </StageLink>
        ) : (
          <button key={entry.key} type="button" className="ix-row" onClick={entry.onSelect} {...handlers}>
            {body}
          </button>
        );
      })}
    </nav>
  );
}
