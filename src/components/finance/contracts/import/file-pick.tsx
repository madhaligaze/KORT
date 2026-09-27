"use client";

/**
 * Выбор файла: указатель из одной строки и перетаскивание над всем окном.
 *
 * Пунктирной зоны сброса нет. Файл над окном прочерчивает волосяную рамку по
 * краю экрана (0,6 с) и ставит по центру «Отпустите файл» — зона сброса и
 * есть весь экран, рисовать ещё одну незачем.
 */
import { useEffect, useRef, useState } from "react";

import { gsap, prefersReducedMotion, useGSAP } from "@/components/motion/gsap";
import { IndexList } from "@/components/stage/index-list";

import styles from "./registry-import.module.css";

const ACCEPT = ".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function isRegistryFile(file: File): boolean {
  return /\.(xlsx|xlsm)$/i.test(file.name);
}

export function FilePick({ onFile, error }: { onFile: (file: File) => void; error: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    let depth = 0;
    const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setOver(true);
    };
    const hover = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setOver(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) onFile(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", hover);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", hover);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [onFile]);

  useGSAP(
    () => {
      const rect = frame.current?.querySelector("rect");
      if (!over || !rect) return;
      if (prefersReducedMotion()) gsap.set(rect, { attr: { "stroke-dashoffset": 0 } });
      else gsap.fromTo(rect, { attr: { "stroke-dashoffset": 1 } }, { attr: { "stroke-dashoffset": 0 }, duration: 0.6, ease: "expo.inOut" });
    },
    { dependencies: [over], scope: frame },
  );

  return (
    <div className={styles.pick}>
      <IndexList
        size="section"
        label="Загрузка реестра"
        entries={[
          {
            key: "pick",
            title: "Выбрать файл .xlsx",
            meta: "или перетащите сюда",
            onSelect: () => input.current?.click(),
          },
        ]}
      />
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Тот же файл второй раз подряд — тоже выбор; без сброса change не придёт.
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
      {error ? (
        <p className={`fin-fail ${styles.pickError}`} role="alert">
          {error}
        </p>
      ) : null}
      <div ref={frame} className={styles.drop} data-on={over ? "true" : undefined} aria-hidden={!over}>
        <svg className={styles.dropSvg} aria-hidden="true">
          <rect x="0.5" y="0.5" rx="14" pathLength={1} strokeDasharray="1" strokeDashoffset="1" />
        </svg>
        <p className={styles.dropText}>Отпустите файл</p>
      </div>
    </div>
  );
}

/** Подпись фазы вместо крутилки: проявляется через 400 мс, раньше ждать нечего. */
export function Phase({ children, note }: { children: string; note?: string }) {
  return (
    <div className={styles.phase} role="status" aria-live="polite">
      <p className={styles.phaseText}>{children}</p>
      {note ? <p className={`fin-mono fin-muted ${styles.phaseNote}`}>{note}</p> : null}
    </div>
  );
}
