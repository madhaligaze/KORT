/**
 * Опрос для живого режима листов — один движок на все таблицы продукта.
 *
 * Реестр договоров и журнал «Таблица» спрашивают сервер одинаково: «что
 * изменилось после номера N» раз в 2 с, и правила у опроса общие:
 *
 * * **только пока вкладка видна.** Спрятана — ни одного запроса; вернулась —
 *   опрос сразу, а не через 2 с. Урок цикла BBC, ходившего в Google
 *   круглые сутки;
 * * **следующий — через паузу после ответа**, а не по часам: медленный ответ
 *   не наслаивает запросы друг на друга;
 * * **отказ — отступление** 2 → 4 → 8 → 16 → 30 с: сервер, которому плохо,
 *   не добивается пятьюдесятью вкладками раз в 2 с;
 * * `tick` отвечает `"ok"`, `"fail"` или `"stop"` (например, вход потерян).
 */
export type PollOutcome = "ok" | "fail" | "stop";

export type Poller = {
  /** Спросить сейчас, не дожидаясь паузы — после своей правки или возврата связи. */
  now: () => void;
  stop: () => void;
};

const EVERY = 2000;
const BACKOFF = [2000, 4000, 8000, 16000, 30000];

export function pollWhileVisible(
  tick: () => Promise<PollOutcome>,
  { every = EVERY, backoff = BACKOFF }: { every?: number; backoff?: number[] } = {},
): Poller {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = false;
  let failures = 0;

  const hidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";

  const schedule = (delay: number) => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (stopped || hidden()) return;
    timer = setTimeout(run, delay);
  };

  const run = async () => {
    timer = null;
    if (stopped) return;
    if (running) {
      schedule(every);
      return;
    }
    running = true;
    let outcome: PollOutcome = "fail";
    try {
      outcome = await tick();
    } catch {
      outcome = "fail";
    } finally {
      running = false;
    }
    if (outcome === "stop") {
      stop();
      return;
    }
    if (outcome === "ok") {
      failures = 0;
      schedule(every);
    } else {
      failures += 1;
      schedule(backoff[Math.min(failures - 1, backoff.length - 1)]);
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") schedule(0);
    else if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  };

  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  schedule(every);
  return { now: () => schedule(0), stop };
}
