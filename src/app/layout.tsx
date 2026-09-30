import type { Metadata, Viewport } from "next";
import { Geologica, Martian_Mono } from "next/font/google";

import { StageTransitionProvider } from "@/components/motion/stage-transition";
import "./globals.css";

/**
 * Шрифты - Geologica и Martian Mono. Оба с кириллицей, это условие номер один:
 * гарнитуры референсов (Mori у GSAP, Roobert у monopo) кириллицы не имеют.
 *
 * Geologica - тёплый гуманистический гротеск, то, что в Mori делает кремовый
 * текст на чёрном «живым», и геометрический Manrope этого не давал. Он
 * переменный: вес и острота (`SHRP`) двигаются плавно, и указатель разделов
 * твинит вес при наведении, а не щёлкает между начертаниями. Табличные цифры
 * у него есть - без них суммы в реестрах гуляли бы по колонке.
 *
 * Martian Mono - голос пометок в фигурных скобках и мелких меток. Ширина у
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
 * `maximumScale: 1` отнимал пинч-зум - а на телефоне это последний способ
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
 * `motion` прячет надписи, которые потом выедут анимацией, - иначе сервер
 * отдаёт их на месте, а после гидратации они пропадают и выезжают заново.
 * Ставится только если человек не просил меньше движения. Через четыре секунды
 * класс снимается сам: если JS не доехал, текст не может остаться невидимым.
 * Когда JS доехал, это ни на что не влияет - к этому моменту начальные
 * состояния держит уже GSAP инлайновыми стилями.
 *
 * Тему скрипт только ставит. Смену темы устройства на ходу слушает
 * theme-store.ts - там же общий переход, которым меняется тема.
 */
const bootScript = `
(function(){
  var html = document.documentElement;
  var chosen = null;
  try {
    var t = localStorage.getItem('theme');
    if (t === 'light' || t === 'dark') chosen = t;
  } catch(e) {}
  try {
    html.setAttribute('data-theme', chosen || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
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
