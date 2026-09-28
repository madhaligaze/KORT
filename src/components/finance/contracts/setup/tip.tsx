"use client";

/**
 * Подсказка при наведении — как у Windows на файле или папке (28.09.2026:
 * «когда наводишь курсором на функцию или кнопку — за что она отвечает»).
 *
 * Не дежурная подпись: на экране её нет, пока человек не задержал курсор на
 * элементе (полсекунды) или не пришёл на него с клавиатуры. Текст — у самого
 * элемента, атрибутом `data-tip` (и `data-tip-title` — заголовок), поэтому
 * подсказку получает любая кнопка экрана без обёрток. Слой один на экран:
 * слушает наведение внутри корня и ищет ближайший `[data-tip]`.
 *
 * Уходит сразу — мышь ушла, щелчок, прокрутка, Esc: подсказка не должна
 * закрывать то, что человек собрался нажать.
 */
import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

type Shown = { title: string; text: string; left: number; top: number; above: boolean };

const DELAY = 550;
const WIDTH = 300;

export function tip(text: string, title?: string): { "data-tip": string; "data-tip-title"?: string } {
  return title ? { "data-tip": text, "data-tip-title": title } : { "data-tip": text };
}

export function TipLayer({ root }: { root: RefObject<HTMLElement | null> }) {
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let timer = 0;
    let current: HTMLElement | null = null;
    const find = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null;
    const show = (element: HTMLElement) => {
      if (!element.isConnected) return;
      const rect = element.getBoundingClientRect();
      const above = rect.bottom + 140 > window.innerHeight;
      const left = Math.max(8, Math.min(rect.left, document.documentElement.clientWidth - WIDTH - 8));
      setShown({
        title: element.dataset.tipTitle ?? "",
        text: element.dataset.tip ?? "",
        left: Math.round(left),
        top: Math.round(above ? rect.top - 6 : rect.bottom + 6),
        above,
      });
    };
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setShown(null);
    };
    const aim = (element: HTMLElement | null, delay: number) => {
      if (element === current) return;
      window.clearTimeout(timer);
      setShown(null);
      current = element;
      if (element) timer = window.setTimeout(() => show(element), delay);
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      aim(find(event.target), DELAY);
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches?.(":focus-visible")) aim(find(target), 250);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    host.addEventListener("pointerover", onOver);
    host.addEventListener("pointerleave", hide);
    host.addEventListener("pointerdown", hide);
    host.addEventListener("focusin", onFocus);
    host.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      host.removeEventListener("pointerover", onOver);
      host.removeEventListener("pointerleave", hide);
      host.removeEventListener("pointerdown", hide);
      host.removeEventListener("focusin", onFocus);
      host.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [root]);

  if (!shown || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="setup-tip"
      role="tooltip"
      style={{ left: shown.left, top: shown.top, transform: shown.above ? "translateY(-100%)" : undefined }}
    >
      {shown.title ? <strong className="setup-tip-title">{shown.title}</strong> : null}
      <span>{shown.text}</span>
    </div>,
    document.body,
  );
}
