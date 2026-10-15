"use client";

/**
 * Объявление о поддержке - при первом входе каждого нового дня, по центру,
 * с затемнением (16.10.2026). «Больше не показывать» - навсегда для учётки:
 * хранится на сервере (`support_threads.notice_off`), а не в браузере, и с
 * другого компьютера объявление тоже не всплывёт.
 *
 * Сцена - та же, что у входа и портрета кабинета: дым сверху полосой, под
 * ним заголовок поднимается словами, текст - строками, а «Написать» и
 * галочка проявляются последними. Закрывается щелчком мимо и Esc, как любое
 * окно продукта; галочка, поставленная перед этим, сохраняется и тогда.
 */
import { useRef, useState } from "react";

import { KortWordmark } from "@/components/brand/kort-wordmark";
import { CardLayer } from "@/components/finance/ui/card-layer";
import { CloseIcon } from "@/components/icons";
import { gsap, prefersReducedMotion, useGSAP } from "@/components/motion/gsap";
import { LiquidStage } from "@/components/motion/liquid-stage";
import { SplitReveal } from "@/components/motion/split-reveal";

export function SupportNotice({
  open,
  onClose,
  onWrite,
}: {
  open: boolean;
  /** Закрыли (щелчком мимо, Esc, крестиком); `off` - стояла ли галочка. */
  onClose: (off: boolean) => void;
  onWrite: (off: boolean) => void;
}) {
  const [off, setOff] = useState(false);
  return (
    <CardLayer open={open} onClose={() => onClose(off)} label="KORT в активной разработке" className="sup-notice">
      <NoticeBody off={off} setOff={setOff} onClose={() => onClose(off)} onWrite={() => onWrite(off)} />
    </CardLayer>
  );
}

function NoticeBody({
  off,
  setOff,
  onClose,
  onWrite,
}: {
  off: boolean;
  setOff: (next: boolean) => void;
  onClose: () => void;
  onWrite: () => void;
}) {
  const foot = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const node = foot.current;
      if (!node || prefersReducedMotion()) return;
      gsap.fromTo(
        node.children,
        { autoAlpha: 0, y: 14 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.8,
          ease: "expo.out",
          delay: 0.75,
          stagger: 0.08,
          clearProps: "transform,opacity,visibility",
        },
      );
    },
    { scope: foot },
  );
  return (
    <>
      <div className="sup-notice-stage">
        <LiquidStage className="sup-notice-liquid" intensity={0.6} delay={0.1} />
        <div className="sup-notice-veil" aria-hidden="true" />
        <div className="sup-notice-top">
          <KortWordmark className="sup-notice-mark" aria-hidden="true" />
          <button type="button" className="sup-notice-close" onClick={onClose} aria-label="Закрыть" title="Закрыть">
            <CloseIcon size={18} />
          </button>
        </div>
      </div>
      <div className="sup-notice-body">
        <SplitReveal as="h2" className="sup-notice-title" by="words" duration={1}>
          KORT в активной разработке
        </SplitReveal>
        <SplitReveal as="p" className="sup-notice-text" by="lines" delay={0.2} duration={1}>
          Мы продолжаем добавлять возможности и исправлять ошибки. Если что-то работает не так, как вы ждёте, или
          не хватает нужной функции, напишите в поддержку: текстом, скриншотом или голосом. Каждое обращение читает
          команда разработки, а ответ придёт сюда же, в KORT.
        </SplitReveal>
      </div>
      <div ref={foot} className="sup-notice-foot">
        <button type="button" className="btn-primary sup-notice-go" onClick={onWrite}>
          Написать
        </button>
        <label className="sup-notice-check">
          <input type="checkbox" checked={off} onChange={(event) => setOff(event.target.checked)} />
          <span>Больше не показывать</span>
        </label>
      </div>
    </>
  );
}
