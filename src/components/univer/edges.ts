/**
 * Рамка выделения останавливается у края листа - общий для листов.
 *
 * Univer 0.25 на шаге за край переносит рамку (`findNextRange` в
 * `@univerjs/sheets-ui`): стрелка вправо в последней колонке уводила её в
 * первую колонку следующей строки, влево в первой - в последнюю колонку
 * строки выше, вверх в первой строке - в последнюю строку листа. Лист
 * прокручивался вслед за рамкой, и человек, который вёл её вправо, чтобы
 * досмотреть широкую таблицу до последней колонки, оказывался в начале
 * следующей строки (15.10.2026: «докручивает и резко перепрыгивает на новую
 * строку, и вид возвращается на первую колонку»). Как в Excel и Google
 * Sheets, у края рамка теперь стоит.
 *
 * Проверка повторяет решение самого Univer: ближайшая видимая строка или
 * колонка в сторону шага (скрытые и отобранные фильтром он перешагивает).
 * Если её нет - шаг вёл бы через край, и команда отменяется до исполнения
 * (`guardCommands`): ни выделение, ни прокрутка не двигаются.
 *
 * Ctrl+стрелка (`moveGap`) идёт к краю данных и через край листа не
 * переносит - её не трогаем. Enter и Tab внутри выделенного диапазона
 * по-прежнему ходят по кругу его ячеек: это обход диапазона, а не край листа.
 * В формуле (режим выбора ссылки) стрелки водят ссылку - их тоже не трогаем.
 */
import { Direction, IContextService, IUniverInstanceService } from "@univerjs/core";
import {
  REF_SELECTIONS_ENABLED,
  SheetsSelectionsService,
  getSheetCommandTarget,
} from "@univerjs/preset-sheets-core";

import { guardCommands, type SheetCommand } from "@/components/univer/guard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UniverApi = any;

const MOVE = "sheet.command.move-selection";
const ENTER_TAB = "sheet.command.move-selection-enter-tab";
/** `JumpOver.moveGap` - Ctrl+стрелка. */
const MOVE_GAP = 1;

type Range = { startRow: number; endRow: number; startColumn: number; endColumn: number };
type SheetModel = {
  getRowCount: () => number;
  getColumnCount: () => number;
  getRowVisible: (row: number) => boolean;
  getColVisible: (column: number) => boolean;
};
type Selection = { range: Range; primary?: (Range & { actualRow: number; actualColumn: number }) | null };

/** Шаг из `range` в сторону `direction` вышел бы за край листа. */
export function atEdge(sheet: SheetModel, range: Range, direction: Direction): boolean {
  switch (direction) {
    case Direction.UP: {
      let row = range.startRow - 1;
      while (row >= 0 && !sheet.getRowVisible(row)) row -= 1;
      return row < 0;
    }
    case Direction.DOWN: {
      const count = sheet.getRowCount();
      let row = range.endRow + 1;
      while (row < count && !sheet.getRowVisible(row)) row += 1;
      return row >= count;
    }
    case Direction.LEFT: {
      let column = range.startColumn - 1;
      while (column >= 0 && !sheet.getColVisible(column)) column -= 1;
      return column < 0;
    }
    case Direction.RIGHT: {
      const count = sheet.getColumnCount();
      let column = range.endColumn + 1;
      while (column < count && !sheet.getColVisible(column)) column += 1;
      return column >= count;
    }
    default:
      return false;
  }
}

function sameCell(a: Range, b: Range): boolean {
  return (
    a.startRow === b.startRow && a.endRow === b.endRow && a.startColumn === b.startColumn && a.endColumn === b.endColumn
  );
}

/** Остановить рамку у края. Возвращает функцию снятия. */
export function stopAtEdges(api: UniverApi): () => void {
  const injector = api._injector;
  const context = () => {
    const target = getSheetCommandTarget(injector.get(IUniverInstanceService));
    const selections = injector.get(SheetsSelectionsService) as {
      getCurrentLastSelection: () => Selection | null | undefined;
      getCurrentSelections: () => readonly Selection[];
    };
    return target ? { sheet: target.worksheet as unknown as SheetModel, selections } : null;
  };
  const refMode = (params: Record<string, unknown>) =>
    !params.fromCurrentSelection && Boolean(injector.get(IContextService).getContextValue(REF_SELECTIONS_ENABLED));

  const move = (command: SheetCommand): boolean => {
    const params = command.params ?? {};
    const direction = params.direction as Direction | undefined;
    if (direction === undefined || params.jumpOver === MOVE_GAP || refMode(params)) return false;
    const now = context();
    const range = now?.selections.getCurrentLastSelection()?.range;
    return Boolean(now && range && atEdge(now.sheet, range, direction));
  };

  const enterTab = (command: SheetCommand): boolean => {
    const params = command.params ?? {};
    const direction = params.direction as Direction | undefined;
    if (direction === undefined) return false;
    const now = context();
    const current = now?.selections.getCurrentSelections().find((item) => item.primary);
    // Выделен диапазон - Enter и Tab обходят его ячейки по кругу, как задумано.
    if (!now || !current?.primary || !sameCell(current.range, current.primary)) return false;
    return atEdge(now.sheet, current.range, direction);
  };

  // Структурные команды здесь не решаются: их перехватывает раздел своим `guardCommands`.
  const guard = guardCommands(api, () => false, { [MOVE]: move, [ENTER_TAB]: enterTab });
  return guard.stop;
}
