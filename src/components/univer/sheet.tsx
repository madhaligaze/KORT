"use client";

import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import UniverPresetSheetsCoreRuRU from "@univerjs/preset-sheets-core/locales/ru-RU";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import UniverPresetSheetsSortRuRU from "@univerjs/preset-sheets-sort/locales/ru-RU";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import UniverPresetSheetsFilterRuRU from "@univerjs/preset-sheets-filter/locales/ru-RU";
import { UniverSheetsConditionalFormattingPreset } from "@univerjs/preset-sheets-conditional-formatting";
import UniverPresetSheetsConditionalFormattingRuRU from "@univerjs/preset-sheets-conditional-formatting/locales/ru-RU";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import UniverPresetSheetsDataValidationRuRU from "@univerjs/preset-sheets-data-validation/locales/ru-RU";
import { UniverSheetsFindReplacePreset } from "@univerjs/preset-sheets-find-replace";
import UniverPresetSheetsFindReplaceRuRU from "@univerjs/preset-sheets-find-replace/locales/ru-RU";
import { UniverSheetsNotePreset } from "@univerjs/preset-sheets-note";
import UniverPresetSheetsNoteRuRU from "@univerjs/preset-sheets-note/locales/ru-RU";
import { UniverSheetsHyperLinkPreset } from "@univerjs/preset-sheets-hyper-link";
import UniverPresetSheetsHyperLinkRuRU from "@univerjs/preset-sheets-hyper-link/locales/ru-RU";
import { UniverSheetsTablePreset } from "@univerjs/preset-sheets-table";
import UniverPresetSheetsTableRuRU from "@univerjs/preset-sheets-table/locales/ru-RU";
import { UniverSheetsThreadCommentPreset } from "@univerjs/preset-sheets-thread-comment";
import UniverPresetSheetsThreadCommentRuRU from "@univerjs/preset-sheets-thread-comment/locales/ru-RU";
import { UniverSheetsDrawingPreset } from "@univerjs/presets/preset-sheets-drawing";
import UniverPresetSheetsDrawingRuRU from "@univerjs/presets/preset-sheets-drawing/locales/ru-RU";
import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { IConfigService } from "@univerjs/core";
import { IMenuManagerService } from "@univerjs/preset-sheets-core";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useSessionScope } from "@/components/session-state";
import { type ListArrow, type ListWatch, openList, watchLists } from "@/components/univer/lists";
import { type PlaceKeeper, keepPlace } from "@/components/univer/place";
import { isDarkTheme } from "@/components/univer/sheet-model";
import { speedUp } from "@/components/univer/speed";
import { lockScroll } from "@/components/use-scroll-lock";
import { registerRuNumfmtLocale } from "@/components/univer/numfmt-locale";

import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-conditional-formatting/lib/index.css";
import "@univerjs/preset-sheets-data-validation/lib/index.css";
import "@univerjs/preset-sheets-find-replace/lib/index.css";
import "@univerjs/preset-sheets-note/lib/index.css";
import "@univerjs/preset-sheets-hyper-link/lib/index.css";
import "@univerjs/preset-sheets-table/lib/index.css";
import "@univerjs/preset-sheets-thread-comment/lib/index.css";
import "@univerjs/presets/lib/styles/preset-sheets-drawing.css";

/** Снимок книги в формате Univer (`IWorkbookData`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WorkbookSnapshot = Record<string, any>;

export type UniverSheetHandle = {
  /** Текущее состояние книги целиком — то, что уходит в сохранение. */
  snapshot: () => WorkbookSnapshot | null;
};

