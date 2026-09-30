"use client";

/**
 * Одна правка настройки: запрос, перечитать схему, отказ - у своего места.
 *
 * Сохранение молчит, как в карточке: под полем прочерчивается линия и гаснет.
 * Отказ сервера («Поле «Источник» уже есть», «Главный лист не убирается»)
 * пишется под тем элементом, который его вызвал, а не тостом в углу: человек
 * смотрит туда, где только что нажал.
 *
 * После успеха схема перечитывается целиком (`reloadSchema`), а не
 * подправляется на месте: её читают лист, карточка и разбор, и правка,
 * угаданная на клиенте, однажды разошлась бы с тем, что записал сервер.
 */
import { useCallback, useRef, useState } from "react";

import { FinanceApiError } from "@/components/finance/api";
import { reloadAll, reloadSchema } from "@/components/finance/contracts/store";
import { noticeUndo, pushUndo, takeUndo } from "@/components/finance/contracts/setup/undo";

export type TraceState = "sending" | "done" | "failed" | undefined;

/**
 * Как вернуть правку (`setup/undo.ts`): что сделано словами и обратный
 * запрос. Функцией - когда обратное зависит от ответа (у добавленного поля
 * ключ выдаёт сервер).
 */
export type UndoSpec = { text: string; revert: () => Promise<unknown>; after?: "schema" | "all" };

export function errorText(exc: unknown): string {
  if (exc instanceof FinanceApiError) return exc.message;
  if (exc instanceof TypeError) return "Нет связи с сервером - изменение не сохранено";
  return exc instanceof Error && exc.message ? exc.message : "Изменение не сохранилось";
}

async function reload(after: "schema" | "all"): Promise<void> {
  if (after === "all") {
    try {
      await reloadAll();
      return;
    } catch {
      /* реестр целиком не перечитался - хотя бы схема */
    }
  }
  await reloadSchema();
}

/** Вернуть последнюю правку настройки - «Вернуть» и Ctrl+Z. */
export async function revertLast(): Promise<boolean> {
  const entry = takeUndo();
  if (!entry) return false;
  try {
    await entry.revert();
    await reload(entry.after);
    noticeUndo({ kind: "reverted", entry });
    return true;
  } catch (exc) {
    noticeUndo({ kind: "failed", entry, error: errorText(exc) });
    return false;
  }
}

export function useSetupAction() {
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, boolean>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const clear = useCallback((key: string) => {
    setErrors((value) => {
      if (!(key in value)) return value;
      const next = { ...value };
      delete next[key];
      return next;
    });
  }, []);

  /**
   * `after`: что перечитать. Сведение значений меняет сами договоры, поэтому
   * там - всё; остальное меняет только схему.
   *
   * `undo`: как вернуть правку. Без него правка не отменяется (сведение двух
   * значений в одно - обратного у него нет, об этом говорит вопрос до него).
   */
  const run = useCallback(
    async <T,>(
      key: string,
      work: () => Promise<T>,
      after: "schema" | "all" = "schema",
      undo?: UndoSpec | ((result: T) => UndoSpec | null),
    ): Promise<boolean> => {
      setBusy((value) => ({ ...value, [key]: true }));
      setErrors((value) => {
        if (!(key in value)) return value;
        const next = { ...value };
        delete next[key];
        return next;
      });
      try {
        const result = await work();
        await reload(after);
        const spec = typeof undo === "function" ? undo(result) : undo;
        if (spec) pushUndo({ text: spec.text, revert: spec.revert, after: spec.after ?? after });
        setDone((value) => ({ ...value, [key]: true }));
        const previous = timers.current.get(key);
        if (previous) clearTimeout(previous);
        timers.current.set(
          key,
          setTimeout(() => {
            setDone((value) => ({ ...value, [key]: false }));
            timers.current.delete(key);
          }, 700),
        );
        return true;
      } catch (exc) {
        setErrors((value) => ({ ...value, [key]: errorText(exc) }));
        return false;
      } finally {
        setBusy((value) => ({ ...value, [key]: false }));
      }
    },
    [],
  );

  const trace = useCallback(
    (key: string): TraceState => (busy[key] ? "sending" : errors[key] ? "failed" : done[key] ? "done" : undefined),
    [busy, errors, done],
  );

  return {
    run,
    clear,
    trace,
    busy: (key: string) => !!busy[key],
    error: (key: string) => errors[key] ?? "",
  };
}

export type SetupAction = ReturnType<typeof useSetupAction>;
