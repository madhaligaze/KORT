"use client";

/**
 * «Реестр · таблица» — реестр договоров листом Univer (фронт-план 6.4, 4.7).
 *
 * Здесь только то, что живёт в React: хранилище → лист (`sync`), вопрос
 * «опечатка или с даты» слоем над ячейкой, строка под листом. Всё, что
 * связывает Univer с договорами, — в `sheet-adapter.ts`.
 *
 * Univer роняет серверную отрисовку (`Path2D is not defined`), поэтому тот,
 * кто ставит этот компонент на страницу, берёт его через `next/dynamic` с
 * `ssr: false`. Рядом с листом — только прозрачность: `transform` и `filter` на
 * предке сделали бы его контейнером для `position: fixed` и сломали замеры
 * холста (правило проекта о GSAP). Слой вопроса поэтому — портал в `body`.
 *
 * Выпадающие списки — общий стандарт листов (`univer/lists.ts`): стрелку у
 * выбранной ячейки, Alt+↓ и печать без списка даёт `UniverSheet`; здесь
 * только прячем стрелку, пока над ячейкой висит вопрос.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { type ChangeMode as ChangeModeValue, contractsApi } from "@/components/finance/api";
import { ChangeMode } from "@/components/finance/contracts/change-mode";
import {
  RegistryBinding,
  buildRegistry,
  paletteNow,
  structureKey,
  type AskGroup,
  type Built,
  type CellHint,
} from "@/components/finance/contracts/sheet-adapter";
import {
  answer,
  boot,
  cancel,
  ensurePayments,
  ensureStaff,
  ensureSummary,
  forBook,
  getRegistry,
  holdLive,
  put,
  useRegistry,
} from "@/components/finance/contracts/store";
import { formatDay } from "@/components/finance/format";
import { lookStore } from "@/components/finance/look-store";
import { type LookKeeper, keepLook } from "@/components/univer/look";
import { UniverSheet, type UniverApi } from "@/components/univer/sheet";
import { useFillHeight } from "@/components/univer/use-fill-height";

type Props = {
  /** Открыть карточку договора (или закрыть — `null`). `ctx` — лист и блок строки. */
  onOpenCard: (id: string | null, ctx?: { view: string; block: number }) => void;
  /** Договор открытой карточки: его строка отмечена, лист к ней прокручивается. */
  openId: string | null;
  /** Книга листов: `""` — реестр («Таблица»), `oneoff` — «Разовые». */
  book?: string;
};

type Note = { text: string; fail: boolean; at: number };

/** Строки заметки ячейки разделены переводом строки (`sheet-adapter`, `render`). */
const NEWLINE = String.fromCharCode(10);

function stillAsking(group: AskGroup): { id: string; key: string }[] {
  const edits = getRegistry().edits;
  return group.items.filter((item) => edits.get(item.id)?.get(item.key)?.state === "asking");
}

