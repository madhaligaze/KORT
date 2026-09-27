/**
 * Клиент раздела «Финансы».
 *
 * `credentials: "include"` обязателен: маршруты закрыты правом «finance» за
 * логином дашборда, и без куки каждый запрос вернул бы 401.
 *
 * Ошибки разворачиваются в текст один раз здесь, а не в каждом экране. FastAPI
 * кладёт человеческое объяснение в `detail`, и оно бывает единственным, что
 * человек увидит: «счёт не найден», «операцию уже изменили». Показать вместо
 * него «Request failed with status 400» — значит потерять смысл отказа.
 */
const API = "/api/backend/api/v1/finance";

export type Money = string;

export type Account = {
  id: string;
  name: string;
  kind: string;
  currency: string;
  /** `null` — остатки человеку не открыты (право «Остатки и долги» или справочники). */
  starting_balance: Money | null;
  excluded_from_reports: boolean;
  /** Номер счёта в банке (IBAN). По нему выписка находит свой счёт. */
  number?: string;
};

export type AccountBalance = Account & {
  balance: Money;
  balance_with_plan: Money;
};

export type DictEntry = { id: string; name: string };
export type Category = DictEntry & {
  side: "income" | "expense";
  system_key: string;
  /** Природа статьи для показателей: себестоимость, операционный, капитал… */
  nature?: string;
};
export type Counterparty = DictEntry & { role: string };
export type Project = DictEntry & { closed: boolean };

export type Dictionaries = {
  accounts: Account[];
  categories: Category[];
  counterparties: Counterparty[];
  projects: Project[];
  tags: DictEntry[];
};

export type Company = { id: string; title: string; role: string };

export type AccessLevel = "none" | "view" | "edit";
export type MemberRole = "owner" | "admin" | "employee";

export type Me = {
  authenticated: boolean;
  user?: { id: string; email: string; phone?: string; full_name: string; must_change_password: boolean };
  company?: Company | null;
  companies?: Company[];
  /** Прежние способности: read | write | accounts | people | company.
   *  Для экранов, ещё не переведённых на `access`. */
  abilities?: string[];
  role?: MemberRole | null;
  /** Раздел прав → уровень. Владельцу и администратору — всё «edit». */
  access?: Record<string, AccessLevel>;
  contracts_scope?: {
    rows: "all" | "department" | "own";
    entities: string[];
    fields: Record<string, AccessLevel>;
  };
  /** Открытые просьбы к администраторам — «N запросов» в раме. */
  pending_requests?: number;
  employee?: {
    id: string;
    full_name: string;
    job_title: string;
    department: { id: string; code: string; title: string } | null;
  } | null;
};

export type MemberRow = {
  id: string;
  email: string;
  full_name: string;
  status: string;
  last_login_at: string | null;
  role: string;
};

export type SessionRow = {
  id: string;
  created_at: string | null;
  last_seen_at: string | null;
  user_agent: string;
  ip?: string;
  /** Сеанс, из которого смотрят. */
  current?: boolean;
};

export type Overview = {
  workspace: { id: string; title: string; currency: string };
  accounts: AccountBalance[];
  total: Money;
  total_with_plan: Money;
  receivable: Money;
  payable: Money;
  overdue_receivable: Money;
  planned_count: number;
  planned_preview: { id: string; kind: string; paid_at: string; amount: Money; comment: string }[];
};

export type OperationKind = "income" | "expense" | "transfer";

export type Operation = {
  id: string;
  version: number;
  kind: OperationKind;
  status: "fact" | "plan";
  paid_at: string;
  accrued_at: string | null;
  period_start: string | null;
  period_end: string | null;
  amount: Money;
  currency: string;
  amount_base: Money;
  account_from: string;
  account_to: string;
  account_from_id: string | null;
  account_to_id: string | null;
  category: string;
  category_id: string | null;
  counterparty: string;
  counterparty_id: string | null;
  projects: { id: string; name: string; amount: Money }[];
  split_state: string;
  tags: string[];
  comment: string;
  source: string;
  import_batch_id: string | null;
};

export type OperationPage = {
  total: number;
  limit: number;
  offset: number;
  sums: { income: Money; expense: Money };
  items: Operation[];
};

export type CashFlowRow = {
  month: string;
  start_balance: Money;
  income: Money;
  expense: Money;
  net: Money;
  end_balance: Money;
  income_plan: Money;
  expense_plan: Money;
  end_balance_with_plan: Money;
};

export type BreakdownItem = {
  name: string;
  /** Только факт. Ожидания живут отдельно — см. `planned` и `months_plan`. */
  total: Money;
  planned: Money;
  months: Record<string, Money>;
  months_plan: Record<string, Money>;
};

export type Check = { name: string; ok: boolean; left: string; right: string; hint?: string };

export type CashFlow = {
  months: string[];
  opening_balance: Money;
  closing_balance: Money;
  rows: CashFlowRow[];
  breakdown: { income: BreakdownItem[]; expense: BreakdownItem[] };
  checks: Check[];
};

export type ProfitRow = {
  month: string;
  income: Money;
  expense: Money;
  profit: Money;
  income_fact: Money;
  expense_fact: Money;
  margin: string;
};

export type Profit = {
  months: string[];
  rows: ProfitRow[];
  breakdown: { income: BreakdownItem[]; expense: BreakdownItem[] };
};

export type DebtItem = {
  id: string;
  due: string;
  accrued: string;
  amount: Money;
  counterparty: string;
  category: string;
  comment: string;
  overdue_days: number;
};

export type DebtSide = {
  total: Money;
  overdue: Money;
  by_counterparty: { name: string; amount: Money }[];
  items: DebtItem[];
};

export type Debts = { as_of: string; receivable: DebtSide; payable: DebtSide };

export type ProjectsReport = {
  items: { name: string; income: Money; expense: Money; profit: Money; margin: string }[];
  not_split: { income: Money; expense: Money; note: string };
};

export type CalendarDay = {
  date: string;
  income: Money;
  expense: Money;
  income_plan: Money;
  expense_plan: Money;
  balance: Money;
  negative: boolean;
};

export type CalendarMonth = {
  month: string;
  opening_balance: Money;
  days: CalendarDay[];
  cash_gaps: string[];
};

export type PlanCell = {
  month: string;
  fact: Money;
  plan: Money;
  deviation: Money;
  /** Пусто, когда плана нет: «∞%» на месте процента читается как сбой расчёта. */
  done_pct: string | null;
};

export type PlanItem = {
  side: "income" | "expense";
  key: string;
  name: string;
  cells: PlanCell[];
  fact_total: Money;
  plan_total: Money;
};

