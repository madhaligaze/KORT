"use client";

/**
 * Маленькие всплывающие списки настройки: один выбор и несколько отметок.
 *
 * Не нативный `<select>`: его выпадающий список рисует система, и на тёмной
 * плите он белый (полупрозрачный `--input-bg` система не понимает), а шрифт у
 * него чужой. Здесь список — слой `.fin-pop`, как у меню «⋯».
 *
 * Слой рендерится порталом с `position: fixed` по координатам кнопки: фраза
 * правила переносится на узком экране, и абсолютный слой внутри строки уехал
 * бы за край или обрезался бы родителем с `overflow`. Позиция ставится прямо
 * в стиль, без состояния React: пересчёт на прокрутке не должен перерисовывать
 * список.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import { CloseIcon } from "@/components/icons";

type FloatingProps = {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  role?: "listbox" | "dialog" | "menu";
  label: string;
  minWidth?: number;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  activeId?: string;
  focusSelf?: boolean;
};

export function Floating({ anchor, onClose, children, role = "dialog", label, minWidth = 208, onKeyDown, activeId, focusSelf }: FloatingProps) {
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const place = () => {
      const host = anchor.current;
      const box = panel.current;
      if (!host || !box) return;
      const rect = host.getBoundingClientRect();
      const viewW = document.documentElement.clientWidth;
      const viewH = window.innerHeight;
      const width = box.offsetWidth;
      const below = viewH - rect.bottom - 12;
      const above = rect.top - 12;
      const height = Math.min(box.scrollHeight, 320);
      const left = Math.max(8, Math.min(rect.left - 6, viewW - width - 8));
      const up = height > below && above > below;
      const room = Math.max(140, Math.min(320, up ? above : below));
      box.style.left = `${left}px`;
      box.style.maxHeight = `${room}px`;
      box.style.top = up ? `${Math.max(8, rect.top - 4 - Math.min(height, room))}px` : `${rect.bottom + 4}px`;
      box.style.visibility = "visible";
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  // Обработчик закрытия меняется на каждой перерисовке родителя; подписки
  // держатся одни на всё время жизни слоя, иначе каждая отметка в списке
  // снимала и ставила бы их заново и уводила фокус с флажка.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (focusSelf) panel.current?.focus({ preventScroll: true });
  }, [focusSelf]);

  useEffect(() => {
    const host = anchor.current;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || host?.contains(target)) return;
      closeRef.current();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        // Esc закрывает список, а не карточку или диалог под ним.
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        host?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [anchor]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panel}
      className="fin-pop setup-pop"
      role={role}
      aria-label={label}
      aria-activedescendant={activeId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{ position: "fixed", top: 0, left: 0, minWidth, visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ── Один выбор ───────────────────────────────────────────────────────────────

export type PopOption = { value: string; label: string; hint?: string; fail?: boolean };

type ChoiceProps = {
  value: string | null | undefined;
  options: PopOption[];
  onPick: (value: string) => void;
  /** Что написано, пока ничего не выбрано. */
  empty?: string;
  /** Текст кнопки, если он не совпадает с подписью выбранного. */
  text?: ReactNode;
  label: string;
  disabled?: boolean;
  fail?: boolean;
  className?: string;
  autoOpen?: boolean;
  onClosed?: () => void;
};

