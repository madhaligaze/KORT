"use client";

/**
 * Выбор словами с линией под выбранным — «Подчёркивание» из словаря движений.
 *
 * Пока не выбрано ничего, линии нет: это и есть вопрос. Линия переезжает к
 * новому выбору (`x` и `scaleX`, 0,45 с), а при смене размеров встаёт на место
 * без движения. Вариант, выбранный человеком, набран `--fin-text`, остальные —
 * приглушённо; цвета «правильного ответа» нет.
 */
import { useEffect, useRef, type ReactNode, type RefObject } from "react";

import { gsap, prefersReducedMotion, useGSAP } from "@/components/motion/gsap";

import styles from "./registry-import.module.css";

function placeLine(box: HTMLElement, bar: HTMLElement, placed: RefObject<boolean>, animate: boolean) {
  const active = box.querySelector<HTMLElement>('[aria-checked="true"]');
  if (!active) {
    gsap.set(bar, { autoAlpha: 0 });
    placed.current = false;
    return;
  }
  const target = {
    x: active.offsetLeft,
    y: active.offsetTop + active.offsetHeight - 2,
    scaleX: active.offsetWidth,
    autoAlpha: 1,
  };
  if (animate && placed.current && !prefersReducedMotion()) {
    gsap.to(bar, { ...target, duration: 0.45, ease: "expo.out", overwrite: "auto" });
  } else {
    gsap.set(bar, { ...target, overwrite: "auto" });
  }
  placed.current = true;
}

export type Choice<T extends string> = { value: T; label: ReactNode; title?: string };

type Props<T extends string> = {
  items: Choice<T>[];
  value: T | null;
  onChange: (value: T) => void;
  label: string;
  /** Столбиком — для длинных значений (расхождения листов). */
  stacked?: boolean;
  disabled?: boolean;
};

export function ChoiceLine<T extends string>({ items, value, onChange, label, stacked, disabled }: Props<T>) {
  const root = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  // Сменился выбор — линия переезжает.
  useGSAP(
    () => {
      if (root.current && line.current) placeLine(root.current, line.current, placed, true);
    },
    { scope: root, dependencies: [value, items.length] },
  );

  // Сменился размер — линия встаёт на место без движения. Наблюдатель свой,
  // не в useGSAP: там с зависимостями уборка копится до размонтирования, и
  // каждый новый выбор добавлял бы ещё одного наблюдателя.
  useEffect(() => {
    const box = root.current;
    const bar = line.current;
    if (!box || !bar) return;
    const observer = new ResizeObserver(() => placeLine(box, bar, placed, false));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={root}
      role="radiogroup"
      aria-label={label}
      className={styles.choice}
      data-stacked={stacked ? "true" : undefined}
    >
      {items.map((item) => {
        const on = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={item.title}
            disabled={disabled}
            className={styles.choiceItem}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        );
      })}
      <span ref={line} className={styles.choiceLine} aria-hidden="true" />
    </div>
  );
}
