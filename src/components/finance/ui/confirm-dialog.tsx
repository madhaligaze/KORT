"use client";

/**
 * Подтверждение опасного действия вместо `window.confirm`.
 *
 * Свой шрифт, кнопки в нашем порядке (опасная — справа), Esc отменяет, фокус
 * заперт внутри. Держится на том же слое карточки, только уже и выше.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

type Props = {
  open: boolean;
  title: string;
  text?: string;
  confirm: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ open, title, text, confirm, danger, busy, onConfirm, onCancel }: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onCancel]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="card-scrim" style={{ zIndex: "var(--z-fin-confirm)" as unknown as number }} onClick={onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="card-sheet"
        style={{ zIndex: "var(--z-fin-confirm)" as unknown as number, width: "min(440px, calc(100vw - 32px))", maxHeight: "none", padding: "1.5rem" }}
      >
        <p style={{ margin: 0, fontSize: "1.125rem", fontWeight: 500 }}>{title}</p>
        {text ? <p style={{ margin: "0.5rem 0 0", fontSize: "0.875rem", color: "var(--fin-text-soft)" }}>{text}</p> : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.5rem" }}>
          <button ref={cancelRef} type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={busy}
            style={danger ? { background: "var(--fin-fail)", color: "#fff" } : undefined}
          >
            {confirm}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
