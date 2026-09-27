"use client";

import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

import { gsap, prefersReducedMotion } from "@/components/motion/gsap";

/**
 * Вкладки и переключатели текстом с линией под выбранным (фронт-план, 7).
 *
 * Выбранное — вес и цвет текста плюс волосяная линия, которая переезжает к
 * новому пункту. Ни пилюль, ни заливки: выбор виден по самому слову.
 *
 * `role="tablist"` — для вкладок, `radiogroup` — для выбора значения
 * («Нет · Видит · Правит»). Стрелки двигают выбор, как у нативной группы.
 */
export type SelectItem<K extends string> = {
  key: K;
  label: ReactNode;
  count?: number;
  /** Подсказка при наведении — например, «Нет права правки». */
  title?: string;
  disabled?: boolean;
};

type Props<K extends string> = {
  items: SelectItem<K>[];
  value: K | null;
  onChange: (key: K) => void;
  role?: "tablist" | "radiogroup";
  label: string;
  size?: "md" | "sm";
  className?: string;
  disabled?: boolean;
};

export function SelectLine<K extends string>({
  items,
  value,
  onChange,
  role = "tablist",
  label,
  size = "md",
  className,
  disabled,
}: Props<K>) {
  const root = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    const host = root.current;
    const bar = line.current;
    if (!host || !bar) return;
    const item = value === null ? null : host.querySelector<HTMLElement>(`[data-key="${CSS.escape(value)}"]`);
    if (!item) {
      gsap.set(bar, { opacity: 0 });
      return;
    }
    const to = { x: item.offsetLeft, scaleX: item.offsetWidth, opacity: 1 };
    if (first.current || prefersReducedMotion()) {
      gsap.set(bar, to);
      first.current = false;
    } else {
      gsap.to(bar, { ...to, duration: 0.45, ease: "expo.out", overwrite: "auto" });
    }
  }, [value, items]);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const enabled = items.filter((item) => !item.disabled);
    const at = enabled.findIndex((item) => item.key === items[index].key);
    const next = enabled[(at + step + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.key);
    root.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(next.key)}"]`)?.focus();
  };

  const radio = role === "radiogroup";
  return (
    <div
      ref={root}
      className={`fin-sel ${className ?? ""}`}
      data-size={size}
      role={role}
      aria-label={label}
      aria-disabled={disabled || undefined}
    >
      {items.map((item, index) => {
        const on = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            data-key={item.key}
            className="fin-sel-item"
            role={radio ? "radio" : "tab"}
            aria-selected={radio ? undefined : on}
            aria-checked={radio ? on : undefined}
            tabIndex={on || (value === null && index === 0) ? 0 : -1}
            title={item.title}
            disabled={disabled || item.disabled}
            onClick={() => onChange(item.key)}
            onKeyDown={(event) => move(event, index)}
          >
            {item.label}
            {item.count !== undefined ? <span className="fin-sel-count">{item.count}</span> : null}
          </button>
        );
      })}
      <span ref={line} className="fin-sel-line" aria-hidden="true" />
    </div>
  );
}
