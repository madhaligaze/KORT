"use client";

import { type ReactNode, useRef, useState } from "react";

import { KortWordmark } from "@/components/brand/kort-wordmark";
import { gsap, prefersReducedMotion, useGSAP } from "@/components/motion/gsap";
import { FadeIn } from "@/components/motion/fade-in";
import { LiquidStage } from "@/components/motion/liquid-stage";
import { ThemeSwitch } from "@/components/stage/theme-switch";

type Props = {
  /**
   * Собирать экран входом: дым → знак → форма. Только на первом экране входа
   * за загрузку страницы: после «Выйти» человек ждать три секунды не должен.
   */
  intro?: boolean;
  children: ReactNode;
};

/** Вход уже показан в этой загрузке страницы. */
let introPlayed = false;

/*
 * Такт входа, секунды от появления экрана. Дым проявляется сам
 * (`LiquidStage`, 2.8 с от `delay`), здесь - то, что идёт следом.
 */
const LETTERS_AT = 1.05;
const LETTER_STAGGER = 0.15;
const PANEL_AT = 2.05;
const PANEL_FOR = 1.3;
const FORM_AT = PANEL_AT + PANEL_FOR * 0.62;

/**
 * Экран входа KORT: сцена со знаком слева, форма справа.
 *
 * Вход собирается по порядку, который задан продуктом: в темноте проявляется
 * дым, потом по одной встают буквы KORT, потом форма раздвигает сцену справа
 * (раскладкой, а не сдвигом: см. `.auth-stage` в globals.css). Форма
 * монтируется только после этого - её заголовок и поля входят своим обычным
 * движением, а фокус в поле ставится, когда поле уже видно.
 *
 * Клик или клавиша во время входа ускоряют его вчетверо: сценарий не должен
 * стоять между человеком и полем пароля. При «меньше движения» экран сразу
 * собран.
 */
export function AuthStage({ intro = false, children }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [playing] = useState(() => intro && !introPlayed && !prefersReducedMotion());
  const [formShown, setFormShown] = useState(!playing);

  useGSAP(
    () => {
      const stage = root.current;
      if (!stage) return;
      if (intro) introPlayed = true;
      if (!playing) return;

      const letters = stage.querySelectorAll<SVGPathElement>(".auth-mark [data-letter]");
      gsap.set(stage, { "--auth-open": 0 });
      // Треть высоты буквы: снизу их подрезает край полотна знака.
      gsap.set(letters, { opacity: 0, y: 50 });

      const timeline = gsap.timeline({
        onComplete: () => {
          stage.removeAttribute("data-intro");
          gsap.set(stage, { clearProps: "--auth-open" });
        },
      });
      timeline
        .to(letters, { opacity: 1, y: 0, duration: 1.1, stagger: LETTER_STAGGER, ease: "expo.out" }, LETTERS_AT)
        .to(stage, { "--auth-open": 1, duration: PANEL_FOR, ease: "power3.inOut" }, PANEL_AT)
        .call(() => setFormShown(true), undefined, FORM_AT);

      const hurry = () => timeline.timeScale(4);
      window.addEventListener("pointerdown", hurry, { once: true });
      window.addEventListener("keydown", hurry, { once: true });
      return () => {
        window.removeEventListener("pointerdown", hurry);
        window.removeEventListener("keydown", hurry);
      };
    },
    { scope: root },
  );

  return (
    <div ref={root} className="auth-stage" data-intro={playing ? "" : undefined}>
      <section className="auth-poster">
        <LiquidStage className="auth-liquid" intensity={0.95} delay={0.1} />
        <div className="auth-poster-veil" aria-hidden="true" />
        <div className="auth-poster-foot">
          <h1 className="auth-mark-title">
            <KortWordmark className="auth-mark" />
          </h1>
        </div>
      </section>
      <section className="auth-panel">
        {/* Тумблер темы входит вместе с формой: пока панель закрыта, ему не на чем стоять. */}
        {formShown ? (
          <FadeIn className="auth-theme">
            <ThemeSwitch />
          </FadeIn>
        ) : null}
        <div className="auth-form">{formShown ? children : null}</div>
      </section>
    </div>
  );
}

/**
 * Ожидание до того, как известно, какой экран показывать.
 *
 * Та же сцена, но пустая: следом почти всегда идёт вход, и он проявляется из
 * этого же цвета. Подпись проявляется с задержкой (`.auth-wait` в
 * globals.css), поэтому быстрая проверка проходит вовсе без неё.
 */
export function AuthWait({ children }: { children: ReactNode }) {
  return (
    <div className="auth-wait" role="status" aria-live="polite">
      <span>{children}</span>
    </div>
  );
}
