/**
 * Перехват команд Univer, которые меняют таблицу для всех, — общий для листов.
 *
 * До 29.09.2026 листы защищались механизмом Univer (`protect.ts`): защищённый
 * лист, запреты вставки строк и колонок, колонки «только чтение» диапазоном.
 * Цена — замки на вкладках и отказ «Диапазон защищён, у вас нет разрешения на
 * установку стилей» на обычной заливке: строка, выделенная по «№», задевала
 * защищённую колонку «№», и Univer отказывал во всём выделении. Пользователь
 * попросил снять блокировку целиком, а ломающее действие — предупреждать
 * окном, где сказано, что именно изменится.
 *
 * Теперь лист ничего не запрещает механизмом прав. Раздел называет команды,
 * которые ему нужно решить самому (вставка и удаление строк и колонок,
 * переименование листа…), и решает: пропустить как есть или отменить и
 * показать своё окно. Отмена — тем же путём, что у проверки прав Univer:
 * исключение `CanceledError` в `beforeCommandExecuted`. Univer при этом
 * оставляет команду в стеке исполнения (память проекта: «отмена через
 * исключение оставляет запись»), и следующие мутации считали бы её своим
 * источником — поэтому запись снимается сразу после отмены.
 */
import { CanceledError, ICommandService } from "@univerjs/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UniverApi = any;

export type SheetCommand = { id: string; params?: Record<string, unknown> };

export type CommandGuard = {
  /** Выполнить своё (команды Univer внутри) мимо перехвата. */
  pass: <T>(run: () => T) => T;
  stop: () => void;
};

/**
 * Структурные команды Univer 0.25, общие для листов. Перехватываются и
 * «входные» (`…-confirm`, которые сначала показывают своё окно Univer), и
 * базовые: пункт меню зовёт первую, горячая клавиша — иногда сразу вторую.
 */
export const STRUCTURE_COMMANDS = {
  insertRows: [
    "sheet.command.insert-row",
    "sheet.command.insert-row-before",
    "sheet.command.insert-row-after",
    "sheet.command.insert-multi-rows-above",
    "sheet.command.insert-multi-rows-after",
    "sheet.command.insert-row-by-range",
  ],
  removeRows: ["sheet.command.remove-row-confirm", "sheet.command.remove-row", "sheet.command.remove-row-by-range"],
  insertCols: [
    "sheet.command.insert-col",
    "sheet.command.insert-col-before",
    "sheet.command.insert-col-after",
    "sheet.command.insert-multi-cols-before",
    "sheet.command.insert-multi-cols-right",
    "sheet.command.insert-col-by-range",
  ],
  removeCols: ["sheet.command.remove-col-confirm", "sheet.command.remove-col", "sheet.command.remove-col-by-range"],
  moveRows: ["sheet.command.move-rows"],
  moveCols: ["sheet.command.move-cols"],
  shiftCells: [
    "sheet.command.insert-range-move-down-confirm",
    "sheet.command.insert-range-move-right-confirm",
    "sheet.command.delete-range-move-left-confirm",
    "sheet.command.delete-range-move-up-confirm",
    "sheet.command.insert-range-move-down",
    "sheet.command.insert-range-move-right",
    "sheet.command.delete-range-move-left",
    "sheet.command.delete-range-move-up",
  ],
  merge: [
    "sheet.command.add-worksheet-merge",
    "sheet.command.add-worksheet-merge-all",
    "sheet.command.add-worksheet-merge-horizontal",
    "sheet.command.add-worksheet-merge-vertical",
  ],
  renameSheet: ["sheet.command.set-worksheet-name"],
  removeSheet: ["sheet.command.remove-sheet-confirm", "sheet.command.remove-sheet"],
  addSheet: ["sheet.command.insert-sheet", "sheet.command.copy-sheet"],
  orderSheets: ["sheet.command.set-worksheet-order"],
  protect: [
    "sheet.command.add-worksheet-protection",
    "sheet.command.set-worksheet-protection",
    "sheet.command.add-range-protection",
    "sheet.command.add-range-protection-from-toolbar",
    "sheet.command.add-range-protection-from-context-menu",
    "sheet.command.add-range-protection-from-sheet-bar",
    "sheet.command.change-sheet-protection-from-sheet-bar",
    "sheet.command.set-range-protection-from-context-menu",
    "sheet.command.set-protection",
  ],
  // Все варианты сортировки (по возрастанию, по нескольким колонкам) зовут её.
  sort: ["sheet.command.sort-range"],
} as const;

