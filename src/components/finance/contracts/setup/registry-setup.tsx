"use client";

/**
 * «Настроить реестр» - шаблон реестра, который правит администратор
 * (фронт-план 6.6, сценарий 6 плана): поля, списки со смыслом, листы с
 * блоками и наши юрлица.
 *
 * Экран ничего не держит у себя: каждая правка уходит на сервер, после ответа
 * схема перечитывается в общем хранилище реестра, и лист, карточка и разбор
 * видят новое сразу - без отдельной синхронизации между экранами.
 *
 * Открыт только владельцу и администратору: сервер отвечает отказом всем
 * остальным (`_require_setup`), а экран не делает вид, что можно.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

// Правила экрана лежат рядом с ним (префикс `setup-`), а не в globals.css:
// общий файл сейчас правят параллельно. Перенос туда - дословно, с удалением
// этого импорта.
import "@/components/finance/contracts/setup/setup.css";

import { ArrowLeftIcon } from "@/components/icons";
import { boot, holdLive, useRegistry } from "@/components/finance/contracts/store";
import { gsap, prefersReducedMotion } from "@/components/motion/gsap";
import { EntitiesTab } from "@/components/finance/contracts/setup/entities-tab";
import { FieldsTab } from "@/components/finance/contracts/setup/fields-tab";
import { SummaryTab } from "@/components/finance/contracts/setup/summary-tab";
import { TipLayer, tip } from "@/components/finance/contracts/setup/tip";
import { clearUndo } from "@/components/finance/contracts/setup/undo";
import { UndoLine } from "@/components/finance/contracts/setup/undo-line";
import { revertLast } from "@/components/finance/contracts/setup/use-setup-action";
import { ViewsTab } from "@/components/finance/contracts/setup/views-tab";
import { useSessionState } from "@/components/session-state";

type Tab = "fields" | "views" | "entities" | "summary";

/**
 * Вкладки - по тому, что человек настраивает: колонки договора (со списками
 * значений внутри), листы, свои юрлица, откуда оплата. «Списки» отдельной
 * вкладкой были вторым входом в те же поля (28.09.2026 - объединены).
 */
const TABS: { key: Tab; title: string; tip: string }[] = [
  {
    key: "fields",
    title: "Поля",
    tip: "Колонки договора: название, тип, как заполнять, обязательность - и значения списков (статусы, виды, предметы).",
  },
  {
    key: "views",
    title: "Листы",
    tip: "Листы реестра и «Разовых»: какие договоры попадают в лист, какие колонки в нём, что подставлять в новую строку и какие строки подсвечивать.",
  },
  {
    key: "entities",
    title: "Наши юрлица",
    tip: "Юрлица группы: по ним договор понимает, какая сторона наша, а какая - клиент.",
  },
  {
    key: "summary",
    title: "Сводка оплат",
    tip: "Книга Google, из которой «Разовые» берут «Оплачено» - по номеру договора и клиенту.",
  },
];