export type PlanActual = { months: string[]; method: string; items: PlanItem[] };

export type GridColumn = {
  key: string;
  title: string;
  kind: string;
  width: number;
  editable: boolean;
  source: string;
};

export type GridRow = {
  id: string;
  version: number;
  cells: Record<string, string>;
  kind: string;
  status: string;
  split_count: number;
};

export type GridPayload = {
  columns: GridColumn[];
  rows: GridRow[];
  options: Record<string, string[]>;
  total: number;
  /** Номер изменения журнала, с которого лист начинает опрос. */
  seq?: number;
};

export type RuleCondition = { field: string; op: string; value: string };

export type Rule = {
  id: string;
  name: string;
  active: boolean;
  match: string;
  conditions: RuleCondition[];
  actions: Record<string, string>;
  /** Сколько операций правило разметило. Ноль у включённого — условие не совпадает. */
  applied_count: number;
  position: number;
};

/** Группа авторазметки: статья, сколько операций в неё ляжет и на какую сумму. */
export type AutotagGroup = {
  category: string;
  side: "income" | "expense";
  /** Правдива, но почти ничего не говорит: «Покупки без уточнения». */
  broad: boolean;
  /** Чем доказано: тип операции банка, продавец, назначение платежа. */
  reason: string;
  count: number;
  amount: Money;
  examples: string[];
  /** Статья уже есть в справочнике; иначе заведётся. */
  exists: boolean;
};

export type AutotagPreview = { uncategorized: number; covered: number; groups: AutotagGroup[] };

export type RuleSuggestion = {
  keyword: string;
  kind: string;
  count: number;
  amount: Money;
  examples: string[];
};

export type ImportProblem = { field: string; text: string };

export type ImportRow = {
  line: number;
  state: "imported" | "skipped" | "failed" | "duplicate";
  problems: ImportProblem[];
  values: Record<string, unknown>;
  raw: Record<string, unknown>;
  operation_id?: string | null;
};

export type ImportQuestion = {
  kind: string;
  title: string;
  text: string;
  samples: string[];
  options: { value: string; label: string; example: string }[];
  /** Для вопроса о счёте: какой счёт завести, если нужного ещё нет. */
  create?: { name: string; number: string; currency: string };
};

/** Свой счёт из переводов выписки, которого нет в справочнике. */
export type SuggestedAccount = { name: string; number: string; currency: string; rows: number };

/** Ответ на вопросы разбора — копится, пока вопросов не останется. */
export type ImportAnswer = { date_order?: string; default_account?: string };

/** Книга Google, открытая сервисному аккаунту программы. */
export type SheetBook = { id: string; name: string; modified?: string };
export type SheetTab = { title: string; sheet_id: number; rows: number; cols: number; hidden?: boolean };

/**
 * Сверка выписки с банком: что банк напечатал и что получилось из строк.
 * Есть у выписок любого формата, где банк печатает реквизиты и остатки —
 * PDF, Excel, выгрузка 1С.
 */
export type BankCheck = {
  period_start: string | null;
  period_end: string | null;
  opening_balance: Money | null;
  closing_balance: Money | null;
  account_number: string;
  card_number: string;
  account: string | null;
  /** Как выбран счёт: «number» — узнан по номеру, «human» — выбран человеком. */
  account_by?: string;
  owner?: string;
  bank_name?: string;
  file_net: Money;
  expected_closing: Money | null;
  gap: Money | null;
  account_id: string | null;
  starting_balance: Money | null;
  ledger_opening: Money | null;
  earlier_operations: number;
  can_set_start: boolean;
};

export type ImportPreview = {
  batch_id: string;
  file_name: string;
  header_line: number;
  counts: { total: number; ready: number; failed: number; skipped: number; duplicate?: number };
  bank?: BankCheck | null;
  question: ImportQuestion | null;
  /** Что разметили правила: «название правила» → сколько строк. */
  rules_applied?: Record<string, number>;
  date_order: string;
  date_evidence: string;
  mapping: { columns: Record<string, { index: number; header: string; how: string }>; width: number };
  unused_columns: string[];
  accounts_missing: string[];
  accounts_suggested?: SuggestedAccount[];
  rows: ImportRow[];
};

export type ImportBatch = {
  id: string;
  file_name: string;
  status: string;
  created_at: string | null;
  applied_at: string | null;
  rows_total: number;
  rows_imported: number;
  rows_failed: number;
  rows_skipped: number;
  rows_duplicate: number;
  decisions: Record<string, unknown>;
};

