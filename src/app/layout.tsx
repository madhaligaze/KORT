import type { Metadata, Viewport } from "next";
import { Geologica, Martian_Mono } from "next/font/google";

import { StageTransitionProvider } from "@/components/motion/stage-transition";
import "./globals.css";

/**
 * Шрифты — Geologica и Martian Mono. Оба с кириллицей, это условие номер один:
 * гарнитуры референсов (Mori у GSAP, Roobert у monopo) кириллицы не имеют.
 *
 * Geologica — тёплый гуманистический гротеск, то, что в Mori делает кремовый
 * текст на чёрном «живым», и геометрический Manrope этого не давал. Он
 * переменный: вес и острота (`SHRP`) двигаются плавно, и указатель разделов
 * твинит вес при наведении, а не щёлкает между начертаниями. Табличные цифры
 * у него есть — без них суммы в реестрах гуляли бы по колонке.
 *
 * Martian Mono — голос пометок в фигурных скобках и мелких меток. Ширина у
 * него тоже переменная: в плотных местах он поджимается осью `wdth`.
 */
const geologica = Geologica({
  variable: "--font-geologica",
  subsets: ["latin", "cyrillic"],
  axes: ["SHRP"],
  display: "swap",
});

const martian = Martian_Mono({
  variable: "--font-martian",
  subsets: ["latin", "cyrillic"],
  axes: ["wdth"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "KORT",
  description: "Управленческий учёт компании: деньги, договоры, выписки банков.",
};

/**
 * Вьюпорт: масштаб не запрещаем, безопасные зоны включаем.
 *
 * `maximumScale: 1` отнимал пинч-зум — а на телефоне это последний способ
 * прочитать плотную таблицу, и заодно нарушение WCAG 1.4.4.
 *
 * `viewportFit: "cover"` обязателен, а не украшение: без него iOS отдаёт во все
 * `env(safe-area-inset-*)` ноль, и вся вёрстка вокруг «чёлки» и домашней
 * полоски молча превращается в пустые отступы.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0e100f",
};

/*
 * До гидратации: тема (чтобы не мигнула чужая) и класс `motion`.
 *
 * `motion` прячет надписи, которые потом выедут анимацией, — иначе сервер
 * отдаёт их на месте, а после гидратации они пропадают и выезжают заново.
 * Ставится только если человек не просил меньше движения. Через четыре секунды
 * класс снимается сам: если JS не доехал, текст не может остаться невидимым.
 * Когда JS доехал, это ни на что не влияет — к этому моменту начальные
 * состояния держит уже GSAP инлайновыми стилями.
 *
 * Тему системы скрипт не только читает, но и слушает: пока человек не выбрал
 * тему сам («Как в системе»), смена темы устройства переключает страницу
 * сразу, без перезагрузки, — и сцена с дымом перетекает в новый цвет.
 */
const bootScript = `
(function(){
  var html = document.documentElement;
  function chosen() {
    try {
      var t = localStorage.getItem('theme');
      return t === 'light' || t === 'dark' ? t : null;
    } catch(e) { return null; }
  }
  try {
    var scheme = window.matchMedia('(prefers-color-scheme: dark)');
    html.setAttribute('data-theme', chosen() || (scheme.matches ? 'dark' : 'light'));
    scheme.addEventListener('change', function(event) {
      if (chosen()) return;
      // Плавно, как у тумблера (theme-store.ts): класс на время перехода.
      if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        html.classList.add('theme-shift');
        setTimeout(function(){ html.classList.remove('theme-shift'); }, 950);
      }
      html.setAttribute('data-theme', event.matches ? 'dark' : 'light');
    });
  } catch(e) {}
  try {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      html.classList.add('motion');
      setTimeout(function(){ html.classList.remove('motion'); }, 4000);
    }
  } catch(e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      data-theme="dark"
      suppressHydrationWarning
      className={`${geologica.variable} ${martian.variable} antialiased`}
    >
      <head>
        <meta charSet="utf-8" />
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>
        <StageTransitionProvider>{children}</StageTransitionProvider>
      </body>
    </html>
  );
}
