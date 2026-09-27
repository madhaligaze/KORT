/**
 * Адрес раздела «Финансы»: раздел, лист и открытая запись живут в адресе.
 *
 * Ссылку на договор можно переслать, а «Назад» на телефоне закрывает
 * карточку, потому что открытие добавило запись в историю (фронт-план 3.2).
 * Смена листа истории не засоряет — `replaceState`.
 */

export function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

/** Поменять параметры адреса. `null` убирает параметр. `push` — новая запись истории. */
export function writeParams(values: Record<string, string | null | undefined>, push = false): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) return;
  if (push) window.history.pushState(window.history.state, "", next);
  else window.history.replaceState(window.history.state, "", next);
}
