import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Headers we never forward from the client request to the backend.
const REQUEST_STRIP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
]);

// Headers we never copy from the backend response back to the browser.
// `content-encoding` / `content-length` MUST be stripped: Node's fetch (undici)
// transparently decompresses the upstream body, so `response.body` is already
// decoded — but the original `Content-Encoding: gzip` header is still present.
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

function buildForwardHeaders(request: NextRequest): Headers {
  const headers = new Headers();

  request.headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (REQUEST_STRIP_HEADERS.has(normalizedKey)) {
      return;
    }
    headers.set(key, value);
  });

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
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: buildForwardHeaders(request),
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });

    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      if (RESPONSE_STRIP_HEADERS.has(key.toLowerCase())) {
        return;
      }
      responseHeaders.set(key, value);
    });

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

    // Ни адреса, ни текста ошибки в ответ браузеру: `targetUrl` — это внутренний
    // адрес API внутри Docker/Railway, а `errorMsg` регулярно содержит его же.
    // Читать это будет человек, которому нужно знать одно: сервер не ответил.
    // Разбираться будет тот, у кого есть лог сервера, — там оба и лежат.
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
