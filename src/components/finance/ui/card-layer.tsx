"use client";

/**
 * Вторая плита — карточка записи по центру окна.
 *
 * Не шторка справа: глаз не должен весь день уходить к правому краю за
 * главным, что сейчас на экране (фронт-план, правки после Claude Design).
 *
 * * над списком — модальная: затемнение, клик по нему закрывает, фокус заперт;
 * * над листом (`dock="bottom"`) — немодальная, внизу по центру: строка
 *   договора в листе остаётся видна, печатаешь в ячейке — карточка меняется;
 * * на телефоне — во весь экран.
 *
 * Рендерится порталом в `document.body`: карточка не должна стать предком
 * листа Univer (transform на предке ломает `position: fixed` и замеры холста).
 * Появление — сдвиг на 28px и прозрачность, без масштаба: «вырастание из
 * точки» — дефолт модальных окон, а не движение «Сцены».
 */
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { gsap, prefersReducedMotion, useGSAP } from "@/components/motion/gsap";
import { lockScroll } from "@/components/use-scroll-lock";

type Props = {
  open: boolean;
  onClose: () => void;
  dock?: "center" | "bottom";
  label: string;
  children: ReactNode;
};

export function CardLayer({ open, onClose, dock = "center", label, children }: Props) {
  const sheet = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const modal = dock === "center";

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
      if (event.key === "Tab" && modal && sheet.current) {
        const focusable = sheet.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const narrow = window.matchMedia("(max-width: 639px)").matches;
    // Общим замком: `overflow: hidden` на body страницу не держал (у `html`
    // стоит `overflow-x: clip`), и на телефоне список под карточкой ехал.
    const unlock = modal || narrow ? lockScroll() : null;
    return () => {
      window.removeEventListener("keydown", onKey);
      unlock?.();
      const back = returnFocus.current;
      if (back instanceof HTMLElement && document.contains(back)) back.focus({ preventScroll: true });
    };
  }, [open, onClose, modal]);

  useGSAP(
    () => {
      if (!open || !sheet.current || prefersReducedMotion()) return;
      const narrow = window.matchMedia("(max-width: 639px)").matches;
      gsap.fromTo(
        sheet.current,
        narrow ? { yPercent: 100 } : { y: 28, autoAlpha: 0 },
        {
          ...(narrow ? { yPercent: 0 } : { y: 0, autoAlpha: 1 }),
          duration: 0.52,
          ease: "expo.out",
          clearProps: "transform,opacity,visibility",
        },
      );
      if (scrim.current) {
        gsap.fromTo(scrim.current, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3, clearProps: "opacity,visibility" });
      }
    },
    { dependencies: [open] },
  );

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <>
      {modal ? <div ref={scrim} className="card-scrim" onClick={onClose} aria-hidden="true" /> : null}
      <div
        ref={sheet}
        className="card-sheet"
        data-dock={dock}
        role="dialog"
        aria-modal={modal ? "true" : "false"}
        aria-label={label}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
