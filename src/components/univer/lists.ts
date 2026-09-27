/**
 * Выпадающий список ячейки — один стандарт на все листы продукта.
 *
 * До 27.09.2026 списки ставил каждый раздел сам, и листы разошлись: реестр
 * показывал значение текстом и стрелку у выбранной ячейки, как Excel, а журнал
 * «Таблица» — цветной капсулой в каждой ячейке колонки (режим Univer по
 * умолчанию). Теперь раздел даёт только значения и строки, а как список
 * выглядит и ведёт себя — решается здесь и в `UniverSheet`:
 *
 * * **без капсул** (`ARROW`): значение — обычный текст, а цвет в листе —
 *   только отказ (правило проекта об индикаторах);
 * * **стрелка — в каждой ячейке со списком**, как в Google Sheets: щелчок по
 *   ней открывает список, Alt+↓ — тоже. До 27.09 стрелка стояла только у
 *   выбранной ячейки (как в Excel), и список в строке был не виден, пока
 *   на ячейку не встанешь: «выпадающий список на строках не виден, пока
 *   курсором не наведёшь». Свою стрелку `UniverSheet` теперь рисует только
 *   спискам в режиме `TEXT`, если такие где-то остались;
 * * **печать — это печать, а не выбор.** Univer открывает список вместе с
 *   редактором ячейки, и строка поиска списка забирает фокус на второй-третьей
 *   букве: «Ба» оставалось в ячейке, «нковский счёт» уходило в поиск, и Enter
 *   не записывал ничего. Правка, начатая с клавиатуры, остаётся ячейке;
 * * **список — подсказка, судья — сервер** (`WARNING`, а не `STOP`): «дей» +
 *   Enter сервер узнаёт как «Действующий», а незнакомое в закрытом списке
 *   отклоняет с объяснением. Запрет Univer ответил бы своим окном, без слов о
 *   том, где список пополняют;
 * * **правило ставится мутацией** — мимо прав листа и мимо «Отменить»: Ctrl+Z
 *   сразу после открытия листа не должен снимать списки.
 *
 * Список ставят только туда, где правка открыта: на листе «только чтение» он
 * предлагал бы выбор, который не запишется.
 */
import { cellRect } from "@/components/univer/cell-rect";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UniverApi = any;

/** `DataValidationRenderMode.TEXT` — без стрелки; её тогда рисует `UniverSheet` у выбранной ячейки. */
const RENDER_TEXT = 0;
/** `DataValidationRenderMode.ARROW` — стрелка в каждой ячейке списка. */
const RENDER_ARROW = 1;
/** `DataValidationErrorStyle.WARNING` — ввод не запрещается. */
const ERROR_WARNING = 2;
/** `DeviceInputEventType.Keyboard`. */
const KEYBOARD = 4;

export const LIST_MUTATION = {
  add: "data-validation.mutation.addRule",
  remove: "data-validation.mutation.removeRule",
};
const SHOW = "sheet.operation.show-data-validation-dropdown";
const HIDE = "sheet.operation.hide-data-validation-dropdown";

/** Команды, после которых ячейка под стрелкой могла сдвинуться или потерять список. */
const MOVES_CELL = /data-validation|col-width|row-height|row-count|column-count|zoom|freeze|hide-row|hide-col|show-row|show-col/;

export type ListRange = { startRow: number; endRow: number; startColumn: number; endColumn: number };

/**
 * Правило списка по стандарту. `uid` — постоянный адрес правила: по нему его
 * снимают и заменяют, когда поменялся справочник или строки.
 */
export function listRule(uid: string, values: readonly string[], ranges: ListRange[]): Record<string, unknown> {
  return {
    uid,
    type: "list",
    formula1: JSON.stringify(values),
    ranges,
    allowBlank: true,
    showDropDown: true,
    showErrorMessage: false,
    errorStyle: ERROR_WARNING,
    renderMode: RENDER_ARROW,
  };
}

/**
 * Поставить правила на лист. Для раздела, который ставит списки один раз при
 * сборке листа; реестр, у которого строки и справочники меняются по месту,
 * сверяет правила сам (`LIST_MUTATION`).
 */
export function putLists(api: UniverApi, sheetId: string, rules: Array<Record<string, unknown>>): void {
  const unitId = api.getActiveWorkbook?.()?.getId?.();
  if (!unitId) return;
  for (const rule of rules) {
    try {
      api.syncExecuteCommand(LIST_MUTATION.add, { unitId, subUnitId: sheetId, rule });
    } catch (exc) {
      // Список — удобство, а не условие работы листа. Но молчать нельзя:
      // именно так они однажды тихо исчезли на журнале в две тысячи строк, и
      // проверка увидела это раньше человека только потому, что смотрела в
      // консоль.
      console.warn(`список «${String(rule.uid)}» не встал:`, exc);
    }
  }
}

type Rule = { type?: string; renderMode?: number };

/** Правило списка под ячейкой листа; `null` — у ячейки списка нет. */
function listRuleAt(ws: UniverApi, row: number, column: number): Rule | null {
  try {
    const rule = ws?.getRange?.(row, column, 1, 1)?.getDataValidation?.()?.rule as Rule | undefined;
    return rule && (rule.type === "list" || rule.type === "listMultiple") ? rule : null;
  } catch {
    return null;
  }
}

function hideList(api: UniverApi): void {
  try {
    void api.executeCommand?.(HIDE, {});
  } catch {
    /* списка нет — нечего закрывать */
  }
}

