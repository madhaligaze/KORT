"use client";

/**
 * Меню «⋯»: список действий плавающим слоем под кнопкой.
 *
 * Esc и клик мимо закрывают; стрелки ходят по пунктам. Опасное действие
 * помечено розой — единственный цвет в меню.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { MoreIcon } from "@/components/icons";

export type MenuItem = {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  hidden?: boolean;
  hint?: ReactNode;
};

export function MenuPopover({ items, label = "Действия", align = "right" }: { items: MenuItem[]; label?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const shown = items.filter((item) => !item.hidden);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((value) => (value + 1) % shown.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((value) => (value - 1 + shown.length) % shown.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        const item = shown[active];
        setOpen(false);
        item?.onSelect();
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, active, shown]);

  if (!shown.length) return null;
  return (
    <div ref={root} style={{ position: "relative" }}>
      <button
        type="button"
        className="fin-icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setActive(0);
          setOpen((value) => !value);
        }}
      >
        <MoreIcon size={18} />
      </button>
      {open ? (
        <div className="fin-pop" role="menu" style={{ top: "calc(100% + 4px)", [align]: 0 }}>
          {shown.map((item, index) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="fin-pop-item"
              data-danger={item.danger ? "true" : undefined}
              data-active={index === active ? "true" : undefined}
              onMouseEnter={() => setActive(index)}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
              {item.hint ? <span className="fin-pop-hint fin-muted">{item.hint}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
