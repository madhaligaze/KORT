"use client";

import { useSyncExternalStore } from "react";

/**
 * Тема: выбор человека и то, что стоит на экране.
 *
 * Выбор — «светлая», «тёмная» или «как в системе» (в localStorage ничего нет).
 * Что стоит на экране — атрибут `data-theme` на <html>: его ставит скрипт до
 * гидратации (app/layout.tsx), он же переключает тему вслед за системой, пока
 * человек не выбрал сам. Тумблер на входе и строка «Тема» в кабинете читают и
 * пишут одно и то же, поэтому разойтись не могут.
 *
 * Смена темы плавная для всей страницы: на время перехода на <html> висит
 * `.theme-shift`, и цвета фонов, текста и рамок перетекают за `--stage-shift`
 * — ту же длительность, за которую перетекает дымовая сцена. Без этого сцена
 * менялась бы плавно, а форма рядом — щелчком.
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

let shiftTimer: number | undefined;

/** Поставить тему на экран — с плавным переходом всей страницы. */
export function applyTheme(next: Theme) {
  const html = document.documentElement;
  if (html.getAttribute("data-theme") === next) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced) {
    const ms = parseFloat(getComputedStyle(html).getPropertyValue("--stage-shift")) || 900;
    html.classList.add("theme-shift");
    window.clearTimeout(shiftTimer);
    shiftTimer = window.setTimeout(() => html.classList.remove("theme-shift"), ms + 50);
  }
  html.setAttribute("data-theme", next);
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

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  // Тема меняется и без нас: вслед за системой (скрипт в layout.tsx).
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
