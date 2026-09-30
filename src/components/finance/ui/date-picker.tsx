"use client";

/**
 * Календарь под полем даты (30.09.2026: «чтоб не надо было печатать ни год,
 * ни месяц, ни день»).
 *
 * Открывается сам, когда поле получает фокус; день - одним щелчком. Далёкая
 * дата (договор 2021 года) - щелчок по «Сентябрь 2026» открывает месяцы,
 * второй - годы: два-три щелчка вместо листания по месяцу. Печать остаётся -
 * кто набирает «15.07.26», тому календарь не мешает, а только встаёт на
 * набранную дату. Клавиатура - из поля: стрелки двигают день (и сразу пишут
 * его в поле), PageUp/PageDown - месяц, с Shift - год, Enter - как у поля.
 *
 * Облик - по правилам «Сцены»: без скруглений и заливок; выбранный день -
 * рамкой и весом, сегодня - чертой под числом. Порталом в `body` и
 * `position: fixed`: карточка договора прокручивается своим телом и обрезала
 * бы календарь. Щелчок по календарю не уводит фокус из поля (`pointerdown`
 * без действия по умолчанию) - иначе поле потеряло бы фокус и записало
 * недонабранное.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { formatDay, parseDay } from "@/components/finance/format";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

type Day = { y: number; m: number; d: number };
type Mode = "days" | "months" | "years";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function isoOf(day: Day): string {
  return `${day.y}-${pad(day.m + 1)}-${pad(day.d)}`;
}

function dayOf(iso: string | null | undefined): Day | null {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return match ? { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) } : null;
}

function today(): Day {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
}

function shift(day: Day, days: number): Day {
  const next = new Date(day.y, day.m, day.d + days);
  return { y: next.getFullYear(), m: next.getMonth(), d: next.getDate() };
}

/** Тот же день через `months` месяцев; 31-е в коротком месяце - последнее число. */
function shiftMonths(day: Day, months: number): Day {
  const first = new Date(day.y, day.m + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return { y: first.getFullYear(), m: first.getMonth(), d: Math.min(day.d, last) };
}

function same(a: Day | null, b: Day | null): boolean {
  return Boolean(a && b && a.y === b.y && a.m === b.m && a.d === b.d);
}

/** 42 клетки (6 недель) месяца, неделя с понедельника. */
function grid(y: number, m: number): Day[] {
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => shift({ y, m, d: 1 }, index - lead));
}

type CalendarProps = {
  /** `id` для `aria-controls` у поля. */
  id?: string;
  /** Поле, под которым встаёт календарь. */
  anchor: RefObject<HTMLElement | null>;
  /** Выбранная дата (ISO) - рамкой. */
  value: string | null;
  /** Курсор клавиатуры (ISO): что стрелки уже набрали в поле. */
  cursor?: string | null;
  onPick: (iso: string) => void;
  onClear?: () => void;
  onClose: () => void;
};

