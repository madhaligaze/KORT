/**
 * Хранилище реестра договоров — одно на компанию, общее для таблицы и карточек.
 *
 * Модульный объект, а не контекст React: карточка открывается поверх листа,
 * и оба должны читать одну запись без посредника, а лист Univer живёт вне
 * дерева React — ему нужна подписка, а не пропсы (урок «Книг»: два списка
 * одних и тех же строк, живущих порознь, расходятся на первой правке).
 *
 * Правила записи (фронт-план 4.5):
 * * правка оптимистична — значение сразу видно во всех видах;
 * * на один договор в полёте не больше одного запроса; правки, пришедшие во
 *   время запроса, склеиваются в следующий — иначе второй запрос уехал бы с тем
 *   же `known_seq` и получил 409 от собственной правки;
 * * сторона и сумма существующего договора спрашивают «опечатка или с даты»:
 *   клиент предсказывает вопрос, сервер держит правило (422 `mode_required`);
 * * нет связи — правка ждёт в очереди и уходит при первом успешном опросе.
 */
import { useSyncExternalStore } from "react";

import { type PollOutcome, type Poller, pollWhileVisible } from "@/components/univer/live";

import {
  type ChangeMode,
  type ChangesBatch,
  type Contract,
  type ContractsAll,
  type OneContract,
  type Party,
  type PaymentSummary,
  type PersonRef,
  type RegistrySchema,
  type SummaryEntry,
  type SummarySource,
  FinanceApiError,
  contractsApi,
} from "@/components/finance/api";

export type EditState = "asking" | "sending" | "queued" | "failed" | "conflict";

export type Edit = {
  value: unknown;
  state: EditState;
  mode?: ChangeMode;
  theirs?: unknown;
  by?: string;
  error?: string;
  startedAt: number;
};

export type RemoteNote = { id: string; field: string; by: string; number: string; at: number };

export type RegistryState = {
  phase: "idle" | "boot" | "ready" | "error";
  error: string;
  company: string | null;
  me: string | null;
  schema: RegistrySchema | null;
  schemaRev: number;
  seq: number;
  byId: ReadonlyMap<string, Contract>;
  order: readonly string[];
  parties: Readonly<Record<string, Party>>;
  /** Подписи людей: из договоров и из справочника. */
  people: Readonly<Record<string, PersonRef>>;
  /** Справочник ответственных — действующие сотрудники (`ensureStaff`); `null` — ещё не прочитан. */
  staff: readonly PersonRef[] | null;
  /**
   * «Оплачено/Остаток по выписке» — договор → сводка (`ensurePayments`).
   * `null` — не прочитано или журнал человеку не открыт.
   */
  payments: Readonly<Record<string, PaymentSummary>> | null;
  /**
   * «Оплачено/Остаток (сводка)» — договор → что о нём знает книга-сводка
   * (`ensureSummary`). `null` — не прочитано или сводка не подключена.
   */
  summary: Readonly<Record<string, SummaryEntry>> | null;
  summarySource: SummarySource | null;
  /** По какой сводке сервер посчитал листы («Остатки») в последнем полном чтении. */
  listSummaryRev: string;
  edits: ReadonlyMap<string, ReadonlyMap<string, Edit>>;
  live: { online: boolean; lastOkAt: number | null; failures: number };
  remote: readonly RemoteNote[];
  /** Договор → «ушёл в „Прочие / Аренда“» / «убран · Дана Ж.». Убирается сменой отбора. */
  departed: ReadonlyMap<string, string>;
  /** Только что появившиеся строки — для прочерка верхней линии. */
  fresh: ReadonlySet<string>;
  /**
   * Договор → отборы (и блоки), в которых он стоял до правки, уведшей его
   * оттуда. Лист держит такую строку приглушённой на месте до смены вкладки.
   * Считается при приходе изменений, а не при отрисовке: список не должен
   * помнить, что рисовал в прошлый раз.
   */
  wasIn: ReadonlyMap<string, readonly { view: string; block: number }[]>;
};

const EMPTY: RegistryState = {
  phase: "idle",
  error: "",
  company: null,
  me: null,
  schema: null,
  schemaRev: 0,
  seq: 0,
  byId: new Map(),
  order: [],
  parties: {},
  people: {},
  staff: null,
  payments: null,
  summary: null,
  summarySource: null,
  listSummaryRev: "",
  edits: new Map(),
  live: { online: true, lastOkAt: null, failures: 0 },
  remote: [],
  departed: new Map(),
  fresh: new Set(),
  wasIn: new Map(),
};

