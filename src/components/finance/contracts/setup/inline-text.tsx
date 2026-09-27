"use client";

/**
 * Подпись, которая правится на месте: в покое — текст, по клику — поле.
 *
 * То же поведение, что у поля карточки: Enter или уход фокуса сохраняет, Esc
 * возвращает прежнее, кнопки «Сохранить» нет. Пока запрос в полёте, стоит уже
 * новое значение, под ним прочерчивается линия; отказ — текст сервера под
 * полем, розой.
 */
import { useState } from "react";

import type { TraceState } from "@/components/finance/contracts/setup/use-setup-action";

type Props = {
  value: string;
  onCommit: (next: string) => void;
  label: string;
  placeholder?: string;
  trace?: TraceState;
  error?: string;
  mono?: boolean;
  allowEmpty?: boolean;
  disabled?: boolean;
  strong?: boolean;
  inputMode?: "text" | "numeric";
  maxLength?: number;
};

export function InlineText({
  value,
  onCommit,
  label,
  placeholder = "—",
  trace,
  error,
  mono,
  allowEmpty,
  disabled,
  strong,
  inputMode,
  maxLength,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [committed, setCommitted] = useState<string | null>(null);

  const shown = trace === "sending" && committed !== null ? committed : value;

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next === value.trim()) return;
    if (!next && !allowEmpty) return;
    setCommitted(next);
    onCommit(next);
  };

  return (
    <span className="setup-inline" data-mono={mono ? "true" : undefined} data-strong={strong ? "true" : undefined}>
      {editing ? (
        <input
          className="setup-inline-input"
          value={draft}
          aria-label={label}
          autoFocus
          inputMode={inputMode}
          maxLength={maxLength}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setDraft(value);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button
          type="button"
          className="setup-inline-value"
          data-empty={shown ? undefined : "true"}
          data-pending={trace === "sending" ? "true" : undefined}
          aria-label={`${label}: ${shown || "пусто"}`}
          disabled={disabled}
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
        >
          {shown || placeholder}
        </button>
      )}
      <span className="ifield-trace" data-state={trace} aria-hidden="true" />
      {error ? (
        <span className="setup-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
