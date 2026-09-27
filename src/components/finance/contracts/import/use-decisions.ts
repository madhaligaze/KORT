"use client";

/**
 * Очередь решений протокола.
 *
 * Каждое решение пересчитывает отчёт на сервере целиком (около 0,6 с на
 * реестре в 460 строк), поэтому решения копятся 300 мс и уходят одним
 * запросом, а запрос в полёте всегда один: ответы не приходят вперемешку, и
 * отчёт, пришедший позже, не затирает решение, принятое раньше.
 *
 * Пока решение не подтверждено сервером, экран показывает его сразу: к
 * решениям партии поверх накладывается очередь. Отказ сети не теряет ничего —
 * неотправленное возвращается в голову очереди, и «Повторить» шлёт его снова.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FinanceApiError, contractsApi, type ContractImportBatch } from "@/components/finance/api";

import { mergeDecisions, type Decisions } from "./types";

const DEBOUNCE_MS = 300;

type Waiter = { resolve: (batch: ContractImportBatch) => void; reject: (error: Error) => void };

/** Адрес решений для `keepalive`: тот же шлюз, что у `contractsApi`, без второй копии префикса. */
function decideUrl(id: string): string {
  return contractsApi.exportUrl().replace(/export\.xlsx.*$/, `imports/${id}/decide`);
}

export function useDecisions(initial: ContractImportBatch) {
  const [batch, setBatch] = useState(initial);
  const [queued, setQueued] = useState<Decisions>({});
  const [sending, setSending] = useState(false);
  /** Отказ: `retry` — сеть или сервер лёг, повтор поможет; иначе решение отвергнуто. */
  const [error, setError] = useState<{ text: string; retry: boolean } | null>(null);

  const batchRef = useRef(initial);
  const pending = useRef<Decisions>({});
  const inflight = useRef<Decisions | null>(null);
  const timer = useRef<number | null>(null);
  const waiters = useRef<Waiter[]>([]);

  const settle = useCallback((failure?: Error) => {
    const list = waiters.current;
    waiters.current = [];
    for (const waiter of list) {
      if (failure) waiter.reject(failure);
      else waiter.resolve(batchRef.current);
    }
  }, []);

  const send = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    // Запрос уже летит — пришедшее за это время он заберёт следующим кругом.
    if (inflight.current) return;
    while (Object.keys(pending.current).length) {
      const payload = pending.current;
      pending.current = {};
      inflight.current = payload;
      setSending(true);
      try {
        const next = await contractsApi.imports.decide(batchRef.current.id, payload);
        batchRef.current = next;
        inflight.current = null;
        setBatch(next);
        // Что пришло, пока запрос был в полёте, остаётся поверх нового отчёта.
        setQueued({ ...pending.current });
      } catch (caught) {
        inflight.current = null;
        setSending(false);
        const failure = caught instanceof Error ? caught : new Error("Решение не сохранилось");
        if (caught instanceof FinanceApiError && (caught.status === 400 || caught.status === 422)) {
          // Сервер решение отверг (правило не из тех полей, что он умеет
          // проверить). Повтор дал бы тот же отказ и запер бы очередь навсегда,
          // поэтому отвергнутое снимается с экрана, а отказ назван словами.
          setQueued({ ...pending.current });
          setError({ text: failure.message, retry: false });
        } else {
          // Раньше отправленное — вниз, пришедшее после — поверх: порядок решений не меняется.
          pending.current = mergeDecisions(payload, pending.current);
          setError({ text: failure.message, retry: true });
        }
        settle(failure);
        return;
      }
    }
    setSending(false);
    settle();
  }, [settle]);

  const decide = useCallback(
    (patch: Decisions) => {
      pending.current = mergeDecisions(pending.current, patch);
      setQueued((current) => mergeDecisions(current, patch));
      setError(null);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void send(), DEBOUNCE_MS);
    },
    [send],
  );

  /** Дождаться, пока всё принятое уйдёт на сервер; вернуть свежую партию. */
  const flush = useCallback(() => {
    const idle = !inflight.current && !Object.keys(pending.current).length;
    if (idle) return Promise.resolve(batchRef.current);
    const done = new Promise<ContractImportBatch>((resolve, reject) => waiters.current.push({ resolve, reject }));
    void send();
    return done;
  }, [send]);

  const retry = useCallback(() => {
    setError(null);
    void send();
  }, [send]);

  // Ушли со страницы или с экрана, не дождавшись 300 мс, — решение всё равно
  // уходит: `keepalive` переживает выгрузку страницы, обычный запрос — нет.
  useEffect(() => {
    const leave = () => {
      if (!Object.keys(pending.current).length) return;
      const payload = pending.current;
      pending.current = {};
      try {
        void fetch(decideUrl(batchRef.current.id), {
          method: "POST",
          credentials: "include",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decisions: payload }),
        });
      } catch {
        /* страница уже выгружается — больше сделать нечего */
      }
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      if (timer.current !== null) window.clearTimeout(timer.current);
      leave();
    };
  }, []);

  /** Решения, как их видит экран: подтверждённые сервером и ещё летящие. */
  const decisions = useMemo(() => mergeDecisions(batch.decisions ?? {}, queued), [batch, queued]);
  const dirty = sending || Object.keys(queued).length > 0;

  return { batch, decisions, decide, flush, retry, error, dirty };
}
