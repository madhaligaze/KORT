"use client";

/**
 * Единственная точка входа в GSAP.
 *
 * Плагины регистрируются здесь один раз, и каждый модуль берёт gsap отсюда, а не
 * из пакета напрямую: импорт `gsap/SplitText` в двух местах без регистрации
 * даёт плагин, который молча ничего не делает, — ошибки нет, текста нет.
 *
 * Кривые продукта — две, и обе взяты из референсов, а не подобраны:
 *   glide — cubic-bezier(0.19, 1, 0.22, 1) у monopo: элементы скользят и
 *           дотягиваются, а не щёлкают на место. Это `expo.out` GSAP почти
 *           точка в точку, поэтому своя кривая не заводится;
 *   carve — power4.inOut, для занавеса между страницами: у него есть и разгон,
 *           и торможение, потому что он закрывает экран целиком.
 */
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

export const EASE_GLIDE = "expo.out";
export const EASE_CARVE = "power4.inOut";

if (typeof window !== "undefined") {
  gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText, ScrambleTextPlugin);
  gsap.defaults({ ease: EASE_GLIDE, duration: 0.9 });
  // Пустой список целей здесь — законное состояние (раздел ждёт данных,
  // у занавеса нет подписи), а не ошибка; предупреждение только шумит в консоли.
  gsap.config({ nullTargetWarn: false });
}

/**
 * Просил ли человек поменьше движения.
 *
 * Проверяется в момент вызова, а не один раз при загрузке модуля: настройку
 * меняют, не перезагружая страницу, и анимация, запущенная после этого, должна
 * её уважать.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Есть ли у устройства настоящее наведение — магнит и подсветка только там. */
export function canHover(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export { gsap, ScrollTrigger, SplitText, useGSAP };
