/**
 * Личный вид листов «Финансов» на сервере (`/finance/looks/{key}`) — хранилище
 * для корня листов (`univer/look.ts`).
 *
 * Вид держится и в памяти вкладки: лист реестра пересобирается при смене
 * настройки, и каждая пересборка не должна заново спрашивать сервер (и на
 * секунду показывать лист без вида).
 */
import { looksApi } from "@/components/finance/api";
import type { Look, LookStore } from "@/components/univer/look";

const memory = new Map<string, Look | null>();

/** `scope` — компания: вид у каждой компании свой, и память вкладки их не путает. */
export function lookStore(key: string, scope: string): LookStore {
  const slot = `${scope}:${key}`;
  return {
    load: async () => {
      if (memory.has(slot)) return memory.get(slot) ?? null;
      const { look } = await looksApi.get(key);
      const value = look && (look as Look).v === 1 ? (look as Look) : null;
      memory.set(slot, value);
      return value;
    },
    save: async (look) => {
      memory.set(slot, look);
      await looksApi.put(key, look);
    },
    clear: async () => {
      memory.set(slot, null);
      await looksApi.reset(key);
    },
  };
}

/** Выход из учётки — вид следующего человека читается заново. */
export function forgetLooks(): void {
  memory.clear();
}
