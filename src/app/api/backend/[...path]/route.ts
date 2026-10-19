import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Headers we never forward from the client request to the backend.
// `x-client-ip` и `x-proxy-auth` ставит только сам прокси (см. `clientIp`):
// присланные браузером подменяли бы адрес в журнале и ключ ограничителя перебора.
const REQUEST_STRIP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
  "x-client-ip",
  "x-proxy-auth",
]);

/**
 * Потолок тела, которое прокси соглашается переслать. Тот же, что у API
 * (`MAX_BODY_BYTES` в `backend/app/main.py`): прокси читает тело в память
 * целиком, и без потолка один запрос на гигабайты валил бы фронт раньше, чем
 * API успел бы отказать.
 */
const MAX_BODY_BYTES = 48 * 1024 * 1024;
const TOO_BIG = `Запрос больше ${MAX_BODY_BYTES / (1024 * 1024)} МБ`;

class BodyTooLarge extends Error {}

/** Тело запроса, но не больше потолка: объявленная длина - сразу, без длины - по ходу чтения. */
async function readBody(request: NextRequest): Promise<ArrayBuffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new BodyTooLarge();
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

// Headers we never copy from the backend response back to the browser.
// `content-encoding` / `content-length` MUST be stripped: Node's fetch (undici)
// transparently decompresses the upstream body, so `response.body` is already
// decoded - but the original `Content-Encoding: gzip` header is still present.
// Forwarding it makes the browser try to gunzip plain bytes → ERR_CONTENT_DECODING_FAILED.
// Dropping it lets the frontend edge re-compress correctly for the browser.
const RESPONSE_STRIP_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "content-range",
  "host",
  "transfer-encoding",
]);

// Upstream request timeout (ms). Generous to allow slow OCR / Azure parsing.
const UPSTREAM_TIMEOUT_MS = 180_000;

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function getBackendBaseUrl(): string {
  const baseUrl = process.env.API_URL || "http://localhost:8000";
  const cleanUrl = stripWrappingQuotes(baseUrl).replace(/\/$/, "");

  if (!process.env.API_URL) {
    console.warn("API_URL is not set, using fallback:", cleanUrl);
  }

  return cleanUrl;
}

function buildTargetUrl(request: NextRequest, path: string[]): string {
  const target = new URL(`${getBackendBaseUrl()}/${path.join("/")}`);
  target.search = request.nextUrl.search;
  return target.toString();
}

/**
 * Адрес человека - первое значение `X-Forwarded-For`: его ставит край Railway,
 * и браузер его не подменит (рекомендация Railway; `X-Real-IP` за их CDN
 * врёт).
 *
 * API читает адрес из `x-client-ip` (`client_ip()` в `routes/finance.py`), а
 * прокси его не ставил: до 01.10.2026 в «Сеансах», журнале действий и
 * уведомлении «пять неверных паролей» стояли адреса узлов Railway
 * (`100.64.0.x`), а ограничитель перебора по адресу считал всех людей за
 * одним узлом одним человеком. Без заголовка (локальный запуск) API берёт
 * адрес соединения сам.
 */
function clientIp(request: NextRequest): string {
  return (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
}

function buildForwardHeaders(request: NextRequest): Headers {
  const headers = new Headers();

  request.headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (REQUEST_STRIP_HEADERS.has(normalizedKey)) {
      return;
    }
    headers.set(key, value);
  });

  const ip = clientIp(request);
  if (ip) headers.set("x-client-ip", ip);
  // Секрет, по которому API отличает прокси от прямого запроса и верит
  // `x-client-ip` только ему (`client_ip()` в `routes/finance.py`).
  const secret = stripWrappingQuotes(process.env.PROXY_SHARED_SECRET ?? "");
  if (secret) headers.set("x-proxy-auth", secret);

  return headers;
}

async function proxyRequest(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await context.params;
  const targetUrl = buildTargetUrl(request, path);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    let body: ArrayBuffer | undefined;
    try {
      body = await readBody(request);
    } catch (error) {
      if (error instanceof BodyTooLarge) return NextResponse.json({ detail: TOO_BIG }, { status: 413 });
      throw error;
    }
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: buildForwardHeaders(request),
      body,
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });

    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      const name = key.toLowerCase();
      if (RESPONSE_STRIP_HEADERS.has(name) || name === "set-cookie") {
        return;
      }
      responseHeaders.set(key, value);
    });
    // Каждую куку - отдельной строкой. `set` оставлял бы только последнюю,
    // а вход ставит две: сеанс и метку устройства.
    for (const cookie of response.headers.getSetCookie()) {
      responseHeaders.append("set-cookie", cookie);
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    const errorMsg = aborted
      ? `Upstream request timed out after ${UPSTREAM_TIMEOUT_MS} ms`
      : error instanceof Error
        ? error.message
        : "Unknown proxy error";
    console.error(`Proxy error calling ${targetUrl}:`, errorMsg);

    // Ни адреса, ни текста ошибки в ответ браузеру: `targetUrl` - это внутренний
    // адрес API внутри Docker/Railway, а `errorMsg` регулярно содержит его же.
    // Читать это будет человек, которому нужно знать одно: сервер не ответил.
    // Разбираться будет тот, у кого есть лог сервера, - там оба и лежат.
    return NextResponse.json(
      {
        detail: aborted
          ? "Сервер не ответил вовремя. Попробуйте ещё раз."
          : "Сервер не отвечает. Попробуйте ещё раз через минуту.",
      },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return proxyRequest(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return proxyRequest(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return proxyRequest(request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return proxyRequest(request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return proxyRequest(request, context);
}

export async function OPTIONS(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  return proxyRequest(request, context);
}
