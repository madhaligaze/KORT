/**
 * Шлюз между окном KORT и сервером - ради работы без связи.
 *
 * Окно ходит только сюда (`http://127.0.0.1:<порт>`). Страницы и статика
 * уходят локальному фронту (`web.ts`), запросы `/api/backend/*` - серверу
 * KORT. Каждый ответ сервера на чтение запоминается на диске (`vault.ts`), и
 * пока сервер молчит, шлюз отвечает за него последним известным: реестр,
 * карточки, кабинет открываются и показывают данные на момент потери связи.
 *
 * Записи без связи шлюз не выдумывает: отвечает 503 «нет связи». Правки
 * договоров на это и рассчитаны - хранилище реестра держит их в очереди на
 * диске и отправляет само, когда связь вернётся (`contracts/store.ts`).
 * Остальные действия честно говорят, что без связи не выполнятся.
 *
 * Реестр шлюз держит свежим сам: опрос изменений и ответы на правки ложатся
 * в сохранённый реестр, и при запуске без связи он не старше последнего
 * опроса.
 */
import { createHash } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

import type { Vault } from "./vault";

export type Status = {
  online: boolean;
  offlineSince: number | null;
  lastOkAt: number | null;
};

type Options = {
  /** Порты, которые пробовать по порядку: от порта зависит адрес окна, а с ним - его хранилище. */
  ports: number[];
  /** Порт локального фронта. */
  webPort: number;
  /** Адреса API по порядку предпочтения (`…/api/backend` сайта или сам API). */
  upstreams: string[];
  vault: Vault;
  version: string;
  onStatus: (status: Status) => void;
  log: (line: string) => void;
};

const API_PREFIX = "/api/backend";
const FINANCE = "/api/v1/finance";
const ME = `${FINANCE}/auth/me`;
const LOGOUT = `${FINANCE}/auth/logout`;
const CONTRACTS = `${FINANCE}/contracts`;
const CHANGES = `${CONTRACTS}/changes`;
/** Готовность API вместе с базой: живой процесс без базы - тоже «нет связи». */
const READY = "/api/v1/health/ready";
const SESSION_COOKIE = "fin_session";

const MAX_BODY = 48 * 1024 * 1024;
const MAX_CACHED = 40 * 1024 * 1024;
const GET_TIMEOUT = 30_000;
/** Как у прокси сайта: распознавание сканов бывает долгим. */
const WRITE_TIMEOUT = 180_000;
const PROBE_TIMEOUT = 6_000;
const PROBE_EVERY = 3_000;
/** Реестр - на диск не чаще: опрос изменений идёт раз в 2 с. */
const FLUSH_EVERY = 3_000;
/** Прочитать реестр заранее, если человек давно его не открывал. */
const WARM_EVERY = 10 * 60_000;

const WRITE_OFFLINE = "Нет связи с сервером. Без связи это не выполнить - попробуйте, когда связь вернётся.";
const READ_OFFLINE =
  "Нет связи с сервером, а этот экран на этом компьютере ещё не открывался - он откроется, когда связь вернётся.";

const HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
  "keep-alive",
  "origin",
  "referer",
  "x-client-ip",
  "x-proxy-auth",
]);
const RESPONSE_DROP = new Set(["connection", "content-encoding", "content-length", "transfer-encoding", "keep-alive"]);

type Cached = { savedAt: number; type: string; body: string };
type Batch = {
  seq?: number;
  schema_rev?: number;
  contracts?: { id: string }[];
  removed?: string[];
  parties?: Record<string, unknown>;
  people?: Record<string, unknown>;
};
type All = Batch & { contracts: { id: string }[] };

class Unreached extends Error {}

