"use client";

/**
 * «Исправить опечатку · Изменение с даты» — вопрос у поля, а не окно.
 *
 * Один компонент для ячейки листа и поля карточки: вопрос про одно значение
 * и стоит рядом с ним. Диалог по центру закрыл бы ячейку, о которой
 * спрашивает. Esc снимает правку — в поле возвращается прежнее значение.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";

import { parseDay } from "@/components/finance/format";

type Props = {
  onFix: () => void;
  onFromDate: (isoDate: string) => void;
  onCancel: () => void;
  style?: CSSProperties;
  count?: number;
};

export function ChangeMode({ onFix, onFromDate, onCancel, style, count }: Props) {
  const [date, setDate] = useState("");
  const [askDate, setAskDate] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const dateInput = useRef<HTMLInputElement>(null);
  const iso = parseDay(date);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  useEffect(() => {
    if (askDate) dateInput.current?.focus();
  }, [askDate]);

  const suffix = count && count > 1 ? ` · ${count}` : "";
  return (
    <div ref={root} className="change-mode" role="group" aria-label="Что это за изменение" style={{ top: "calc(100% + 6px)", left: "-0.5rem", ...style }}>
      <button type="button" onClick={onFix} autoFocus>
        Исправить опечатку{suffix}
      </button>
      <span className="fin-muted">·</span>
      {askDate ? (
        <>
          <span>Изменение с</span>
          <input
            ref={dateInput}
            value={date}
            placeholder="дд.мм.гггг"
            inputMode="numeric"
            aria-label="С какой даты"
            onChange={(event) => setDate(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && iso) {
                event.preventDefault();
                onFromDate(iso);
              }
            }}
          />
          <button type="button" disabled={!iso} onClick={() => iso && onFromDate(iso)}>
            Записать{suffix}
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setAskDate(true)}>
          Изменение с даты{suffix}
        </button>
      )}
    </div>
  );
}
