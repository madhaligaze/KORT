/**
 * KORT для Windows.
 *
 * Устройство (подробно - `desktop/README.md`):
 * - `web.ts` - локальный фронт, тот же, что на kort.cards;
 * - `gateway.ts` - шлюз окна: страницы - фронту, запросы - серверу, а пока
 *   сервер молчит - сохранённое на диске;
 * - `vault.ts` - шифрованное хранилище (ответы сервера, очередь правок);
 * - `updates.ts` - обновления из релизов GitHub;
 * - `preload.ts` - мост `window.kortDesktop`.
 */
import fs from "node:fs";
import path from "node:path";

import {
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  app,
  dialog,
  ipcMain,
  nativeTheme,
  screen,
  session,
  shell,
} from "electron";

import { Gateway, type Status } from "./gateway";
import { type UpdateState, Updates } from "./updates";
import { Vault } from "./vault";
import { startWeb } from "./web";

/** Порт окна постоянный: от него зависит адрес, а с адресом - всё, что окно помнит. */
const PORTS = [47823, 47824, 47825, 47826, 47827];

/**
 * Куда ходить за данными, по порядку: сайт (его прокси знает, где сейчас
 * API, даже после переезда хостинга) и сам API напрямую - на случай, когда
 * лежит только фронт сайта. Для проверки - `KORT_API` через запятую или
 * `upstreams` в `settings.json` папки приложения.
 */
const UPSTREAMS = ["https://kort.cards/api/backend", "https://kortbackend-production.up.railway.app"];

const MAX_SAVED = 20 * 1024 * 1024;

// Проверки (`pw-finmap/kort/desktop-*`) живут в своей папке данных и не
// трогают сохранённое настоящего KORT на этой машине.
if (process.env.KORT_DATA_DIR) app.setPath("userData", process.env.KORT_DATA_DIR);
const dataDir = app.getPath("userData");
const logFile = path.join(dataDir, "logs", "kort.log");

function log(line: string): void {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) {
      fs.renameSync(logFile, `${logFile}.old`);
    }
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* журнал - не повод падать */
  }
}

type Settings = { upstreams?: string[]; zoom?: number; bounds?: Electron.Rectangle; maximized?: boolean };

function readSettings(): Settings {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8")) as Settings;
  } catch {
    return {};
  }
}

function writeSettings(next: Partial<Settings>): void {
  try {
    const merged = { ...readSettings(), ...next };
    fs.writeFileSync(path.join(dataDir, "settings.json"), JSON.stringify(merged, null, 2));
  } catch {
    /* не запомнилось - откроется по умолчанию */
  }
}

function upstreams(): string[] {
  const fromEnv = (process.env.KORT_API ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  const list = fromEnv.length ? fromEnv : readSettings().upstreams?.length ? readSettings().upstreams! : UPSTREAMS;
  return list.map((item) => item.replace(/\/$/, ""));
}

let win: BrowserWindow | null = null;
let gateway: Gateway | null = null;
let origin = "";

if (!app.requestSingleInstanceLock()) {
  // Второй KORT рядом с первым писал бы в те же файлы - открываем первый.
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(boot, (error: unknown) => fail(error));
}

function fail(error: unknown): void {
  const text = error instanceof Error ? error.message : String(error);
  log(`start failed: ${text}`);
  dialog.showErrorBox("KORT не запустился", `${text}\n\nЖурнал: ${logFile}`);
  app.quit();
}

async function boot(): Promise<void> {
  log(`start ${app.getVersion()}`);
  // Свой значок на панели задач и свои уведомления - по коду приложения
  // установщика (`appId` в electron-builder.yml), а не значок Electron.
  app.setAppUserModelId("cards.kort.desktop");
  Menu.setApplicationMenu(null);
  const vault = new Vault(path.join(dataDir, "vault"));
  const webDir = app.isPackaged ? path.join(process.resourcesPath, "web") : path.join(__dirname, "..", "web");
  let web: Awaited<ReturnType<typeof startWeb>>;
  try {
    web = await startWeb(webDir, log);
  } catch (error) {
    fail(error);
    return;
  }
  const updates = new Updates((state: UpdateState) => win?.webContents.send("desktop:update", state), log);
  gateway = new Gateway({
    ports: PORTS,
    webPort: web.port,
    upstreams: upstreams(),
    vault,
    version: app.getVersion(),
    onStatus: (status: Status) => {
      log(status.online ? "online" : "offline");
      win?.webContents.send("desktop:status", status);
      if (status.online) updates.check();
    },
    log,
  });
  const port = await gateway.start();
  origin = `http://127.0.0.1:${port}`;
  log(`gateway ${origin} → ${upstreams().join(", ")}`);

  const ours = (event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) =>
    (event.senderFrame?.url ?? "").startsWith(`${origin}/`);
  ipcMain.on("desktop:version", (event) => {
    event.returnValue = app.getVersion();
  });
  ipcMain.handle("desktop:status", (event) => (ours(event) ? gateway?.current() : null));
  ipcMain.handle("desktop:update", (event) => (ours(event) ? updates.current() : null));
  ipcMain.handle("desktop:install", (event) => {
    if (ours(event)) updates.install(() => gateway?.flush());
  });
  ipcMain.handle("desktop:load", (event, key: unknown) => {
    if (!ours(event) || typeof key !== "string" || key.length > 300) return null;
    const text = vault.read("queue", key);
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  });
  ipcMain.handle("desktop:save", (event, key: unknown, value: unknown) => {
    if (!ours(event) || typeof key !== "string" || key.length > 300) return;
    const text = JSON.stringify(value ?? null);
    if (text.length > MAX_SAVED) throw new Error("очередь больше 20 МБ");
    vault.write("queue", key, text);
  });

  permissions();
  createWindow();
  updates.start();

  // И при обычном закрытии, и при «Обновите приложение» (`app.quit()` без
  // `window-all-closed`): реестр - на диск, фронт - остановить, иначе
  // установщик споткнётся о его файлы.
  app.on("will-quit", () => {
    gateway?.stop();
    web.child.kill();
  });
  app.on("window-all-closed", () => app.quit());
}

/** Микрофон - голосовым в поддержку; остальное, что просит страница, - нет. */
function permissions(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const own = (details.requestingUrl ?? "").startsWith(`${origin}/`);
    if (!own) return callback(false);
    if (permission === "media") {
      const types = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
      return callback(types.every((type) => type === "audio"));
    }
    callback(["clipboard-read", "clipboard-sanitized-write", "fullscreen", "notifications"].includes(permission));
  });
}

