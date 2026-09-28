"use client";

import { setChoice, useTheme } from "@/components/theme-store";

/**
 * Тумблер темы: солнце и луна, под выбранной — черта. Один и тот же на входе
 * и в шапке приложения; цвета берёт у места (`--sw-on` / `--sw-off`).
 *
 * По умолчанию стоит тема системы — тумблер просто показывает её, пока его не
 * тронули; первое нажатие запоминает выбор.
 *
 * Черта переезжает «каплей»: передний край уходит первым, задний догоняет
 * (`.theme-switch-knob` в globals.css), — поэтому на полпути она тянется под
 * обеими иконками. Солнце на уходе поворачивает лучи, луна — рог.
 */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  const theme = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Тёмная тема"
      title={dark ? "Светлая тема" : "Тёмная тема"}
      className={`theme-switch ${className}`}
      data-on={theme}
      onClick={() => setChoice(dark ? "light" : "dark")}
    >
      <span className="theme-switch-knob" aria-hidden="true" />
      <svg className="theme-switch-icon theme-switch-sun" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4.2" />
        <g className="theme-switch-rays">
          <path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.28 5.28l1.84 1.84M16.88 16.88l1.84 1.84M5.28 18.72l1.84-1.84M16.88 7.12l1.84-1.84" />
        </g>
      </svg>
      <svg className="theme-switch-icon theme-switch-moon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.2 14.6A8.4 8.4 0 0 1 9.4 3.8a8.4 8.4 0 1 0 10.8 10.8Z" />
      </svg>
    </button>
  );
}
