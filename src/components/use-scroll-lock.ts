"use client";

/**
 * Блокировка прокрутки фона, пока открыт модальный слой.
 *
 * Живёт не в модуле дашборда, а рядом с иконками: им пользуются и модалки
 * воркбенча, и шиты BBC. У модуля дашборда в README описано, как его удалить
 * целиком, — общая утилита внутри него сделала бы это описание неверным.
 *
 * Почему `position: fixed`, а не `overflow: hidden`: на iOS Safari `overflow`
 * на body просто игнорируется — страница под модалкой продолжает ехать.
 * Приходится вынимать её из потока и запоминать смещение руками.
 *
 * Счётчик ссылок обязателен: шиты открываются поверх шитов, и наивный
 * «заблокировал/разблокировал» вернул бы прокрутку по закрытию верхнего,
 * пока нижний ещё открыт.
 */
import { useEffect } from "react";

let locks = 0;
let savedScrollY = 0;
let savedStyles: {
  position: string;
  top: string;
  left: string;
  right: string;
  width: string;
  overflowY: string;
} | null = null;

function engage() {
  const { body } = document;
  savedScrollY = window.scrollY;
  savedStyles = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflowY: body.style.overflowY,
  };

  body.style.position = "fixed";
  body.style.top = `-${savedScrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  // Полоса прокрутки остаётся зарезервированной, иначе на десктопе страница
  // дёргается вбок на её ширину в момент открытия.
  body.style.overflowY = "scroll";

  // Состояние на <html> — тем же приёмом, что и плотность: правила из
  // globals.css достают до чего угодно без прокидывания пропа.
  document.documentElement.dataset.bbcSheet = "open";
}

function release() {
  const { body } = document;
  if (savedStyles) {
    body.style.position = savedStyles.position;
    body.style.top = savedStyles.top;
    body.style.left = savedStyles.left;
    body.style.right = savedStyles.right;
    body.style.width = savedStyles.width;
    body.style.overflowY = savedStyles.overflowY;
    savedStyles = null;
  }
  delete document.documentElement.dataset.bbcSheet;

  // Возврат ровно туда, где стояли: `position: fixed` уже сбросил прокрутку в
  // ноль, поэтому без этого закрытие модалки выбрасывало бы наверх страницы.
  // Именно `instant`: `auto` значит «как в CSS», а у `html` стоит
  // `scroll-behavior: smooth` — страница прыгала наверх и на глазах ехала
  // обратно (найдено 27.09 на окне операции).
  window.scrollTo({ top: savedScrollY, behavior: "instant" });
}

/**
 * Заблокировать прокрутку фона; возвращает снятие. Для слоёв, которые решают
 * о замке внутри своего эффекта (карточка: на телефоне всегда, на широком —
 * только модальная). Снятие можно звать дважды — второй раз ничего не делает.
 *
 * `overflow: hidden` на body здесь не замена: у `html` стоит `overflow-x:
 * clip`, и запрет с body до окна браузера не доходит — страница под слоем
 * прокручивалась колесом.
 */
export function lockScroll(): () => void {
  locks += 1;
  if (locks === 1) engage();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    locks -= 1;
    if (locks === 0) release();
  };
}

/** Держит прокрутку фона заблокированной, пока `active` истинно. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    return lockScroll();
  }, [active]);
}
