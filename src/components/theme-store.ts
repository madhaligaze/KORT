"use client";

import { useSyncExternalStore } from "react";

/**
 * Тема: выбор человека и то, что стоит на экране.
 *
 * Выбор — «светлая», «тёмная» или «как в системе» (в localStorage ничего нет).
 * Что стоит на экране — атрибут `data-theme` на <html>: первым его ставит
 * скрипт до гидратации (app/layout.tsx), дальше — этот модуль, в том числе
 * вслед за системой, пока человек не выбрал сам. Тумблер один — на входе и в шапке приложения
 * (`stage/theme-switch.tsx`); строку «Тема» в кабинете сняли 28.09.2026, и
 * вернуться к «как в системе» из интерфейса больше нельзя — `setChoice("system")`
 * остался для этого случая.
 *
 * Смена темы плавная для всей страницы — одним растворением через View
 * Transitions: браузер снимает кадр в старой теме, тема под ним меняется
 * мгновенно, и два кадра растворяются друг в друге на видеокарте за
 * `--stage-shift` (globals.css, «Смена темы»). Дым, лист Univer и форма входят
 * в кадр как есть — общий переход у всего, что на экране.
 *
 * До 28.09.2026 переход держал класс `.theme-shift`: он вешал transition цвета
 * на каждый элемент страницы и через 950 мс снимался таймером. Внутри
 * приложения это тысячи одновременных переходов — смена шла рывками; на входе
 * снятие класса на несколько кадров возвращало вуали сцены старый цвет —
 * вспышка в конце. Поэлементные переходы цвета не возвращать.
 *
 * Без View Transitions (старый браузер) и при «меньше движения» тема
 * меняется сразу.
 */
export type ThemeChoice = "light" | "dark" | "system";
export type Theme = "light" | "dark";

const KEY = "theme";
const listeners = new Set<() => void>();

export function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === "dark" || stored === "light" ? stored : "system";
  } catch {
    return "system";
  }
}

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

let shifting: ViewTransition | null = null;

/** Поставить тему на экран — с плавным переходом всей страницы. */
export function applyTheme(next: Theme) {
  const html = document.documentElement;
  if (html.getAttribute("data-theme") === next) return;
  const swap = () => html.setAttribute("data-theme", next);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Скрытая вкладка (тема сменилась вслед за системой) кадр не снимет.
  if (reduced || typeof document.startViewTransition !== "function" || document.visibilityState !== "visible") {
    swap();
    return;
  }
  // `.theme-vt` живёт, пока идёт растворение: по нему тумблер выходит из общего
  // кадра, и его черта едет своим ходом, а не растворяется вдвоём с прежней.
  html.classList.add("theme-vt");
  const transition = document.startViewTransition(swap);
  shifting = transition;
  transition.finished.finally(() => {
    // Новое нажатие посреди растворения обрывает прежнее — класс снимает последнее.
    if (shifting !== transition) return;
    shifting = null;
    html.classList.remove("theme-vt");
  });
}

export function setChoice(next: ThemeChoice) {
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    /* приватный режим — выбор не запомнится, но экран переключится */
  }
  applyTheme(next === "system" ? systemTheme() : next);
  listeners.forEach((listener) => listener());
}

// Пока человек не выбрал тему сам, страница идёт за системой — сразу, без
// перезагрузки, тем же растворением, что у тумблера. Слушатель жил в скрипте
// layout.tsx и менял тему своим кодом, мимо общего перехода.
if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
    if (readChoice() === "system") applyTheme(event.matches ? "dark" : "light");
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  // Атрибут меняется не только отсюда: у переходов он встаёт позже вызова.
  const watch = new MutationObserver(listener);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
    watch.disconnect();
  };
}

/** Выбор человека: светлая, тёмная или как в системе. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, readChoice, () => "system" as ThemeChoice);
}

/** Что стоит на экране сейчас. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => "dark" as Theme);
}
