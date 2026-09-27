"use client";

/**
 * Состояние на время сессии вкладки: переживает перезагрузку страницы.
 *
 * Открыто окно операции, заполнено полформы — и сайт перезагрузился (выкладка,
 * случайный F5, телефон выгрузил вкладку). Раньше всё начиналось с чистого
 * листа. Теперь окно встаёт обратно с тем, что в нём было, лист — на той же
 * ячейке, фильтры — те же. Просьба пользователя 27.09.2026: «любое состояние
 * сохраняется на момент сессии… ровно с последнего события».
 *
 * Как устроено:
 *
 * * **`sessionStorage`**, а не `localStorage`: живёт, пока открыта вкладка, и
 *   переживает перезагрузку; новая вкладка начинает с чистого. Черновик,
 *   всплывший через неделю в другом окне, был бы чужим;
 * * **область — учётка и компания** (`SessionScope`): черновик одной учётки не
 *   всплывёт у другой, вошедшей в той же вкладке. Выход из учётки стирает всё
 *   (`dropAllSessions`) — компьютер бывает общим;
 * * **пишется только тронутое**: пока человек ничего не менял, в хранилище
 *   пусто, и начальное значение считается заново (новая дата «сегодня», новый
 *   справочник);
 * * **форма сверяется с начальным**: объект дополняется полями начального
 *   значения, чужой тип отбрасывается. Выкладка, поменявшая форму состояния,
 *   не роняет экран восстановленным старьём;
 * * **черновик стирают явно** — при сохранении и при закрытии окна человеком
 *   (`useSessionDrop`). Перезагрузка окно не закрывает, поэтому черновик живёт.
 *
 * Не запоминается нарочно: подтверждения «Удалить?» (разрушительное действие
 * не должно всплывать само), пароли и токены, «идёт запрос» и тексты ошибок,
 * данные сервера — их перечитывают.
 */
import { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

const PREFIX = "ses|";

const ScopeContext = createContext("");

/** Чьё состояние: учётка и компания. Без области — общее (листы «Таблиц»). */
export function SessionScope({ scope, children }: { scope: string; children: ReactNode }) {
  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}

export function useSessionScope(): string {
  return useContext(ScopeContext);
}

const fullKey = (scope: string, key: string) => `${PREFIX}${scope}|${key}`;

function read(full: string): unknown {
  try {
    const raw = window.sessionStorage.getItem(full);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function write(full: string, value: unknown): void {
  try {
    if (value === undefined) window.sessionStorage.removeItem(full);
    else window.sessionStorage.setItem(full, JSON.stringify(value));
  } catch {
    /* хранилище переполнено или запрещено — живём без запоминания */
  }
}

function removeWhere(test: (key: string) => boolean): void {
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key && test(key)) keys.push(key);
    }
    keys.forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    /* нет хранилища — нечего и стирать */
  }
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Восстановленное — если той же формы, что начальное; объект дополняется новыми полями. */
function restore<T>(stored: unknown, initial: T): T {
  if (stored === undefined) return initial;
  if (initial === null || initial === undefined) return stored as T;
  if (isPlain(initial)) return isPlain(stored) ? ({ ...initial, ...stored } as T) : initial;
  if (Array.isArray(initial)) return Array.isArray(stored) ? (stored as T) : initial;
  return typeof stored === typeof initial ? (stored as T) : initial;
}

/** Прочитать без хука — для кода вне React (лист Univer). */
export function readSession<T>(scope: string, key: string, initial: T): T {
  return typeof window === "undefined" ? initial : restore(read(fullKey(scope, key)), initial);
}

/** Записать без хука; `undefined` стирает. */
export function writeSession(scope: string, key: string, value: unknown): void {
  if (typeof window !== "undefined") write(fullKey(scope, key), value);
}

/**
 * `useState`, переживающий перезагрузку вкладки. `key` — адрес внутри области
 * («journal.filters», «op.new.expense.amount»); `null` — не запоминать.
 * Третий элемент — «забыть»: стереть и не писать, пока значение не тронут
 * снова.
 */
export function useSessionState<T>(
  key: string | null,
  initial: T | (() => T),
): readonly [T, Dispatch<SetStateAction<T>>, () => void] {
  return useSessionStateIn(useContext(ScopeContext), key, initial);
}

/**
 * То же с явной областью — для того, кто сам её и задаёт (оболочка раздела
 * монтируется раньше, чем узнаёт учётку).
 *
 * Сменились область или ключ — значение перечитывается: оболочка «Финансов»
 * рендерится до входа с пустой областью, и прочитай хук хранилище один раз,
 * окно операции после перезагрузки так и не встало бы.
 */
export function useSessionStateIn<T>(
  scope: string,
  key: string | null,
  initial: T | (() => T),
): readonly [T, Dispatch<SetStateAction<T>>, () => void] {
  const full = key === null ? null : fullKey(scope, key);
  const start = (at: string | null): T => {
    const value = typeof initial === "function" ? (initial as () => T)() : initial;
    return at && typeof window !== "undefined" ? restore(read(at), value) : value;
  };
  // `touched` — в самом состоянии: пишется только тронутое, «забыть» его снимает.
  const [slot, setSlot] = useState<{ full: string | null; value: T; touched: boolean }>(() => ({
    full,
    value: start(full),
    touched: false,
  }));
  let current = slot;
  if (slot.full !== full) {
    // Производное состояние на рендере — приём из документации React: без
    // эффекта и без кадра со старым значением.
    current = { full, value: start(full), touched: false };
    setSlot(current);
  }
  const set = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setSlot((was) => ({
      full: was.full,
      touched: true,
      value: typeof next === "function" ? (next as (prev: T) => T)(was.value) : next,
    }));
  }, []);
  useEffect(() => {
    if (slot.full && slot.touched) write(slot.full, slot.value);
  }, [slot]);
  const forget = useCallback(() => {
    if (full) write(full, undefined);
    setSlot((was) => ({ ...was, touched: false }));
  }, [full]);
  return [current.value, set, forget] as const;
}

/**
 * Стереть черновик целиком: ключ и всё под ним («op.new.expense» стирает и
 * «op.new.expense.amount»). Зовут при сохранении и при закрытии окна человеком.
 */
export function useSessionDrop(): (prefix: string) => void {
  const scope = useContext(ScopeContext);
  return useCallback(
    (prefix: string) => {
      const base = fullKey(scope, prefix);
      removeWhere((key) => key === base || key.startsWith(`${base}.`));
    },
    [scope],
  );
}

/** Выход из учётки: стереть всё запомненное во вкладке. */
export function dropAllSessions(): void {
  if (typeof window !== "undefined") removeWhere((key) => key.startsWith(PREFIX));
}