export function RegistrySetup({ onBack }: { onBack: () => void }) {
  const phase = useRegistry((s) => s.phase);
  const error = useRegistry((s) => s.error);
  const schema = useRegistry((s) => s.schema);
  const company = useRegistry((s) => s.company);
  const me = useRegistry((s) => s.me);
  // Вкладка переживает перезагрузку страницы (`session-state.tsx`): админ,
  // который правит листы, после F5 должен оказаться там же, а не на «Полях».
  // Запомненная вкладка, которой больше нет, - «Поля».
  const [stored, setTab] = useSessionState<Tab>("setup.tab", "fields");
  const tab: Tab = TABS.some((item) => item.key === stored) ? stored : "fields";
  const [slow, setSlow] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Счётчики «в договорах» и число договоров блока считаются по хранилищу;
  // опрос держит их свежими, пока экран открыт.
  useEffect(() => holdLive(), []);

  // Ctrl+Z (⌘Z) вне поля ввода - вернуть последнюю правку настройки. В поле
  // ввода клавиша остаётся браузеру: там она отменяет набранное. Стек отмен
  // живёт, пока экран открыт (`setup/undo.ts`).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.code !== "KeyZ") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      void revertLast();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearUndo();
    };
  }, []);

  // «Читаем реестр…» - только если чтение затянулось: на быстрой связи
  // подпись мелькнула бы на кадр и ничего не сказала.
  useEffect(() => {
    if (phase === "ready") return;
    const timer = setTimeout(() => setSlow(true), 400);
    return () => clearTimeout(timer);
  }, [phase]);

  const choose = (next: Tab) => setTab(next);

  const top = (
    <div className="creg-top setup-top">
      <button type="button" className="btn-ghost btn-sm setup-back" onClick={onBack}>
        <ArrowLeftIcon size={16} aria-hidden="true" />
        Реестр
      </button>
    </div>
  );

  if (phase === "error") {
    return (
      <div className="setup-root">
        {top}
        <p className="setup-error" role="alert">
          {error || "Реестр не прочитался"}{" "}
          {company ? (
            <button type="button" className="fin-link-btn" onClick={() => void boot(company, me, true)}>
              Повторить
            </button>
          ) : null}
        </p>
      </div>
    );
  }

  if (phase !== "ready" || !schema) {
    return (
      <div className="setup-root">
        {top}
        <p className="creg-empty" style={{ opacity: slow ? 1 : 0, transition: "opacity .3s" }}>
          Читаем реестр…
        </p>
      </div>
    );
  }

  if (!schema.access.setup) {
    return (
      <div className="setup-root">
        {top}
        <p className="creg-empty">Настройка реестра открыта владельцу и администратору.</p>
      </div>
    );
  }

  return (
    <div className="setup-root" ref={root}>
      <TipLayer root={root} />
      {top}
      <Tabs active={tab} onSelect={choose} />
      <div className="setup-body" role="tabpanel" id={`setup-panel-${tab}`} aria-labelledby={`setup-tab-${tab}`}>
        {tab === "fields" ? <FieldsTab /> : null}
        {tab === "views" ? <ViewsTab /> : null}
        {tab === "entities" ? <EntitiesTab /> : null}
        {tab === "summary" ? <SummaryTab /> : null}
      </div>
      <UndoLine />
    </div>
  );
}

/** Вкладки с линией под выбранной: линия едет к новой вкладке - «выбрано это». */
function Tabs({ active, onSelect }: { active: Tab; onSelect: (tab: Tab) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    const host = root.current;
    const bar = line.current;
    const place = (animate: boolean) => {
      const tab = host?.querySelector<HTMLElement>(`[data-key="${active}"]`);
      if (!host || !bar || !tab) return;
      const to = { x: tab.offsetLeft, scaleX: tab.offsetWidth };
      if (!animate || prefersReducedMotion()) gsap.set(bar, to);
      else gsap.to(bar, { ...to, duration: 0.45, ease: "expo.out", overwrite: "auto" });
    };
    place(!first.current);
    first.current = false;
    // Смена размеров (шрифт догрузился, окно сузили) - перескок без движения.
    const observer = new ResizeObserver(() => place(false));
    if (host) observer.observe(host);
    return () => observer.disconnect();
  }, [active]);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const index = TABS.findIndex((item) => item.key === active);
    const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    onSelect(next.key);
    root.current?.querySelector<HTMLElement>(`[data-key="${next.key}"]`)?.focus();
  };

  return (
    <div className="creg-bar setup-bar">
      <div ref={root} className="creg-tabs" role="tablist" aria-label="Настройка реестра" onKeyDown={onKey}>
        {TABS.map((item) => (
          <button
            key={item.key}
            id={`setup-tab-${item.key}`}
            type="button"
            role="tab"
            data-key={item.key}
            aria-selected={item.key === active}
            aria-controls={`setup-panel-${item.key}`}
            tabIndex={item.key === active ? 0 : -1}
            className="creg-tab"
            {...tip(item.tip)}
            onClick={() => onSelect(item.key)}
          >
            {item.title}
          </button>
        ))}
        <span ref={line} className="creg-underline" aria-hidden="true" />
      </div>
    </div>
  );
}