export class FinanceApiError extends Error {
  status: number;
  /** Тело ответа. Реестр договоров кладёт туда смысл отказа: 422
   *  `mode_required` со списком полей, 409 `conflict` со свежим договором. */
  body: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/**
 * Сигналы раме раздела: сеанс пропал (401) и право отобрано (403).
 *
 * Без них каждый экран разбирался сам: заблокированный сотрудник оставался в
 * кабинете со своим именем и красным «Войдите в «Финансы»» во вкладке, а
 * реестр после отзыва права минуту показывал все договоры с «Нет связи».
 * Рама на 401 уводит ко входу, на 403 — перечитывает права.
 */
export const AUTH_LOST_EVENT = "finance:auth-lost";
export const FORBIDDEN_EVENT = "finance:forbidden";
/** Двери входа отвечают 401 на неверный пароль — это не потеря сеанса. */
const LOGIN_PATHS = /^\/auth\/(login|register|phone\/)/;

function signal(status: number, path: string): void {
  if (typeof window === "undefined") return;
  if (status === 401 && !LOGIN_PATHS.test(path)) window.dispatchEvent(new Event(AUTH_LOST_EVENT));
  if (status === 403) window.dispatchEvent(new Event(FORBIDDEN_EVENT));
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    signal(response.status, path);
    let message = `Сервер ответил ${response.status}`;
    let payload: unknown;
    try {
      const body = await response.json();
      payload = body;
      // `detail` у FastAPI бывает и строкой, и списком ошибок валидации.
      if (typeof body?.detail === "string") message = body.detail;
      else if (Array.isArray(body?.detail)) {
        message = body.detail.map((item: { msg?: string }) => item?.msg ?? "").filter(Boolean).join("; ") || message;
      }
    } catch {
      /* тело не JSON — оставляем код состояния */
    }
    throw new FinanceApiError(message, response.status, payload);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
};

/** Счёт-фактура: обязательство до денег. */
export type Invoice = {
  id: string;
  kind: "out" | "in";
  number: string;
  status: string;
  issued_at: string;
  due_at: string;
  counterparty: string;
  project: string;
  amount_net: string;
  vat_rate: string;
  vat_amount: string;
  amount_gross: string;
  comment: string;
  paid: boolean;
  overdue_days: number;
  operation_id: string | null;
};

export type InvoiceSide = { total: string; open: string; overdue: string };

export type Recurrence = {
  id: string;
  title: string;
  active: boolean;
  kind: string;
  period: string;
  period_title: string;
  day: number;
  amount: string;
  next_at: string;
  until: string | null;
  category: string;
  counterparty: string;
  project: string;
  comment: string;
  waiting: number;
};

export type HistoryEntry = {
  id: string;
  at: string | null;
  actor: string;
  kind: string;
  entity: string;
  entity_id: string | null;
  title: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  undone_at: string | null;
  can_undo: boolean;
};

/** Подключение банка или другого источника операций. */
export type Integration = {
  id: string;
  slug: string;
  title: string;
  kind: "api" | "statement" | "sheets";
  state: string;
  logo: string;
  account: string;
  account_id: string | null;
  settings: Record<string, unknown>;
  received: number;
  last_seen_at: string | null;
  has_token: boolean;
  token?: string;
};

export type BankOption = {
  slug: string;
  title: string;
  logo: string;
  ways: string[];
  parser: string;
};

export type BalanceData = {
  as_of: string;
  assets: { total: string; rows: Array<{ name: string; amount: string; details?: Array<{ name: string; amount: string }> }> };
  liabilities: { total: string; rows: Array<{ name: string; amount: string }> };
  equity: string;
  not_counted: string[];
};

export type IndicatorsData = {
  period: { from: string; to: string };
  revenue: string;
  cogs: string;
  gross_profit: string;
  operating_costs: string;
  ebitda: string;
  depreciation: string;
  operating_profit: string;
  financial_costs: string;
  tax: string;
  net_profit: string;
  gross_margin: string | null;
  ebitda_margin: string | null;
  net_margin: string | null;
  not_counted: string[];
};

export type StatementData = {
  account: { id: string; name: string; kind: string };
  opening_balance: string;
  closing_balance: string;
  income: string;
  expense: string;
  rows: Array<{
    id: string;
    paid_at: string;
    kind: string;
    direction: "in" | "out";
    amount: string;
    balance: string;
    category: string;
    counterparty: string;
    comment: string;
  }>;
};

export const financeApi = {
  // ── Счета-фактуры ──
  invoices: (kind?: "out" | "in") =>
    request<{ items: Invoice[]; summary: { receivable: InvoiceSide; payable: InvoiceSide } }>(
      `/invoices${kind ? `?kind=${kind}` : ""}`,
    ),
  createInvoice: (body: unknown) =>
    request<{ id: string; number: string }>("/invoices", { method: "POST", body: JSON.stringify(body) }),
  voidInvoice: (id: string) => request<{ ok: boolean }>(`/invoices/${id}/void`, { method: "POST" }),

  // ── Повторяющиеся операции ──
  recurrences: () => request<{ items: Recurrence[]; horizon_days: number }>("/recurrences"),
  createRecurrence: (body: unknown) =>
    request<{ id: string; created: number }>("/recurrences", { method: "POST", body: JSON.stringify(body) }),
  materializeRecurrences: () =>
    request<{ created: number }>("/recurrences/materialize", { method: "POST" }),
  toggleRecurrence: (id: string, active: boolean) =>
    request<{ id: string; active: boolean }>(`/recurrences/${id}?active=${active}`, { method: "PATCH" }),
  deleteRecurrence: (id: string) =>
    request<{ removed: number }>(`/recurrences/${id}`, { method: "DELETE" }),

  setCategoryNature: (id: string, nature: string) =>
    request<{ id: string; nature: string }>(`/dictionaries/categories/${id}/nature`, {
      method: "PATCH",
      body: JSON.stringify({ nature }),
    }),

  // ── История ──
  history: () => request<{ items: HistoryEntry[] }>("/history"),
  undo: (id: string) => request<{ ok: boolean }>(`/history/${id}/undo`, { method: "POST" }),

  // ── Интеграции ──
  integrations: () => request<{ items: Integration[]; catalog: BankOption[] }>("/integrations"),
  createIntegration: (body: unknown) =>
    request<Integration & { token?: string; inbox_url?: string }>("/integrations", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  rotateIntegrationToken: (id: string) =>
    request<{ token: string }>(`/integrations/${id}/token`, { method: "POST" }),
  setIntegrationState: (id: string, state: "active" | "off") =>
    request<Integration>(`/integrations/${id}?state=${state}`, { method: "PATCH" }),
  deleteIntegration: (id: string) => request<{ ok: boolean }>(`/integrations/${id}`, { method: "DELETE" }),

  // ── Баланс, показатели, выписка ──
  balance: (asOf?: string) => request<BalanceData>(`/reports/balance${asOf ? `?as_of=${asOf}` : ""}`),
  indicators: (params: { date_from?: string; date_to?: string } = {}) =>
    request<IndicatorsData>(`/reports/indicators${qs(params)}`),
  accountStatement: (params: { account_id: string; date_from?: string; date_to?: string }) =>
    request<StatementData>(`/reports/statement${qs(params)}`),

  // ── Учётки ───────────────────────────────────────────────────────────────
  me: () => request<Me>("/auth/me"),
  login: (body: { email: string; password: string }) =>
    request<Me>("/auth/login", { method: "POST", body: JSON.stringify(body) }),
  register: (body: { email: string; password: string; company: string; full_name?: string }) =>
    request<Me>("/auth/register", { method: "POST", body: JSON.stringify(body) }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  // Вход сотрудника по номеру: номер → «пароль» или «задайте пароль».
  phoneStart: (phone: string) =>
    request<{ step: "password" | "set_password" }>("/auth/phone/start", {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),
  phoneLogin: (body: { phone: string; password: string }) =>
    request<Me>("/auth/phone/login", { method: "POST", body: JSON.stringify(body) }),
  /** Задать пароль и сразу войти — ответ как у `me`. */
  phoneSetPassword: (body: { phone: string; password: string }) =>
    request<Me>("/auth/phone/set-password", { method: "POST", body: JSON.stringify(body) }),
  phoneForgot: (phone: string) =>
    request<{ ok: boolean }>("/auth/phone/forgot", { method: "POST", body: JSON.stringify({ phone }) }),
  switchCompany: (companyId: string) =>
    request<Me>("/auth/switch", { method: "POST", body: JSON.stringify({ company_id: companyId }) }),
  addCompany: (title: string) =>
    request<Company>("/auth/companies", { method: "POST", body: JSON.stringify({ title }) }),
  renameCompany: (title: string) =>
    request<{ id: string; title: string }>("/auth/company", {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  members: () => request<{ items: MemberRow[] }>("/auth/members"),
  invite: (body: { email: string; password: string; role: string; full_name?: string }) =>
    request<{ id: string; email: string; role: string }>("/auth/members", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  changeRole: (userId: string, role: string) =>
    request<{ ok: boolean }>(`/auth/members/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  removeMember: (userId: string) =>
    request<{ ok: boolean }>(`/auth/members/${userId}`, { method: "DELETE" }),
  changePassword: (body: { old_password: string; new_password: string }) =>
    request<{ ok: boolean }>("/auth/password", { method: "POST", body: JSON.stringify(body) }),
  sessions: () => request<{ items: SessionRow[] }>("/auth/sessions"),
  revokeSession: (id: string) =>
    request<{ ok: boolean }>(`/auth/sessions/${id}`, { method: "DELETE" }),

  overview: () => request<Overview>("/overview"),
  dictionaries: () => request<Dictionaries>("/dictionaries"),

  operations: (params: Record<string, string | number | undefined>) =>
    request<OperationPage>(`/operations${qs(params)}`),
  createOperation: (body: unknown) =>
    request<Operation>("/operations", { method: "POST", body: JSON.stringify(body) }),
  patchOperation: (id: string, body: unknown) =>
    request<Operation>(`/operations/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteOperation: (id: string) => request<{ ok: boolean }>(`/operations/${id}`, { method: "DELETE" }),

  grid: (params: Record<string, string | number | undefined>) =>
    request<GridPayload>(`/grid${qs(params)}`),
  /** Живой режим листа «Таблица»: строки, изменённые после номера, и снятые. */
  gridChanges: (since: number) =>
    request<{ rows: GridRow[]; removed: string[]; seq: number }>(`/grid/changes${qs({ since })}`),
  autotagPreview: () => request<AutotagPreview>("/autotag"),
  autotagApply: (groups: { side: string; category: string }[]) =>
    request<{ updated: number; by_category: Record<string, number> }>("/autotag", {
      method: "POST",
      body: JSON.stringify({ groups }),
    }),
  setStartingBalance: (accountId: string, value: string) =>
    request<{ id: string; name: string; starting_balance: Money }>(`/accounts/${accountId}`, {
      method: "PATCH",
      body: JSON.stringify({ starting_balance: value }),
    }),
  /**
   * Адрес выгрузки журнала в Excel с теми же фильтрами, что на экране.
   *
   * Ссылка, а не запрос из кода: файл скачивает браузер, со своим окном
   * сохранения и своим именем файла из заголовка ответа.
   */
  exportJournalUrl: (params: Record<string, string | number | undefined>) =>
    `${API}/export/journal.xlsx${qs(params)}`,
  patchCell: (body: { operation_id: string; column: string; value: unknown; version?: number }) =>
    request<Operation & { row: GridRow }>("/grid/cell", { method: "PATCH", body: JSON.stringify(body) }),
  addGridRow: (cells: Record<string, unknown>) =>
    request<Operation & { row: GridRow }>("/grid/row", { method: "POST", body: JSON.stringify({ cells }) }),

  cashFlow: (params: Record<string, string | undefined>) =>
    request<CashFlow>(`/reports/cash-flow${qs(params)}`),
  profit: (params: Record<string, string | undefined>) =>
    request<Profit>(`/reports/profit${qs(params)}`),
  debts: (params: Record<string, string | undefined> = {}) =>
    request<Debts>(`/reports/debts${qs(params)}`),
  projects: (params: Record<string, string | undefined> = {}) =>
    request<ProjectsReport>(`/reports/projects${qs(params)}`),
  calendar: (year: number, month: number) =>
    request<CalendarMonth>(`/reports/calendar${qs({ year, month })}`),
  planActual: (params: Record<string, string | undefined> = {}) =>
    request<PlanActual>(`/reports/plan-actual${qs(params)}`),
  upsertPlan: (body: {
    month: string;
    side: string;
    method: string;
    amount: string;
    category_id?: string | null;
    project_id?: string | null;
  }) => request<{ id: string; month: string; amount: Money }>("/plans", {
    method: "POST",
    body: JSON.stringify(body),
  }),

  createEntry: (kind: "categories" | "counterparties" | "projects" | "tags", body: unknown) =>
    request<DictEntry>(`/dictionaries/${kind}`, { method: "POST", body: JSON.stringify(body) }),
  createAccount: (body: unknown) =>
    request<DictEntry>("/accounts", { method: "POST", body: JSON.stringify(body) }),
  setAccountNumber: (accountId: string, number: string) =>
    request<{ id: string; name: string; number: string }>(`/accounts/${accountId}/number`, {
      method: "PUT",
      body: JSON.stringify({ number }),
    }),
  archiveEntry: (kind: string, id: string) =>
    request<{ ok: boolean }>(`/dictionaries/${kind}/${id}`, { method: "DELETE" }),

  rules: () => request<{ items: Rule[] }>("/rules"),
  createRule: (body: {
    name: string;
    conditions: RuleCondition[];
    actions: Record<string, string>;
    match?: string;
  }) => request<{ id: string; name: string }>("/rules", { method: "POST", body: JSON.stringify(body) }),
  toggleRule: (id: string, active: boolean) =>
    request<{ id: string; active: boolean }>(`/rules/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    }),
  deleteRule: (id: string) => request<{ ok: boolean }>(`/rules/${id}`, { method: "DELETE" }),
  applyRules: (body: { only_uncategorized?: boolean } = {}) =>
    request<{ rules: number; updated: number; by_rule: Record<string, number> }>("/rules/apply", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ruleSuggestions: () => request<{ items: RuleSuggestion[] }>("/rules/suggest"),

  importPreview: (file: File, params: { date_order?: string; default_account?: string } = {}) => {
    const form = new FormData();
    form.append("file", file);
    return request<ImportPreview>(`/import/preview${qs(params)}`, { method: "POST", body: form });
  },
  sheetBooks: () => request<{ configured: boolean; items: SheetBook[] }>("/sheets/books"),
  sheetBook: (id: string) =>
    request<{ id: string; title: string; url: string; tabs: SheetTab[] }>(`/sheets/books/${id}`),
  /** Вкладка книги разбирается тем же разбором, что и загруженный файл. */
  sheetPreview: (body: { book_id: string; tab: string; date_order?: string; default_account?: string }) =>
    request<ImportPreview>("/sheets/preview", { method: "POST", body: JSON.stringify(body) }),
  importBatches: () => request<{ items: ImportBatch[] }>("/import/batches"),
  importBatch: (id: string) =>
    request<{
      id: string;
      file_name: string;
      status: string;
      counts: Record<string, number>;
      rows: ImportRow[];
      decisions: Record<string, unknown>;
      mapping: ImportPreview["mapping"];
    }>(
      `/import/batches/${id}`,
    ),
  applyBatch: (id: string, body: { lines?: number[]; create_dictionaries?: boolean } = {}) =>
    request<{
      imported: number;
      failed: number;
      skipped: number;
      duplicate: number;
      total: number;
      /** Номер счёта из выписки, записанный счёту при заводке. */
      remembered?: { account: string; number: string } | null;
    }>(
      `/import/batches/${id}/apply`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  fixImportRow: (id: string, line: number, patch: Record<string, unknown>) =>
    request<{ line: number; state: string; problems: ImportProblem[]; values: Record<string, unknown> }>(
      `/import/batches/${id}/rows/${line}`,
      { method: "PATCH", body: JSON.stringify({ patch }) },
    ),
};

/**
 * Деньги на экране: разряды пробелами, две цифры после запятой только когда
 * они есть.
 *
 * Копейки прячутся не для красоты. В управленческом отчёте суммы семизначные,
 * и «1 680 000,00» против «1 680 000» — это шум в каждой строке таблицы,
 * который мешает сравнивать порядки величин глазом. Там, где копейки есть, они
 * показываются: это не округление, а отсутствие ложной точности.
 */
export function formatMoney(
  value: Money | number,
  options: { sign?: boolean; whole?: boolean } = {},
): string {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return String(value);
  /**
   * Копейки показываем всегда.
   *
   * Раньше целая сумма печаталась без них, и в одной колонке отчёта стояли
   * «2 084 872» и «915 207,42». Колонку денег читают по разрядам сверху вниз;
   * когда у части чисел запятой нет, разряды перестают стоять друг под
   * другом, и взгляд спотыкается там, где должен скользить. Это не украшение:
   * ровно так глазами ловят лишний ноль.
   *
   * `whole` оставлен для мест, где копейки заведомо не нужны и место дорого.
   */
  const fraction = options.whole ? 0 : 2;
  const text = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  }).format(Math.abs(number));
  const prefix = options.sign ? (number < 0 ? "−" : "+") : number < 0 ? "−" : "";
  return `${prefix}${text}`;
}

/**
 * Сумма для узкой полосы: «3,05 млн» вместо «3 050 000».
 *
 * Полоса шириной в палец, и полное число в ней либо обрезается, либо
 * набирается таким кеглем, что не читается. Точность здесь не нужна: это
 * взгляд «сколько всего», а точная цифра — в раскрытой панели.
 */
export function compactMoney(value: Money | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "—";
  const sign = number < 0 ? "−" : "";
  const abs = Math.abs(number);
  const round = (n: number) => n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0).replace(".", ",").replace(/,0+$/, "");
  if (abs >= 1_000_000_000) return `${sign}${round(abs / 1_000_000_000)} млрд`;
  if (abs >= 1_000_000) return `${sign}${round(abs / 1_000_000)} млн`;
  if (abs >= 10_000) return `${sign}${round(abs / 1_000)} тыс`;
  return `${sign}${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(abs)}`;
}

/** «2026-09» → «сентябрь 2026»; для шапок таблиц — «сен 26». */
export function formatMonth(month: string, short = false): string {
  const [year, index] = month.split("-").map(Number);
  const full = [
    "январь", "февраль", "март", "апрель", "май", "июнь",
    "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
  ];
  const brief = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  if (!index || index < 1 || index > 12) return month;
  return short ? `${brief[index - 1]} ${String(year).slice(2)}` : `${full[index - 1]} ${year}`;
}

/** «2026-09-17» → «17 сен 2026». */
export function formatDate(iso: string): string {
  if (!iso) return "";
  const [year, month, day] = iso.split("-").map(Number);
  const brief = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  if (!month || month < 1 || month > 12) return iso;
  return `${day} ${brief[month - 1]} ${year}`;
}

/** Первое и последнее число месяца, сдвинутого на `shift` от текущего. */
export function monthEdges(shift = 0): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + shift, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + shift + 1, 0);
  const iso = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return { from: iso(start), to: iso(end) };
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// ── Реестр договоров ─────────────────────────────────────────────────────────
//
// Контракт — раздел «Контракт API для экранов» плана. Экраны не зовут fetch и
// не держат копий договоров: всё через `contractsApi` и хранилище
// `finance/contracts/store.ts`.

export type FieldType =
  | "text" | "number" | "money" | "date" | "bool" | "list" | "multi_list"
  | "url" | "person" | "party" | "department" | "choice";

export type RegistryField = {
  key: string;
  type: FieldType;
  title: string;
  system: boolean;
  /** Сервер уже урезал поля по правам: скрытых здесь нет, у видимых — можно ли править. */
  editable: boolean;
  required: boolean;
  hidden: boolean;
  position: number;
  choices?: { value: string; label: string }[];
  /**
   * Как поле заполняют руками — только у полей со списком: `list` — только из
   * списка, `hint` — из списка или своё, `own` — сторона только из наших
   * юрлиц. Нет ключа — поле пишется как есть.
   */
  fill?: FieldFill;
  /** Какие способы можно выбрать у этого поля в настройке. */
  fills?: FieldFill[];
};

export type FieldFill = "list" | "hint" | "own";

/** Оплаты договора по журналу: суммы строками, как все деньги API. */
export type PaymentSummary = {
  paid: string | null;
  /** Только у договора на всю сумму: сумма минус оплачено. */
  remaining: string | null;
  count: number;
  last_at: string | null;
  /** Спорные платежи: подходят и к этому договору, и к другому. */
  open: number;
};

export type PaymentItem = {
  operation_id: string;
  paid_at: string;
  amount: string;
  kind: "income" | "expense";
  counterparty: string;
  account: string;
  comment: string;
  /** `auto` — разнесла система, `manual` — человек, `open` — спорный. */
  how: "auto" | "manual" | "open";
};

export type ContractPayments = { summary: PaymentSummary | null; items: PaymentItem[] };

export type ListValue = {
  id: string;
  value: string;
  meaning: {
    phase?: string;
    handover?: string;
    billing?: string;
    economic_role?: string;
    system?: string;
    roles?: { executor?: string; customer?: string };
    kind?: string;
    /** «Это разные»: значения, которые не двойники этого. */
    distinct?: string[];
  };
  position: number;
  /** Более раннее похожее значение того же списка — возможный двойник. */
  similar?: string;
};

export type FilterCondition = { field: string; op: string; value: unknown };
export type ViewFilter = { any: { all: FilterCondition[] }[] };

export type ViewBlock = {
  title: string;
  filter: ViewFilter;
  roles: { executor?: string; customer?: string; order?: ("executor" | "customer")[] };
  columns: { key: string; label: string; width?: number | null }[];
  defaults: Record<string, string>;
};

export type RegistryView = {
  id: string;
  key: string;
  title: string;
  main: boolean;
  /** Книга листа: `""` — реестр (карточки и «Таблица»), `oneoff` — «Разовые». */
  book?: string;
  position: number;
  blocks: ViewBlock[];
  sort: unknown[];
};

export type OwnEntity = {
  id: string;
  code: string;
  name: string;
  full_name: string;
  bin: string;
  vat_payer: boolean;
  accounts: { id: string; name: string; number: string }[];
};

export type RegistrySchema = {
  schema_rev: number;
  fields: RegistryField[];
  /** Действующие значения — их предлагают выборы. */
  lists: Record<string, ListValue[]>;
  /** Значения в архиве — только чтобы подписать договоры, где они стоят. */
  archived_values?: Record<string, ListValue[]>;
  departments: { id: string; code: string; title: string; position: number }[];
  views: RegistryView[];
  /** Откуда «Оплачено (сводка)»; `null` — сводка не подключена. */
  summary?: SummarySource | null;
  own_entities: OwnEntity[];
  mode_fields: string[];
  virtual_fields: Record<string, string>;
  billing_kinds: string[];
  economic_roles: string[];
  status_phases: string[];
  today: string;
  access: { edit: boolean; setup: boolean };
};

/** Книга-сводка компании: откуда «Оплачено (сводка)» (`contracts/summary.py`). */
export type SummarySource = {
  spreadsheet_id: string;
  worksheet: string;
  title: string;
  url: string;
  read_at: string | null;
  rows: number;
  rev: string;
  drift: string;
  error: string;
};

/**
 * Что сводка знает о договоре. `found` — строки нашлись; `missing` — номера
 * в сводке нет; `other_client` — номер есть, клиент другой; `ambiguous` —
 * подходят разные клиенты, и выбрать нельзя.
 */
export type SummaryEntry = {
  state: "found" | "missing" | "other_client" | "ambiguous";
  paid?: string;
  remaining?: string | null;
  months?: string[];
  rows?: number;
  customer?: string;
  candidates?: string[];
};

export type ContractIssue = { code: string; field: string; text: string; ref: string; acknowledged: boolean };

export type Contract = {
  id: string;
  seq: number;
  /** Значения по ключу поля. Пустые сервер не отдаёт: нет ключа — пусто. */
  values: Record<string, unknown>;
  provenance: Record<string, string>;
  issues: ContractIssue[];
  views: { view: string; block: number }[];
  roles?: { executor?: string; customer?: string };
  file_snapshot: { paid?: string; remaining?: string; as_of?: string; file?: string };
  position: number;
  source: string;
  created_by: string | null;
  created_at: string | null;
  updated_by: { id: string; short_name: string } | null;
  updated_at: string | null;
  deleted: boolean;
};

export type Party = { id: string; name: string; own: boolean; code: string; bin: string };
export type PersonRef = { id: string; name: string; department_id: string | null };

export type ContractsAll = {
  contracts: Contract[];
  parties: Record<string, Party>;
  people: Record<string, PersonRef>;
  seq: number;
  schema_rev: number;
  /** По какой сводке посчитаны листы вроде «Остатки» (`""` — без сводки). */
  summary_rev?: string;
};

export type ChangesBatch = ContractsAll & { removed: string[] };

export type ChangeMode =
  | { kind: "fix" }
  | { kind: "from_date"; effective_from: string; number?: string; signed_at?: string; summary?: string };

export type OneContract = {
  contract: Contract;
  parties: Record<string, Party>;
  people: Record<string, PersonRef>;
};

export type Amendment = {
  id: string;
  number: string;
  signed_at: string | null;
  summary: string;
  effect: string;
  effective_from: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  before_label: string;
  after_label: string;
  origin: "change" | "parsed";
  piece: string;
  ahead: boolean;
  applied_at: string | null;
};

export type ParsedPiece = {
  index: number;
  text: string;
  start: number;
  end: number;
  number: string;
  signed_at: string | null;
  summary: string;
  summary_start: number | null;
  summary_end: number | null;
  effect: string;
  effective_from: string | null;
  value_hint: string;
  confirmed: string[] | null;
};

export type HistoryItem = {
  id: string;
  at: string | null;
  actor: string;
  kind: string;
  title: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

export type ContractImportSection = {
  key: string;
  title: string;
  blocking: boolean;
  done: boolean;
  summary: string;
  items: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  [extra: string]: unknown;
};

export type ContractImportBatch = {
  id: string;
  status: "preview" | "applied" | "cancelled";
  file_name: string;
  decisions: Record<string, unknown>;
  report: {
    file: string;
    main_sheet: string;
    sheets: string[];
    sections: ContractImportSection[];
    blocking: string[];
    totals: { create: number; update: number; main_rows: number };
    result?: { created: number; failed: { ref: string; error: string }[] };
  };
};

const C = "/contracts";

export const contractsApi = {
  schema: () => request<RegistrySchema>(`${C}/schema`),
  all: () => request<ContractsAll>(C),
  changes: (since: number) => request<ChangesBatch>(`${C}/changes${qs({ since })}`),
  one: (id: string) => request<OneContract>(`${C}/${id}`),
  create: (values: Record<string, unknown>, ctx?: { view?: string; block?: number; source?: string }) =>
    request<OneContract>(C, {
      method: "POST",
      body: JSON.stringify({ values, view: ctx?.view, block: ctx?.block, source: ctx?.source ?? "app" }),
    }),
  patch: (id: string, values: Record<string, unknown>, knownSeq: number | null, mode?: ChangeMode | null) =>
    request<OneContract>(`${C}/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ values, known_seq: knownSeq, mode: mode ?? null }),
    }),
  remove: (id: string) => request<{ ok: boolean }>(`${C}/${id}`, { method: "DELETE" }),
  acknowledge: (id: string, code: string, on: boolean) =>
    request<OneContract>(`${C}/${id}/acknowledge`, { method: "POST", body: JSON.stringify({ code, on }) }),
  history: (id: string, before?: string) =>
    request<{ items: HistoryItem[] }>(`${C}/${id}/history${qs({ before })}`),
  amendments: {
    list: (id: string) => request<{ items: Amendment[] }>(`${C}/${id}/amendments`),
    parse: (id: string) => request<{ pieces: ParsedPiece[] }>(`${C}/${id}/amendments/parse`, { method: "POST" }),
    confirm: (id: string, piece: Record<string, unknown>) =>
      request<OneContract>(`${C}/${id}/amendments/confirm`, { method: "POST", body: JSON.stringify({ piece }) }),
    remove: (id: string, amendmentId: string) =>
      request<{ ok: boolean }>(`${C}/${id}/amendments/${amendmentId}`, { method: "DELETE" }),
  },
  parties: {
    search: (q: string, limit = 20) =>
      request<{ parties: Party[] }>(`${C}/parties${qs({ q, limit })}`),
    similar: (name: string, bin = "") =>
      request<{ parties: Party[] }>(`${C}/parties/similar${qs({ name, bin })}`),
  },
  people: () => request<{ people: PersonRef[] }>(`${C}/people`),
  payments: {
    /** «Оплачено/Остаток по выписке» видимых договоров; 403 — журнал не открыт. */
    all: () => request<{ contracts: Record<string, PaymentSummary> }>(`${C}/payments`),
    of: (id: string) => request<ContractPayments>(`${C}/${id}/payments`),
    decide: (id: string, operationId: string, action: "link" | "unlink" | "auto") =>
      request<ContractPayments>(`${C}/${id}/payments`, {
        method: "POST",
        body: JSON.stringify({ operation_id: operationId, action }),
      }),
  },
  /** «Оплачено/Остаток (сводка)» видимых договоров; `force` — перечитать книгу. */
  summary: (force = false) =>
    request<{ source: SummarySource | null; contracts: Record<string, SummaryEntry> }>(
      `${C}/summary${qs({ force: force ? "true" : undefined })}`,
    ),
  exportUrl: (views?: string[]) => `${API}${C}/export.xlsx${qs({ views: views?.join(",") })}`,
  imports: {
    upload: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<ContractImportBatch>(`${C}/imports`, { method: "POST", body: form });
    },
    get: (id: string) => request<ContractImportBatch>(`${C}/imports/${id}`),
    decide: (id: string, decisions: Record<string, unknown>) =>
      request<ContractImportBatch>(`${C}/imports/${id}/decide`, { method: "POST", body: JSON.stringify({ decisions }) }),
    apply: (id: string) =>
      request<{ result: { created: number; failed: { ref: string; error: string }[] } }>(
        `${C}/imports/${id}/apply`,
        { method: "POST" },
      ),
    cancel: (id: string) => request<{ ok: boolean }>(`${C}/imports/${id}/cancel`, { method: "POST" }),
  },
  setup: {
    addField: (title: string, type: string, after?: string | null) =>
      request<{ key: string }>(`${C}/setup/fields`, { method: "POST", body: JSON.stringify({ title, type, after }) }),
    updateField: (key: string, data: Record<string, unknown>) =>
      request<{ key: string }>(`${C}/setup/fields/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify(data) }),
    addValue: (field: string, value: string, meaning?: ListValue["meaning"]) =>
      request<{ id: string }>(`${C}/setup/lists/${encodeURIComponent(field)}`, {
        method: "POST",
        body: JSON.stringify({ value, meaning }),
      }),
    updateValue: (id: string, data: Record<string, unknown>) =>
      request<{ id: string }>(`${C}/setup/values/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    mergeValues: (keep: string, drop: string) =>
      request<{ ok: boolean }>(`${C}/setup/values/merge`, { method: "POST", body: JSON.stringify({ keep, drop }) }),
    addEntity: (data: Record<string, unknown>) =>
      request<{ id: string }>(`${C}/setup/entities`, { method: "POST", body: JSON.stringify(data) }),
    updateEntity: (id: string, data: Record<string, unknown>) =>
      request<{ id: string }>(`${C}/setup/entities/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    mergeParties: (keep: string, drop: string) =>
      request<{ ok: boolean }>(`${C}/setup/parties/merge`, { method: "POST", body: JSON.stringify({ keep, drop }) }),
    addDepartment: (data: Record<string, unknown>) =>
      request<{ id: string }>(`${C}/setup/departments`, { method: "POST", body: JSON.stringify(data) }),
    updateDepartment: (id: string, data: Record<string, unknown>) =>
      request<{ id: string }>(`${C}/setup/departments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    addView: (data: Record<string, unknown>) =>
      request<RegistryView>(`${C}/setup/views`, { method: "POST", body: JSON.stringify(data) }),
    updateView: (id: string, data: Record<string, unknown>) =>
      request<RegistryView>(`${C}/setup/views/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    connectSummary: (link: string, worksheet: string) =>
      request<{ title: string; worksheet: string; rows: number; drift: string }>(`${C}/setup/summary`, {
        method: "POST",
        body: JSON.stringify({ link, worksheet }),
      }),
    disconnectSummary: () => request<{ ok: boolean }>(`${C}/setup/summary`, { method: "DELETE" }),
    preview: (filter: ViewFilter) =>
      request<{ count: number; sample: string[] }>(`${C}/setup/views/preview`, {
        method: "POST",
        body: JSON.stringify({ filter }),
      }),
  },
};

// ── Люди, права, журнал действий (личный кабинет) ────────────────────────────

export type Department = {
  id: string;
  code: string;
  title: string;
  position: number;
  archived: boolean;
  employees: number;
};

/** `no_access` — человек в справочнике без входа (например, ответственный). */
export type AccountStatus = "no_access" | "blocked" | "pending" | "pending_expired" | "active";

export type EmployeeRequest = {
  id: string;
  kind: "password_reset_requested" | "login_locked";
  created_at: string | null;
};

export type EmployeeRow = {
  id: string;
  full_name: string;
  short_name: string;
  job_title: string;
  department_id: string | null;
  position: number;
  archived: boolean;
  phone: string;
  status: AccountStatus;
  account: {
    user_id: string;
    email: string;
    phone: string;
    role: MemberRole;
    status: AccountStatus;
    pending_until: string | null;
    last_seen_at: string | null;
    last_login_at: string | null;
    blocked_at: string | null;
  } | null;
  requests: EmployeeRequest[];
};

export type NotificationItem = {
  id: string;
  kind: "password_reset_requested" | "login_locked" | "password_set" | string;
  actionable: boolean;
  created_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  payload: { ip?: string; user_agent?: string; repeats?: number; [key: string]: unknown };
  subject: { user_id: string; employee_id: string | null; name: string; phone: string } | null;
};

export type AccessResource = {
  key: string;
  title: string;
  group: string;
  levels: AccessLevel[];
  note?: string;
};

export type AccessCatalog = {
  resources: AccessResource[];
  fields: { key: string; field: string; title: string; levels: AccessLevel[] }[];
  row_scopes: ("all" | "department" | "own")[];
};

export type ContractScope = { rows?: "all" | "department" | "own"; entities?: string[] };
export type Grant = { level: AccessLevel; scope?: ContractScope };

/** Права субъекта. У человека ещё права отдела и итог — для колонок «Отдел» и «Итог». */
export type SubjectAccess = {
  subject: {
    kind: "department" | "employee";
    id: string;
    title: string;
    code?: string;
    role?: MemberRole | null;
    /** Владелец и администратор: матрицы нет, «видит и правит всё». */
    admin?: boolean;
    department?: { id: string; code: string; title: string } | null;
  };
  grants: Record<string, Grant>;
  department_grants?: Record<string, Grant>;
  effective: Record<string, AccessLevel>;
  contracts_scope?: { rows: "all" | "department" | "own"; entities: string[] };
};

export type GrantChange = AccessLevel | { level: AccessLevel; scope?: ContractScope } | null;

export type AuditActor = { user_id: string; employee_id: string | null; name: string; short_name: string };

export type AuditItem = {
  id: string;
  at: string | null;
  category: "data" | "auth" | "admin" | "view" | "export" | "import" | string;
  kind: string;
  title: string;
  entity: string;
  entity_id: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  actor: AuditActor | null;
  actor_text: string;
  ip: string;
  user_agent: string;
  session_id: string | null;
  undone_at: string | null;
  can_undo: boolean;
};

export type AuditQuery = {
  q?: string;
  user_id?: string;
  employee_id?: string;
  department_id?: string;
  /** Через запятую: data,auth,admin,view,export,import. */
  category?: string;
  /** `contract.*` — все события договоров. */
  kind?: string;
  entity_id?: string;
  since?: string;
  until?: string;
  cursor?: string;
  limit?: number;
};

const P = "/people";

export const peopleApi = {
  list: () => request<{ departments: Department[]; employees: EmployeeRow[] }>(P),
  departments: {
    create: (data: { code: string; title?: string }) =>
      request<Department>(`${P}/departments`, { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: { code?: string; title?: string; archived?: boolean }) =>
      request<Department>(`${P}/departments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  },
  employees: {
    create: (data: {
      full_name: string;
      phone?: string;
      department_id?: string | null;
      job_title?: string;
      access?: boolean;
      role?: MemberRole;
    }) => request<EmployeeRow>(`${P}/employees`, { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      request<EmployeeRow>(`${P}/employees/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    archive: (id: string) => request<EmployeeRow>(`${P}/employees/${id}`, { method: "DELETE" }),
    /** Открыть вход человеку из справочника: учётка по номеру ждёт пароль 72 часа. */
    openAccount: (id: string, data: { phone?: string; role?: MemberRole }) =>
      request<EmployeeRow>(`${P}/employees/${id}/account`, { method: "POST", body: JSON.stringify(data) }),
    reset: (id: string) => request<EmployeeRow>(`${P}/employees/${id}/reset`, { method: "POST" }),
    block: (id: string) => request<EmployeeRow>(`${P}/employees/${id}/block`, { method: "POST" }),
    unblock: (id: string) => request<EmployeeRow>(`${P}/employees/${id}/unblock`, { method: "POST" }),
    endSessions: (id: string) =>
      request<EmployeeRow & { sessions_closed?: number }>(`${P}/employees/${id}/end-sessions`, { method: "POST" }),
    sessions: (id: string) => request<{ items: SessionRow[] }>(`${P}/employees/${id}/sessions`),
  },
  access: {
    catalog: () => request<AccessCatalog>("/access/catalog"),
    get: (kind: "department" | "employee", id: string) => request<SubjectAccess>(`/access/${kind}/${id}`),
    put: (kind: "department" | "employee", id: string, changes: Record<string, GrantChange>) =>
      request<SubjectAccess>(`/access/${kind}/${id}`, { method: "PUT", body: JSON.stringify({ changes }) }),
  },
  audit: {
    list: (query: AuditQuery = {}) =>
      request<{ items: AuditItem[]; next_cursor: string | null }>(`/audit${qs(query)}`),
    view: (section: string, contractId?: string) =>
      request<{ recorded: boolean }>("/audit/view", {
        method: "POST",
        body: JSON.stringify({ section, contract_id: contractId ?? null }),
      }),
    undo: (id: string) => request<{ ok: boolean }>(`/audit/${id}/undo`, { method: "POST" }),
  },
  notifications: {
    list: () => request<{ items: NotificationItem[]; pending: number }>("/notifications"),
    resolve: (id: string) =>
      request<{ ok: boolean; id: string; pending: number }>(`/notifications/${id}/resolve`, { method: "POST" }),
  },
  self: {
    endOtherSessions: () => request<{ closed: number }>("/auth/sessions/end-others", { method: "POST" }),
    changePassword: (body: { old_password: string; new_password: string }) =>
      request<{ ok: boolean; sessions_closed: number }>("/auth/password", { method: "POST", body: JSON.stringify(body) }),
    /** Свои ФИО и телефон — только владельцу и администратору. */
    profile: (data: { full_name?: string; phone?: string }) =>
      request<Me>("/auth/profile", { method: "PATCH", body: JSON.stringify(data) }),
  },
};

// ── Корзина ──────────────────────────────────────────────────────────────────

/** Удалённое: договор, операция, юрлицо, поле, значение, лист, отдел, сотрудник, запись справочника. */
export type TrashItem = {
  kind: string;
  kind_title: string;
  /** Где это жило: «Реестр», «Журнал», «Настройка реестра», «Кабинет», «Справочники». */
  where: string;
  id: string;
  title: string;
  deleted_at: string | null;
  /** Кто удалил — из журнала действий; пусто, если там нет записи о записи. */
  by: string;
};

export const trashApi = {
  list: () => request<{ items: TrashItem[] }>("/trash"),
  restore: (kind: string, id: string) =>
    request<{ kind: string; id: string; title: string; where: string }>(`/trash/${kind}/${id}/restore`, { method: "POST" }),
  purge: (kind: string, id: string) =>
    request<{ kind: string; id: string; title: string }>(`/trash/${kind}/${id}`, { method: "DELETE" }),
};

// ── Личный вид листов ────────────────────────────────────────────────────────

/** Вид листа — как его собирает `univer/look.ts`; сервер держит как есть. */
export const looksApi = {
  get: (key: string) => request<{ look: Record<string, unknown> }>(`/looks/${key}`),
  put: (key: string, look: unknown) =>
    request<{ ok: boolean }>(`/looks/${key}`, { method: "PUT", body: JSON.stringify({ look }) }),
  reset: (key: string) => request<{ ok: boolean }>(`/looks/${key}`, { method: "DELETE" }),
};
