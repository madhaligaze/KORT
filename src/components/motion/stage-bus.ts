"use client";

/**
 * Закрыт ли экран занавесом перехода.
 *
 * Страница, в которую ведёт переход, монтируется, пока занавес ещё опущен, и
 * её собственный вход отыграл бы целиком за занавесом — человек увидел бы уже
 * собранный экран, а вход, ради которого всё затевалось, пропал бы. Поэтому
 * входы ждут здесь: пока занавес опущен, обещание висит; поднялся — выполнено.
 *
 * Состояние модульное, а не в контексте React: входы живут в компонентах,
 * которые не обязаны лежать внутри провайдера (стартовый экран, экраны входа),
 * и тянуть к каждому контекст ради одного флага незачем.
 */
let clear: Promise<void> = Promise.resolve();
let release: (() => void) | null = null;

export function markStageCovered(): void {
  if (release) return;
  clear = new Promise<void>((resolve) => {
    release = resolve;
  });
}

export function markStageClear(): void {
  release?.();
  release = null;
}

export function whenStageClear(): Promise<void> {
  return clear;
}

/**
 * Страница просит не поднимать занавес, пока она не соберётся.
 *
 * Нужна тяжёлым экранам: лист Univer — это ~7 МБ кода и сборка книги, по
 * полсекунды и больше на главном потоке. Поднимись занавес одновременно с
 * этой работой — подъём дёргается, а под ним видно, как экран складывается
 * по частям. Держит не дольше, чем решит переход (см. `stage-transition.tsx`):
 * медленная сеть не должна превращать занавес в чёрный экран.
 */
const holds = new Set<symbol>();
let onRelease: (() => void) | null = null;

export function holdStage(): () => void {
  const token = Symbol("stage-hold");
  holds.add(token);
  return () => {
    if (holds.delete(token) && holds.size === 0) onRelease?.();
  };
}

export function stageHeld(): boolean {
  return holds.size > 0;
}

/** Переход подписывается, чтобы поднять занавес, как только отпустили последнее. */
export function onStageReleased(listener: () => void): () => void {
  onRelease = listener;
  return () => {
    if (onRelease === listener) onRelease = null;
  };
}
