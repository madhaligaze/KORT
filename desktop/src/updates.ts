/**
 * Обновления - как у VS Code: новая версия скачивается сама, в фоне, а
 * человек нажимает «Обновите приложение» - и KORT закрывается и открывается
 * уже новым (тихая установка поверх, без мастера).
 *
 * Версии выходят из релизов GitHub (`madhaligaze/KORT`, `.github/workflows/
 * desktop.yml`) на каждый пуш, который трогает интерфейс или десктоп.
 * Номер версии - «уровень.0.сборка»: уровень поднимают в `release.json`,
 * когда старой версией работать уже нельзя (сервер ждёт другого). Новая
 * версия с большим уровнем - обязательное обновление: окно поверх KORT без
 * «Позже». С тем же уровнем - кнопка вверху, старой можно работать дальше.
 */
import { app } from "electron";
import { autoUpdater } from "electron-updater";

export type UpdateState = {
  phase: "idle" | "downloading" | "ready";
  version: string | null;
  percent: number;
  /** Старая версия устарела: работать дальше нельзя. */
  forced: boolean;
};

const CHECK_EVERY = 15 * 60_000;

function level(version: string): number {
  return Number.parseInt(version.split(".")[0] ?? "0", 10) || 0;
}

export class Updates {
  private state: UpdateState = { phase: "idle", version: null, percent: 0, forced: false };
  private lastCheck = 0;

  constructor(
    private readonly send: (state: UpdateState) => void,
    private readonly log: (line: string) => void,
  ) {}

  current(): UpdateState {
    return this.state;
  }

  start(): void {
    // В разработке (`pnpm start`) обновляться не из чего.
    if (!app.isPackaged) return;
    // Проверка обновления без GitHub: свои latest.yml и установщик с локального адреса.
    if (process.env.KORT_UPDATE_URL) autoUpdater.setFeedURL({ provider: "generic", url: process.env.KORT_UPDATE_URL });
    autoUpdater.autoDownload = true;
    // Закрыл KORT, не нажав кнопку, - скачанное встанет при выходе.
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = {
      info: (message?: unknown) => this.log(`update: ${String(message)}`),
      warn: (message?: unknown) => this.log(`update: ${String(message)}`),
      error: (message?: unknown) => this.log(`update: ${String(message)}`),
      debug: () => undefined,
    };
    const forced = (version: string) => level(version) > level(app.getVersion());
    autoUpdater.on("update-available", (info) => {
      this.set({ phase: "downloading", version: info.version, percent: 0, forced: forced(info.version) });
    });
    autoUpdater.on("download-progress", (progress) => this.set({ percent: Math.floor(progress.percent) }));
    autoUpdater.on("update-downloaded", (info) => {
      this.set({ phase: "ready", version: info.version, percent: 100, forced: forced(info.version) });
    });
    autoUpdater.on("error", (error) => {
      this.log(`update: ${error?.message ?? error}`);
      // Не скачалось (нет связи с GitHub) - не держим окно «обновите»: попробуем при следующей проверке.
      if (this.state.phase === "downloading") this.set({ phase: "idle", percent: 0 });
    });
    setTimeout(() => this.check(), 5_000);
    setInterval(() => this.check(), CHECK_EVERY);
  }

  /** Проверить сейчас - например, когда вернулась связь. Не чаще раза в минуту. */
  check(): void {
    if (!app.isPackaged || this.state.phase !== "idle") return;
    if (Date.now() - this.lastCheck < 60_000) return;
    this.lastCheck = Date.now();
    autoUpdater.checkForUpdates().catch(() => undefined);
  }

  /** «Обновите приложение»: закрыться, тихо поставить новое и открыться снова. */
  install(beforeQuit: () => void): void {
    if (this.state.phase !== "ready") return;
    beforeQuit();
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  }

  private set(next: Partial<UpdateState>): void {
    this.state = { ...this.state, ...next };
    this.send(this.state);
  }
}
