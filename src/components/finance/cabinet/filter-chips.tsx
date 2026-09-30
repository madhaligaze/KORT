"use client";

/**
 * Отбор списка - прямоугольные чипы со счётчиком (28.09.2026): отделы в
 * «Сотрудниках» и «Правах», «Что показать» в корзине.
 *
 * Раньше отбор был ещё одной строкой текстовых вкладок с чертой под двумя
 * такими же строками навигации и читался как ещё один раздел. Чип
 * отличается от вкладки рамкой - это отбор, а не переход.
 *
 * Выбранный - рамкой тушью и весом, как `.fin-chip[data-on]`, а не залитой
 * плашкой: заливка в продукте - у главного действия (плита «Войти»,
 * «Добавить»), и залитый отдел спорил бы с кнопкой «+ Сотрудник» рядом.
 */
export type Chip<K extends string> = { key: K; label: string; count?: number };

export function FilterChips<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: Chip<K>[];
  value: K | null;
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <div className="cab-chips" role="group" aria-label={label}>
      {items.map((item) => {
        const on = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            className="cab-chip"
            aria-pressed={on}
            data-on={on ? "true" : undefined}
            data-zero={item.count === 0 ? "true" : undefined}
            onClick={() => onChange(item.key)}
          >
            {item.label}
            {item.count !== undefined ? <span className="cab-chip-count">{item.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
