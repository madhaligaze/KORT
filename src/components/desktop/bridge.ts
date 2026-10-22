/**
 * Мост к десктопу KORT (`desktop/src/preload.ts`).
 *
 * В браузере моста нет, и всё, что от него зависит, просто не включается:
 * сайт ведёт себя как раньше. В десктопе страницу отдаёт локальный шлюз - он
 * помнит ответы сервера на этом компьютере и, пока сервер молчит, отвечает
 * за него сохранённым. Мост говорит странице две вещи: есть ли связь и куда
 * положить правки, чтобы они пережили закрытие окна.
 */

export type DesktopStatus = {
  /** Сервер отвечает. */
  online: boolean;
  /** С какого момента связи нет (мс). */
  offlineSince: number | null;
  /** Последний ответ сервера (мс): данные на экране - на этот момент. */
  lastOkAt: number | null;
};

/** Обновление приложения (`desktop/src/updates.ts`). */
export type DesktopUpdate = {
  phase: "idle" | "downloading" | "ready";
  version: string | null;
  percent: number;
  /** Эта версия устарела: работать дальше нельзя, только обновиться. */
  forced: boolean;
};

export type DesktopBridge = {
  version: string;
  status: () => Promise<DesktopStatus>;
  onStatus: (listener: (status: DesktopStatus) => void) => () => void;
  /** Сохранённое под ключом - зашифровано на диске этого компьютера. */
  load: (key: string) => Promise<unknown>;
  save: (key: string, value: unknown) => Promise<void>;
  update: () => Promise<DesktopUpdate>;
  onUpdate: (listener: (state: DesktopUpdate) => void) => () => void;
  /** Закрыться, поставить скачанное и открыться снова. */
  installUpdate: () => Promise<void>;
};

export function desktop(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { kortDesktop?: DesktopBridge }).kortDesktop ?? null;
}