/** Фасад Univer. Типы пакета сюда не тянем — они огромны и меняются от версии. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UniverApi = any;

type Props = {
  /** Книга. `null` — пустая таблица «с нуля». */
  data: WorkbookSnapshot | null;
  /**
   * Фасад готов, книга создана.
   *
   * Через него подписываются на правки и раздают права. Возвращённая функция
   * вызывается при размонтировании — ею снимают подписки, иначе второй заход
   * в раздел получит их вдвое.
   */
  onReady?: (api: UniverApi) => void | (() => void);
  /**
   * Комментарии к ячейкам и картинки на листе.
   *
   * Только там, где книга хранится снимком целиком («Таблицы»): и то и другое
   * Univer держит в ресурсах снимка. В «Финансах» и «Книгах» строки живут в
   * базе, снимка нет — комментарий, оставленный там, пропал бы при перезагрузке.
   */
  extras?: boolean;
  /** Кнопка «На весь экран» в ленте. По умолчанию есть у каждого листа. */
  fullscreen?: boolean;
  /**
   * Ссылка «Изменить» в выпадающем списке ячейки — открывает панель правил.
   * В «Таблицах» списки свои и правятся здесь же; в реестре и журнале их
   * ставит раздел по справочникам, и правило, поправленное в панели, молча
   * разошлось бы с сервером до следующей пересборки листа.
   */
  listEdit?: boolean;
  /**
   * Лист нарисован. Univer рисует не сразу после `createWorkbook`, а через
   * 300 мс (стадия `Rendered`), поэтому «книга создана» ещё не значит «видно».
   */
  onShown?: () => void;
  /**
   * Оформление, формулы и вставка в ленте. `false` оставляет то, что работает
   * с данными: отмену, поиск, фильтр и сортировку. `"look"` — ещё и всё, что
   * меняет только вид (шрифт, цвета, выравнивание, перенос, границы): лист,
   * который пишет в базу только значения, держит такое оформление личным видом
   * учётки (`look.ts`), а формулы, слияние, вставка и проверки остаются
   * закрыты — они меняли бы данные или раскладку листа.
   */
  formatting?: boolean | "look";
  /**
   * Стрелка списка у выбранной ячейки. `false` — пока раздел держит над
   * ячейкой свой слой (вопрос реестра «опечатка или с даты»): стрелка легла
   * бы поверх него.
   */
  listArrow?: boolean;
  /**
   * Имя места листа в сессии («journal», «registry», «tables.<id>»): лист
   * книги, выбранная ячейка, прокрутка и «На весь экран» переживают
   * перезагрузку страницы (`place.ts`). Без имени лист открывается с начала.
   */
  session?: string;
};

/**
 * Пункты ленты, которые меняют только вид ячейки (`formatting="look"`). Формат
 * чисел сюда не входит: он у сумм и дат свой, и «Процент» на сумме договора
 * читался бы как другое число.
 */
const LOOK_MENU = new Set([
  "sheet.command.set-range-font-family",
  "sheet.command.set-range-fontsize",
  "sheet.command.set-range-font-increase",
  "sheet.command.set-range-font-decrease",
  "sheet.command.set-range-bold",
  "sheet.command.set-range-italic",
  "sheet.command.set-range-underline",
  "sheet.command.set-range-stroke",
  "sheet.command.set-range-text-color",
  "sheet.command.reset-range-text-color",
  "sheet.command.set-background-color",
  "sheet.command.reset-background-color",
  "sheet.command.set-border-basic",
  "sheet.command.set-horizontal-text-align",
  "sheet.command.set-vertical-text-align",
  "sheet.command.set-text-wrap",
  "sheet.command.set-text-rotation",
]);

/** Пункты ленты, которые остаются у листа без оформления (`formatting={false}`). */
const DATA_ONLY_MENU = new Set([
  "univer.command.undo",
  "univer.command.redo",
  "base-ui.operation.toggle-shortcut-panel",
  "ui.operation.open-find-dialog",
  "sheet.command.smart-toggle-filter",
  "sheet.command.clear-filter-criteria",
  "sheet.command.re-calc-filter",
  "sheet.menu.sheets-sort",
  "sheet.command.sort-range-asc",
  "sheet.command.sort-range-asc-ext",
  "sheet.command.sort-range-desc",
  "sheet.command.sort-range-desc-ext",
  "sheet.command.sort-range-custom",
]);
const RIBBON_TABS = ["ribbon.start", "ribbon.insert", "ribbon.formulas", "ribbon.data", "ribbon.view", "ribbon.others"];

/**
 * Спрятать в ленте всё, кроме работы с данными.
 *
 * Прячется то, что лента на самом деле содержит (обходом меню), а не список,
 * выписанный под версию: пункт, добавленный следующей версией Univer, не
 * проскочит в ленту реестра. Формулы и форматы чисел заводят свои пункты позже
 * книги — поэтому обход повторяется на каждом изменении меню, а сигнал об
 * изменении подаётся, только если нашлось новое (иначе своё же изменение
 * запускало бы обход снова и снова).
 */
