"use client";

/**
 * Окно предупреждения листа — перед изменением, которое меняет таблицу для
 * всех (29.09.2026).
 *
 * Пользователь: «не тупое предупреждение одно для всех, а каждое — что именно
 * изменится или сломается». Поэтому окно — только оболочка: заголовок,
 * последствия списком и действие дают разделы (`sheet-adapter.ts`,
 * `table-view.tsx`), по конкретной команде и конкретным строкам.
 *
 * Кнопки — по просьбе владельца: «Отмена» зелёной плитой (в фокусе, Enter и Esc
 * — отмена), «ОК» красной. Это единственное место, где зелёный в продукте не
 * про приход денег: здесь он значит «ничего не менять». Отказ (действие
 * человеку не открыто или невозможно) — одна кнопка «Понятно».
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SheetWarningSpec = {
  title: string;
  /** Что изменится — по строке на последствие. */
  lines: string[];
  /** Подпись красной кнопки; нет — окно-отказ с одной кнопкой «Понятно». */
  confirm?: string;
  onConfirm?: (input: string) => Promise<void> | void;
  /** Поле ввода (название новой колонки). */
  input?: { label: string; value: string; placeholder?: string };
  /** Другое, безопасное действие — ссылкой под последствиями («Скрыть только у меня»). */
  alt?: { label: string; run: () => Promise<void> | void };
  /** Отменили или закрыли — раздел возвращает лист как было. */
  onCancel?: () => void;
};

export function SheetWarning({ spec, onClose }: { spec: SheetWarningSpec | null; onClose: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState<SheetWarningSpec | null>(null);
  if (spec !== current) {
    // Новое окно — с чистого: значение поля, отказ, занятость.
    setCurrent(spec);
    setValue(spec?.input?.value ?? "");
    setBusy(false);
    setError("");
  }

  useEffect(() => {
    if (!spec) return;
    if (spec.input) inputRef.current?.select();
    else cancelRef.current?.focus();
  }, [spec]);

  useEffect(() => {
    if (!spec) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) {
          spec.onCancel?.();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [spec, busy, onClose]);

  if (!spec || typeof document === "undefined") return null;
  const cancel = () => {
    if (busy) return;
    spec.onCancel?.();
    onClose();
  };
  const run = async (action: () => Promise<void> | void) => {
    setBusy(true);
    setError("");
    try {
      await action();
      onClose();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не получилось");
      setBusy(false);
    }
  };
  const refusal = !spec.confirm || !spec.onConfirm;
  return createPortal(
    <>
      <div className="card-scrim" style={{ zIndex: "var(--z-fin-confirm)" as unknown as number }} onClick={cancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={spec.title}
        className="card-sheet sheet-warn"
        style={{ zIndex: "var(--z-fin-confirm)" as unknown as number }}
      >
        <p className="sheet-warn-title">{spec.title}</p>
        {spec.lines.length ? (
          <ul className="sheet-warn-lines">
            {spec.lines.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ul>
        ) : null}
        {spec.input ? (
          <label className="sheet-warn-input">
            <span>{spec.input.label}</span>
            <input
              ref={inputRef}
              value={value}
              placeholder={spec.input.placeholder}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && value.trim() && spec.onConfirm) void run(() => spec.onConfirm?.(value.trim()));
              }}
            />
          </label>
        ) : null}
        {spec.alt ? (
          <p className="sheet-warn-alt">
            <button type="button" className="fin-link-btn" disabled={busy} onClick={() => void run(() => spec.alt?.run())}>
              {spec.alt.label}
            </button>
          </p>
        ) : null}
        {error ? <p className="sheet-warn-error">{error}</p> : null}
        <div className="sheet-warn-actions">
          <button ref={cancelRef} type="button" className="sheet-warn-cancel" onClick={cancel} disabled={busy}>
            {refusal ? "Понятно" : "Отмена"}
          </button>
          {!refusal ? (
            <button
              type="button"
              className="sheet-warn-ok"
              disabled={busy || (spec.input ? !value.trim() : false)}
              onClick={() => void run(() => spec.onConfirm?.(value.trim()))}
            >
              {busy ? "…" : spec.confirm}
            </button>
          ) : null}
        </div>
      </div>
    </>,
    document.body,
  );
}
