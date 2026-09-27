"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
} from "react";

import { EASE_CARVE, gsap, prefersReducedMotion, SplitText } from "./gsap";
import { holdStage, markStageClear, markStageCovered, onStageReleased, stageHeld } from "./stage-bus";

/**
 * Переход между разделами: занавес.
 *
 * Тёмное полотно въезжает снизу, на нём поднимается название раздела, куда
 * идём; под занавесом Next меняет страницу; занавес уходит вверх и открывает
 * новый экран, чей собственный вход стартует ровно в этот момент.
 *
 * Три правила, без которых переход становится ловушкой:
 *
 * 1. **Ссылка остаётся ссылкой.** Ctrl/Cmd-клик, средняя кнопка и «открыть в
 *    новой вкладке» работают как у обычной <a>: перехватывается только
 *    простой клик. Без JS это просто Link.
 * 2. **Занавес не может остаться опущенным.** Страница не пришла за восемь
 *    секунд (упал запрос, ошибка сборки) — занавес поднимается сам. Лучше
 *    старый экран, чем чёрный.
 * 3. **Поднимается только после того, как новая страница нарисована**: смена
 *    `pathname` плюс два кадра. Поднять раньше — человек увидит, как старый
 *    экран подменяется новым, то есть ровно то, что занавес должен скрыть.
 *    Тяжёлая страница (лист Univer) может попросить подождать ещё —
 *    `useStageHold`, но не дольше `HOLD_MS` после прихода.
 *
 * «Меньше движения» — обычная навигация, без занавеса.
 */

type Navigate = (href: string, label?: string) => void;

const StageContext = createContext<Navigate | null>(null);

const SAFETY_MS = 8000;
/** Сколько страница может держать занавес после прихода. */
const HOLD_MS = 3000;

type Flight = {
  from: string;
  split: SplitText | null;
  timer: number;
  holdTimer: number;
  holdExpired: boolean;
  pushed: boolean;
  covered: boolean;
  arrived: boolean;
  lifting: boolean;
};

export function StageTransitionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const curtainRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const flight = useRef<Flight | null>(null);

  const lift = useCallback(() => {
    const state = flight.current;
    const curtain = curtainRef.current;
    if (!state || !curtain || state.lifting) return;
    state.lifting = true;
    window.clearTimeout(state.timer);
    window.clearTimeout(state.holdTimer);

    gsap
      .timeline({
        onComplete: () => {
          state.split?.revert();
          gsap.set(curtain, { autoAlpha: 0, yPercent: 100 });
          flight.current = null;
        },
      })
      .to(state.split?.chars ?? [], { yPercent: -118, duration: 0.3, ease: "power3.in", stagger: 0.0065 })
      .to(curtain, { yPercent: -100, duration: 0.61, ease: EASE_CARVE }, "<0.05")
      // Вход новой страницы стартует, когда занавес открыл треть экрана: к
      // этому моменту уже видно, что там есть, и появление читается как
      // продолжение движения, а не как второе событие после первого.
      .add(markStageClear, "<0.2");
  }, []);

  const tryLift = useCallback(() => {
    const state = flight.current;
    if (!state?.covered || !state.arrived) return;
    if (stageHeld() && !state.holdExpired) {
      if (!state.holdTimer) {
        state.holdTimer = window.setTimeout(() => {
          state.holdExpired = true;
          lift();
        }, HOLD_MS);
      }
      return;
    }
    lift();
  }, [lift]);

  // Страница отпустила занавес — поднять, если он ждал только её.
  useEffect(() => onStageReleased(tryLift), [tryLift]);

  const navigate = useCallback<Navigate>(
    (href, label = "") => {
      if (flight.current) return;
      const target = href.split(/[?#]/)[0] || "/";
      const curtain = curtainRef.current;
      const labelEl = labelRef.current;
      if (target === pathname) return;
      if (!curtain || !labelEl || prefersReducedMotion()) {
        router.push(href);
        return;
      }

      router.prefetch(href);
      labelEl.textContent = label;
      const split = label ? SplitText.create(labelEl, { type: "words,chars", charsClass: "stage-char", mask: "chars" }) : null;

      const state: Flight = {
        from: pathname,
        split,
        timer: 0,
        holdTimer: 0,
        holdExpired: false,
        pushed: false,
        covered: false,
        arrived: false,
        lifting: false,
      };
      flight.current = state;
      markStageCovered();
      state.timer = window.setTimeout(() => {
        state.covered = true;
        state.arrived = true;
        lift();
      }, SAFETY_MS);

      gsap
        .timeline({
          onComplete: () => {
            state.covered = true;
            tryLift();
          },
        })
        .set(curtain, { autoAlpha: 1, y: 0, yPercent: 100 })
        .to(curtain, { yPercent: 0, duration: 0.54, ease: EASE_CARVE })
        .from(split?.chars ?? [], { yPercent: 118, duration: 0.56, ease: "expo.out", stagger: 0.014 }, "-=0.27")
        // Навигация уходит, пока буквы ещё поднимаются: страница успевает
        // собраться под занавесом, и ждать её после него почти не приходится.
        .add(() => {
          state.pushed = true;
          router.push(href);
        }, "-=0.38")
        // Пауза, чтобы название успели прочитать: без неё быстрая страница
        // поднимала занавес раньше, чем буквы вставали на место.
        .to({}, { duration: 0.1 });
    },
    [pathname, router, lift, tryLift],
  );

  useEffect(() => {
    const state = flight.current;
    if (!state || !state.pushed || pathname === state.from) return;
    state.arrived = true;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(tryLift);
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [pathname, tryLift]);

  return (
    <StageContext.Provider value={navigate}>
      {children}
      <div ref={curtainRef} className="stage-curtain" aria-hidden="true">
        <span ref={labelRef} className="stage-curtain-label" />
      </div>
    </StageContext.Provider>
  );
}

type StageLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  /** Что написать на занавесе — название раздела, куда ведёт ссылка. */
  label?: string;
};

/** Ссылка, которая переходит через занавес. Вне провайдера — обычный Link. */
export function StageLink({ href, label, onClick, target, ...rest }: StageLinkProps) {
  const navigate = useContext(StageContext);
  return (
    <Link
      href={href}
      target={target}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !navigate) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (target && target !== "_self") return;
        event.preventDefault();
        navigate(href, label);
      }}
    />
  );
}

/**
 * Не поднимать занавес, пока `active`: страница ещё собирается.
 *
 * Брать в компоненте, который приходит вместе со страницей, а не в ленивом
 * (`next/dynamic`): ленивый смонтируется, когда занавес уже пошёл вверх.
 * Эффект — макетный, чтобы просьба успела раньше, чем переход решит
 * поднимать. Без перехода (прямой заход по адресу) ничего не делает.
 */
export function useStageHold(active: boolean): void {
  useLayoutEffect(() => (active ? holdStage() : undefined), [active]);
}

/** Переход через занавес из кода — для кнопок, которые не ссылки. */
export function useStageNavigate(): Navigate {
  const navigate = useContext(StageContext);
  const router = useRouter();
  return useCallback<Navigate>(
    (href, label) => (navigate ? navigate(href, label) : router.push(href)),
    [navigate, router],
  );
}