function keepDataOnly(univerAPI: UniverApi, extra: ReadonlySet<string> = new Set()): () => void {
  try {
    const injector = univerAPI._injector;
    const menus = injector.get(IMenuManagerService);
    const config = injector.get(IConfigService);
    const hidden: Record<string, { hidden: true }> = {};
    type Node = { item?: { id: string }; children?: Node[] };
    const sweep = () => {
      const fresh: Record<string, { hidden: true }> = {};
      // Вложенные пункты разрешённого (цвета палитры, варианты выравнивания)
      // разрешены вместе с ним.
      const walk = (nodes: Node[] | undefined, allowed: boolean) => {
        for (const node of nodes ?? []) {
          const id = node.item?.id;
          const ok = allowed || (id ? DATA_ONLY_MENU.has(id) || extra.has(id) : false);
          if (id && !ok && !hidden[id]) fresh[id] = hidden[id] = { hidden: true };
          if (node.children) walk(node.children, ok);
        }
      };
      for (const tab of RIBBON_TABS) walk(menus.getMenuByPositionKey(tab) as Node[], false);
      if (!Object.keys(fresh).length) return;
      config.setConfig("menu", fresh, { merge: true });
      // Лента перечитывает меню по сигналу изменения — пустое слияние его даёт.
      menus.appendRootMenu({});
    };
    sweep();
    const subscription = menus.menuChanged$.subscribe(() => queueMicrotask(sweep));
    return () => subscription.unsubscribe();
  } catch (exc) {
    // Лишние кнопки — неудобство, а не повод не открыть лист.
    console.warn("лента листа не урезана:", exc);
    return () => {};
  }
}

/**
 * `LifecycleStages.Rendered` из `@univerjs/core`. Не `Steady`: её Univer
 * объявляет по таймеру через 3 с после первой отрисовки, и занавес, ждущий
 * её, стоял бы до своего предела.
 */
const RENDERED = 2;

/**
 * Всё, что общее у листов продукта, живёт здесь, а не в разделах.
 *
 * Лист журнала, «Реестр · таблица», «Таблицы» и «Книги» — один и тот же
 * компонент. Раньше тему умел только лист реестра (своим адаптером), кнопку
 * «На весь экран» — только журнал (своей пилюлей поверх ленты), и каждое
 * улучшение приходилось повторять в каждом разделе. Теперь:
 *
 * * **тема** — лист идёт за `data-theme` приложения и за системной темой
 *   («Как в системе»); тёмный класс Univer снимается при уходе, иначе
 *   следующий светлый лист получил бы тёмную ленту;
 * * **«На весь экран»** — вкладкой прямо в ряду вкладок ленты, с классами
 *   соседней вкладки Univer: шрифт, отступы, наведение и тёмная тема у неё
 *   те же, что у «Начало» и «Вставки». Esc сворачивает; страница под листом
 *   не прокручивается;
 * * **скорость прокрутки** — `speed.ts`: ячейка считается один раз на кадр,
 *   а не семь-восемь, и без лишних разборов строк;
 * * **выпадающие списки** — `lists.ts`: раздел ставит правило `listRule`, а
 *   значение текстом без капсулы, стрелка у выбранной ячейки, Alt+↓ и печать
 *   без списка — здесь, у каждого листа одинаково.
 */
const FULL_TEXT = "На весь экран";
const COLLAPSE_TEXT = "Свернуть";

/**
 * Ряд вкладок ленты: `role="tablist"` шапки Univer. Прежний признак «три и
 * больше кнопок» не находил ряд у листа без оформления — там вкладок две
 * («Начало», «Данные»), и «На весь экран» пропадала. Он остаётся запасным для
 * версии без роли.
 */
function findTabRow(root: HTMLElement): HTMLElement | null {
  const header = root.querySelector("header");
  if (!header) return null;
  const list = header.querySelector<HTMLElement>('[role="tablist"]');
  if (list) return list;
  for (const node of Array.from(header.querySelectorAll<HTMLElement>("div"))) {
    const buttons = Array.from(node.children).filter((child) => child.tagName === "BUTTON");
    if (buttons.length >= 3) return node;
  }
  return null;
}

