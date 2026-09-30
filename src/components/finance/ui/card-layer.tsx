"use client";

/**
 * Вторая плита - карточка записи по центру окна.
 *
 * Не шторка справа: глаз не должен весь день уходить к правому краю за
 * главным, что сейчас на экране (фронт-план, правки после Claude Design).
 *
 * * модальная: затемнение, щелчок по нему закрывает, Esc закрывает, фокус
 *   заперт - и над списком, и над листом;
 * * на телефоне - во весь экран.
 *
 * Над листом до 29.09.2026 карточка стояла внизу без затемнения, чтобы
 * правимая строка оставалась видна. На окне 1280×590 она закрывала почти весь
 * лист, а закрыть её можно было только крестиком - щелчок мимо уходил в лист.
 *
 * Рендерится порталом в `document.body`: карточка не должна стать предком
 * листа Univer (transform на предке ломает `position: fixed` и замеры холста).
 * Появление - сдвиг на 28px и прозрачность, без масштаба: «вырастание из
 * точки» - дефолт модальных окон, а не движение «Сцены».
 */
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { gsap, prefersReducedMotion, useGSAP } from "@/components/motion/gsap";
import { lockScroll } from "@/components/use-scroll-lock";

type Props = {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
};

export function CardLayer({ open, onClose, label, children }: Props) {
  const sheet = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<Element | null>(null);
  // Закрытие - по ссылке, а не зависимостью эффекта. Раздел передаёт
  // `onClose` новой стрелкой на каждой перерисовке, и эффект снимался и
  // ставился заново при открытой карточке - а снимаясь, возвращал фокус туда,
  // где тот был до открытия. Над листом это редактор ячейки Univer: до
  // 30.09.2026 опрос реестра перерисовывал раздел, и доля, которую набирали в
  // карточке, теряла фокус после первой-второй цифры.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key === "Tab" && sheet.current) {
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
    // Общим замком: `overflow: hidden` на body страницу не держал (у `html`
    // стоит `overflow-x: clip`), и на телефоне список под карточкой ехал.
    const unlock = lockScroll();
    return () => {
      window.removeEventListener("keydown", onKey);
      unlock();
      const back = returnFocus.current;
      if (back instanceof HTMLElement && document.contains(back)) back.focus({ preventScroll: true });
    };
  }, [open]);

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
      <div ref={scrim} className="card-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={sheet} className="card-sheet" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </>,
    document.body,
  );
}
