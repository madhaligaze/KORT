"use client";

/**
 * Строка «Вернуть» внизу экрана настройки (`setup/undo.ts`).
 *
 * Внизу по центру, немодально - там же, где карточка над листом: правка
 * могла быть сделана на любой вкладке и в любом месте длинного списка, а
 * строка у самого поля уехала бы с прокруткой. Говорит, что сделано, и
 * предлагает вернуть; Ctrl+Z - то же для тех, кто знает клавиши. Через
 * двадцать секунд строка уходит, но Ctrl+Z работает, пока экран открыт.
 */
import { useEffect, useRef, useState } from "react";

import { useUndo } from "@/components/finance/contracts/setup/undo";
import { revertLast } from "@/components/finance/contracts/setup/use-setup-action";

const STAY_MS = 20_000;
const STAY_AFTER_MS = 6_000;

export function UndoLine() {
  const { stack, notice } = useUndo();
  const [hidden, setHidden] = useState(false);
  const over = useRef(false);

  useEffect(() => {
    if (!notice) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- новая правка снова показывает строку
    setHidden(false);
    if (notice.kind === "reverting" || notice.kind === "failed") return;
    const timer = window.setTimeout(
      () => {
        if (!over.current) setHidden(true);
      },
      notice.kind === "done" ? STAY_MS : STAY_AFTER_MS,
    );
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  const more = stack.length > 0;
  let text: string;
  let action: string | null = null;
  switch (notice.kind) {
    case "done":
      text = notice.entry.text;
      action = "Вернуть";
      break;
    case "reverting":
      text = `Возвращаем: ${notice.entry.text}`;
      break;
    case "reverted":
      text = `Вернули как было: ${notice.entry.text}`;
      action = more ? "Вернуть и предыдущее" : null;
      break;
    case "failed":
      text = `Не вернулось: ${notice.error}`;
      break;
  }

  return (
    <div
      className="setup-undo"
      role="status"
      aria-live="polite"
      data-hidden={hidden ? "true" : undefined}
      data-fail={notice.kind === "failed" ? "true" : undefined}
      onPointerEnter={() => {
        over.current = true;
      }}
      onPointerLeave={() => {
        over.current = false;
      }}
    >
      <span className="setup-undo-text">{text}</span>
      {action && more ? (
        <>
          <button
            type="button"
            className="btn-ghost btn-sm setup-undo-btn"
            onClick={() => void revertLast()}
          >
            {action}
          </button>
          <kbd className="setup-undo-key" title="Вернуть последнюю правку с клавиатуры">
            Ctrl+Z
          </kbd>
        </>
      ) : null}
    </div>
  );
}