/** Классы вкладки, которая сейчас не выбрана: у выбранной свои цвет и вес. */
function idleTabClass(row: HTMLElement): string {
  const buttons = Array.from(row.children).filter(
    (child): child is HTMLButtonElement => child instanceof HTMLButtonElement && !child.dataset.usheetFull,
  );
  // По роли вкладки, а не по толщине шрифта: пока шрифт не догрузился, вес у
  // всех вкладок одинаковый, и «На весь экран» брала классы выбранной —
  // синюю заливку «Начала».
  const idle =
    buttons.find((button) => button.getAttribute("aria-selected") === "false") ??
    (buttons.some((button) => button.hasAttribute("aria-selected"))
      ? undefined
      : buttons.find((button) => Number(getComputedStyle(button).fontWeight) < 600));
  // Невыбранной вкладки ещё нет — подождать, а не взять классы выбранной.
  return idle?.className ?? "";
}

/**
 * Пустая книга: один лист, столько же строк и колонок, сколько даёт новый
 * документ Google Sheets. Числа не круглые, потому что скопированы у него —
 * человек, переехавший из Sheets, не должен упереться в другую границу.
 */
export function blankWorkbook(name = "Новая таблица"): WorkbookSnapshot {
  return {
    id: `blank-${Date.now()}`,
    name,
    locale: LocaleType.RU_RU,
    sheetOrder: ["sheet-1"],
    styles: {},
    sheets: {
      "sheet-1": {
        id: "sheet-1",
        name: "Лист1",
        rowCount: 1000,
        columnCount: 26,
        cellData: {},
      },
    },
  };
}

