"use client";

/**
 * Привычки учётки на стороне экрана (сервер - `app/finance/habits.py`).
 *
 * 29.09.2026: «сотрудник часто открывает таблицу, а с карточками не работает -
 * при следующих заходах программа сразу должна показать табличный вид».
 * Раньше вид реестра помнился только последним щелчком в этом браузере, а на
 * другом компьютере или после входа реестр открывался карточками.
 *
 * Здесь две вещи:
 *
 * * **замер** (`useModeTracker`) - минуты настоящей работы в виде: вкладка на
 *   виду, и за последние две минуты была мышь, клавиша или колесо. Открытая и
 *   забытая вкладка не считается. Отчёт - раз в минуту работы, при смене вида
 *   и при уходе со страницы; явный щелчок по «Карточки / Таблица» - сразу
 *   (`pickMode`);
 * * **вид по умолчанию** (`preferOf`) - что сервер считает привычкой. Приходит
 *   вместе с «кто я» (`me.habits`), так что вход открывает нужный вид с
 *   первого кадра и на новом компьютере; ответ на отчёт свежее - он главнее,
 *   пока страница открыта.
 *
 * Группы - любые разделы с несколькими видами; сейчас это два реестра
 * (`REGISTRIES` в `finance-client.tsx`).
 */
import { useEffect } from "react";

import { habitsApi } from "@/components/finance/api";

type Prefer = Record<string, string>;

/** Привычка из ответов на отчёты этой страницы - свежее, чем `me.habits` с прошлого опроса. */
const fresh = new Map<string, Prefer>();

/** Чья привычка: `учётка:компания`. Пусто - никто не вошёл. */
export function habitsOwner(userId: string | null, companyId: string | null): string {
  return userId && companyId ? `${userId}:${companyId}` : "";
}

function remember(owner: string, next: Prefer): void {
  fresh.set(owner, next ?? {});
}

/** Вид по привычке для группы; `null` - привычки ещё нет. `fromMe` - `me.habits`. */
export function preferOf(owner: string, group: string, fromMe?: Readonly<Record<string, string>> | null): string | null {
  if (!owner) return null;
  const known = fresh.get(owner);
  if (known) return known[group] ?? null;
  return fromMe?.[group] ?? null;
}

function report(owner: string, group: string, mode: string, minutes: number, pick: boolean, keepalive = false): void {
  habitsApi
    .report(group, { mode, minutes: Math.round(minutes * 100) / 100, pick }, keepalive)
    .then((answer) => remember(owner, answer.prefer))
    .catch(() => undefined);
}

/** Человек сам выбрал вид - голос сразу, не дожидаясь минут. */
export function pickMode(owner: string, group: string, mode: string): void {
  if (owner) report(owner, group, mode, 0, true);
}

const TICK = 5_000;
const IDLE = 120_000;
const FLUSH = 60_000;
const INPUTS = ["pointerdown", "pointermove", "keydown", "wheel"] as const;

/** Считать минуты работы в виде `mode` группы `group`, пока он открыт. */
export function useModeTracker(owner: string, group: string | null, mode: string | null): void {
  useEffect(() => {
    if (!owner || !group || !mode) return;
    let worked = 0;
    let lastInput = Date.now();
    let tickAt = Date.now();
    const flush = (keepalive = false) => {
      const minutes = worked / 60_000;
      worked = 0;
      // Меньше трёх секунд - это не работа, а проход мимо.
      if (minutes >= 0.05) report(owner, group, mode, minutes, false, keepalive);
    };
    const onInput = () => {
      lastInput = Date.now();
    };
    const timer = window.setInterval(() => {
      const now = Date.now();
      const step = Math.min(now - tickAt, TICK * 2);
      tickAt = now;
      if (document.visibilityState === "visible" && now - lastInput < IDLE) worked += step;
      if (worked >= FLUSH) flush();
    }, TICK);
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush(true);
    };
    const onLeave = () => flush(true);
    // На захвате: лист Univer гасит часть событий у себя, до окна они не всплывают.
    const opts = { capture: true, passive: true } as const;
    for (const type of INPUTS) window.addEventListener(type, onInput, opts);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.clearInterval(timer);
      for (const type of INPUTS) window.removeEventListener(type, onInput, opts);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onLeave);
      flush();
    };
  }, [owner, group, mode]);
}