export function ChoicePop({
  value,
  options,
  onPick,
  empty = "—",
  text,
  label,
  disabled,
  fail,
  className,
  autoOpen = false,
  onClosed,
}: ChoiceProps) {
  // Пункт со значением "" — «пустое разрешено», а не значение: в список он не
  // идёт (стандарт `ChoiceSelect`), его подпись — то, что написано, пока
  // ничего не выбрано, а вернуться к пустому — крестиком у кнопки. До 27.09
  // «—» и «не назначен» стояли в списке наравне с фазами и отделами.
  const blank = options.find((item) => item.value === "");
  const choices = blank ? options.filter((item) => item.value !== "") : options;
  const none = !value;
  const emptyText = blank && blank.label !== "—" ? blank.label : empty;
  const [open, setOpen] = useState(autoOpen);
  const [active, setActive] = useState(() => Math.max(0, choices.findIndex((item) => item.value === value)));
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const current = none ? undefined : choices.find((item) => item.value === value);

  // Стрелками по длинному списку (сорок предметов) выбранная строка не должна
  // уходить за край слоя.
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  const close = () => {
    setOpen(false);
    onClosed?.();
  };
  const pick = (index: number) => {
    const option = choices[index];
    close();
    button.current?.focus({ preventScroll: true });
    if (option && option.value !== value) onPick(option.value);
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(choices.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(active);
    } else if (event.key === "Tab") {
      close();
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`fin-link-btn ${className ?? ""}`}
        data-fail={fail || current?.fail || (none && blank?.fail) ? "true" : undefined}
        data-empty={!current && text === undefined ? "true" : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        // Кнопка «+ условие» ничего не выбрала — её имя не должно кончаться «: —».
        aria-label={current ? `${label}: ${current.label}` : text !== undefined ? label : `${label}: ${emptyText}`}
        disabled={disabled}
        onClick={() => {
          setActive(Math.max(0, choices.findIndex((item) => item.value === value)));
          if (open) close();
          else setOpen(true);
        }}
      >
        {text ?? current?.label ?? emptyText}
      </button>
      {blank && current && !disabled ? (
        <button
          type="button"
          className="choice-clear choice-clear-inline"
          aria-label={`Очистить: ${label}`}
          title="Очистить"
          onClick={() => {
            close();
            onPick("");
          }}
        >
          <CloseIcon size={12} />
        </button>
      ) : null}
      {open ? (
        <Floating
          anchor={button}
          onClose={close}
          role="listbox"
          label={label}
          onKeyDown={onKey}
          activeId={`${id}-${active}`}
          focusSelf
        >
          {choices.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-${index}`}
              role="option"
              aria-selected={option.value === value}
              className="fin-pop-item setup-pop-item"
              data-active={index === active ? "true" : undefined}
              data-current={option.value === value ? "true" : undefined}
              data-danger={option.fail ? "true" : undefined}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(index)}
            >
              <span>{option.label}</span>
              {option.hint ? <span className="fin-pop-hint fin-muted">{option.hint}</span> : null}
            </div>
          ))}
        </Floating>
      ) : null}
    </>
  );
}

// ── Несколько отметок ────────────────────────────────────────────────────────

type MultiProps = {
  values: string[];
  options: PopOption[];
  onChange: (values: string[]) => void;
  label: string;
  text: ReactNode;
  /** Поиск появляется сам, если вариантов больше десяти. */
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
  autoOpen?: boolean;
  onClosed?: () => void;
  fail?: boolean;
};

export function MultiPop({
  values,
  options,
  onChange,
  label,
  text,
  searchable,
  disabled,
  className,
  autoOpen = false,
  onClosed,
  fail,
}: MultiProps) {
  const [open, setOpen] = useState(autoOpen);
  const [query, setQuery] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const search = searchable ?? options.length > 10;
  const needle = query.trim().toLowerCase();
  const chosen = useMemo(() => new Set(values), [values]);
  // Отмеченные — наверху: их проверяют глазами первыми, и в списке из сорока
  // предметов отметка не должна теряться внизу.
  const shown = useMemo(() => {
    const list = needle
      ? options.filter((item) => item.label.toLowerCase().includes(needle) || (item.hint ?? "").toLowerCase().includes(needle))
      : options;
    return [...list.filter((item) => chosen.has(item.value)), ...list.filter((item) => !chosen.has(item.value))];
    // Порядок фиксируется при открытии: строка не должна прыгать вверх под
    // курсором в момент отметки.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, needle, open]);

  const close = () => {
    setOpen(false);
    setQuery("");
    onClosed?.();
  };
  const toggle = (value: string) => {
    onChange(chosen.has(value) ? values.filter((item) => item !== value) : [...values, value]);
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`fin-link-btn ${className ?? ""}`}
        data-fail={fail ? "true" : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {text}
      </button>
      {open ? (
        <Floating anchor={button} onClose={close} label={label} minWidth={260} focusSelf={!search}>
          {search ? (
            <input
              className="setup-pop-search"
              value={query}
              placeholder="Найти"
              aria-label={`${label}: поиск`}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : null}
          {shown.map((option) => (
            <label key={option.value} className="fin-pop-item setup-pop-check">
              <input type="checkbox" checked={chosen.has(option.value)} onChange={() => toggle(option.value)} />
              <span className="setup-pop-text">{option.label}</span>
              {option.hint ? <span className="fin-pop-hint fin-muted">{option.hint}</span> : null}
            </label>
          ))}
          {!shown.length ? <div className="fin-pop-group fin-muted">Ничего не нашлось</div> : null}
        </Floating>
      ) : null}
    </>
  );
}