/**
 * Где открыть окно. Запомненное место - только если оно целиком на одном из
 * экранов (монитор могли отключить); иначе 1440×900, но не больше рабочей
 * области: на ноутбуке 1280×720 (150%) окно выше экрана уводило низ сцены
 * входа со знаком KORT за край.
 */
function windowBounds(saved?: Electron.Rectangle): Partial<Electron.Rectangle> {
  const onScreen = (bounds: Electron.Rectangle) =>
    screen.getAllDisplays().some(({ workArea: area }) =>
      bounds.x >= area.x &&
      bounds.y >= area.y &&
      bounds.x + bounds.width <= area.x + area.width &&
      bounds.y + bounds.height <= area.y + area.height,
    );
  if (saved && onScreen(saved)) return saved;
  const area = screen.getPrimaryDisplay().workArea;
  return { width: Math.min(1440, area.width), height: Math.min(900, area.height) };
}

function createWindow(): void {
  const saved = readSettings();
  win = new BrowserWindow({
    ...windowBounds(saved.bounds),
    minWidth: 800,
    minHeight: 560,
    show: false,
    title: "KORT",
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    // Фон окна до первой отрисовки - фон сцены входа (`--stage-bg` в
    // globals.css): CSS здесь ещё нет, а белая вспышка перед дымом - лишняя.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0e100f" : "#cfccc2",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  if (saved.maximized ?? true) win.maximize();
  const contents = win.webContents;
  win.once("ready-to-show", () => win?.show());
  contents.on("did-finish-load", () => {
    if (typeof saved.zoom === "number") contents.setZoomLevel(saved.zoom);
  });

  // Ссылки наружу (книги Google, Telegram, почта) - в браузере, не в окне KORT.
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${origin}/`)) return { action: "allow" };
    openOutside(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (url.startsWith(`${origin}/`)) return;
    event.preventDefault();
    openOutside(url);
  });

  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const ctrl = input.control || input.meta;
    const key = input.key.toLowerCase();
    if (key === "f12" || (ctrl && input.shift && key === "i")) {
      contents.toggleDevTools();
      event.preventDefault();
    } else if (key === "f5" || (ctrl && !input.shift && key === "r")) {
      contents.reload();
      event.preventDefault();
    } else if (ctrl && (key === "=" || key === "+" || key === "-" || key === "0")) {
      // Масштаб страницы - как Ctrl+плюс/минус в браузере; запоминается.
      const next = key === "0" ? 0 : contents.getZoomLevel() + (key === "-" ? -0.5 : 0.5);
      const zoom = Math.max(-3, Math.min(3, next));
      contents.setZoomLevel(zoom);
      writeSettings({ zoom });
      event.preventDefault();
    }
  });

  contents.on("context-menu", (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      items.push(
        { label: "Вырезать", role: "cut", enabled: params.editFlags.canCut },
        { label: "Копировать", role: "copy", enabled: params.editFlags.canCopy },
        { label: "Вставить", role: "paste", enabled: params.editFlags.canPaste },
        { type: "separator" },
        { label: "Выделить всё", role: "selectAll" },
      );
    } else if (params.selectionText.trim()) {
      items.push({ label: "Копировать", role: "copy" });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win ?? undefined });
  });

  const remember = () => {
    if (!win || win.isDestroyed()) return;
    writeSettings({ maximized: win.isMaximized(), ...(win.isMaximized() ? {} : { bounds: win.getBounds() }) });
  };
  win.on("close", remember);
  win.on("closed", () => {
    win = null;
  });
  void win.loadURL(`${origin}/`);
}

function openOutside(url: string): void {
  if (/^(https?:|mailto:|tel:)/i.test(url)) void shell.openExternal(url);
}
