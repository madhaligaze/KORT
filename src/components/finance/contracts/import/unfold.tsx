"use client";

/**
 * «Раскрытие» из словаря движений: высота от старой к новой и прозрачность
 * содержимого, 0,28 с. Высоту твинит только этот контейнер — внутри протокола
 * нет листа Univer, поэтому высоту здесь можно.
 *
 * Свёрнутое содержимое размонтируется после движения, а не до: иначе пункт
 * схлопывался бы рывком, а движение шло бы по пустому месту.
 */
import { useRef, useState, type ReactNode } from "react";

import { gsap, prefersReducedMotion, useGSAP } from "@/components/motion/gsap";

export function Unfold({ open, id, children }: { open: boolean; id?: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  // Раскрыли — содержимое появляется в том же рендере, до движения.
  if (open && !mounted) setMounted(true);
  const box = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useGSAP(
    () => {
      const el = box.current;
      if (first.current) {
        // Раскрытый с порога пункт (первый ждущий решения) не раскрывается
        // заново: вход протокола уже рассказывает, что на экране.
        first.current = false;
        return;
      }
      if (!el) return;
      const quiet = prefersReducedMotion();
      if (open) {
        if (quiet) return;
        gsap.fromTo(
          el,
          { height: 0, opacity: 0, overflow: "hidden" },
          { height: "auto", opacity: 1, duration: 0.28, ease: "expo.out", overwrite: "auto", clearProps: "height,opacity,overflow" },
        );
      } else {
        gsap.to(el, {
          height: 0,
          opacity: 0,
          overflow: "hidden",
          duration: quiet ? 0 : 0.2,
          ease: "power2.in",
          overwrite: "auto",
          onComplete: () => setMounted(false),
        });
      }
    },
    { dependencies: [open] },
  );

  if (!mounted) return null;
  return (
    <div ref={box} id={id}>
      {children}
    </div>
  );
}
