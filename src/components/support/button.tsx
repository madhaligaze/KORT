"use client";

/**
 * Поддержка в шапке.
 *
 * В покое - значок; раз в 20 секунд он подъёмом сменяется словом
 * «Поддержка» и через три секунды возвращается (16.10.2026: «в основном
 * всегда иконка, и раз в 20 секунд анимированно меняется на слово»). Значок
 * облачка без слова читается не всеми, а слово постоянно занимало бы шапку.
 * Ширина кнопки едет вместе со словом: компания слева уступает ей место на
 * эти секунды, ничего не перекрывается.
 *
 * Пришёл ответ поддержки - на месте значка плита «Ответ поддержки» и стучит
 * раз в 6 секунд, пока её не откроют: одноразовый знак уставший работник
 * пропустит (память проекта, «уставший работник»), а цветная точка - не наш
 * язык (CLAUDE.md, «Индикаторы состояния»). Плита - заливка цветом текста
 * шапки: самое контрастное на тёмной раме без нового цвета.
 *
 * Движение - GSAP; при «меньше движения» смена слова мгновенная, стука нет.
 * Вне видимой вкладки ничего не играет.
 */
import { useEffect, useRef } from "react";

import { SupportIcon } from "@/components/icons";
import { plural } from "@/components/finance/format";
import { gsap, prefersReducedMotion } from "@/components/motion/gsap";

const EVERY_MS = 20_000;
/** Первое слово - вскоре после входа: значок узнают, не дожидаясь двадцати секунд. */
const FIRST_MS = 6_000;
const HOLD_S = 3;
const KNOCK_MS = 6_000;

export function SupportButton({ unread, onOpen }: { unread: number; onOpen: () => void }) {
  const box = useRef<HTMLButtonElement>(null);
  const icon = useRef<HTMLSpanElement>(null);
  const word = useRef<HTMLSpanElement>(null);
  const plate = useRef<HTMLSpanElement>(null);
  const waiting = unread > 0;

  useEffect(() => {
    if (waiting) return;
    const button = box.current;
    const iconNode = icon.current;
    const wordNode = word.current;
    if (!button || !iconNode || !wordNode) return;
    let timeline: gsap.core.Timeline | null = null;
    const play = () => {
      if (document.visibilityState !== "visible" || timeline?.isActive()) return;
      const from = button.offsetWidth;
      const to = wordNode.offsetWidth;
      const still = prefersReducedMotion();
      const quick = still ? 0 : 1;
      timeline = gsap.timeline({
        onComplete: () => {
          gsap.set(button, { clearProps: "width" });
          gsap.set([iconNode, wordNode], { clearProps: "transform,opacity,visibility" });
        },
      });
      timeline
        .set(button, { width: from })
        .to(button, { width: to, duration: 0.6 * quick, ease: "expo.out" }, 0)
        .to(iconNode, { yPercent: -120, autoAlpha: 0, duration: 0.26 * quick, ease: "power3.in" }, 0)
        .fromTo(
          wordNode,
          { yPercent: 120, autoAlpha: 0 },
          { yPercent: 0, autoAlpha: 1, duration: 0.6 * quick, ease: "expo.out" },
          0.12 * quick,
        )
        .to(wordNode, { yPercent: -120, autoAlpha: 0, duration: 0.26 * quick, ease: "power3.in" }, `+=${HOLD_S}`)
        .to(button, { width: from, duration: 0.6 * quick, ease: "expo.out" }, "<")
        .fromTo(
          iconNode,
          { yPercent: 120, autoAlpha: 0 },
          { yPercent: 0, autoAlpha: 1, duration: 0.6 * quick, ease: "expo.out" },
          `<${0.12 * quick}`,
        );
    };
    const first = window.setTimeout(play, FIRST_MS);
    const every = window.setInterval(play, EVERY_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
      timeline?.kill();
      gsap.set(button, { clearProps: "width" });
      gsap.set([iconNode, wordNode], { clearProps: "transform,opacity,visibility" });
    };
  }, [waiting]);

  useEffect(() => {
    const node = plate.current;
    if (!waiting || !node || prefersReducedMotion()) return;
    // Плита встаёт подъёмом - «здесь теперь другое», - потом стучит, пока ждёт.
    gsap.fromTo(node, { yPercent: 110, autoAlpha: 0 }, { yPercent: 0, autoAlpha: 1, duration: 0.6, ease: "expo.out", clearProps: "transform,opacity,visibility" });
    const knock = () => {
      if (document.visibilityState !== "visible") return;
      gsap.fromTo(
        node,
        { y: 0 },
        { y: -4, duration: 0.13, ease: "power2.out", yoyo: true, repeat: 3, clearProps: "transform" },
      );
    };
    const timer = window.setInterval(knock, KNOCK_MS);
    return () => {
      window.clearInterval(timer);
      gsap.killTweensOf(node);
      gsap.set(node, { clearProps: "transform,opacity,visibility" });
    };
  }, [waiting]);

  if (waiting) {
    const label = `Ответ поддержки${unread > 1 ? ` · ${unread}` : ""}`;
    return (
      <button
        type="button"
        className="fin-support"
        data-waiting="true"
        onClick={onOpen}
        title="Открыть переписку с поддержкой"
        aria-label={`${unread} ${plural(unread, "ответ", "ответа", "ответов")} поддержки - открыть`}
      >
        <span ref={plate} className="fin-support-plate">
          <span className="only-desktop">{label}</span>
          <span className="only-mobile">Ответ{unread > 1 ? ` · ${unread}` : ""}</span>
        </span>
      </button>
    );
  }
  return (
    <button
      ref={box}
      type="button"
      className="fin-support"
      onClick={onOpen}
      title="Поддержка - написать о проблеме или пожелании"
      aria-label="Поддержка"
    >
      <span ref={icon} className="fin-support-icon">
        <SupportIcon size={19} />
      </span>
      <span ref={word} className="fin-support-word" aria-hidden="true">
        Поддержка
      </span>
    </button>
  );
}
