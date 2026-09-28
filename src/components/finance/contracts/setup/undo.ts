"use client";

/**
 * Право на ошибку в «Настроить реестр»: каждая правка знает, как её вернуть.
 *
 * 28.09.2026 владелец случайно нажал «спрятано» у «Планируемого срока
 * завершения» — поле пропало из листа и карточки у всех, а как вернуть, было
 * непонятно: вторая половина переключателя читалась подписью, а не кнопкой.
 * Теперь правка кладёт сюда обратное действие, строка внизу экрана говорит,
 * что сделано, и «Вернуть» (или Ctrl+Z вне поля ввода) возвращает как было.
 *
 * Стек общий для всех вкладок настройки — правку на «Полях» можно вернуть,
 * уйдя на «Листы». Живёт, пока открыт экран настройки: вернуть правку, у
 * которой за это время могли смениться соседи, спустя час — уже не отмена, а
 * новая правка, и её делают руками.
 */
import { useSyncExternalStore } from "react";

export type UndoEntry = {
  id: number;
  /** Что сделано, словами: «„Планируемый срок завершения“ спрятано». */
  text: string;
  /** Обратное действие — запрос к серверу. */
  revert: () => Promise<unknown>;
  /** Что перечитать после отмены: сведение значений меняет сами договоры. */
  after: "schema" | "all";
};

export type UndoNotice =
  | { kind: "done"; entry: UndoEntry }
  | { kind: "reverting"; entry: UndoEntry }
  | { kind: "reverted"; entry: UndoEntry }
  | { kind: "failed"; entry: UndoEntry; error: string };

type State = { stack: UndoEntry[]; notice: UndoNotice | null };

const LIMIT = 30;
let state: State = { stack: [], notice: null };
let counter = 0;
const listeners = new Set<() => void>();

function set(next: State): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function pushUndo(entry: Omit<UndoEntry, "id" | "after"> & { after?: UndoEntry["after"] }): void {
  counter += 1;
  const full: UndoEntry = { id: counter, after: "schema", ...entry };
  set({ stack: [...state.stack.slice(-(LIMIT - 1)), full], notice: { kind: "done", entry: full } });
}

/** Снять верхнюю правку со стека — для отмены. */
export function takeUndo(): UndoEntry | null {
  const top = state.stack[state.stack.length - 1];
  if (!top) return null;
  set({ stack: state.stack.slice(0, -1), notice: { kind: "reverting", entry: top } });
  return top;
}

export function noticeUndo(notice: UndoNotice | null): void {
  set({ ...state, notice });
}

/** Экран настройки закрыли — старые отмены больше не наши. */
export function clearUndo(): void {
  set({ stack: [], notice: null });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUndo(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** «Планируемый срок завершения» → «„Планируемый…“» для строки отмены. */
export function quoted(text: string): string {
  return `«${text}»`;
}