function accountOf(cookie: string | undefined): string | null {
  const match = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]*)`).exec(cookie ?? "");
  if (!match || !match[1]) return null;
  return createHash("sha256").update(match[1]).digest("hex").slice(0, 24);
}

/** Сеанс из ответа сервера: токен нового входа, `null` - выход, `undefined` - сеанс не трогали. */
function sessionSet(headers: Headers): string | null | undefined {
  for (const line of headers.getSetCookie()) {
    const match = new RegExp(`^${SESSION_COOKIE}=([^;]*)`).exec(line);
    if (match) return match[1] || null;
  }
  return undefined;
}

/**
 * Куки сервера - для окна на 127.0.0.1: без `Secure` (адрес шлюза - http) и
 * без `Domain` (иначе браузер её не примет).
 */
function localCookie(line: string): string {
  return line
    .split(";")
    .map((part) => part.trim())
    .filter((part) => !/^secure$/i.test(part) && !/^domain=/i.test(part))
    .map((part) => (/^samesite=none$/i.test(part) ? "SameSite=Lax" : part))
    .join("; ");
}

/** Ответил не API, а край хостинга или прокси сайта: «сервер не отвечает». */
function edge(response: Response): boolean {
  if (response.headers.get("x-railway-fallback") || response.headers.get("x-render-routing")) return true;
  return response.status === 502 || response.status === 504;
}

function readBody(request: http.IncomingMessage): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    if (request.method === "GET" || request.method === "HEAD") {
      resolve(undefined);
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    request.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY) {
        reject(new Error("too big"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function json(response: http.ServerResponse, status: number, payload: unknown, extra: Record<string, string> = {}): void {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length),
    "cache-control": "no-store",
    ...extra,
  });
  response.end(body);
}

function parse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Сохраняется только то, что можно показать без связи: чтение учёта, а не файлы и не опрос. */
function cacheable(path: string): boolean {
  if (!path.startsWith(`${FINANCE}/`) || path === CHANGES) return false;
  if (path.startsWith(`${FINANCE}/auth/`)) return path === ME;
  return !/\.(xlsx|xls|pdf|csv|zip|ogg|webm)$/i.test(path);
}

export class Gateway {
  private server: http.Server | null = null;
  port = 0;
  private status: Status = { online: true, offlineSince: null, lastOkAt: null };
  private upstream: string;
  private probing: NodeJS.Timeout | null = null;
  /** Учётка → компания, в которой она сейчас: сохранённое двух компаний не смешивается. */
  private companies = new Map<string, string>();
  /** Реестр в памяти - чтобы класть в него изменения, не расшифровывая файл каждые 2 с. */
  private registries = new Map<string, { all: All; type: string; dirty: boolean }>();
  private flushTimer: NodeJS.Timeout | null = null;
  /** Лист → когда реестр читали заранее и когда он сам освежался опросом. */
  private warmedAt = new Map<string, number>();
  private freshAt = new Map<string, number>();

  constructor(private readonly options: Options) {
    this.upstream = options.upstreams[0];
  }

  async start(): Promise<number> {
    for (const port of this.options.ports) {
      try {
        this.port = await this.listen(port);
        return this.port;
      } catch {
        /* порт занят - следующий */
      }
    }
    this.port = await this.listen(0);
    return this.port;
  }

  private listen(port: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        this.handle(request, response).catch(() => {
          if (!response.headersSent) json(response, 500, { detail: "Сбой KORT на этом компьютере. Перезапустите приложение." });
          else response.destroy();
        });
      });
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", reject);
        this.server = server;
        resolve((server.address() as AddressInfo).port);
      });
    });
  }

  current(): Status {
    return this.status;
  }

  /** Перед выходом: реестр в памяти - на диск. */
  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    for (const [scope, entry] of this.registries) {
      if (!entry.dirty) continue;
      entry.dirty = false;
      this.put(scope, CONTRACTS, entry.type, JSON.stringify(entry.all));
    }
  }

  stop(): void {
    this.flush();
    if (this.probing) clearInterval(this.probing);
    this.server?.close();
  }

  // ── Связь ─────────────────────────────────────────────────────────────────

  private reached(): void {
    const was = this.status.online;
    this.status = { online: true, offlineSince: null, lastOkAt: Date.now() };
    if (this.probing) {
      clearInterval(this.probing);
      this.probing = null;
    }
    if (!was) this.options.onStatus(this.status);
  }

  private lost(): void {
    if (!this.status.online) return;
    this.status = { online: false, offlineSince: Date.now(), lastOkAt: this.status.lastOkAt };
    this.options.onStatus(this.status);
    if (!this.probing) {
      this.probing = setInterval(() => void this.probe(), PROBE_EVERY);
      void this.probe();
    }
  }

  private probeBusy = false;

  /** Без связи - стучимся во все адреса по порядку; первый ответивший становится основным. */
  private async probe(): Promise<void> {
    if (this.probeBusy) return;
    this.probeBusy = true;
    try {
      for (const base of this.options.upstreams) {
        try {
          const response = await fetch(`${base}${READY}`, { signal: AbortSignal.timeout(PROBE_TIMEOUT), cache: "no-store" });
          const body = (await response.json().catch(() => null)) as { status?: string } | null;
          if (response.ok && !edge(response) && body?.status === "ok") {
            this.upstream = base;
            this.reached();
            return;
          }
        } catch {
          /* следующий адрес */
        }
      }
    } finally {
      this.probeBusy = false;
    }
  }

  // ── Запросы ───────────────────────────────────────────────────────────────

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    // Только окно KORT: страница чужого сайта, переименовавшая себя в
    // 127.0.0.1 (DNS rebinding), сюда не попадёт.
    const host = request.headers.host ?? "";
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}`) {
      response.writeHead(421);
      response.end();
      return;
    }
    const url = request.url ?? "/";
    if (url === API_PREFIX || url.startsWith(`${API_PREFIX}/`)) {
      await this.api(request, response, url.slice(API_PREFIX.length) || "/");
      return;
    }
    this.web(request, response);
  }

  /** Страница и статика - локальному фронту как есть, потоком. */
  private web(request: http.IncomingMessage, response: http.ServerResponse): void {
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: this.options.webPort,
        method: request.method,
        path: request.url,
        headers: { ...request.headers, host: `127.0.0.1:${this.options.webPort}` },
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        response.end("KORT ещё запускается - обновите окно через секунду.");
      } else response.destroy();
    });
    request.pipe(upstream);
  }

  private async api(request: http.IncomingMessage, response: http.ServerResponse, rest: string): Promise<void> {
    const method = (request.method ?? "GET").toUpperCase();
    const path = rest.split("?")[0];
    const account = accountOf(request.headers.cookie);
    let body: Buffer | undefined;
    try {
      body = await readBody(request);
    } catch {
      json(response, 413, { detail: `Запрос больше ${MAX_BODY / (1024 * 1024)} МБ` });
      return;
    }
    const reading = method === "GET";
    // Связи нет - не ждём таймаута на каждом запросе: проба вернёт связь сама.
    if (!this.status.online) {
      if (reading) this.fromCache(response, account, rest, path);
      else json(response, 503, { detail: WRITE_OFFLINE }, { "x-kort-offline": "1" });
      return;
    }
    let answer: Response;
    try {
      answer = await this.forward(request, rest, method, body);
    } catch {
      this.lost();
      if (reading) this.fromCache(response, account, rest, path);
      else json(response, 503, { detail: WRITE_OFFLINE }, { "x-kort-offline": "1" });
      return;
    }
    const bytes = Buffer.from(await answer.arrayBuffer());
    this.reached();
    const headers: Record<string, string | string[]> = {};
    answer.headers.forEach((value, key) => {
      const name = key.toLowerCase();
      if (RESPONSE_DROP.has(name) || name === "set-cookie") return;
      headers[name] = value;
    });
    const cookies = answer.headers.getSetCookie().map(localCookie);
    if (cookies.length) headers["set-cookie"] = cookies;
    headers["content-length"] = String(bytes.length);
    response.writeHead(answer.status, headers);
    response.end(bytes);
    try {
      this.remember(method, rest, path, account, answer, bytes, request.headers.cookie ?? "");
    } catch (error) {
      // Не сохранилось - ответ человек уже получил; причина - в журнал.
      this.options.log(`cache ${method} ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async forward(request: http.IncomingMessage, rest: string, method: string, body: Buffer | undefined): Promise<Response> {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value === undefined || HOP_HEADERS.has(key.toLowerCase())) continue;
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    headers.set("x-kort-desktop", this.options.version);
    const answer = await fetch(`${this.upstream}${rest}`, {
      method,
      headers,
      body: body && body.length ? new Uint8Array(body) : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(method === "GET" ? GET_TIMEOUT : WRITE_TIMEOUT),
    });
    if (edge(answer)) {
      await answer.body?.cancel();
      throw new Unreached();
    }
    return answer;
  }

  // ── Сохранённое ───────────────────────────────────────────────────────────

  private companyOf(account: string): string {
    let company = this.companies.get(account);
    if (company === undefined) {
      company = this.options.vault.read(`cache/${account}`, "company") ?? "";
      this.companies.set(account, company);
    }
    return company;
  }

  private scopeOf(account: string): string {
    return `cache/${account}/${this.companyOf(account) || "_"}`;
  }

  private put(scope: string, key: string, type: string, body: string): void {
    const meta = JSON.stringify({ savedAt: Date.now(), type });
    this.options.vault.write(scope, key, `${meta}\n${body}`);
  }

  private get(scope: string, key: string): Cached | null {
    const raw = this.options.vault.read(scope, key);
    if (raw === null) return null;
    const cut = raw.indexOf("\n");
    const meta = parse<{ savedAt: number; type: string }>(raw.slice(0, cut));
    if (!meta) return null;
    return { savedAt: meta.savedAt, type: meta.type, body: raw.slice(cut + 1) };
  }

  private fromCache(response: http.ServerResponse, account: string | null, rest: string, path: string): void {
    const entry = account && cacheable(path) ? this.cached(account, rest, path) : null;
    if (!entry) {
      json(response, 503, { detail: READ_OFFLINE }, { "x-kort-offline": "1" });
      return;
    }
    const body = Buffer.from(entry.body);
    response.writeHead(200, {
      "content-type": entry.type,
      "content-length": String(body.length),
      "cache-control": "no-store",
      "x-kort-offline": "1",
      "x-kort-saved-at": new Date(entry.savedAt).toISOString(),
    });
    response.end(body);
  }

  private cached(account: string, rest: string, path: string): Cached | null {
    if (path === ME) return this.get(`cache/${account}`, ME);
    const scope = this.scopeOf(account);
    if (rest === CONTRACTS) {
      const hot = this.registries.get(scope);
      if (hot) return { savedAt: Date.now(), type: hot.type, body: JSON.stringify(hot.all) };
    }
    return this.get(scope, rest);
  }

  private remember(
    method: string,
    rest: string,
    path: string,
    account: string | null,
    answer: Response,
    bytes: Buffer,
    cookie: string,
  ): void {
    const vault = this.options.vault;
    // Вход и выход меняют учётку: сохранённое вышедшего стирается.
    const token = sessionSet(answer.headers);
    if (token === null || (path === LOGOUT && answer.ok)) {
      if (account) this.forget(account);
      return;
    }
    const session = token ? accountOf(`${SESSION_COOKIE}=${token}`) : null;
    if (session) for (const other of vault.scopes("cache")) if (other !== session) this.forget(other);
    if (!answer.ok) return;
    const type = answer.headers.get("content-type") ?? "";
    if (!type.includes("application/json") || bytes.length > MAX_CACHED) return;
    const text = bytes.toString("utf8");

    // «Кто я» отвечает не только `/auth/me`: вход и смена компании отдают то же
    // самое, и после входа фронт отдельно не спрашивает - а без сохранённого
    // «кто я» без связи не открыть ничего.
    if (path.startsWith(`${FINANCE}/auth/`)) {
      const owner = session ?? account;
      const me = parse<{ authenticated?: boolean; company?: { id?: string } | null; access?: Record<string, string> }>(text);
      if (!owner || !me?.authenticated) return;
      const company = me.company?.id ?? "";
      if (this.companyOf(owner) !== company) {
        this.flush();
        this.companies.set(owner, company);
        vault.write(`cache/${owner}`, "company", company);
      }
      this.put(`cache/${owner}`, ME, type, text);
      const access = me.access?.contracts;
      if (access && access !== "none") this.warm(owner, token ? `${SESSION_COOKIE}=${token}` : cookie);
      return;
    }
    if (!account) return;
    const scope = this.scopeOf(account);
    if (method === "GET") {
      if (path === CHANGES) {
        this.overlay(scope, parse<Batch>(text));
        this.freshAt.set(scope, Date.now());
      } else if (cacheable(path)) {
        if (rest === CONTRACTS) {
          const all = parse<All>(text);
          if (all) this.registries.set(scope, { all, type, dirty: false });
          this.freshAt.set(scope, Date.now());
        }
        this.put(scope, rest, type, text);
      }
      return;
    }
    // Ответ правки договора - сам договор: он ложится в сохранённый реестр и карточку.
    if (path.startsWith(`${CONTRACTS}/`) || path === CONTRACTS) {
      const one = parse<{ contract?: { id?: string }; parties?: Record<string, unknown>; people?: Record<string, unknown> }>(text);
      const id = one?.contract?.id;
      if (!one || !id) return;
      this.overlay(scope, { contracts: [one.contract as { id: string }], parties: one.parties, people: one.people });
      this.put(scope, `${CONTRACTS}/${id}`, type, text);
    }
  }

  /** Сохранённый реестр с изменениями опроса или ответа на правку. */
  private overlay(scope: string, batch: Batch | null): void {
    if (!batch || (!batch.contracts?.length && !batch.removed?.length)) {
      const hot = this.registries.get(scope);
      if (hot && batch?.seq && batch.seq > (hot.all.seq ?? 0)) hot.all.seq = batch.seq;
      return;
    }
    let hot = this.registries.get(scope);
    if (!hot) {
      const stored = this.get(scope, CONTRACTS);
      const all = stored ? parse<All>(stored.body) : null;
      if (!stored || !all) return;
      hot = { all, type: stored.type, dirty: false };
      this.registries.set(scope, hot);
    }
    const all = hot.all;
    const byId = new Map(all.contracts.map((item) => [item.id, item]));
    for (const item of batch.contracts ?? []) byId.set(item.id, item);
    for (const id of batch.removed ?? []) byId.delete(id);
    all.contracts = [...byId.values()];
    all.parties = { ...(all.parties ?? {}), ...(batch.parties ?? {}) };
    all.people = { ...(all.people ?? {}), ...(batch.people ?? {}) };
    if (batch.seq !== undefined) all.seq = Math.max(all.seq ?? 0, batch.seq);
    if (batch.schema_rev !== undefined) all.schema_rev = batch.schema_rev;
    hot.dirty = true;
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_EVERY);
  }

  private forget(account: string): void {
    for (const scope of [...this.registries.keys()]) if (scope.startsWith(`cache/${account}/`)) this.registries.delete(scope);
    this.companies.delete(account);
    this.options.vault.drop(`cache/${account}`);
  }

  /**
   * Реестр читается заранее, даже если человек его сегодня не открывал: связь
   * пропадает не по расписанию, а без сохранённого реестра без связи нечего
   * заполнять. Открытый реестр держит сохранённое свежим сам (`overlay`), и
   * тогда второй раз его не читаем.
   */
  private warm(account: string, cookie: string): void {
    const scope = this.scopeOf(account);
    const last = Math.max(this.warmedAt.get(scope) ?? 0, this.freshAt.get(scope) ?? 0);
    if (Date.now() - last < WARM_EVERY) return;
    this.warmedAt.set(scope, Date.now());
    void (async () => {
      for (const rest of [`${CONTRACTS}/schema`, CONTRACTS, `${CONTRACTS}/people`]) {
        try {
          const answer = await fetch(`${this.upstream}${rest}`, {
            headers: { cookie, "x-kort-desktop": this.options.version },
            cache: "no-store",
            signal: AbortSignal.timeout(GET_TIMEOUT),
          });
          if (edge(answer)) return;
          const bytes = Buffer.from(await answer.arrayBuffer());
          this.remember("GET", rest, rest, account, answer, bytes, cookie);
        } catch {
          return;
        }
      }
    })();
  }
}