export type StructureKind = keyof typeof STRUCTURE_COMMANDS;

const KIND_OF = new Map<string, StructureKind>(
  (Object.entries(STRUCTURE_COMMANDS) as [StructureKind, readonly string[]][]).flatMap(([kind, ids]) =>
    ids.map((id) => [id, kind] as [string, StructureKind]),
  ),
);

export function kindOf(id: string): StructureKind | null {
  return KIND_OF.get(id) ?? null;
}

/**
 * Пункты меню Univer про защиту листа — прячутся у всех листов: защита листа
 * в продукте больше не держит данные, а поставленная человеком вернула бы
 * замки и отказы «нет разрешения».
 */
export const PROTECTION_MENU = [
  "sheet.contextMenu.permission",
  "sheet.command.add-range-protection-from-context-menu",
  "sheet.command.set-range-protection-from-context-menu",
  "sheet.command.delete-range-protection-from-context-menu",
  "sheet.command.view-sheet-permission-from-context-menu",
  "sheet.command.add-range-protection-from-sheet-bar",
  "sheet.command.change-sheet-protection-from-sheet-bar",
  "sheet.command.delete-worksheet-protection-from-sheet-bar",
  "sheet.command.view-sheet-permission-from-sheet-bar",
  "sheet.command.add-range-protection-from-toolbar",
];

/**
 * Решать структурные команды разделу. `decide` вызывается синхронно, до
 * команды: `true` — отменить (раздел сделает своё или объяснит), `false` —
 * пропустить. Команды, исполненные через `pass`, не перехватываются.
 */
export function guardCommands(
  api: UniverApi,
  decide: (command: SheetCommand, kind: StructureKind) => boolean,
  /** Другие команды, которые раздел решает сам: id → «отменить?». */
  extra: Record<string, (command: SheetCommand) => boolean> = {},
): CommandGuard {
  let passing = 0;
  let service: {
    beforeCommandExecuted: (listener: (info: SheetCommand, options?: Record<string, unknown>) => void) => { dispose?: () => void };
    _commandExecutionStack?: unknown[];
  } | null = null;
  try {
    service = api._injector.get(ICommandService);
  } catch {
    service = null;
  }
  const disposable = service?.beforeCommandExecuted((info, options) => {
    if (passing > 0 || options?.fromCollab || options?.onlyLocal) return;
    const kind = kindOf(info.id);
    const own = extra[info.id];
    if (!kind && !own) return;
    let cancel = false;
    try {
      cancel = own ? own(info) : decide(info, kind as StructureKind);
    } catch (exc) {
      console.warn("решение по команде листа не принято:", exc);
      cancel = false;
    }
    if (!cancel) return;
    // Univer оставил бы отменённую команду в стеке исполнения навсегда.
    queueMicrotask(() => {
      const stack = service?._commandExecutionStack;
      if (!Array.isArray(stack)) return;
      const at = stack.lastIndexOf(info);
      if (at >= 0) stack.splice(at, 1);
    });
    throw new CanceledError();
  });
  return {
    pass: (run) => {
      passing += 1;
      try {
        return run();
      } finally {
        passing -= 1;
      }
    },
    stop: () => disposable?.dispose?.(),
  };
}

/** Текущее выделение активного листа — диапазоны (для команд без своих параметров). */
export type SelectedRange = { startRow: number; endRow: number; startColumn: number; endColumn: number; rangeType?: number };

export function selectedRanges(api: UniverApi): SelectedRange[] {
  try {
    const ws = api.getActiveWorkbook?.()?.getActiveSheet?.();
    return ((ws?.getSelection?.()?._selections ?? []) as { range: SelectedRange }[]).map((item) => item.range);
  } catch {
    return [];
  }
}

/** Диапазон команды: из её параметров, иначе — из выделения. */
export function rangesOf(api: UniverApi, command: SheetCommand): SelectedRange[] {
  const params = command.params ?? {};
  const range = (params.range ?? params.fromRange) as SelectedRange | undefined;
  if (range && typeof range.startRow === "number") return [range];
  const ranges = params.ranges as SelectedRange[] | undefined;
  if (Array.isArray(ranges) && ranges.length) return ranges;
  return selectedRanges(api);
}
