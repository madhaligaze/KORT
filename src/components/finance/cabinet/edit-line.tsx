"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { ChoiceSelect } from "@/components/choice-select";
import { PhoneInput, formatPhone, phoneDigits, phoneValue } from "@/components/finance/ui/phone-input";

/**
 * Строка «подпись · значение», которая в покое — текст (фронт-план, 6.9).
 *
 * Правится там, где человеку это можно: нажал — поле на месте текста,
 * Enter или уход из поля — сохранено, Esc — отмена. Кнопки «Сохранить» нет:
 * пока запрос в полёте, под значением прочерчивается волосяная линия;
 * отказ — текстом сервера под полем, розой.
 */
type Option = { value: string; label: string };

type Props = {
  label: string;
  value: string;
  /** Как показать значение в покое; по умолчанию — само значение. */
  shown?: ReactNode;
  editable?: boolean;
  kind?: "text" | "phone" | "select";
  options?: Option[];
  placeholder?: string;
  onSave: (next: string) => Promise<unknown>;
  mono?: boolean;
};

export function EditLine({
  label,
  value,
  shown,
  editable = false,
  kind = "text",
  options = [],
  placeholder = "—",
  onSave,
  mono,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const field = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => {
      if (field.current) field.current.focus();
      else wrap.current?.querySelector<HTMLInputElement>("input")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  const commit = async (next: string) => {
    setEditing(false);
    if (next === value) return;
    setSending(true);
    setError("");
    try {
      await onSave(next);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не сохранилось");
      setDraft(value);
    } finally {
      setSending(false);
    }
  };

  const rest =
    shown ?? (value ? (kind === "phone" ? formatPhone(value) : (options.find((o) => o.value === value)?.label ?? value)) : "");
  // Пункт со значением "" — «пустое разрешено», его подпись — подсказка
  // («Без отдела»). В список он не идёт, в покое — приглушён, как любое
  // пустое (стандарт `ChoiceSelect`).
  const blank = kind === "select" ? options.find((o) => o.value === "") : undefined;
  const emptyText = blank?.label ?? placeholder;

  let control: ReactNode = null;
  if (editing) {
    const keys = (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDraft(value);
        setEditing(false);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void commit(draft);
      }
    };
    if (kind === "select") {
      control = (
        <ChoiceSelect
          ref={(el) => {
            field.current = el;
          }}
          className="input-field cab-input"
          value={draft}
          onChange={(next) => void commit(next)}
          onBlur={() => setEditing(false)}
          onKeyDown={keys}
          aria-label={label}
          placeholder={emptyText}
          clearable={Boolean(blank)}
        >
          {options
            .filter((option) => option.value !== "")
            .map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
        </ChoiceSelect>
      );
    } else if (kind === "phone") {
      control = (
        <span
          ref={wrap}
          className="cab-phone"
          onKeyDown={keys}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void commit(draft);
          }}
        >
          <PhoneInput value={phoneDigits(draft)} onChange={(digits) => setDraft(phoneValue(digits))} />
        </span>
      );
    } else {
      control = (
        <input
          ref={(el) => {
            field.current = el;
          }}
          className="input-field cab-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit(draft.trim())}
          onKeyDown={keys}
          aria-label={label}
        />
      );
    }
  }

  return (
    <div className="cab-line">
      <span className="cab-line-label">{label}</span>
      <span className="cab-line-value" data-sending={sending ? "true" : undefined}>
        {editing ? (
          control
        ) : editable ? (
          <button
            type="button"
            className={`cab-line-text ${mono ? "fin-mono" : ""}`}
            data-empty={rest ? undefined : "true"}
            onClick={() => setEditing(true)}
          >
            {rest || emptyText}
          </button>
        ) : (
          <span className={`cab-line-static ${mono ? "fin-mono" : ""}`} data-empty={rest ? undefined : "true"}>
            {rest || (blank ? emptyText : "—")}
          </span>
        )}
        <span className="cab-trace" aria-hidden="true" />
        {error ? (
          <span className="cab-line-error fin-fail" role="alert">
            {error}
          </span>
        ) : null}
      </span>
    </div>
  );
}
