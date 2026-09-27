/**
 * Двойники значений списка — та же мера, что на сервере (`fields.is_similar`).
 *
 * В «списке или своём» (вид, предмет) новое значение заводится из
 * напечатанного. Перед этим карточка спрашивает «Это „Абонентское
 * обслуживание“?», если напечатано почти то же: опечатка, ставшая значением,
 * делит отчёт надвое. Сервер находит тех же двойников для вкладки «Списки» —
 * мера одна, иначе карточка и настройка спорили бы, что считать двойником.
 */

/** Без регистра, пробелов и знаков: «Бух. сопровождение» = «бух сопровождение». */
export function similarKey(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е").replace(/[^0-9a-zа-я]+/g, "");
}

/** Опечаток между строками (замена, вставка, пропуск, перестановка соседних), не больше `limit + 1`. */
function distance(a: string, b: string, limit: number): number {
  let before: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i, ...new Array<number>(b.length).fill(0)];
    let best = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, before[j - 2] + 1);
      current[j] = value;
      best = Math.min(best, value);
    }
    if (best > limit) return limit + 1;
    before = previous;
    previous = current;
  }
  return previous[b.length];
}

/** Короче пяти букв — только полное совпадение («НО» и «ЮО» — разные отделы). */
export function isSimilar(a: string, b: string): boolean {
  const left = similarKey(a);
  const right = similarKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  // «Недействующий» — «Действующий» с «не» спереди: слово противоположное.
  if (left.endsWith(right) || right.endsWith(left)) return false;
  if (Math.min(left.length, right.length) < 5) return false;
  const limit = Math.max(left.length, right.length) < 12 ? 1 : 2;
  if (Math.abs(left.length - right.length) > limit) return false;
  return distance(left, right, limit) <= limit;
}
