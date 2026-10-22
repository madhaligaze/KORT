import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Hosting = "render" | "railway" | "other";

/** Хостинг API по `API_URL`. Незнакомый адрес - "other": будильник тогда молчит. */
function hostingOf(raw: string | undefined): Hosting {
  const value = (raw ?? "").trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    return "other";
  }
  if (host.endsWith(".onrender.com")) return "render";
  if (host.endsWith(".railway.app") || host.endsWith(".railway.internal") || host.endsWith(".rlwy.net")) {
    return "railway";
  }
  return "other";
}

/**
 * Где живёт API: "render", "railway" или "other" - по `API_URL`, без запроса
 * к самому API.
 *
 * Нужен будильнику `.github/workflows/render-wake.yml`. Бесплатный сервис
 * Render засыпает через 15 минут без запросов, а запрос фронта (тоже с Render)
 * его не будит: край Render отвечает прокси мгновенным 502 (22.10.2026 так
 * пролежал весь день). Будит только запрос снаружи прямо на адрес API - его и
 * шлёт будильник, но лишь пока здесь "render". После возврата на Railway
 * разбуженный API на Render был бы вторым процессом на той же базе - со вторым
 * ботом и вторым проходом 1С.
 *
 * Сам адрес наружу не отдаётся, как и в прокси `api/backend`: только хостинг.
 */
export function GET(): NextResponse {
  return NextResponse.json(
    { api: hostingOf(process.env.API_URL) },
    { headers: { "cache-control": "no-store" } },
  );
}
