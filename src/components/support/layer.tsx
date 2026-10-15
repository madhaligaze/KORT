"use client";

/**
 * Поддержка на странице: объявление дня, окно переписки и напоминание об
 * ответе. Монтируется рамой приложения один раз; значок в шапке -
 * `button.tsx`, он только открывает окно (`openSupport`).
 *
 * **Объявление** - при первом входе каждого нового дня (по часам человека, а
 * не сервера): день, когда оно показано, и «больше не показывать» хранит
 * сервер за учёткой. Вкладку оставили открытой на ночь - объявление встанет
 * утром, когда к ней вернутся.
 *
 * **Напоминание** - пока ответ поддержки не открыт, внизу по центру плита
 * «Поддержка ответила» с началом ответа и раз в 8 секунд стучит: ответ, где
 * поддержка просит подробностей, не должен утонуть в шуме рабочего экрана
 * (16.10.2026). Крестик прячет её до следующего ответа - значок в шапке
 * продолжает ждать.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { supportApi, type Me } from "@/components/finance/api";
import { CloseIcon } from "@/components/icons";
import { gsap, prefersReducedMotion, useGSAP } from "@/components/motion/gsap";
import { SupportChat } from "@/components/support/chat";
import { SupportNotice } from "@/components/support/notice";
import { closeSupport, openSupport, useSupportOpen, useSupportUnread } from "@/components/support/store";

/** Объявление - после входа сцены, а не поверх неё. */
const NOTICE_DELAY_MS = 1600;
const KNOCK_MS = 8000;

/** Сегодня по часам человека: «2026-10-16». */
function localDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function ReplyStrip({ preview, onOpen, onHide }: { preview: string; onOpen: () => void; onHide: () => void }) {
  const strip = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const node = strip.current;
      if (!node || prefersReducedMotion()) return;
      gsap.fromTo(node, { y: 32, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, ease: "expo.out", clearProps: "transform,opacity,visibility" });
      const knock = () => {
        if (document.visibilityState !== "visible") return;
        gsap.fromTo(node, { y: 0 }, { y: -5, duration: 0.14, ease: "power2.out", yoyo: true, repeat: 3, clearProps: "transform" });
      };
      const timer = window.setInterval(knock, KNOCK_MS);
      return () => window.clearInterval(timer);
    },
    { scope: strip },
  );
  if (typeof document === "undefined") return null;
  return createPortal(
    <div ref={strip} className="sup-strip" role="status" aria-live="polite">
      <button type="button" className="sup-strip-main" onClick={onOpen}>
        <span className="sup-strip-label">Поддержка ответила</span>
        <span className="sup-strip-text">{preview}</span>
        <span className="sup-strip-open">Открыть</span>
      </button>
      <button type="button" className="sup-strip-hide" onClick={onHide} aria-label="Скрыть до следующего ответа" title="Скрыть до следующего ответа">
        <CloseIcon size={15} />
      </button>
    </div>,
    document.body,
  );
}

export function SupportLayer({ me, onRefresh }: { me: Me; onRefresh: () => void }) {
  const open = useSupportOpen();
  const state = me.support;
  const unread = useSupportUnread(state);
  const [notice, setNotice] = useState(false);
  const [hidden, setHidden] = useState("");
  /** День, на который решение об объявлении уже принято в этой вкладке. */
  const decided = useRef("");
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const noticeOff = state?.notice_off ?? false;
  const noticeSeen = state?.notice_seen_on ?? null;
  const known = Boolean(state);
  useEffect(() => {
    if (!known) return;
    let timer = 0;
    const check = () => {
      const today = localDay();
      if (decided.current === today) return;
      if (noticeOff || noticeSeen === today) {
        decided.current = today;
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        decided.current = today;
        // Человек уже в переписке - объявление о ней лишнее; день засчитан.
        if (openRef.current) {
          void supportApi.notice({ seen_on: today }).catch(() => undefined);
          return;
        }
        setNotice(true);
      }, NOTICE_DELAY_MS);
    };
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [known, noticeOff, noticeSeen]);

  const finishNotice = useCallback(
    (off: boolean) => {
      setNotice(false);
      void supportApi
        .notice({ seen_on: localDay(), ...(off ? { off: true } : {}) })
        .then(onRefresh)
        .catch(() => undefined);
    },
    [onRefresh],
  );

  const reply = state?.last_reply ?? null;
  const strip = unread > 0 && !open && !notice && reply !== null && hidden !== reply.id;

  return (
    <>
      <SupportNotice
        open={notice}
        onClose={finishNotice}
        onWrite={(off) => {
          finishNotice(off);
          openSupport();
        }}
      />
      <SupportChat open={open} onClose={closeSupport} onState={() => onRefresh()} />
      {strip && reply ? (
        <ReplyStrip key={reply.id} preview={reply.preview} onOpen={openSupport} onHide={() => setHidden(reply.id)} />
      ) : null}
    </>
  );
}