export const UniverSheet = forwardRef<UniverSheetHandle, Props>(function UniverSheet(
  { data, onReady, extras = false, fullscreen = true, listEdit = true, formatting = true, listArrow = true, session, onShown },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const fullRef = useRef(full);
  const sessionScope = useSessionScope();
  const placeRef = useRef<PlaceKeeper | null>(null);
  const [arrow, setArrow] = useState<ListArrow | null>(null);
  const listArrowRef = useRef(listArrow);
  listArrowRef.current = listArrow;
  const listsRef = useRef<ListWatch | null>(null);
  /** Узел в ряду вкладок ленты, куда порталом встаёт «На весь экран». */
  const [tabSlot, setTabSlot] = useState<{ host: HTMLElement; className: string } | null>(null);
  // Через ref, чтобы обработчик, пересозданный родителем, не пересоздавал
  // книгу: эффект ниже монтируется один раз и живёт до размонтирования.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onShownRef = useRef(onShown);
  onShownRef.current = onShown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null);

  useImperativeHandle(
    ref,
    () => ({
      snapshot: () => {
        const api = apiRef.current;
        if (!api) return null;
        try {
          return api.getActiveWorkbook()?.save() ?? null;
        } catch {
          return null;
        }
      },
    }),
    [],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    // До создания книги: первая же отрисовка уже форматирует числа, и локаль,
    // зарегистрированная после неё, до этих ячеек не дойдёт.
    registerRuNumfmtLocale();
    const { univerAPI } = createUniver({
      locale: LocaleType.RU_RU,
      locales: {
        [LocaleType.RU_RU]: mergeLocales(
          UniverPresetSheetsCoreRuRU,
          UniverPresetSheetsSortRuRU,
          UniverPresetSheetsFilterRuRU,
          UniverPresetSheetsConditionalFormattingRuRU,
          UniverPresetSheetsDataValidationRuRU,
          UniverPresetSheetsFindReplaceRuRU,
          UniverPresetSheetsNoteRuRU,
          UniverPresetSheetsHyperLinkRuRU,
          UniverPresetSheetsTableRuRU,
          ...(extras ? [UniverPresetSheetsThreadCommentRuRU, UniverPresetSheetsDrawingRuRU] : []),
        ),
      },
      presets: [
        UniverSheetsCorePreset({ container: containerRef.current }),
        UniverSheetsSortPreset(),
        UniverSheetsFilterPreset(),
        UniverSheetsConditionalFormattingPreset(),
        UniverSheetsDataValidationPreset({ showEditOnDropdown: listEdit }),
        UniverSheetsFindReplacePreset(),
        UniverSheetsNotePreset(),
        UniverSheetsHyperLinkPreset(),
        UniverSheetsTablePreset(),
        ...(extras ? [UniverSheetsThreadCommentPreset(), UniverSheetsDrawingPreset()] : []),
      ],
    });
    apiRef.current = univerAPI;
    // Тема — до книги: первая отрисовка уже в нужных цветах, без вспышки.
    const retheme = () => {
      try {
        univerAPI.toggleDarkMode?.(isDarkTheme());
      } catch {
        /* версия без тёмной темы — лист останется светлым */
      }
    };
    retheme();
    // `data` берётся прямо из пропа, хотя эффект и с пустыми зависимостями:
    // новая книга приходит не сменой пропа, а пересозданием компонента через
    // `key` у родителя, поэтому значение на монтировании — всегда нужное.
    univerAPI.createWorkbook(data ?? blankWorkbook());
    // После книги: плагины листа стартуют с первой книгой, до неё их служб в
    // Univer ещё нет. Кадры движок начнёт рисовать позже — подписка их застанет.
    const stopSpeed = speedUp(univerAPI);
    // Меню плагинов листа заводятся вместе с книгой — урезать ленту можно
    // только после неё.
    const stopTrim =
      formatting === true ? null : keepDataOnly(univerAPI, formatting === "look" ? LOOK_MENU : undefined);
    // `onReady` берётся из пропа по той же причине, что и `data`: компонент
    // монтируется один раз на книгу, новая приходит пересозданием через `key`.
    const detach = onReadyRef.current?.(univerAPI);
    const lists = watchLists(univerAPI, containerRef.current, {
      arrow: (next) =>
        setArrow((prev) =>
          prev === next || (prev && next && prev.left === next.left && prev.top === next.top && prev.size === next.size)
            ? prev
            : next,
        ),
      allowed: () => listArrowRef.current,
    });
    listsRef.current = lists;
    // Место на листе в сессии: `session` и область читаются на монтировании,
    // как `data` — новый лист приходит пересозданием через `key`.
    const place = session ? keepPlace(univerAPI, sessionScope, session, () => fullRef.current) : null;
    placeRef.current = place;

    // «Лист виден»: стадия Rendered и два кадра — первый холст уже на экране.
    // Тогда же лист встаёт на запомненное место: до отрисовки прокрутке не на
    // что опереться.
    let shownFrame = 0;
    let shownSent = false;
    const shown = () => {
      if (shownSent) return;
      shownSent = true;
      shownFrame = requestAnimationFrame(() => {
        if (place?.restore()) setFull(true);
        shownFrame = requestAnimationFrame(() => onShownRef.current?.());
      });
    };
    let lifecycle: { dispose?: () => void } | undefined;
    try {
      if ((univerAPI.getCurrentLifecycleStage?.() ?? 0) >= RENDERED) shown();
      else
        lifecycle = univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, ({ stage }: { stage: number }) => {
          if (stage >= RENDERED) shown();
        });
    } catch {
      shown();
    }

    // Тачпад: лист докрутили до края вбок — и браузер принимал тот же жест за
    // «Назад»/«Вперёд» и уводил со страницы (Chrome и Safari на Mac, Edge на
    // Windows). Univer у края событие не гасит, и оно доходило до окна.
    // Гасим горизонтальное колесо над листом на всплытии — после Univer, так
    // что прокрутку листа это не трогает, а вбок странице ехать некуда
    // (`overflow-x: clip` у html). Вертикальное не трогаем: у нижнего края
    // листа страница должна прокручиваться дальше.
    const host = containerRef.current;
    const onSideWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.preventDefault();
    };
    host.addEventListener("wheel", onSideWheel, { passive: false });

    // Смена темы в приложении — атрибут `data-theme`; «Как в системе» — ещё и
    // системная настройка, которая меняется без атрибута.
    const themeObserver = new MutationObserver(retheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const system = window.matchMedia?.("(prefers-color-scheme: dark)");
    system?.addEventListener?.("change", retheme);

    return () => {
      cancelAnimationFrame(shownFrame);
      host.removeEventListener("wheel", onSideWheel);
      themeObserver.disconnect();
      system?.removeEventListener?.("change", retheme);
      lists.stop();
      listsRef.current = null;
      place?.stop();
      placeRef.current = null;
      try {
        stopTrim?.();
        lifecycle?.dispose?.();
        detach?.();
        stopSpeed();
        univerAPI.dispose();
      } catch {
        /* повторный dispose при быстром размонтировании — не ошибка */
      }
      // Univer вешает тёмный класс на <html> и сам его не снимает.
      document.documentElement.classList.remove("univer-dark");
      apiRef.current = null;
    };
    // Монтируется один раз; новая книга приходит через `key` у родителя.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Вкладка «На весь экран» в ряду вкладок ленты. Лента рисуется Univer после
  // создания книги и может перерисоваться (смена листа, права) — наблюдатель
  // возвращает узел на место, если его выкинули.
  //
  // Наблюдатель только планирует, а в DOM пишет кадр спустя. Запись прямо из
  // колбэка, который следит за тем же деревом, — петля: своя вставка рождает
  // новую запись, та — новую вставку, и всё это в микрозадачах, до которых ни
  // отрисовка, ни React уже не доходят. 26.09 так намертво висела вкладка при
  // выходе из «Таблиц»: React оторвал лист от документа раньше, чем снял
  // наблюдатель, проверка «узел на месте» смотрела на `isConnected`, который у
  // оторванного дерева ложь, и узел вставлялся перед самим собой бесконечно.
  useEffect(() => {
    const root = containerRef.current;
    if (!fullscreen || !root) return;
    let host: HTMLElement | null = null;
    let frame = 0;
    const attach = () => {
      frame = 0;
      // Лист уже снят со страницы и ждёт размонтирования — не трогать.
      if (!root.isConnected) return;
      // Дешёвая проверка первой: Univer меняет DOM листа постоянно (редактор
      // ячейки, всплывающие списки), а узел на месте почти всегда. Классы
      // пересчитываются и тогда: вкладки ленты дорисовываются после первой
      // вставки, и класс, взятый с одной лишь выбранной «Начало», оставлял
      // «На весь экран» синей навсегда.
      const placed = host?.isConnected && host.parentElement?.firstElementChild === host;
      const row = placed ? (host?.parentElement ?? null) : findTabRow(root);
      if (!row) return;
      if (!host) {
        host = document.createElement("span");
        host.style.display = "contents";
        host.dataset.usheetSlot = "true";
      }
      if (row.firstChild !== host) row.insertBefore(host, row.firstChild);
      const className = idleTabClass(row);
      if (!className) return;
      const slot = { host, className };
      setTabSlot((current) => (current?.host === slot.host && current.className === slot.className ? current : slot));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(attach);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      host?.remove();
      setTabSlot(null);
    };
  }, [fullscreen]);

  // Раздел открыл или закрыл свой слой над ячейкой — стрелке пора на место.
  useEffect(() => {
    listsRef.current?.refresh();
  }, [listArrow]);

  useEffect(() => {
    // Развернули или свернули — место листа в сессии это помнит.
    fullRef.current = full;
    placeRef.current?.save();
    // Univer меряет холст по событию resize: без толчка после смены размера
    // лист остаётся прежней ширины внутри нового окна.
    const nudge = window.setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    if (!full) return () => window.clearTimeout(nudge);
    // Пока лист во весь экран, страница под ним не едет: колесо двигает
    // таблицу, а не то, что осталось снизу. Общим замком приложения —
    // `overflow: hidden` на body страницу не держит (у `html` `overflow-x: clip`).
    const unlock = lockScroll();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(nudge);
      unlock();
      window.removeEventListener("keydown", onKey);
    };
  }, [full]);

  return (
    <div className="usheet" data-full={full ? "true" : undefined}>
      <div ref={containerRef} className="usheet-canvas" />
      {tabSlot
        ? createPortal(
            <button
              type="button"
              data-usheet-full="true"
              className={tabSlot.className}
              aria-pressed={full}
              onClick={(event) => {
                setFull((was) => !was);
                // После клика мышью кольцо фокуса Univer оставалось на кнопке
                // рамкой; с клавиатуры (detail = 0) фокус остаётся, где был.
                if (event.detail > 0) event.currentTarget.blur();
              }}
            >
              {full ? COLLAPSE_TEXT : FULL_TEXT}
            </button>,
            tabSlot.host,
          )
        : null}
      {arrow
        ? createPortal(
            <button
              type="button"
              className="usheet-list-arrow"
              aria-label="Открыть список"
              title="Список · Alt+↓"
              style={{ left: arrow.left, top: arrow.top, width: arrow.size, height: arrow.size }}
              // Фокус остаётся в листе: иначе Enter после выбора ушёл бы кнопке.
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => apiRef.current && openList(apiRef.current)}
            >
              <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
                <path d="M1 1 L5 5 L9 1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>,
            document.body,
          )
        : null}
    </div>
  );
});