export function RegistrySheet({ onOpenCard, openId, book = "" }: Props) {
  const state = useRegistry((value) => value);
  const { ref: box, height } = useFillHeight(360, 4);
  const [note, setNote] = useState<Note | null>(null);
  const [ask, setAsk] = useState<AskGroup | null>(null);
  const [spot, setSpot] = useState<{ left: number; top: number } | null>(null);
  const [generation, setGeneration] = useState(0);
  const [late, setLate] = useState(false);
  const binding = useRef<RegistryBinding | null>(null);
  const activeView = useRef<string | null>(null);
  const openRef = useRef(openId);
  const onOpenRef = useRef(onOpenCard);
  const pop = useRef<HTMLDivElement>(null);
  const [hint, setHint] = useState<CellHint | null>(null);
  const [hintSpot, setHintSpot] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const [acking, setAcking] = useState("");
  const [ackError, setAckError] = useState("");
  const hintBox = useRef<HTMLDivElement>(null);
  const [keeper, setKeeper] = useState<LookKeeper | null>(null);
  const [lookEmpty, setLookEmpty] = useState(true);

  useEffect(() => {
    onOpenRef.current = onOpenCard;
  }, [onOpenCard]);

  // Живой режим, пока лист открыт: чужие правки приходят опросом раз в 2 с.
  useEffect(() => holdLive(), []);
  // Ответственные в списке ячейки — из справочника сотрудников кабинета.
  useEffect(() => {
    void ensureStaff();
  }, []);
  // «Оплачено/Остаток по выписке» меняют выписки и разнесение, а не правки
  // договоров — опросу реестра о них неоткуда узнать. Раз в минуту, пока
  // вкладка на виду, и сразу при возвращении на неё.
  useEffect(() => {
    void ensurePayments();
    const refresh = () => {
      if (document.visibilityState === "visible") void ensurePayments();
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  // «Оплачено/Остаток (сводка)» — из книги-сводки: раз в минуту, пока вкладка
  // на виду, и сразу при возвращении на неё (сервер держит книгу пять минут).
  const usesSummary = useMemo(
    () =>
      (state.schema?.views ?? []).some(
        (view) =>
          (view.book ?? "") === book &&
          view.blocks.some((block) => block.columns.some((column) => column.key.startsWith("summary_"))),
      ),
    [state.schema, book],
  );
  useEffect(() => {
    if (!usesSummary) return;
    void ensureSummary();
    const refresh = () => {
      if (document.visibilityState === "visible") void ensureSummary();
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [usesSummary]);

  const ready = state.phase === "ready" && state.schema !== null;
  const scoped = useMemo(() => forBook(state, book).schema, [state, book]);
  const structure = useMemo(() => (scoped ? structureKey(scoped) : ""), [scoped]);
  const empty = ready && scoped !== null && scoped.views.length === 0;

  /**
   * Книга собирается заново только при смене раскладки (колонки, листы, права)
   * или по просьбе связки. Правки, чужие договоры и новые значения списков
   * лист переписывает по месту: пересборка — это секунда и потерянная
   * прокрутка.
   */
  const built = useMemo<Built | null>(() => {
    // `generation` — просьба связки собрать книгу заново (лист поменяли в обход).
    if (!ready || !structure || empty || generation < 0) return null;
    return buildRegistry(getRegistry(), paletteNow(), book);
  }, [ready, structure, empty, generation, book]);

  const onReady = useCallback(
    (api: UniverApi) => {
      if (!built) return;
      const next = new RegistryBinding(
        api,
        built,
        {
          note: (text, fail) => setNote(text ? { text, fail: Boolean(fail), at: Date.now() } : null),
          ask: (group) => setAsk(group),
          openCard: (id, ctx) => onOpenRef.current(id, ctx),
          sheet: (view) => {
            activeView.current = view;
          },
          rebuild: () => setGeneration((value) => value + 1),
          hint: (at) => {
            setAckError("");
            if (!at) {
              setHint(null);
              return;
            }
            const found = binding.current?.hintAt(at.sheet, at.row, at.col) ?? null;
            setHint(found);
            const rect = found ? binding.current?.cellRectAt(at.sheet, at.row, at.col) : null;
            if (!rect?.visible) {
              setHintSpot(null);
              return;
            }
            // Под ячейкой; у нижнего края окна — над ней.
            const above = rect.bottom + 180 > window.innerHeight;
            setHintSpot({ left: Math.round(rect.left), top: Math.round(above ? rect.top - 6 : rect.bottom + 6), above });
          },
        },
        box.current,
      );
      binding.current = next;
      const stop = next.start(activeView.current, openRef.current);
      next.sync(getRegistry());
      // Личный вид: ширины, цвета, перенос — у каждого свои (`univer/look.ts`).
      const look = keepLook(api, next.lookIds(), lookStore(book ? `registry.${book}` : "registry", getRegistry().company ?? ""));
      next.setLook(look);
      setKeeper(look);
      setLookEmpty(look.empty());
      const unwatch = look.subscribe(() => setLookEmpty(look.empty()));
      if (process.env.NODE_ENV !== "production") {
        // Только в разработке: пробники Playwright читают лист.
        (window as unknown as Record<string, unknown>).__cregSheet = { api, binding: next, build: buildRegistry, palette: paletteNow };
      }
      return () => {
        unwatch();
        look.stop();
        next.setLook(null);
        stop();
        if (binding.current === next) binding.current = null;
      };
    },
    [built, box, book],
  );

  useEffect(() => {
    binding.current?.sync(state);
  }, [state]);

  useEffect(() => {
    openRef.current = openId;
    binding.current?.setOpen(openId);
  }, [openId]);

  // «Читаем реестр…» — только если чтение затянулось: быстрый ответ не должен
  // мигать подписью.
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setLate(true), 400);
    return () => window.clearTimeout(timer);
  }, [ready]);

  // Отказ сервера по правке ячейки («„имх“ нет в списке …») — строкой под
  // листом сразу: у ячейки он виден только при наведении, а напечатавший
  // смотрит в лист, а не водит мышью. Каждый отказ — один раз.
  const shownFail = useRef(0);
  useEffect(() => {
    let latest: { at: number; text: string } | null = null;
    for (const edits of state.edits.values()) {
      for (const item of edits.values()) {
        if (item.state !== "failed" || item.startedAt <= shownFail.current) continue;
        if (!latest || item.startedAt > latest.at) latest = { at: item.startedAt, text: item.error || "Правка не сохранилась" };
      }
    }
    if (!latest) return;
    shownFail.current = latest.at;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- строка под листом следует за хранилищем правок
    setNote({ text: latest.text, fail: true, at: Date.now() });
  }, [state.edits]);

  // Строка под листом гаснет сама; отказ держится дольше — его читают.
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), note.fail ? 12000 : 6000);
    return () => window.clearTimeout(timer);
  }, [note]);

  const settle = useCallback((group: AskGroup, mode: ChangeModeValue | null) => {
    const items = stillAsking(group);
    binding.current?.touch(items);
    for (const item of items) {
      if (mode) answer(item.id, item.key, mode);
      else cancel(item.id, item.key);
    }
    if (mode?.kind === "from_date" && mode.effective_from > (getRegistry().schema?.today ?? "")) {
      // Дата в будущем: в ячейке остаётся прежнее, заметка говорит, что впереди.
      const edits = getRegistry().edits;
      const values = new Map(items.map((item) => [`${item.id}|${item.key}`, edits.get(item.id)?.get(item.key)?.value]));
      binding.current?.markAhead(
        items,
        (item) =>
          `с ${formatDay(mode.effective_from)} — ${binding.current?.valueText(item.id, item.key, values.get(`${item.id}|${item.key}`)) ?? ""}`,
      );
    }
    setAsk(null);
    setSpot(null);
    binding.current?.focus();
  }, []);

  // Слой вопроса едет вместе с ячейкой; ячейка ушла из видимой части листа,
  // лист сменили или на вопрос ответили в карточке — слой закрывается, как Esc.
  useEffect(() => {
    if (!ask) return;
    let frame = 0;
    // Несколько кадров подряд: лист в момент вопроса может ещё доезжать до
    // ячейки (Enter сдвинул выделение, прокрутка догоняет), и один кадр «не
    // видно» не повод снимать правку.
    let hidden = 0;
    const tick = () => {
      if (!stillAsking(ask).length) {
        setAsk(null);
        setSpot(null);
        return;
      }
      const rect = binding.current?.rectOf(ask);
      if (!rect || !rect.visible) {
        hidden += 1;
        if (hidden >= 6) {
          settle(ask, null);
          return;
        }
        frame = window.requestAnimationFrame(tick);
        return;
      }
      hidden = 0;
      const left = Math.round(rect.left);
      const top = Math.round(rect.bottom + 6);
      setSpot((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [ask, settle]);

  // Клик мимо вопроса — то же, что Esc: молча сохранить правку «как-нибудь»
  // нельзя, сервер её всё равно не примет.
  useEffect(() => {
    if (!ask) return;
    const onDown = (event: PointerEvent) => {
      if (pop.current && event.target instanceof Node && pop.current.contains(event.target)) return;
      settle(ask, null);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [ask, settle]);

  // Подсказка уходит, когда лист прокрутили (ячейка уехала), по Esc и по
  // щелчку мимо неё. Наведение на другую ячейку прячет её само (сервис заметок).
  useEffect(() => {
    if (!hint) return;
    const hide = () => setHint(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const onDown = (event: PointerEvent) => {
      if (hintBox.current && event.target instanceof Node && hintBox.current.contains(event.target)) return;
      hide();
    };
    const host = box.current;
    host?.addEventListener("wheel", hide, { passive: true });
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      host?.removeEventListener("wheel", hide);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [hint, box]);

  const acknowledge = async (id: string, code: string) => {
    setAcking(code);
    setAckError("");
    try {
      put(await contractsApi.acknowledge(id, code, true));
      setHint((current) => {
        if (!current) return current;
        const issues = current.issues.filter((issue) => issue.code !== code);
        const text = current.text
          .split(NEWLINE)
          .filter((line) => !current.issues.some((issue) => issue.code === code && issue.text === line))
          .join(NEWLINE);
        return text.trim() ? { ...current, issues, text } : null;
      });
    } catch (exc) {
      setAckError(exc instanceof Error ? exc.message : "Отметка не сохранилась");
    } finally {
      setAcking("");
    }
  };

  const count = ask ? stillAsking(ask).length : 0;
  // Рамка листа стоит с первого кадра, даже пока реестр читается: замер
  // высоты вешается на неё один раз при монтировании. Когда рамка появлялась
  // только после чтения, замер уже прошёл впустую, и лист оставался на
  // минимуме — 360 пикселей и пустота под ним.
  return (
    <div>
      <div
        ref={box}
        className="creg-sheet-wrap"
        style={{ height }}
        onKeyDownCapture={(event) => {
          // Alt+Enter — карточка договора активной строки (в редакторе ячейки
          // Alt+Enter остаётся переводом строки).
          if (event.altKey && event.key === "Enter" && binding.current && !binding.current.isEditing()) {
            if (binding.current.openActive()) {
              event.preventDefault();
              event.stopPropagation();
            }
          }
        }}
      >
        {built ? (
          <UniverSheet
            key={built.unitId}
            data={built.snapshot}
            onReady={onReady}
            listEdit={false}
            formatting="look"
            listArrow={!ask}
            session={book ? `registry.${book}` : "registry"}
          />
        ) : empty ? (
          <p className="creg-sheet-note" role="status" style={{ margin: "1rem" }}>
            Листов в этой книге нет — их заводят в «Настроить реестр» → «Листы»
          </p>
        ) : state.phase === "error" ? (
          <p className="creg-sheet-note fin-fail" role="status" style={{ margin: "1rem" }}>
            {state.error || "Реестр не прочитался"} ·{" "}
            <button
              type="button"
              className="fin-link-btn"
              onClick={() => state.company && boot(state.company, state.me, true)}
            >
              Повторить
            </button>
          </p>
        ) : (
          <p className="creg-sheet-note" role="status" aria-live="polite" style={{ margin: "1rem" }}>
            {late ? "Читаем реестр…" : ""}
          </p>
        )}
      </div>
      <div className="creg-sheet-foot">
        <p className={note?.fail ? "creg-sheet-note fin-fail" : "creg-sheet-note"} role="status" aria-live="polite">
          {note?.text ?? ""}
        </p>
        {keeper && !lookEmpty ? (
          <button
            type="button"
            className="fin-link-btn creg-look-reset"
            title="Ширины, цвета и перенос — ваши, коллеги их не видят"
            onClick={async () => {
              await keeper.reset();
              // Вид снимается пересборкой листа: стили уже лежат в ячейках.
              setGeneration((value) => value + 1);
            }}
          >
            Сбросить мой вид
          </button>
        ) : null}
      </div>
      {ask && spot && count
        ? createPortal(
            <div ref={pop}>
              <ChangeMode
                count={count}
                style={{ position: "fixed", top: spot.top, left: spot.left, maxWidth: 360 }}
                onFix={() => settle(ask, { kind: "fix" })}
                onFromDate={(iso) => settle(ask, { kind: "from_date", effective_from: iso })}
                onCancel={() => settle(ask, null)}
              />
            </div>,
            document.body,
          )
        : null}
      {hint && hintSpot && !ask
        ? createPortal(
            <div
              ref={hintBox}
              className="creg-hint"
              role="dialog"
              aria-label="Подсказка ячейки"
              style={{
                left: hintSpot.left,
                top: hintSpot.top,
                transform: hintSpot.above ? "translateY(-100%)" : undefined,
              }}
            >
              {hint.text.split(NEWLINE).map((line, index) => {
                const issue = hint.issues.find((item) => item.text === line);
                return (
                  <div key={`${index}-${line}`} className="creg-hint-line">
                    <span>{line}</span>
                    {issue && hint.id && state.schema?.access.edit ? (
                      <button
                        type="button"
                        className="creg-hint-ack"
                        disabled={acking === issue.code}
                        onClick={() => void acknowledge(hint.id as string, issue.code)}
                        title="Проверено: так и должно быть — замечание перестанет гореть"
                      >
                        {acking === issue.code ? "…" : "Учтено"}
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {ackError ? <p className="creg-hint-fail">{ackError}</p> : null}
              {hint.id ? (
                <button
                  type="button"
                  className="fin-link-btn creg-hint-open"
                  onClick={() => {
                    const id = hint.id as string;
                    setHint(null);
                    onOpenRef.current(id, { view: hint.sheet, block: hint.block });
                  }}
                >
                  Открыть договор
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export default RegistrySheet;
