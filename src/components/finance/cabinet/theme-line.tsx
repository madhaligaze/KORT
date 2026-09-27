"use client";

import { SelectLine } from "@/components/finance/ui/select-line";
import { type ThemeChoice, setChoice, useThemeChoice } from "@/components/theme-store";

/**
 * «Тема» в профиле: Светлая · Тёмная · Как в системе.
 *
 * Выбор хранится там же, где его пишет тумблер на входе (`theme-store.ts`),
 * поэтому они не расходятся. Только здесь можно вернуться к «как в системе»:
 * у тумблера два положения.
 */
export function ThemeLine() {
  const theme = useThemeChoice();
  return (
    <div className="cab-line">
      <span className="cab-line-label">Тема</span>
      <span className="cab-line-value">
        <SelectLine
          items={[
            { key: "light", label: "Светлая" },
            { key: "dark", label: "Тёмная" },
            { key: "system", label: "Как в системе" },
          ]}
          value={theme}
          onChange={(next) => setChoice(next as ThemeChoice)}
          role="radiogroup"
          label="Тема"
          size="sm"
          className="cab-level"
        />
      </span>
    </div>
  );
}
