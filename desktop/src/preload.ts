/**
 * Мост окна к десктопу - `window.kortDesktop` (`src/components/desktop/bridge.ts`
 * на стороне страницы). Странице открыто только это: связь, очередь правок
 * на диске и обновления.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("kortDesktop", {
  version: ipcRenderer.sendSync("desktop:version") as string,
  status: () => ipcRenderer.invoke("desktop:status"),
  onStatus: (listener: (value: unknown) => void) => listen("desktop:status", listener),
  load: (key: string) => ipcRenderer.invoke("desktop:load", key),
  save: (key: string, value: unknown) => ipcRenderer.invoke("desktop:save", key, value),
  update: () => ipcRenderer.invoke("desktop:update"),
  onUpdate: (listener: (value: unknown) => void) => listen("desktop:update", listener),
  installUpdate: () => ipcRenderer.invoke("desktop:install"),
});
