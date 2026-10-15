"use client";

/**
 * Окно поддержки - одно на страницу, а открыть его может кто угодно: значок
 * в шапке, «Написать» в объявлении, напоминание об ответе. Поэтому открыто
 * ли оно - во внешнем хранилище, а не в состоянии одного компонента.
 *
 * Здесь же - что человек уже прочитал. `me` перечитывается раз в 20 с, и
 * ответ из опроса, начатого до того, как переписку открыли, вернул бы значку
 * «Ответ поддержки» на секунду-другую. Прочитанное помнится по времени
 * сервера (самый свежий ответ на экране), а не по часам компьютера: часы
 * бывают сбиты, и новый ответ спрятался бы за ними.
 */
import { useSyncExternalStore } from "react";

import type { SupportState } from "@/components/finance/api";

let chatOpen = false;
/** Время (ISO сервера) самого свежего ответа, который человек уже видел. */
let readThrough = "";
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openSupport(): void {
  if (chatOpen) return;
  chatOpen = true;
  emit();
}

export function closeSupport(): void {
  if (!chatOpen) return;
  chatOpen = false;
  emit();
}

export function useSupportOpen(): boolean {
  return useSyncExternalStore(subscribe, () => chatOpen, () => false);
}

/** Ответы до этого времени (сервера) прочитаны - даже если `me` ещё не знает. */
export function markReadThrough(at: string): void {
  if (!at || (readThrough && Date.parse(at) <= Date.parse(readThrough))) return;
  readThrough = at;
  emit();
}

/** Выход из учётки: прочитанное - чужое для следующей. */
export function forgetSupport(): void {
  readThrough = "";
  chatOpen = false;
  emit();
}

/** Сколько ответов ждут человека - с поправкой на только что прочитанное. */
export function useSupportUnread(state: SupportState | undefined): number {
  const through = useSyncExternalStore(subscribe, () => readThrough, () => "");
  if (!state?.unread || !state.last_reply) return 0;
  if (through && Date.parse(state.last_reply.at) <= Date.parse(through)) return 0;
  return state.unread;
}