export function DateCalendar({ id, anchor, value, cursor, onPick, onClear, onClose }: CalendarProps) {
  const selected = dayOf(value);
  const focus = dayOf(cursor ?? null) ?? selected ?? today();
  const [page, setPage] = useState<{ y: number; m: number }>({ y: focus.y, m: focus.m });
  const [mode, setMode] = useState<Mode>("days");
  const [place, setPlace] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const now = today();

  // Курсор ушёл в другой месяц (стрелки, набор) - страница за ним.
  const focusKey = `${focus.y}-${focus.m}`;
  const [shownFor, setShownFor] = useState(focusKey);
  if (shownFor !== focusKey) {
    setShownFor(focusKey);
    setPage({ y: focus.y, m: focus.m });
  }

  // Место - под полем, а если снизу не хватает окна - над ним; следом за
  // прокруткой карточки и сменой размера окна.
  useLayoutEffect(() => {
    const measure = () => {
      const host = anchor.current;
      const self = box.current;
      if (!host || !self) return;
      const rect = host.getBoundingClientRect();
      const width = self.offsetWidth;
      const height = self.offsetHeight;
      const room = window.innerHeight - rect.bottom;
      const above = room < height + 12 && rect.top > room;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      setPlace({ left, top: above ? rect.top - height - 6 : rect.bottom + 6, above });
    };
    measure();
    let frame = 0;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", again);
      window.removeEventListener("scroll", again, true);
    };
  }, [anchor, mode, page]);

  // Щелчок мимо поля и календаря - закрыть.
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (box.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [anchor, onClose]);

  if (typeof document === "undefined") return null;

  const title =
    mode === "days" ? `${MONTHS[page.m]} ${page.y}` : mode === "months" ? String(page.y) : `${page.y - (page.y % 12)} - ${page.y - (page.y % 12) + 11}`;
  const step = (direction: 1 | -1) => {
    if (mode === "days") {
      const next = new Date(page.y, page.m + direction, 1);
      setPage({ y: next.getFullYear(), m: next.getMonth() });
    } else {
      setPage({ y: page.y + direction * (mode === "months" ? 1 : 12), m: page.m });
    }
  };
  const stepLabel = mode === "days" ? "месяц" : mode === "months" ? "год" : "12 лет";

  return createPortal(
    <div
      ref={box}
      id={id}
      className="dp"
      role="dialog"
      aria-label="Календарь"
      data-above={place?.above ? "true" : undefined}
      style={{ left: place?.left ?? -9999, top: place?.top ?? -9999 }}
      onPointerDown={(event) => event.preventDefault()}
    >
      <div className="dp-head">
        <button type="button" className="dp-nav" aria-label={`Предыдущий ${stepLabel}`} onClick={() => step(-1)}>
          ‹
        </button>
        <button
          type="button"
          className="dp-title"
          title={mode === "days" ? "Выбрать месяц" : mode === "months" ? "Выбрать год" : undefined}
          onClick={() => setMode(mode === "days" ? "months" : "years")}
          disabled={mode === "years"}
        >
          {title}
        </button>
        <button type="button" className="dp-nav" aria-label={`Следующий ${stepLabel}`} onClick={() => step(1)}>
          ›
        </button>
      </div>

      {mode === "days" ? (
        <div className="dp-days" role="grid">
          {WEEKDAYS.map((name, index) => (
            <span key={name} className="dp-wd" data-weekend={index > 4 ? "true" : undefined}>
              {name}
            </span>
          ))}
          {grid(page.y, page.m).map((day) => (
            <button
              key={isoOf(day)}
              type="button"
              className="dp-day"
              data-out={day.m !== page.m ? "true" : undefined}
              data-today={same(day, now) ? "true" : undefined}
              data-on={same(day, selected) ? "true" : undefined}
              data-cursor={cursor && same(day, dayOf(cursor)) ? "true" : undefined}
              aria-label={formatDay(isoOf(day))}
              aria-pressed={same(day, selected)}
              onClick={() => onPick(isoOf(day))}
            >
              {day.d}
            </button>
          ))}
        </div>
      ) : mode === "months" ? (
        <div className="dp-cells">
          {MONTHS_SHORT.map((name, index) => (
            <button
              key={name}
              type="button"
              className="dp-cell"
              data-on={selected && selected.y === page.y && selected.m === index ? "true" : undefined}
              data-today={now.y === page.y && now.m === index ? "true" : undefined}
              onClick={() => {
                setPage({ y: page.y, m: index });
                setMode("days");
              }}
            >
              {name}
            </button>
          ))}
        </div>
      ) : (
        <div className="dp-cells">
          {Array.from({ length: 12 }, (_, index) => page.y - (page.y % 12) + index).map((year) => (
            <button
              key={year}
              type="button"
              className="dp-cell"
              data-on={selected?.y === year ? "true" : undefined}
              data-today={now.y === year ? "true" : undefined}
              onClick={() => {
                setPage({ y: year, m: page.m });
                setMode("months");
              }}
            >
              {year}
            </button>
          ))}
        </div>
      )}

      <div className="dp-foot">
        <button type="button" className="fin-link-btn" onClick={() => onPick(isoOf(now))}>
          Сегодня
        </button>
        {onClear && value ? (
          <button type="button" className="fin-link-btn" onClick={onClear}>
            Очистить
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Клавиши календаря из поля ввода: стрелки - день, PageUp/PageDown - месяц
 * (с Shift - год). Возвращает новую дату для поля или `null`, если клавиша не
 * календарная - тогда её обрабатывает поле.
 */
export function calendarKey(event: { key: string; shiftKey: boolean }, text: string, fallback: string | null): string | null {
  const base = dayOf(parseDay(text) ?? fallback) ?? today();
  switch (event.key) {
    case "ArrowLeft":
      return isoOf(shift(base, -1));
    case "ArrowRight":
      return isoOf(shift(base, 1));
    case "ArrowUp":
      return isoOf(shift(base, -7));
    case "ArrowDown":
      return isoOf(shift(base, 7));
    case "PageUp":
      return isoOf(shiftMonths(base, event.shiftKey ? -12 : -1));
    case "PageDown":
      return isoOf(shiftMonths(base, event.shiftKey ? 12 : 1));
    default:
      return null;
  }
}

/**
 * Поле даты с календарём для форм, где дата - часть большей записи
 * («Изменение с …», дата соглашения при разборе): значение - текст
 * «дд.мм.гггг», как у простого поля, выбор в календаре его заполняет.
 */
export function DateInput({
  value,
  onChange,
  onEnter,
  inputRef,
  className,
  style,
  ariaLabel,
  autoFocus,
}: {
  value: string;
  onChange: (text: string) => void;
  onEnter?: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel: string;
  autoFocus?: boolean;
}) {
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? own;
  const [open, setOpen] = useState(false);
  const calendarId = useId();
  const iso = parseDay(value);
  return (
    <>
      <input
        ref={ref}
        className={className}
        style={style}
        value={value}
        placeholder="дд.мм.гггг"
        inputMode="numeric"
        aria-label={ariaLabel}
        role="combobox"
        aria-controls={calendarId}
        aria-haspopup="dialog"
        aria-expanded={open}
        autoFocus={autoFocus}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            return;
          }
          const next = calendarKey(event, value, null);
          if (next) {
            event.preventDefault();
            setOpen(true);
            onChange(formatDay(next));
            return;
          }
          if (event.key === "Enter" && onEnter) {
            event.preventDefault();
            setOpen(false);
            onEnter();
          }
        }}
      />
      {open ? (
        <DateCalendar
          id={calendarId}
          anchor={ref}
          value={iso}
          cursor={iso}
          onPick={(picked) => {
            onChange(formatDay(picked));
            setOpen(false);
          }}
          onClear={() => onChange("")}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
