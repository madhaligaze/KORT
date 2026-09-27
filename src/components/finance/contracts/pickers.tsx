"use client";

/**
 * Выбор значения: сторона, значение списка, ответственные.
 *
 * Паттерн ARIA combobox: ↑/↓, Enter, Esc. Список подсказывает, а не
 * запрещает: новое значение — строка «+ Завести «ввод»» внизу. Похожая
 * сторона — вопрос «Это ТОО «Атриум плюс»?», молча не выбирается ничего
 * (правило «не угадывать»).
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { type Party, contractsApi } from "@/components/finance/api";

export type ComboOption = { id: string; label: string; hint?: string; group?: string };

type ComboProps = {
  options: ComboOption[];
  placeholder?: string;
  initial?: string;
  allowCreate?: boolean;
  createLabel?: (text: string) => string;
  /** Что сказать, когда напечатанного нет, а заводить новое нельзя. */
  emptyText?: string;
  onPick: (option: ComboOption) => void;
  onCreate?: (text: string) => void;
  onCancel: () => void;
  onQuery?: (text: string) => void;
  autoFocus?: boolean;
};

export function Combo({
  options,
  placeholder,
  initial = "",
  allowCreate = true,
  createLabel = (text) => `+ Завести «${text}»`,
  emptyText = "Ничего не нашлось",
  onPick,
  onCreate,
  onCancel,
  onQuery,
  autoFocus = true,
}: ComboProps) {
  const [query, setQuery] = useState(initial);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) onCancel();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onCancel]);

  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!needle) return options.slice(0, 60);
    return options
      .filter((item) => item.label.toLowerCase().includes(needle) || (item.hint ?? "").toLowerCase().includes(needle))
      .slice(0, 60);
  }, [options, needle]);
  const exact = shown.some((item) => item.label.trim().toLowerCase() === needle);
  const canCreate = allowCreate && !!needle && !exact && !!onCreate;
  const total = shown.length + (canCreate ? 1 : 0);

  const choose = (index: number) => {
    if (index < shown.length) onPick(shown[index]);
    else if (canCreate) onCreate?.(query.trim());
  };

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => Math.min(total - 1, value + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(0, value - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (total) choose(Math.min(active, total - 1));
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  let lastGroup = "";
  return (
    <div ref={root} style={{ position: "relative" }}>
      <input
        ref={input}
        className="ifield-input"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        value={query}
        placeholder={placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          onQuery?.(event.target.value);
        }}
        onKeyDown={onKey}
      />
      <div id={listId} className="fin-pop" role="listbox" style={{ top: "calc(100% + 4px)", left: "-0.5rem", right: "-0.5rem" }}>
        {shown.map((option, index) => {
          const head = option.group && option.group !== lastGroup ? option.group : "";
          lastGroup = option.group ?? lastGroup;
          return (
            <div key={option.id} role="presentation">
              {head ? <div className="fin-pop-group eyebrow">{head}</div> : null}
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className="fin-pop-item"
                data-active={index === active ? "true" : undefined}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {option.label}
                </span>
                {option.hint ? <span className="fin-pop-hint fin-mono">{option.hint}</span> : null}
              </button>
            </div>
          );
        })}
        {!shown.length && !canCreate ? <div className="fin-pop-group fin-muted">{emptyText}</div> : null}
        {canCreate ? (
          <button
            type="button"
            role="option"
            aria-selected={active === shown.length}
            className="fin-pop-item"
            data-active={active === shown.length ? "true" : undefined}
            onMouseEnter={() => setActive(shown.length)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(shown.length)}
            style={{ borderTop: shown.length ? "1px solid var(--fin-line)" : undefined }}
          >
            {createLabel(query.trim())}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ── Сторона ─────────────────────────────────────────────────────────────────

export type PartyChoice = { id: string } | { name: string };

type PartyPickerProps = {
  slot: "executor" | "customer";
  label: string;
  own: Party[];
  /** Поле закрыто на наши юрлица: контрагентов в выборе нет. */
  ownOnly?: boolean;
  /** Завести наше юрлицо прямо из выбора — только тому, кто настраивает реестр. */
  onCreateOwn?: (name: string) => void;
  onPick: (choice: PartyChoice) => void;
  onCancel: () => void;
};

/** Наши юрлица — первой группой в первом слоте, после контрагентов — во втором. */
export function PartyPicker({ slot, label, own, ownOnly = false, onCreateOwn, onPick, onCancel }: PartyPickerProps) {
  const [found, setFound] = useState<Party[]>([]);
  const [similar, setSimilar] = useState<{ name: string; candidates: Party[] } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (text: string) => {
    if (ownOnly) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const result = await contractsApi.parties.search(text, 30);
        setFound(result.parties.filter((party) => !party.own));
      } catch {
        setFound([]);
      }
    }, 150);
  };

  useEffect(() => {
    search("");
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const ownOptions: ComboOption[] = own.map((party) => ({
    id: party.id,
    label: party.name,
    hint: party.code && party.code !== party.name ? party.code : undefined,
    group: "Наши юрлица",
  }));
  const otherOptions: ComboOption[] = found.map((party) => ({
    id: party.id,
    label: party.name,
    hint: party.bin || undefined,
    group: "Контрагенты",
  }));
  const options = slot === "executor" ? [...ownOptions, ...otherOptions] : [...otherOptions, ...ownOptions];

  if (ownOnly) {
    return (
      <Combo
        options={ownOptions.map((option) => ({ ...option, group: undefined }))}
        placeholder={label}
        allowCreate={Boolean(onCreateOwn)}
        createLabel={(text) => `+ Завести «${text}» нашим юрлицом`}
        emptyText={
          own.length
            ? "Не наше юрлицо — здесь только наши"
            : "Наших юрлиц ещё нет — их заводят в настройке реестра"
        }
        onPick={(option) => onPick({ id: option.id })}
        onCreate={(text) => onCreateOwn?.(text)}
        onCancel={onCancel}
      />
    );
  }

  if (similar) {
    const first = similar.candidates[0];
    return (
      <div className="ifield-note" style={{ color: "var(--fin-text)" }}>
        Это {first.name}
        {first.bin ? <span className="fin-mono"> · {first.bin}</span> : null}?{" "}
        <button type="button" className="fin-link-btn" onClick={() => onPick({ id: first.id })}>
          Да, он
        </button>{" "}
        ·{" "}
        <button type="button" className="fin-link-btn" onClick={() => onPick({ name: similar.name })}>
          Нет, новый
        </button>{" "}
        ·{" "}
        <button type="button" className="fin-link-btn" onClick={onCancel}>
          Отмена
        </button>
      </div>
    );
  }

  return (
    <Combo
      options={options}
      placeholder={label}
      onQuery={search}
      onPick={(option) => onPick({ id: option.id })}
      onCreate={async (text) => {
        try {
          const result = await contractsApi.parties.similar(text);
          if (result.parties.length) {
            setSimilar({ name: text, candidates: result.parties });
            return;
          }
        } catch {
          /* без подсказки — заводим как написано */
        }
        onPick({ name: text });
      }}
      onCancel={onCancel}
    />
  );
}