/** Открыть список активной ячейки (стрелка, Alt+↓). `false` — у ячейки списка нет. */
export function openList(api: UniverApi): boolean {
  const workbook = api.getActiveWorkbook?.();
  const ws = workbook?.getActiveSheet?.();
  const range = ws?.getActiveRange?.();
  if (!ws || !range) return false;
  const row = range.getRow();
  const column = range.getColumn();
  if (!listRuleAt(ws, row, column)) return false;
  try {
    void api.executeCommand?.(SHOW, { unitId: workbook.getId(), subUnitId: ws.getSheetId(), row, column });
    return true;
  } catch {
    return false;
  }
}

/** Где стоит стрелка списка: в координатах окна, квадрат `size`. */
export type ListArrow = { left: number; top: number; size: number };

export type ListWatch = {
  /** Пересчитать стрелку: например, раздел открыл или закрыл свой слой над ячейкой. */
  refresh: () => void;
  stop: () => void;
};

/**
 * Поведение списков на листе: стрелка у выбранной ячейки, Alt+↓, печать без
 * списка. `host` — узел, внутри которого Univer рисует лист; `allowed` —
 * можно ли сейчас показывать стрелку (раздел держит над ячейкой свой слой).
 */
export function watchLists(
  api: UniverApi,
  host: HTMLElement,
  events: { arrow: (at: ListArrow | null) => void; allowed: () => boolean },
): ListWatch {
  const disposers: Array<() => void> = [];
  const listen = (disposable: { dispose?: () => void } | undefined | null) => {
    if (disposable?.dispose) disposers.push(() => disposable.dispose?.());
  };
  let alive = true;
  let editing = false;
  let frame = 0;
  let idle = 0;
  const timers = new Set<number>();
  const later = (run: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (alive) run();
    }, ms);
    timers.add(id);
  };

  /** Стрелка — на выбранную ячейку со списком; не одна ячейка или идёт правка — убрать. */
  const place = () => {
    frame = 0;
    if (!alive) return;
    if (editing || !events.allowed()) return events.arrow(null);
    const ws = api.getActiveWorkbook?.()?.getActiveSheet?.();
    const range = ws?.getActiveRange?.();
    if (!ws || !range || (range.getHeight?.() ?? 1) > 1 || (range.getWidth?.() ?? 1) > 1) return events.arrow(null);
    const row = range.getRow();
    const column = range.getColumn();
    // Стрелка своя только у списка без оформления: у плашек и стрелок
    // Univer (списки, заведённые в «Таблицах» панелью правил) она уже есть.
    if (listRuleAt(ws, row, column)?.renderMode !== RENDER_TEXT) return events.arrow(null);
    const rect = cellRect(api, host, ws.getSheetId(), row, column);
    if (!rect?.visible) return events.arrow(null);
    const height = rect.bottom - rect.top;
    const size = Math.round(Math.max(14, Math.min(20, height - 4)));
    events.arrow({ left: Math.round(rect.right - size - 2), top: Math.round(rect.top + (height - size) / 2), size });
  };
  const schedule = () => {
    if (alive && !frame) frame = window.requestAnimationFrame(place);
  };

  listen(
    api.addEvent?.(api.Event.SheetEditStarted, (event: { worksheet?: UniverApi; row: number; column: number; eventType?: number }) => {
      editing = true;
      schedule();
      if (event.eventType !== KEYBOARD) return;
      const ws = event.worksheet ?? api.getActiveWorkbook?.()?.getActiveSheet?.();
      if (!listRuleAt(ws, event.row, event.column)) return;
      // Список открывается в той же подписке на редактор, что и событие, —
      // закрываем и сразу, и следующим тактом, и после его отрисовки.
      hideList(api);
      later(() => hideList(api), 0);
      later(() => hideList(api), 60);
    }),
  );
  listen(
    api.addEvent?.(api.Event.SheetEditEnded, () => {
      // Значение из редактора ложится командой чуть позже события.
      later(() => {
        editing = false;
        schedule();
      }, 30);
    }),
  );
  // Прокрутка и масштаб двигают ячейку под стрелкой. Подписка на прокрутку
  // бывает пустой, пока лист не нарисован (см. `cell-rect.ts`), — поэтому
  // стрелка прячется ещё и на колесе мыши, ниже.
  for (const name of ["SelectionChanged", "ActiveSheetChanged", "SheetZoomChanged", "Scroll"]) {
    const kind = api.Event?.[name];
    if (kind) listen(api.addEvent?.(kind, schedule));
  }
  // Раздел поставил или снял правило, поменялась ширина колонки — стрелка
  // могла оказаться не там или не у того.
  listen(
    api.onCommandExecuted?.((command: { id: string }) => {
      if (MOVES_CELL.test(command.id)) schedule();
    }),
  );

  const onWheel = () => {
    events.arrow(null);
    window.clearTimeout(idle);
    idle = window.setTimeout(schedule, 160);
  };
  // Alt+↓ — список ячейки, как в Excel. В редакторе ячейки клавиша его.
  const onKey = (event: KeyboardEvent) => {
    if (!event.altKey || event.key !== "ArrowDown" || editing) return;
    if (openList(api)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  host.addEventListener("wheel", onWheel, { capture: true, passive: true });
  host.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", schedule);
  disposers.push(() => {
    host.removeEventListener("wheel", onWheel, { capture: true });
    host.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", schedule);
  });

  return {
    refresh: schedule,
    stop: () => {
      alive = false;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(idle);
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
      disposers.forEach((stop) => stop());
    },
  };
}
