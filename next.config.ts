import path from "node:path";
import type { NextConfig } from "next";

/**
 * Заголовки защиты на каждой странице (аудит 19.10.2026: не было ни одного).
 *
 * - CSP только запрещающая: чужая рамка, `<base>`, отправка форм на чужой
 *   адрес, плагины. `script-src` не ограничен намеренно: тему до первой
 *   отрисовки ставит встроенный скрипт (`layout.tsx`), и без нонсов строгий
 *   `script-src` его бы погасил.
 * - Микрофон - только себе: голосовое в поддержке (`support/voice.tsx`).
 */
const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // `x-powered-by: Next.js` называл стек каждому, кто спросит.
  poweredByHeader: false,
  turbopack: {
    root: path.resolve(__dirname),
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // KORT выделен из раздела «Финансы» (/finance) PDF-CONVERTER. Разосланные
  // ссылки-приглашения вида /finance?phone=… должны приводить ко входу:
  // адрес меняется, параметры остаются.
  async redirects() {
    return [{ source: "/finance", destination: "/", permanent: false }];
  },
};

export default nextConfig;
