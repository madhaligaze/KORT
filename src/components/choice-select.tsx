"use client";

import { forwardRef, type SelectHTMLAttributes } from "react";

import { CloseIcon } from "@/components/icons";
import { PlaceholderOption } from "@/components/placeholder-option";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "defaultValue" | "onChange" | "placeholder"> & {
  value: string;
  onChange: (value: string) => void;
  /**
   * Что видно, пока ничего не выбрано: «Без категории», «Все счета»,
   * «Выберите счёт». Приглушено и в раскрытом списке не стоит.
   */
  placeholder: string;
  /**
   * Пустое — законное состояние поля (необязательная категория, фильтр
   * «все»): у выбранного значения крестик, который возвращает к пустому.
   * Обязательному полю (счёт операции) крестик не нужен.
   */
  clearable?: boolean;
  /** Класс обёртки — когда поле само элемент гибкой строки. */
  wrapClassName?: string;
};

/**
 * Выпадающий список продукта: пустое значение — подсказка, а не пункт.
 *
 * До 27.09.2026 «Без категории», «Все счета», «Выберите счёт» были обычными
 * пунктами: стояли в списке первыми наравне со счетами и статьями и в поле
 * выглядели как выбранное значение — тем же цветом и весом. Пользователь
 * спросил, почему «Выберите счёт» «устроено как тоже какое-то значение», а
 * следом показал «Без категории» — то же самое. Теперь пустое в списке не
 * стоит вовсе (`PlaceholderOption`), в поле приглушено, а вернуться к нему у
 * необязательного поля можно крестиком.
 *
 * Крестик не забирает фокус (`pointerdown` без действия по умолчанию): у
 * редактора в ячейке уход фокуса значит «правка закончена».
 */
export const ChoiceSelect = forwardRef<HTMLSelectElement, Props>(function ChoiceSelect(
  { value, onChange, placeholder, clearable = false, wrapClassName, children, disabled, ...rest },
  ref,
) {
  const clear = clearable && value !== "" && !disabled;
  return (
    <span className={wrapClassName ? `choice ${wrapClassName}` : "choice"} data-clear={clear ? "" : undefined}>
      <select ref={ref} {...rest} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
        <PlaceholderOption>{placeholder}</PlaceholderOption>
        {children}
      </select>
      {clear ? (
        <button
          type="button"
          className="choice-clear"
          aria-label={`Очистить: ${placeholder}`}
          title={placeholder}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onChange("")}
        >
          <CloseIcon size={14} />
        </button>
      ) : null}
    </span>
  );
});