let state: RegistryState = EMPTY;

/** Отборы, из которых договор ушёл этой правкой, — вдобавок к уже запомненным. */
function leftViews(
  wasIn: Map<string, readonly { view: string; block: number }[]>,
  before: Contract | undefined,
  after: Contract,
): void {
  if (!before) return;
  const now = new Set(after.views.map((place) => place.view));
  const gone = before.views.filter((place) => !now.has(place.view));
  if (!gone.length) return;
  const known = wasIn.get(after.id) ?? [];
  wasIn.set(after.id, [...known.filter((place) => !gone.some((g) => g.view === place.view)), ...gone]);
}
const listeners = new Set<() => void>();

function emit(next: Partial<RegistryState>): void {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRegistry(): RegistryState {
  return state;
}

export function useRegistry<T>(select: (value: RegistryState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(EMPTY),
  );
}

// ── Загрузка ─────────────────────────────────────────────────────────────────

let onAuthLost: (() => void) | null = null;

export function setAuthLost(handler: (() => void) | null): void {
  onAuthLost = handler;
}

function sortOrder(byId: ReadonlyMap<string, Contract>): string[] {
  return [...byId.values()]
    .filter((item) => !item.deleted)
    .sort((a, b) => a.position - b.position || (a.created_at ?? "").localeCompare(b.created_at ?? ""))
    .map((item) => item.id);
}

let booting: Promise<void> | null = null;

/** Схема и все договоры — по одному запросу. 460 договоров — секунда. */
export function boot(company: string, me: string | null, force = false): Promise<void> {
  if (!force && state.company === company && (state.phase === "ready" || booting)) {
    return booting ?? Promise.resolve();
  }
  if (state.company !== company) {
    state = { ...EMPTY, company, me, phase: "boot" };
    listeners.forEach((listener) => listener());
  } else {
    emit({ phase: state.phase === "ready" ? "ready" : "boot", me });
  }
  booting = (async () => {
    try {
      const [schema, all] = await Promise.all([contractsApi.schema(), contractsApi.all()]);
      if (state.company !== company) return;
      loadAll(schema, all);
    } catch (exc) {
      if (state.company !== company) return;
      if (exc instanceof FinanceApiError && exc.status === 401) onAuthLost?.();
      emit({ phase: "error", error: exc instanceof Error ? exc.message : "Реестр не прочитался" });
    } finally {
      booting = null;
    }
  })();
  return booting;
}

function loadAll(schema: RegistrySchema, all: ContractsAll): void {
  const byId = new Map<string, Contract>();
  for (const item of all.contracts) byId.set(item.id, item);
  emit({
    phase: "ready",
    error: "",
    schema,
    schemaRev: schema.schema_rev,
    seq: all.seq,
    byId,
    order: sortOrder(byId),
    parties: all.parties,
    listSummaryRev: all.summary_rev ?? "",
    // Справочник сотрудников держится поверх: полное чтение приносит только
    // тех, кто стоит в договорах.
    people: { ...Object.fromEntries((state.staff ?? []).map((person) => [person.id, person])), ...all.people },
  });
}

export async function reloadSchema(): Promise<void> {
  try {
    const schema = await contractsApi.schema();
    emit({ schema, schemaRev: schema.schema_rev });
  } catch {
    /* следующий опрос попробует снова */
  }
}

/** Перечитать всё — после загрузки Excel или сведения значений. */
export async function reloadAll(): Promise<void> {
  if (!state.company) return;
  const [schema, all] = await Promise.all([contractsApi.schema(), contractsApi.all()]);
  loadAll(schema, all);
}

// ── Живой режим: опрос ───────────────────────────────────────────────────────

// Сам опрос (пауза, видимость вкладки, отступление) — общий движок листов
// `univer/live.ts`; здесь только что спросить и как применить ответ.
let interest = 0;
let poller: Poller | null = null;

async function pollOnce(): Promise<PollOutcome> {
  if (state.phase !== "ready") return "ok";
  try {
    const batch = await contractsApi.changes(state.seq);
    applyChanges(batch);
    const live = { online: true, lastOkAt: Date.now(), failures: 0 };
    emit({ live });
    if (batch.schema_rev !== state.schemaRev) await reloadSchema();
    flushQueued();
    return "ok";
  } catch (exc) {
    if (exc instanceof FinanceApiError && exc.status === 401) {
      onAuthLost?.();
      return "stop";
    }
    if (exc instanceof FinanceApiError && exc.status === 403) await reloadSchema();
    const failures = state.live.failures + 1;
    // «Нет связи» — после двух отказов подряд или 6 с без успеха: одиночный
    // сбой не должен мигать янтарём.
    const stale = state.live.lastOkAt === null || Date.now() - state.live.lastOkAt > 6000;
    emit({ live: { online: !(failures >= 2 || stale), lastOkAt: state.live.lastOkAt, failures } });
    return "fail";
  }
}

/** Экран, которому нужен живой режим, держит интерес, пока открыт. */
export function holdLive(): () => void {
  interest += 1;
  if (interest === 1) poller = pollWhileVisible(pollOnce);
  return () => {
    interest -= 1;
    if (interest <= 0) {
      interest = 0;
      poller?.stop();
      poller = null;
    }
  };
}

const FIELD_WORDS: Record<string, string> = {};

function fieldWord(key: string): string {
  if (FIELD_WORDS[key]) return FIELD_WORDS[key];
  const field = state.schema?.fields.find((item) => item.key === key);
  return (field?.title ?? key).toLowerCase();
}

function applyChanges(batch: ChangesBatch): void {
  if (!batch.contracts.length && !batch.removed.length) {
    if (batch.seq > state.seq) emit({ seq: batch.seq });
    return;
  }
  const byId = new Map(state.byId);
  const departed = new Map(state.departed);
  const wasIn = new Map(state.wasIn);
  const fresh = new Set<string>();
  const notes: RemoteNote[] = [];
  for (const incoming of batch.contracts) {
    const before = byId.get(incoming.id);
    const mine = state.edits.get(incoming.id);
    if (!before) fresh.add(incoming.id);
    leftViews(wasIn, before, incoming);
    // Поля с правкой в полёте не перетираются: побеждает то, что человек
    // только что напечатал; конфликт решит сервер по `known_seq`.
    let merged = incoming;
    if (mine && mine.size) {
      const values = { ...incoming.values };
      for (const [key, edit] of mine) if (edit.state !== "conflict") values[key] = before?.values[key];
      merged = { ...incoming, values };
    }
    if (before && incoming.updated_by && incoming.updated_by.id !== state.me) {
      for (const key of Object.keys({ ...before.values, ...incoming.values })) {
        if (JSON.stringify(before.values[key]) !== JSON.stringify(incoming.values[key]) && !mine?.has(key)) {
          notes.push({
            id: incoming.id,
            field: fieldWord(key),
            by: incoming.updated_by.short_name,
            number: String(incoming.values.number ?? ""),
            at: Date.now(),
          });
          break;
        }
      }
    }
    byId.set(incoming.id, merged);
  }
  for (const id of batch.removed) {
    const before = byId.get(id);
    if (before) {
      departed.set(id, "убран");
      byId.set(id, { ...before, deleted: true });
    }
  }
  emit({
    byId,
    order: sortOrder(byId),
    seq: Math.max(state.seq, batch.seq),
    parties: { ...state.parties, ...batch.parties },
    people: { ...state.people, ...batch.people },
    remote: [...notes, ...state.remote].slice(0, 20),
    departed,
    fresh,
    wasIn,
  });
}

export function forgetDeparted(): void {
  if (state.departed.size || state.fresh.size || state.wasIn.size) {
    const byId = new Map(state.byId);
    for (const [id] of state.departed) {
      const item = byId.get(id);
      if (item?.deleted) byId.delete(id);
    }
    emit({ departed: new Map(), fresh: new Set(), wasIn: new Map(), byId, order: sortOrder(byId) });
  }
}

export function noteDeparted(id: string, text: string): void {
  const departed = new Map(state.departed);
  departed.set(id, text);
  emit({ departed });
}

// ── Правка ───────────────────────────────────────────────────────────────────

function setEdit(id: string, key: string, edit: Edit | null): void {
  const edits = new Map(state.edits);
  const forContract = new Map(edits.get(id) ?? []);
  if (edit) forContract.set(key, edit);
  else forContract.delete(key);
  if (forContract.size) edits.set(id, forContract);
  else edits.delete(id);
  emit({ edits });
}

function putOne(one: OneContract, keepEdits = true): void {
  const byId = new Map(state.byId);
  const incoming = one.contract;
  const mine = keepEdits ? state.edits.get(incoming.id) : undefined;
  let merged = incoming;
  if (mine && mine.size) {
    const values = { ...incoming.values };
    const before = byId.get(incoming.id);
    for (const [key, edit] of mine) {
      if (edit.state === "sending" || edit.state === "queued" || edit.state === "asking") {
        values[key] = before?.values[key];
      }
    }
    merged = { ...incoming, values };
  }
  const wasIn = new Map(state.wasIn);
  leftViews(wasIn, byId.get(incoming.id), incoming);
  byId.set(incoming.id, merged);
  emit({
    byId,
    order: sortOrder(byId),
    seq: Math.max(state.seq, incoming.seq),
    parties: { ...state.parties, ...one.parties },
    people: { ...state.people, ...one.people },
    wasIn,
  });
}

/** Сегодня по часовому поясу компании (UTC+5): правило «заведён сегодня». */
function companyToday(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

function createdToday(contract: Contract): boolean {
  if (!contract.created_at) return false;
  const created = new Date(new Date(contract.created_at).getTime() + 5 * 3600_000).toISOString().slice(0, 10);
  return created === companyToday();
}

/** Спросит ли сервер «опечатка или с даты». Предсказание; правило держит сервер. */
export function needsMode(contract: Contract | undefined, key: string): boolean {
  if (!contract || !state.schema?.mode_fields.includes(key)) return false;
  if (contract.source === "import") return true;
  return !(contract.created_by === state.me && createdToday(contract));
}

/** Значение поля с учётом правки в полёте. */
export function shownValue(id: string, key: string): unknown {
  const edit = state.edits.get(id)?.get(key);
  if (edit && edit.state !== "conflict") return edit.value;
  return state.byId.get(id)?.values[key];
}

const inflight = new Set<string>();

/**
 * Правка поля. Если поле спросит режим — правка ждёт ответа («asking»), и вид
 * показывает вопрос у поля; `answer()` отправляет её с режимом.
 */
export function edit(id: string, key: string, value: unknown, mode?: ChangeMode): void {
  const contract = state.byId.get(id);
  if (!contract) return;
  const current = contract.values[key];
  if (JSON.stringify(current ?? null) === JSON.stringify(value ?? null) && !state.edits.get(id)?.has(key)) return;
  if (!mode && needsMode(contract, key)) {
    setEdit(id, key, { value, state: "asking", startedAt: Date.now() });
    return;
  }
  setEdit(id, key, { value, state: "queued", mode, startedAt: Date.now() });
  send(id);
}

export function answer(id: string, key: string, mode: ChangeMode): void {
  const pending = state.edits.get(id)?.get(key);
  if (!pending) return;
  setEdit(id, key, { ...pending, state: "queued", mode });
  send(id);
}

/** Esc у вопроса или «Отмена»: правка снимается, в поле прежнее значение. */
export function cancel(id: string, key: string): void {
  setEdit(id, key, null);
}

/** «Поставить моё» при конфликте: та же правка поверх свежего номера. */
export function insist(id: string, key: string): void {
  const pending = state.edits.get(id)?.get(key);
  if (!pending) return;
  setEdit(id, key, { ...pending, state: "queued", theirs: undefined, by: undefined, error: undefined });
  send(id);
}

function send(id: string): void {
  if (inflight.has(id)) return;
  const edits = state.edits.get(id);
  if (!edits) return;
  const ready = [...edits].filter(([, item]) => item.state === "queued");
  if (!ready.length) return;
  // Правки с разными режимами в один запрос не склеиваются.
  const mode = ready[0][1].mode;
  const batch = ready.filter(([, item]) => JSON.stringify(item.mode ?? null) === JSON.stringify(mode ?? null));
  const values: Record<string, unknown> = {};
  for (const [key, item] of batch) values[key] = item.value;
  const contract = state.byId.get(id);
  if (!contract) return;
  inflight.add(id);
  for (const [key, item] of batch) setEdit(id, key, { ...item, state: "sending" });
  contractsApi
    .patch(id, values, contract.seq, mode ?? null)
    .then((one) => {
      inflight.delete(id);
      for (const [key] of batch) {
        const now = state.edits.get(id)?.get(key);
        // Во время запроса человек успел напечатать другое — оно уйдёт следующим.
        if (now && now.state === "sending") setEdit(id, key, null);
      }
      putOne(one);
      send(id);
    })
    .catch((exc: unknown) => {
      inflight.delete(id);
      if (exc instanceof FinanceApiError) {
        const body = (exc.body ?? {}) as { code?: string; fields?: string[]; conflicts?: string[] } & Partial<OneContract>;
        if (exc.status === 422 && body.code === "mode_required") {
          for (const [key, item] of batch) {
            setEdit(id, key, { ...item, state: (body.fields ?? []).includes(key) ? "asking" : "queued", mode: undefined });
          }
          send(id);
          return;
        }
        if (exc.status === 409 && body.code === "conflict") {
          if (body.contract) putOne(body as OneContract, false);
          const fresh = state.byId.get(id);
          for (const [key, item] of batch) {
            if ((body.conflicts ?? []).includes(key)) {
              setEdit(id, key, {
                ...item,
                state: "conflict",
                theirs: fresh?.values[key],
                by: fresh?.updated_by?.short_name ?? "",
              });
            } else setEdit(id, key, { ...item, state: "queued" });
          }
          send(id);
          return;
        }
        if (exc.status === 401) onAuthLost?.();
        if (exc.status >= 500 || exc.status === 0) {
          for (const [key, item] of batch) setEdit(id, key, { ...item, state: "queued" });
          emit({ live: { ...state.live, online: false } });
          return;
        }
        for (const [key, item] of batch) setEdit(id, key, { ...item, state: "failed", error: exc.message });
        return;
      }
      // Сеть упала: правка ждёт и уйдёт при первом успешном опросе.
      for (const [key, item] of batch) setEdit(id, key, { ...item, state: "queued" });
      emit({ live: { ...state.live, online: false, failures: state.live.failures + 1 } });
    });
}

function flushQueued(): void {
  for (const [id, edits] of state.edits) {
    if ([...edits.values()].some((item) => item.state === "queued")) send(id);
  }
}

export function pendingCount(): number {
  let count = 0;
  for (const edits of state.edits.values()) {
    for (const item of edits.values()) if (item.state === "queued" || item.state === "sending") count += 1;
  }
  return count;
}

// ── Заведение и удаление ─────────────────────────────────────────────────────

export async function create(
  values: Record<string, unknown>,
  ctx?: { view?: string; block?: number; source?: string },
): Promise<string> {
  const one = await contractsApi.create(values, ctx);
  putOne(one, false);
  const fresh = new Set(state.fresh);
  fresh.add(one.contract.id);
  emit({ fresh });
  return one.contract.id;
}

export async function remove(id: string): Promise<void> {
  await contractsApi.remove(id);
  const byId = new Map(state.byId);
  byId.delete(id);
  emit({ byId, order: sortOrder(byId) });
}

export async function refreshOne(id: string): Promise<void> {
  try {
    putOne(await contractsApi.one(id));
  } catch {
    /* договор мог уйти — опрос покажет */
  }
}

export function put(one: OneContract): void {
  putOne(one, false);
}

/** Сводка оплат старше этого — перечитывается при следующем обращении. */
const PAYMENTS_TTL = 30_000;
let paymentsAt = 0;
let paymentsLoading: Promise<void> | null = null;
/** Журнал не открыт (403) — не спрашивать заново до смены компании. */
let paymentsClosedFor: string | null = null;

/**
 * Оплаты по выписке читаются своим запросом, а не с договорами: они
 * меняются от выписок и разнесения, а не от правки договора, и номер
 * изменений реестра о них не знает.
 */
export function ensurePayments(force = false): Promise<void> {
  const company = state.company;
  if (!company || paymentsClosedFor === company) return Promise.resolve();
  const fresh = state.payments !== null && Date.now() - paymentsAt < PAYMENTS_TTL;
  if (!force && (paymentsLoading || fresh)) return paymentsLoading ?? Promise.resolve();
  paymentsLoading = (async () => {
    try {
      const result = await contractsApi.payments.all();
      if (state.company !== company) return;
      paymentsAt = Date.now();
      emit({ payments: result.contracts });
    } catch (exc) {
      if (exc instanceof FinanceApiError && exc.status === 403) paymentsClosedFor = company;
    } finally {
      paymentsLoading = null;
    }
  })();
  return paymentsLoading;
}

/** Сводка старше этого — перечитывается при следующем обращении (сервер держит книгу 5 мин). */
const SUMMARY_TTL = 60_000;
let summaryAt = 0;
let summaryLoading: Promise<void> | null = null;

/**
 * «Оплачено/Остаток (сводка)» — своим запросом, как оплаты по выписке: книгу
 * правят бухгалтеры, а не реестр, и номер изменений реестра о ней не знает.
 *
 * Листы вроде «Остатков» сервер раскладывает по уже прочитанной сводке.
 * Пришла сводка новее той, по которой собран реестр, — реестр перечитывается
 * целиком, иначе строка с погашенным остатком стояла бы в «Остатках» до
 * перезагрузки страницы.
 */
export function ensureSummary(force = false): Promise<void> {
  const company = state.company;
  if (!company) return Promise.resolve();
  const fresh = state.summary !== null && Date.now() - summaryAt < SUMMARY_TTL;
  if (!force && (summaryLoading || fresh)) return summaryLoading ?? Promise.resolve();
  summaryLoading = (async () => {
    try {
      const result = await contractsApi.summary(force);
      if (state.company !== company) return;
      summaryAt = Date.now();
      emit({ summary: result.source ? result.contracts : null, summarySource: result.source });
      const rev = result.source?.rev ?? "";
      if (rev && rev !== state.listSummaryRev && state.phase === "ready") await reloadAll();
    } catch {
      /* колонка «по сводке» останется пустой до следующей попытки */
    } finally {
      summaryLoading = null;
    }
  })();
  return summaryLoading;
}

/** Справочник старше этого — перечитывается при следующем выборе. */
const STAFF_TTL = 20_000;
let staffAt = 0;
let staffLoading: Promise<void> | null = null;

/**
 * Справочник ответственных — действующие сотрудники из личного кабинета.
 *
 * Раньше он читался один раз за сессию и жил внутри `people`, а `people`
 * переписывался каждым полным чтением реестра: сотрудник, заведённый в
 * кабинете после открытия реестра, в выборе не появлялся до перезагрузки, а
 * после загрузки Excel пропадали все, кто ещё не стоял в договорах.
 */
export function ensureStaff(force = false): Promise<void> {
  // Смена компании сбрасывает `staff` в `null` — справочник читается заново.
  const fresh = state.staff !== null && Date.now() - staffAt < STAFF_TTL;
  if (!force && (staffLoading || fresh)) return staffLoading ?? Promise.resolve();
  const company = state.company;
  staffLoading = (async () => {
    try {
      const result = await contractsApi.people();
      if (state.company !== company) return;
      const people: Record<string, PersonRef> = { ...state.people };
      for (const person of result.people) people[person.id] = person;
      staffAt = Date.now();
      emit({ people, staff: result.people });
    } catch {
      /* выбор покажет тех, кто уже есть в договорах */
    } finally {
      staffLoading = null;
    }
  })();
  return staffLoading;
}

// ── Книги листов ─────────────────────────────────────────────────────────────

const schemaBooks = new WeakMap<RegistrySchema, Map<string, RegistrySchema>>();
const stateBooks = new WeakMap<RegistryState, Map<string, RegistryState>>();
const scopedSchemas = new WeakSet<RegistrySchema>();

/** Лист в книге `book`: `""` — реестр, `oneoff` — «Разовые». */
export function inBook(view: { book?: string }, book: string): boolean {
  return (view.book ?? "") === book;
}

/**
 * Состояние, в схеме которого только листы одной книги. Тот же объект на то
 * же состояние: лист сверяет схему по ссылке, и новая копия на каждый вызов
 * значила бы полную перерисовку на каждой правке.
 */
export function forBook(value: RegistryState, book: string): RegistryState {
  const schema = value.schema;
  // Уже урезанное состояние не урезается второй раз: новая копия схемы
  // выглядела бы для листа сменой схемы.
  if (!schema || scopedSchemas.has(schema)) return value;
  let states = stateBooks.get(value);
  if (!states) stateBooks.set(value, (states = new Map()));
  const hit = states.get(book);
  if (hit) return hit;
  let schemas = schemaBooks.get(schema);
  if (!schemas) schemaBooks.set(schema, (schemas = new Map()));
  let scoped = schemas.get(book);
  if (!scoped) {
    scoped = { ...schema, views: schema.views.filter((view) => inBook(view, book)) };
    schemas.set(book, scoped);
    scopedSchemas.add(scoped);
  }
  const next = { ...value, schema: scoped };
  states.set(book, next);
  return next;
}

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  // Только в разработке: пробники Playwright читают состояние хранилища.
  (window as unknown as Record<string, unknown>).__finRegistry = { getRegistry, needsMode };
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (pendingCount() > 0) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
}
