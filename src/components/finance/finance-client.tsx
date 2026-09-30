"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";

import {
  BookIcon,
  BoltIcon,
  CalendarIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  ContractGridIcon,
  ContractIcon,
  FileTextIcon,
  FolderIcon,
  GaugeIcon,
  GridIcon,
  PersonIcon,
  PlugIcon,
  ReceiptIcon,
  RepeatIcon,
  ScaleIcon,
  ListIcon,
  OneoffIcon,
  RefreshIcon,
  TableIcon,
  TargetIcon,
  TrendIcon,
  UploadIcon,
  WalletIcon,
} from "@/components/icons";
import {
  type Dictionaries,
  type Overview,
  AUTH_LOST_EVENT,
  FORBIDDEN_EVENT,
  SCHEMA_EVENT,
  FinanceApiError,
  financeApi,
  peopleApi,
  compactMoney,
  formatMoney,
} from "@/components/finance/api";
import { MONEY_RESOURCES, can, canAny, isAdmin, nameOf } from "@/components/finance/access";
import { AuthGate, AuthLoading, PasswordChangeGate, useMe } from "@/components/finance/auth-gate";
import { Cabinet } from "@/components/finance/cabinet/cabinet";
import { plural, shortName } from "@/components/finance/format";
import { FadeIn } from "@/components/motion/fade-in";
import { SplitReveal } from "@/components/motion/split-reveal";
import { ThemeSwitch } from "@/components/stage/theme-switch";
import { RulesPanel } from "@/components/finance/rules-panel";
import { OperationDialog } from "@/components/finance/operation-dialog";
import { Journal } from "@/components/finance/journal";
import { ImportPanel } from "@/components/finance/import-panel";
import { SheetsPanel } from "@/components/finance/sheets-panel";
import { KortWordmark } from "@/components/brand/kort-wordmark";
import { InvoicesPanel } from "@/components/finance/invoices-panel";
import { RecurrencesPanel } from "@/components/finance/recurrences-panel";
import { IntegrationsPanel } from "@/components/finance/integrations-panel";
import { BalanceReport, IndicatorsReport, StatementReport } from "@/components/finance/ledger-reports";
import { CashFlowReport, DebtsReport, ProfitReport, ProjectsReport } from "@/components/finance/reports";
import { CalendarView } from "@/components/finance/calendar-view";
import { PlanActualReport } from "@/components/finance/plan-actual";
import { DictionariesPanel } from "@/components/finance/dictionaries-panel";
import { Registry, RegistryActions, useRegistryBoot } from "@/components/finance/contracts/registry-cards";
import { ContractCard } from "@/components/finance/contracts/contract-card";
import { bookTitle } from "@/components/finance/contracts/schema";
import { boot, ensureSchema, ensureSummary, useRegistry } from "@/components/finance/contracts/store";
import { OneoffStaff, SummaryLine } from "@/components/finance/contracts/oneoff";
import { RegistryImport } from "@/components/finance/contracts/import/registry-import";
import { RegistrySetup } from "@/components/finance/contracts/setup/registry-setup";
import { readParam, writeParams } from "@/components/finance/address";
import { forgetLooks } from "@/components/finance/look-store";
import { habitsOwner, pickMode, preferOf, useModeTracker } from "@/components/finance/habits";
import type { Me, OperationKind } from "@/components/finance/api";
import { SessionScope, dropAllSessions, useSessionState, useSessionStateIn } from "@/components/session-state";

/** «Настроить реестр» читает схему из хранилища реестра - поднимаем его, если
 *  экран открыли по ссылке, минуя «Реестр». */
function SetupScreen({ me, onBack }: { me: Me; onBack: () => void }) {
  useRegistryBoot(me);
  return <RegistrySetup onBack={onBack} />;
}

/** Univer роняет серверную отрисовку - лист реестра только в браузере. */
const RegistrySheet = dynamic(
  () => import("./contracts/registry-sheet").then((m) => m.RegistrySheet),
  { ssr: false, loading: () => <p className="creg-empty">Готовим лист…</p> },
);

/**
 * «Реестр · таблица»: лист и карточка договора.
 *
 * Карточка - по центру, как в «Карточках», с затемнением: щелчок мимо и Esc
 * её закрывают, стрелки ведут по строкам листа. До 29.09.2026 она вставала
 * внизу без затемнения, чтобы правимая строка оставалась видна, - но на окне
 * 1280×590 закрывала почти весь лист, закрыть её можно было только крестиком,
 * и открывалась она с первого щелчка по «№», которым отмечают строку.
 */
function SheetScreen({ me }: { me: Me }) {
  return <RegistryTable me={me} book="" />;
}

function RegistryTable({ me, book }: { me: Me; book: string }) {
  useRegistryBoot(me);
  const [openId, setOpenId] = useState<string | null>(() => readParam("id"));
  const open = useCallback((id: string | null) => {
    setOpenId(id);
    writeParams({ id }, id !== null);
  }, []);
  useEffect(() => {
    const onPop = () => setOpenId(readParam("id"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Соседей открытого договора знает лист: порядок строк, отбор фильтром.
  const [around, setAround] = useState<{ prev: string | null; next: string | null }>({ prev: null, next: null });
  const prev = openId ? around.prev : null;
  const next = openId ? around.next : null;
  return (
    <>
      <RegistrySheet me={me} book={book} onOpenCard={open} openId={openId} onNeighbors={setAround} />
      <ContractCard
        id={openId}
        open={!!openId}
        book={book}
        onClose={() => open(null)}
        onCreated={(id) => open(id)}
        onPrev={prev ? () => open(prev) : undefined}
        onNext={next ? () => open(next) : undefined}
      />
    </>
  );
}

/**
 * «Разовые · Таблица»: листы книги `oneoff` (договоры ЮО вида «Разовая
 * услуга») - как книга юротдела BBC «Разовые». Сводки по сотрудникам - своим
 * листом в той же книге (`staff-sheet.ts`), как «Сводка по сотрудникам» у
 * юротдела. Карточка - та же, что у «Таблицы» реестра.
 */
function OneoffScreen({ me, onGo }: { me: Me; onGo: (section: string) => void }) {
  // Сводка по сотрудникам считает остатки - сводка нужна и без её колонок.
  useEffect(() => {
    void ensureSummary();
  }, []);
  return (
    <>
      <div className="creg-oneoff-top">
        <SummaryLine onSetup={isAdmin(me) ? () => onGo("contracts-setup") : undefined} />
      </div>
      <RegistryTable me={me} book="oneoff" />
    </>
  );
}

/**
 * «Разовые · Карточки»: те же листы книги `oneoff` строками, как «Реестр», и
 * сводка по сотрудникам - таблицами, как было до листа (28.09.2026: «в
 * карточном виде пускай остаётся как есть»).
 */
function OneoffCardsScreen({ me, onGo }: { me: Me; onGo: (section: string) => void }) {
  useRegistryBoot(me);
  const [staff, setStaff] = useSessionState("oneoff.staff", false);
  useEffect(() => {
    void ensureSummary();
  }, []);
  return (
    <>
      <div className="creg-oneoff-top">
        <SummaryLine onSetup={isAdmin(me) ? () => onGo("contracts-setup") : undefined} />
      </div>
      {/* «По сотрудникам» - в одном ряду с «Все · Мои · С долями» под «Новый
          договор» (30.09.2026: пунктирная ссылка над кнопкой ломала верх). */}
      <Registry me={me} onGo={onGo} book="oneoff" staff={{ on: staff, set: setStaff, view: <OneoffStaff /> }} />
    </>
  );
}

/**
 * Сотрудник, которому ещё не открыли ни одного раздела, стоит на главном
 * экране, а не в кабинете (28.09.2026): колонка пустая, на месте раздела -
 * отказ словами и кто его снимает.
 */
function NoSections({ onCabinet }: { onCabinet: () => void }) {
  return (
    <div className="fin-nosections" role="status">
      <p className="fin-nosections-line">Вам пока не открыт ни один раздел.</p>
      <p className="fin-nosections-sub">
        Доступ даёт владелец или администратор компании - открытый раздел появится здесь сам.
      </p>
      <button type="button" className="fin-link-btn" onClick={onCabinet}>
        Личный кабинет
      </button>
    </div>
  );
}

/**
 * Табличный вид грузится только по требованию: Univer тянет за собой канвас и
 * при импорте обращается к `window`, поэтому серверная отрисовка его роняет
 * («Path2D is not defined»). Тот же приём, что в «Книгах» и «Таблицах».
 */
const TableView = dynamic(() => import("./table-view").then((m) => m.TableView), {
  ssr: false,
  loading: () => <div className="p-6 text-sm" style={{ color: "var(--text-muted)" }}>Готовим лист…</div>,
});

type Section =
  | "contracts"
  | "contracts-sheet"
  | "contracts-oneoff"
  | "contracts-oneoff-cards"
  | "contracts-import"
  | "contracts-setup"
  | "journal"
  | "table"
  | "calendar"
  | "cash"
  | "profit"
  | "debts"
  | "projects"
  | "plan"
  | "import"
  | "sheets"
  | "dictionaries"
  | "rules"
  | "invoices"
  | "recurrences"
  | "integrations"
  | "balance"
  | "indicators"
  | "statement"
  | "me";

/**
 * Разделы живут в левой колонке, а не лентой сверху.
 *
 * Лента из тринадцати названий не помещалась даже на 1440: последняя вкладка
 * обрезалась, и о её существовании узнавали случайно. В колонке место есть
 * всегда, а свёрнутая она занимает ширину пальца - ровно то устройство, что у
 * Finmap, и по той же причине.
 *
 * Значок здесь не украшение: в свёрнутой колонке он единственное, по чему
 * раздел узнаётся.
 */
type SectionItem = {
  key: Section;
  title: string;
  icon: (props: { size?: number }) => ReactElement;
  /** Право, которое открывает раздел (`app/finance/access.py`, RESOURCES). */
  resource: string;
};

/**
 * Разделы сгруппированы так же, как у Finmap: работа с операциями, отчёты,
 * настройки. Двадцать пунктов подряд - это уже поиск, а не навигация; три
 * группы по шесть-восемь читаются одним взглядом.
 */
const GROUPS: { title: string; items: SectionItem[] }[] = [
  {
    // Договоры - первыми: колонка идёт в порядке цепочки учёта, от договора к
    // деньгам и отчётам (план, «Картина целиком»).
    title: "Договоры",
    // Пункт на реестр, а не на вид: карточки и таблица - виды одних и тех же
    // договоров, переключаются у заголовка (`REGISTRIES`). «Разовые ЮО» -
    // свой реестр со своими листами (28.09.2026: разделить «Реестр ·
    // Таблица · Разовые» на два пункта). Подпись второго - из правила книги
    // («отдел - ЮО»), см. `bookTitle`.
    items: [
      { key: "contracts", title: "Реестр", icon: ContractIcon, resource: "contracts" },
      { key: "contracts-oneoff-cards", title: "Разовые", icon: OneoffIcon, resource: "contracts" },
    ],
  },
  {
    title: "Учёт",
    items: [
      { key: "journal", title: "Журнал", icon: ListIcon, resource: "journal" },
      { key: "table", title: "Таблица", icon: TableIcon, resource: "table" },
      { key: "calendar", title: "Календарь", icon: CalendarIcon, resource: "calendar" },
      { key: "invoices", title: "Счета", icon: ReceiptIcon, resource: "invoices" },
      { key: "recurrences", title: "Повторения", icon: RepeatIcon, resource: "recurrences" },
      { key: "import", title: "Загрузка", icon: UploadIcon, resource: "import" },
      { key: "sheets", title: "Google Таблицы", icon: GridIcon, resource: "sheets" },
    ],
  },
  {
    title: "Отчёты",
    items: [
      { key: "cash", title: "Деньги", icon: WalletIcon, resource: "reports.cash" },
      { key: "profit", title: "Прибыль", icon: TrendIcon, resource: "reports.profit" },
      { key: "debts", title: "Долги", icon: ClockIcon, resource: "reports.debts" },
      { key: "balance", title: "Баланс", icon: ScaleIcon, resource: "reports.balance" },
      { key: "indicators", title: "Показатели", icon: GaugeIcon, resource: "reports.indicators" },
      { key: "statement", title: "Выписка по счёту", icon: FileTextIcon, resource: "reports.statement" },
      { key: "projects", title: "Проекты", icon: FolderIcon, resource: "reports.projects" },
      { key: "plan", title: "План / Факт", icon: TargetIcon, resource: "reports.plan" },
    ],
  },
  {
    // «Команда» и «История» ушли в личный кабинет (фронт-план, 3.1): колонка -
    // инструмент учёта, всё о людях живёт в кабинете.
    title: "Настройки",
    items: [
      { key: "integrations", title: "Интеграции", icon: PlugIcon, resource: "integrations" },
      { key: "rules", title: "Правила", icon: BoltIcon, resource: "rules" },
      { key: "dictionaries", title: "Справочники", icon: BookIcon, resource: "dictionaries" },
    ],
  },
];

/**
 * Экраны без пункта в колонке: редкие действия внутри «Реестра» (меню ⋯) и
 * личный кабинет, который открывается по имени в раме. У кабинета права нет:
 * своё видит каждый, а вкладки людей решают права `people` и `audit`.
 */
const HIDDEN_SECTIONS: SectionItem[] = [
  { key: "contracts-sheet", title: "Реестр", icon: ContractGridIcon, resource: "contracts" },
  { key: "contracts-oneoff", title: "Разовые", icon: ContractGridIcon, resource: "contracts" },
  { key: "contracts-import", title: "Загрузка реестра", icon: UploadIcon, resource: "contracts" },
  { key: "contracts-setup", title: "Настроить реестр", icon: BookIcon, resource: "contracts" },
  { key: "me", title: "Личный кабинет", icon: PersonIcon, resource: "" },
];

const SECTIONS: SectionItem[] = GROUPS.flatMap((group) => group.items);
const ALL_SECTIONS: SectionItem[] = [...SECTIONS, ...HIDDEN_SECTIONS];

/**
 * Реестры и их виды. Реестр - пункт колонки и заголовок раздела, вид -
 * «Карточки · Таблица» рядом с заголовком. Выбранный вид - весом и чертой
 * под словом, не цветом и не плашкой (правило индикаторов). Порядок видов
 * постоянный: переключение не переставляет слова.
 */
type Registry = { nav: Section; book: string; modes: { key: Section; title: string }[] };
const REGISTRIES: Registry[] = [
  {
    nav: "contracts",
    book: "",
    modes: [
      { key: "contracts", title: "Карточки" },
      { key: "contracts-sheet", title: "Таблица" },
    ],
  },
  {
    nav: "contracts-oneoff-cards",
    book: "oneoff",
    modes: [
      { key: "contracts-oneoff-cards", title: "Карточки" },
      { key: "contracts-oneoff", title: "Таблица" },
    ],
  },
];
const REGISTRY_MODE_KEYS = new Set<Section>(REGISTRIES.flatMap((registry) => registry.modes.map((mode) => mode.key)));

function registryOf(section: Section): Registry | undefined {
  return REGISTRIES.find((registry) => registry.modes.some((mode) => mode.key === section));
}

/** Пункт колонки, который горит для раздела: у вида реестра - его реестр. */
function navKey(section: Section): Section {
  return registryOf(section)?.nav ?? section;
}

/**
 * Последний вид каждого реестра: «Разовые ЮО» в колонке ведут туда, где
 * человек работал, - в таблицу, если он в ней, а не каждый раз в карточки.
 */
const MODE_KEY = "fin_registry_mode";

function readMode(nav: Section): Section | null {
  try {
    const value = localStorage.getItem(`${MODE_KEY}:${nav}`);
    return REGISTRIES.find((registry) => registry.nav === nav)?.modes.find((mode) => mode.key === value)?.key ?? null;
  } catch {
    return null;
  }
}

/**
 * Вид реестра, выбранный в этой вкладке, - главнее привычки: переключился на
 * карточки ради одного договора и ушёл в «Разовые» - вернёшься в карточки.
 * Новая вкладка или вход - снова по привычке (`habits.ts`).
 */
const SESSION_MODE_KEY = "fin_registry_mode_now";

function readSessionMode(nav: Section): Section | null {
  try {
    const value = sessionStorage.getItem(`${SESSION_MODE_KEY}:${nav}`);
    return REGISTRIES.find((registry) => registry.nav === nav)?.modes.find((mode) => mode.key === value)?.key ?? null;
  } catch {
    return null;
  }
}

function writeSessionMode(section: Section): void {
  const registry = registryOf(section);
  if (!registry) return;
  try {
    sessionStorage.setItem(`${SESSION_MODE_KEY}:${registry.nav}`, section);
  } catch {
    /* вкладка без хранилища - решит привычка */
  }
}

/** Каким видом открыть реестр: выбор в этой вкладке → привычка учётки → последний в браузере. */
function chooseMode(nav: Section, owner: string, fromMe?: Readonly<Record<string, string>> | null): Section | null {
  const registry = REGISTRIES.find((item) => item.nav === nav);
  if (!registry) return null;
  const habit = preferOf(owner, nav, fromMe);
  const byHabit = registry.modes.find((mode) => mode.key === habit)?.key ?? null;
  return readSessionMode(nav) ?? byHabit ?? readMode(nav);
}

function writeMode(section: Section): void {
  const registry = registryOf(section);
  if (!registry) return;
  try {
    localStorage.setItem(`${MODE_KEY}:${registry.nav}`, section);
  } catch {
    /* вид не запомнится - откроются карточки */
  }
}
/** Загрузка и настройка реестра меняют шаблон компании - владелец и администратор. */
const ADMIN_SECTIONS = new Set<Section>(["contracts-import", "contracts-setup"]);

/**
 * Мера раздела (`.fin-body[data-measure]` в globals.css): до какой ширины
 * раздел растёт на широком окне. Листы Univer - во всю ширину, настройки и
 * загрузки - узкой строкой, остальное - шириной таблиц и отчётов.
 */
const FULL_SECTIONS = new Set<Section>(["table", "contracts-sheet", "contracts-oneoff"]);
// «Разовые · Карточки» - строки реестра шириной данных, как «Реестр».
const FORM_SECTIONS = new Set<Section>([
  "import",
  "sheets",
  "integrations",
  "rules",
  "dictionaries",
  "contracts-import",
  "contracts-setup",
]);
function measureOf(section: Section): "full" | "form" | "data" {
  if (FULL_SECTIONS.has(section)) return "full";
  return FORM_SECTIONS.has(section) ? "form" : "data";
}

function sectionFromAddress(): Section | null {
  const wanted = readParam("s");
  return (ALL_SECTIONS.find((item) => item.key === wanted)?.key as Section | undefined) ?? null;
}

/**
 * Последний открытый раздел - туда же при следующем входе. Раньше вход всегда
 * вёл в «Журнал», и компания, которая ведёт договоры, каждый раз начинала с
 * пустого журнала, хотя колонка начинается с «Реестра».
 */
const LAST_KEY = "fin_last_section";

function readLast(): Section | null {
  try {
    const value = localStorage.getItem(LAST_KEY);
    return (
      (SECTIONS.find((item) => item.key === value)?.key as Section | undefined) ??
      (REGISTRY_MODE_KEYS.has(value as Section) ? (value as Section) : null)
    );
  } catch {
    return null;
  }
}

function writeLast(section: Section): void {
  if (!SECTIONS.some((item) => item.key === section) && !REGISTRY_MODE_KEYS.has(section)) return;
  try {
    localStorage.setItem(LAST_KEY, section);
  } catch {
    /* не запомнится - откроется первый раздел колонки */
  }
}

/** Как часто перечитывать «кто я и что мне открыто», пока вкладка видна. */
const ME_POLL_MS = 20000;

/**
 * Закреплена ли колонка разделов - выбор человека, переживающий перезагрузку.
 *
 * Через `useSyncExternalStore`, а не «прочитать в эффекте и положить в
 * состояние»: второй способ сначала рисует свёрнутую колонку, потом раскрытую,
 * и закреплённая панель мигает при каждом открытии раздела. Если хранилище
 * недоступно (приватное окно), выбор живёт в памяти до перезагрузки.
 */
const RAIL_KEY = "fin_rail";
let railMemory = false;
const railListeners = new Set<() => void>();

function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "pinned";
  } catch {
    return railMemory;
  }
}

function writeRail(pinned: boolean): void {
  railMemory = pinned;
  try {
    localStorage.setItem(RAIL_KEY, pinned ? "pinned" : "hover");
  } catch {
    /* выбор останется в памяти */
  }
  railListeners.forEach((listener) => listener());
}

function subscribeRail(listener: () => void): () => void {
  railListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    railListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function FinanceClient() {
  // Раздел сам решает, кто вошёл: своя учётка, свой вход, своя компания.
  const { me, setMe, loading } = useMe();
  const [picked, setSectionState] = useState<Section | null>(null);
  /**
   * Раздел живёт в адресе: ссылку на реестр или договор можно переслать.
   * Первый раздел читается после монтирования, а не в начальном состоянии -
   * иначе серверная отрисовка и первая клиентская разошлись бы.
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- адрес читается только в браузере
    setSectionState(sectionFromAddress());
    const onPop = () => setSectionState(sectionFromAddress());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  /** Колонка - только разрешённые разделы (фронт-план, 3.1). */
  const visible = useCallback(
    (item: SectionItem) =>
      item.key === "me" || (ADMIN_SECTIONS.has(item.key) ? isAdmin(me) : can(me, item.resource)),
    [me],
  );
  /**
   * Подпись «Разовые ЮО» - из правила книги, поэтому колонке нужна схема
   * реестра. Одна схема, без договоров: человек может и не открывать реестр.
   */
  const seesContracts = can(me, "contracts");
  const companyKey = me?.company?.id ?? null;
  const userKey = me?.user?.id ?? null;
  useEffect(() => {
    if (companyKey && seesContracts) void ensureSchema(companyKey, userKey);
  }, [companyKey, userKey, seesContracts]);
  // Привычки учётки - до выбора раздела входа: вид реестра берётся из них.
  const habitOwner = habitsOwner(userKey, companyKey);
  const meHabits = me?.habits ?? null;
  const registrySchema = useRegistry((s) => s.schema);
  const oneoffTitle = bookTitle(registrySchema, "oneoff");
  const titleOf = useCallback(
    (item: SectionItem): string =>
      item.key === "contracts-oneoff-cards" || item.key === "contracts-oneoff" ? oneoffTitle : item.title,
    [oneoffTitle],
  );
  const groups = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        items: group.items.filter(visible).map((item) => ({ ...item, title: titleOf(item) })),
      })).filter((g) => g.items.length),
    [visible, titleOf],
  );
  const [last, setLast] = useState<Section | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- хранилище читается только в браузере
    setLast(readLast());
  }, []);
  /**
   * Без раздела в адресе - последний открытый, иначе первый в колонке.
   *
   * Разделов нет (сотрудник, которому ещё ничего не открыли) - всё равно
   * главный экран, а не кабинет: пустая колонка и предупреждение на месте
   * раздела (`NoSections`). Право, выданное, пока человек смотрит, открывает
   * раздел само: `me` перечитывается раз в 20 с.
   */
  const { home, section, sectionItem, hasSections, registry } = useMemo(() => {
    const lastItem = last ? ALL_SECTIONS.find((item) => item.key === last) : undefined;
    const firstKey = groups[0]?.items[0]?.key ?? null;
    const entry: Section | null = lastItem && visible(lastItem) ? lastItem.key : firstKey;
    // Вход в реестр - видом по привычке учётки, а не тем, что открывался
    // последним в этом браузере (29.09.2026); на новом компьютере, где
    // «последнего» нет, - тоже. Показанный вид сразу становится выбором этой
    // вкладки (эффект ниже), поэтому опрос `me` раз в 20 с с новой привычкой
    // не перекинет открытые карточки на таблицу посреди работы.
    const entryRegistry = entry ? registryOf(entry) : undefined;
    const homeKey: Section | null = entryRegistry ? (chooseMode(entryRegistry.nav, habitOwner, meHabits) ?? entry) : entry;
    const current: Section | null = picked ?? homeKey;
    const baseItem = current ? ALL_SECTIONS.find((item) => item.key === current) : undefined;
    return {
      home: homeKey,
      section: current,
      sectionItem: baseItem ? { ...baseItem, title: titleOf(baseItem) } : undefined,
      hasSections: groups.length > 0,
      registry: current ? registryOf(current) : undefined,
    };
  }, [last, groups, visible, picked, titleOf, habitOwner, meHabits]);
  const allowed = sectionItem ? visible(sectionItem) : false;
  const money = canAny(me, MONEY_RESOURCES);
  /**
   * Сводка в колонке - остатки и долги - своим правом, а не «есть любой
   * денежный раздел». Кассиру с журналом и таблицей она не открыта: журнал
   * дают, чтобы вносить операции, а не чтобы знать, сколько денег у компании.
   */
  const summary = can(me, "reports.summary");
  const setSection = useCallback((next: Section | string) => {
    const key = (ALL_SECTIONS.find((item) => item.key === next)?.key ?? "journal") as Section;
    setSectionState(key);
    writeLast(key);
    writeMode(key);
    // Запись открытого договора, лист и вкладки кабинета принадлежат своему
    // экрану - при смене раздела они уходят из адреса.
    writeParams({ s: key, id: null, v: null, t: null, d: null }, true);
  }, []);
  /**
   * «Карточки · Таблица»: явный выбор - голос в привычку учётки и выбор этой
   * вкладки (`habits.ts`, `writeSessionMode`).
   */
  const pickView = useCallback(
    (next: Section) => {
      const target = registryOf(next);
      if (target && next !== section) {
        pickMode(habitOwner, target.nav, next);
        writeSessionMode(next);
      }
      setSection(next);
    },
    [section, setSection, habitOwner],
  );
  /** Пункт колонки: у реестра - вид по привычке учётки или выбранный в этой вкладке. */
  const openNav = useCallback(
    (key: Section) => {
      const found = REGISTRIES.find((item) => item.nav === key);
      setSection(found ? (chooseMode(key, habitOwner, meHabits) ?? key) : key);
    },
    [setSection, habitOwner, meHabits],
  );
  /** Откуда пришли в кабинет - туда и возвращает «← К учёту». */
  const [cameFrom, setCameFrom] = useState<Section | null>(null);
  const openCabinet = useCallback(() => {
    if (section && section !== "me") setCameFrom(section);
    setSection("me");
  }, [section, setSection]);
  /**
   * Из кабинета - к учёту: туда, откуда пришли, иначе на главный раздел; без
   * разделов - на главный экран с предупреждением. Одна дорога у «← К учёту»
   * и у знака KORT в шапке.
   */
  const leaveCabinet = useCallback(() => {
    const came = cameFrom ? ALL_SECTIONS.find((item) => item.key === cameFrom) : undefined;
    const back = came && came.key !== "me" && visible(came) ? came.key : home;
    if (back) setSection(back);
    else {
      setSectionState(null);
      writeParams({ s: null, id: null, v: null, t: null, d: null }, true);
    }
  }, [cameFrom, visible, home, setSection]);
  /**
   * Знак KORT - «на главную» (29.09.2026): до того из кабинета на главную
   * вела только «← К учёту» на портрете. В кабинете знак дышит - подсказка,
   * что он и есть дорога назад.
   */
  const goHome = useCallback(() => {
    if (section === "me") leaveCabinet();
    else if (home && home !== section) setSection(home);
  }, [section, home, leaveCabinet, setSection]);
  const openContract = useCallback((id: string) => {
    setSectionState("contracts");
    writeParams({ s: "contracts", id, v: null, t: null, d: null }, true);
  }, []);
  const [pending, setPending] = useState(0);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- число приходит вместе с me
    setPending(me?.pending_requests ?? 0);
  }, [me?.pending_requests]);
  /**
   * Просьбы о сбросе видно и с другой вкладки браузера: число в заголовке.
   * Кнопка «N запросов» в раме видна, только пока смотришь на раздел.
   */
  const seesRequests = can(me, "people", "edit");
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s/, "");
    document.title = seesRequests && pending > 0 ? `(${pending}) ${base}` : base;
  }, [pending, seesRequests]);

  /**
   * Права могут поменяться, пока человек в разделе: `me` перечитывается раз в
   * 20 с, пока вкладка видна, - колонка перестраивается, «N запросов»
   * обновляется. 403 на любом запросе перечитывает сразу (фронт-план, 3.4):
   * раньше это было только обещанием плана, и отобранный реестр минуту стоял
   * на экране с подписью «Нет связи».
   */
  const [authNotice, setAuthNotice] = useState("");
  const refreshMe = useCallback(async () => {
    try {
      const next = await financeApi.me();
      if (!next.authenticated) setAuthNotice("Сеанс завершён - войдите снова");
      setMe(next.authenticated ? next : null);
    } catch (exc) {
      if (exc instanceof FinanceApiError && exc.status === 401) setMe(null);
    }
  }, [setMe]);
  useEffect(() => {
    if (!me) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshMe();
    }, ME_POLL_MS);
    return () => clearInterval(timer);
  }, [me, refreshMe]);
  const signedIn = me !== null;
  // Минуты работы в виде реестра - в привычку учётки (`habits.ts`).
  useModeTracker(signedIn ? habitOwner : "", registry?.nav ?? null, registry && allowed ? section : null);
  // Открытый вид реестра - выбор этой вкладки: новая привычка с опроса его не сменит.
  useEffect(() => {
    if (signedIn && registry && section) writeSessionMode(section);
  }, [signedIn, registry, section]);
  useEffect(() => {
    if (!signedIn) return;
    // Сеанс закрыли (блокировка, сброс, «Завершить сеансы») - ко входу со
    // словами, а не кабинет со своим именем и чужой ошибкой внутри.
    const lost = () => {
      setAuthNotice("Сеанс завершён - войдите снова");
      setMe(null);
    };
    // Не чаще раза в 3 с - но сигнал внутри этих секунд не теряется, а
    // откладывается: права, сменившиеся сразу после открытия страницы,
    // иначе доезжали только с опросом через 20 с.
    let lastCheck = 0;
    let later = 0;
    const forbidden = () => {
      const wait = lastCheck + 3000 - Date.now();
      if (wait > 0) {
        if (!later) {
          later = window.setTimeout(() => {
            later = 0;
            lastCheck = Date.now();
            void refreshMe();
          }, wait);
        }
        return;
      }
      lastCheck = Date.now();
      void refreshMe();
    };
    window.addEventListener(AUTH_LOST_EVENT, lost);
    window.addEventListener(FORBIDDEN_EVENT, forbidden);
    window.addEventListener(SCHEMA_EVENT, forbidden);
    return () => {
      window.clearTimeout(later);
      window.removeEventListener(AUTH_LOST_EVENT, lost);
      window.removeEventListener(FORBIDDEN_EVENT, forbidden);
      window.removeEventListener(SCHEMA_EVENT, forbidden);
    };
  }, [signedIn, setMe, refreshMe]);

  /** Сигнал «открыт раздел» в журнал действий; сервер сам держит «не чаще раза в минуту». */
  useEffect(() => {
    if (!me?.company || !sectionItem?.resource || !allowed) return;
    void peopleApi.audit.view(sectionItem.resource).catch(() => undefined);
  }, [me?.company, sectionItem?.resource, allowed]);
  /**
   * Колонка разделов: свёрнута в полосу значков и раскрывается наведением.
   *
   * Закрепить её открытой можно кнопкой - тогда она не сворачивается, когда
   * курсор уходит. Свёрнутое состояние по умолчанию работает только потому,
   * что полоса теперь видима: подложка, значки разделов и текущий раздел
   * плашкой. В прежнем виде - 60px пустоты с вертикальной цифрой - её
   * принимали за край экрана и не наводили на неё курсор вообще.
   */
  const railOpen = useSyncExternalStore(subscribeRail, readRail, () => false);

  /**
   * Новый раздел открывается с начала.
   *
   * Иначе прокрутка оставалась там, где был прошлый раздел: пункт «Правила»
   * внизу колонки нажимали, прокрутив страницу, и новый раздел рисовался выше
   * экрана - человек видел пустоту и листал наверх сам. Первое открытие
   * пропускается: страница и так в начале, а прыжок при загрузке мешал бы
   * якорю в адресе, если он когда-нибудь появится.
   */
  const firstSection = useRef(true);
  useEffect(() => {
    if (firstSection.current) {
      firstSection.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [section]);
  const toggleRail = useCallback(() => writeRail(!readRail()), []);
  /**
   * Высота липкой шапки - переменной `--fin-head-h` на странице.
   *
   * Колонка разделов, шапка списка договоров и полоса записи разбора липнут
   * к окну, а шапка «Финансов» липнет поверх них. Отступ был прибит в 0.75rem
   * от края окна, и после прокрутки верх колонки («Договоры», «Реестр»)
   * уезжал под шапку: на MacBook (окно ~790px) и в длинной «Настройке
   * реестра» - всегда. Высота шапки меняется (перенос кнопок, другая ширина),
   * поэтому она меряется, а не записывается числом.
   */
  const headObserver = useRef<ResizeObserver | null>(null);
  const measureHead = useCallback((node: HTMLElement | null) => {
    headObserver.current?.disconnect();
    headObserver.current = null;
    if (!node) return;
    const page = node.parentElement;
    const put = () => page?.style.setProperty("--fin-head-h", `${Math.round(node.getBoundingClientRect().height)}px`);
    put();
    if (typeof ResizeObserver === "undefined") return;
    headObserver.current = new ResizeObserver(put);
    headObserver.current.observe(node);
  }, []);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [dictionaries, setDictionaries] = useState<Dictionaries | null>(null);
  const [error, setError] = useState<string>("");
  /**
   * Чьё запомненное состояние (`session-state.tsx`): учётка и компания. До
   * входа - пусто, и открытое перед перезагрузкой окно операции встаёт, как
   * только вход известен.
   */
  const sessionScope = me?.user?.id ? `${me.user.id}:${me.company?.id ?? ""}` : "";
  /**
   * Открытое окно операции переживает перезагрузку, а поля в нём - свой
   * черновик (`OperationDialog`). `plan` - окно открыто с уже отмеченным
   * ожиданием, из раздела «Долги».
   */
  const [dialog, setDialog] = useSessionStateIn<{ kind: OperationKind; plan: boolean } | null>(
    sessionScope,
    sessionScope ? "fin.op-dialog" : null,
    null,
  );
  /**
   * Счётчик перезагрузок. Меняется, когда данные изменились где угодно в
   * разделе, и по нему обновляются и сводка слева, и открытый экран.
   *
   * Счётчик, а не флаг: два изменения подряд с флагом дали бы одну
   * перезагрузку, и вторая правка осталась бы не видна - та же ошибка, что
   * ловили в «Книгах» на быстром наборе.
   */
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  /**
   * Пересобрать лист «Таблицы» - только по кнопке «Перечитать».
   *
   * Отдельно от `revision`, потому что лист сам зовёт `reload` после каждой
   * правки, чтобы обновились остатки слева. Пересобирай он себя на каждый
   * такой вызов - прыгал бы в начало после каждой ячейки, а строки меняли бы
   * порядок прямо под курсором.
   */
  const [sheetRefresh, setSheetRefresh] = useState(0);

  const companyId = me?.company?.id ?? null;

  useEffect(() => {
    // Справочники - у денежных разделов. Юристу с одними договорами они не
    // открыты: запрос ответил бы 403 и повесил бы над реестром чужую ошибку.
    if (!companyId || !money) return;
    let alive = true;
    (async () => {
      try {
        const dicts = await financeApi.dictionaries();
        if (!alive) return;
        setDictionaries(dicts);
        setError("");
      } catch (exc) {
        if (!alive) return;
        setError(exc instanceof Error ? exc.message : "Не удалось прочитать данные раздела");
      }
    })();
    return () => {
      alive = false;
    };
    // Компания в зависимостях не для порядка: при переключении надо перечитать
    // всё, иначе на экране останутся счета и операции прежней компании.
  }, [revision, companyId, money]);

  /**
   * Сводка - отдельным запросом и только при своём праве.
   *
   * Раньше она шла в паре со справочниками через `Promise.all`: отказ сводки
   * ронял и справочники, и журнал, открытый человеку, стоял пустым под
   * плашкой «Раздел „Журнал“ вам не открыт».
   */
  useEffect(() => {
    if (!companyId || !summary) {
      // Право сняли - цифры не остаются в памяти страницы до перезагрузки.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- сброс вслед за правом из `me`
      setOverview(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const next = await financeApi.overview();
        if (alive) setOverview(next);
      } catch (exc) {
        // 403 - право сняли только что: `me` перечитается и уберёт блок сам,
        // плашка с отказом над открытым журналом была бы чужой ошибкой.
        if (!alive || (exc instanceof FinanceApiError && exc.status === 403)) return;
        setError(exc instanceof Error ? exc.message : "Сводка по счетам не прочиталась");
      }
    })();
    return () => {
      alive = false;
    };
  }, [revision, companyId, summary]);

  const currency = overview?.workspace.currency ?? "KZT";
  const symbol = currency === "KZT" ? "₸" : currency;

  const content = useMemo(() => {
    if (!me) return null;
    if (!section) return <NoSections onCabinet={() => setSection("me")} />;
    if (!allowed) {
      return (
        <p className="fin-denied">
          Нет доступа к разделу «{sectionItem?.title ?? ""}». Доступ даёт администратор.
        </p>
      );
    }
    switch (section) {
      case "contracts":
        return <Registry me={me} onGo={setSection} book="" />;
      case "contracts-sheet":
        return <SheetScreen me={me} />;
      case "contracts-oneoff":
        return <OneoffScreen me={me} onGo={setSection} />;
      case "contracts-oneoff-cards":
        return <OneoffCardsScreen me={me} onGo={setSection} />;
      case "contracts-import":
        return (
          <RegistryImport
            onDone={() => {
              if (me.company) void boot(me.company.id, me.user?.id ?? null, true);
              setSection("contracts");
            }}
            onCancel={() => setSection("contracts")}
          />
        );
      case "contracts-setup":
        return <SetupScreen me={me} onBack={() => setSection("contracts")} />;
      default:
        break;
    }
    if (!dictionaries) return null;
    switch (section) {
      case "journal":
        return <Journal dictionaries={dictionaries} revision={revision} onChanged={reload} />;
      case "table":
        return <TableView onChanged={reload} refresh={sheetRefresh} canEdit={can(me, "table", "edit")} />;
      case "calendar":
        return <CalendarView revision={revision} />;
      case "cash":
        return <CashFlowReport revision={revision} />;
      case "profit":
        return <ProfitReport revision={revision} />;
      case "debts":
        return <DebtsReport
            revision={revision}
            onChanged={reload}
            onNewExpectation={(kind) => setDialog({ kind, plan: true })}
          />;
      case "projects":
        return <ProjectsReport revision={revision} />;
      case "plan":
        return <PlanActualReport revision={revision} onChanged={reload} />;
      case "import":
        return <ImportPanel onChanged={reload} accounts={dictionaries.accounts} onNext={() => setSection("rules")} />;
      case "sheets":
        return <SheetsPanel onChanged={reload} accounts={dictionaries.accounts} />;
      case "rules":
        return <RulesPanel dictionaries={dictionaries} onChanged={reload} />;
      case "dictionaries":
        return <DictionariesPanel dictionaries={dictionaries} onChanged={reload} />;
      case "invoices":
        return <InvoicesPanel dictionaries={dictionaries} onChanged={reload} />;
      case "recurrences":
        return <RecurrencesPanel dictionaries={dictionaries} onChanged={reload} />;
      case "integrations":
        return <IntegrationsPanel accounts={dictionaries.accounts} onGo={setSection} onChanged={reload} />;
      case "balance":
        return <BalanceReport revision={revision} />;
      case "indicators":
        return <IndicatorsReport revision={revision} />;
      case "statement":
        return <StatementReport accounts={dictionaries.accounts} revision={revision} />;
      default:
        return null;
    }
  }, [section, sectionItem, allowed, dictionaries, revision, reload, me, sheetRefresh, setSection, setDialog]);

  if (loading) return <AuthLoading />;
  if (!me) {
    return (
      <AuthGate
        key={authNotice}
        notice={authNotice}
        onReady={(next) => {
          setAuthNotice("");
          setMe(next);
        }}
      />
    );
  }
  if (me.user?.must_change_password) {
    return (
      <PasswordChangeGate
        onDone={async () => {
          const next = await financeApi.me();
          setMe(next.authenticated ? next : null);
        }}
      />
    );
  }

  /**
   * Новая операция - у заголовка «Журнала», а не в шапке: сервисом пользуются
   * отделы, которым записывать деньги незачем. Только при праве правки
   * журнала; без права кнопок нет вовсе, а не пустое место (фронт-план, 3.3).
   * «Перевод» на телефоне не прячется: перевод из кассы на счёт - обычная
   * работа кассира.
   */
  const operationActions =
    section === "journal" && can(me, "journal", "edit") ? (
      <div className="fin-ops" role="group" aria-label="Новая операция">
        {/* Имена кнопок прежние - «+ Доход» и т. д.: по ним их находят проверки. */}
        <button type="button" className="fin-op" data-kind="income" onClick={() => setDialog({ kind: "income", plan: false })}>
          <span className="fin-op-sign">+</span> Доход
        </button>
        <button type="button" className="fin-op" data-kind="expense" onClick={() => setDialog({ kind: "expense", plan: false })}>
          <span className="fin-op-sign">−</span> Расход
        </button>
        <button type="button" className="fin-op" onClick={() => setDialog({ kind: "transfer", plan: false })}>
          <span className="fin-op-sign">⇄</span> Перевод
        </button>
      </div>
    ) : null;

  return (
    <SessionScope scope={sessionScope}>
    <div className="fin-page">
      <header className="fin-head" ref={measureHead}>
        <button
          type="button"
          className="fin-brand"
          data-pulse={section === "me" ? "true" : undefined}
          onClick={goHome}
          title="На главную"
          aria-label="KORT - на главную"
        >
          <KortWordmark className="fin-brand-mark" />
        </button>
        {/* Компания в шапке, а не название раздела: человек ведёт несколько
            компаний, и первое, что ему надо знать, - в какой он сейчас. */}
        <div className="flex flex-col mr-auto min-w-0">
          <span
            className="fin-head-title text-sm font-semibold truncate"
            style={{ letterSpacing: "-0.01em" }}
          >
            {me.company?.title ?? "KORT"}
          </span>
          {(me.companies?.length ?? 0) > 1 ? (
            <select
              className="fin-head-sub text-xs bg-transparent cursor-pointer"
              style={{ border: "none", outline: "none", padding: 0 }}
              value={me.company?.id ?? ""}
              onChange={async (event) => {
                const next = await financeApi.switchCompany(event.target.value);
                setMe(next);
                reload();
              }}
              aria-label="Сменить компанию"
            >
              {(me.companies ?? []).map((company) => (
                <option key={company.id} value={company.id}>
                  {company.title}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {pending > 0 && can(me, "people", "edit") ? (
          <button type="button" className="fin-head-requests" onClick={openCabinet}>
            {pending} {plural(pending, "запрос", "запроса", "запросов")}
          </button>
        ) : null}

        {/* «+ Доход / − Расход / ⇄ Перевод» здесь больше нет (28.09.2026): шапку
            видят все отделы, а записывать деньги - дело финансов. Кнопки - у
            заголовка «Журнала», см. `operationActions` выше. */}
        {money ? (
          <button
            type="button"
            className="fin-icon-btn fin-head-person-icon only-desktop"
            onClick={() => {
              reload();
              setSheetRefresh((value) => value + 1);
            }}
            title="Перечитать данные"
            aria-label="Перечитать данные"
          >
            <RefreshIcon size={16} />
          </button>
        ) : null}
        {/* Тема - тем же тумблером, что на входе; строки «Тема» в кабинете нет. */}
        <ThemeSwitch className="fin-head-theme" />
        {/* Имя вместо «Выйти»: выход - редкое действие, он в кабинете. */}
        <button
          type="button"
          className="fin-head-person only-desktop"
          data-on={section === "me" ? "true" : undefined}
          onClick={openCabinet}
          title="Личный кабинет"
        >
          {shortName(nameOf(me)) || "Личный кабинет"}
        </button>
        <button
          type="button"
          className="fin-icon-btn fin-head-person-icon only-mobile"
          onClick={openCabinet}
          aria-label="Личный кабинет"
        >
          <PersonIcon size={18} />
        </button>
      </header>

      {error ? (
        <div
          className="mx-3 sm:mx-4 mt-3 px-3 py-2 text-xs card-inner flex items-start gap-2"
          style={{ borderColor: "var(--outflow-border)", background: "var(--outflow-bg)", color: "var(--text-primary)" }}
        >
          <span style={{ flex: 1 }}>{error}</span>
          <button type="button" onClick={() => setError("")} aria-label="Скрыть сообщение">
            <CloseIcon size={14} />
          </button>
        </div>
      ) : null}

      {section === "me" ? (
        <div className="fin-plate" data-cabinet="true">
          <main className="fin-body fin-body-cabinet min-w-0" data-measure="full">
            <Cabinet
              me={me}
              onMe={(next) => {
                setMe(next);
                reload();
              }}
              onBack={leaveCabinet}
              onLogout={async () => {
                await financeApi.logout().catch(() => undefined);
                // Компьютер бывает общим: черновики вышедшего не ждут следующего.
                // Второй раз - после того как экраны снялись: лист, снимаясь,
                // запоминает своё место.
                dropAllSessions();
                forgetLooks();
                setAuthNotice("");
                // Выходят из кабинета, и раздел «кабинет» оставался выбранным:
                // следующий вход - свой или чужой - открывался кабинетом, а не
                // главным экраном (28.09.2026). Раздел и адрес - с чистого листа.
                setSectionState(null);
                setCameFrom(null);
                writeParams({ s: null, id: null, v: null, t: null, d: null }, false);
                setMe(null);
                window.setTimeout(dropAllSessions, 300);
              }}
              onOpenContract={openContract}
              onPending={setPending}
              hasSections={hasSections}
            />
          </main>
        </div>
      ) : (
      <div className="fin-plate">
        <aside
          className="fin-aside"
          data-open={railOpen ? "true" : undefined}
          data-summary={summary ? undefined : "false"}
        >
          {/* Внутренний слой прилипает к экрану, а сама колонка тянется на
              всю высоту плиты - вместе с подложкой и разделительной линией.
              Прилипни колонка целиком, подложка обрывалась бы посреди длинного
              журнала. */}
          <div className="fin-aside-inner">
          {/* Навигация. В свёрнутой колонке видны значки, в раскрытой - названия.
              Подпись не прячется display'ем: свёрнутая колонка её обрезает
              шириной, поэтому переход плавный, а не мигающий. */}
          <nav className="fin-nav" aria-label="Разделы финансов">
            {hasSections ? null : (
              // Пустая колонка говорит, почему она пустая: без строки её
              // принимали за недогрузившуюся страницу.
              <div className="fin-nav-group">
                <span className="fin-nav-head">Разделы</span>
                <span className="fin-nav-empty">
                  <span className="fin-nav-text">Пока не открыты</span>
                </span>
              </div>
            )}
            {groups.map((group) => (
              <div key={group.title} className="fin-nav-group">
                <span className="fin-nav-head">{group.title}</span>
                {group.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="fin-nav-item"
                    data-on={section ? navKey(section) === item.key : false}
                    title={item.title}
                    onClick={() => openNav(item.key)}
                  >
                    <span className="fin-nav-ico">
                      <item.icon size={17} />
                    </span>
                    <span className="fin-nav-text">{item.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          {/* Главная цифра в свёрнутом виде: ради неё на панель и смотрят, не
              раскрывая её. В раскрытой колонке её место занимает полный блок. */}
          {summary ? (
          <div className="fin-rail-foot" aria-hidden="true">
            <span className="fin-rail-sum">{compactMoney(overview?.total)}</span>
            <span className="fin-rail-cur">{symbol}</span>
          </div>
          ) : null}

          {summary ? (
          <div className="fin-aside-full flex flex-col gap-3">
          <div className="fin-total">
            <span className="fin-total-label">Всего на счетах</span>
            <span className="fin-total-value">
              {symbol} {overview ? formatMoney(overview.total) : "-"}
            </span>
            {overview && overview.total_with_plan !== overview.total ? (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {symbol} {formatMoney(overview.total_with_plan)} с учётом ожиданий
              </span>
            ) : null}
          </div>

          <div>
            <p className="fin-label mb-1">Счета</p>
            {(overview?.accounts ?? []).map((account) => (
              <div key={account.id} className="fin-acc-row">
                <span className="fin-acc-name" title={account.name}>
                  {account.name}
                  {account.excluded_from_reports ? " · вне отчётов" : ""}
                </span>
                <span className="fin-num" style={{ color: "var(--text-primary)" }}>
                  {formatMoney(account.balance)}
                </span>
              </div>
            ))}
            {overview && overview.accounts.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Счетов пока нет
              </p>
            ) : null}
          </div>

          <div>
            <p className="fin-label mb-1">Ожидания</p>
            <div className="fin-acc-row">
              <span className="fin-acc-name">Нам должны</span>
              <span className="fin-num" style={{ color: "var(--text-primary)" }}>
                {overview ? formatMoney(overview.receivable) : "-"}
              </span>
            </div>
            <div className="fin-acc-row">
              <span className="fin-acc-name">Мы должны</span>
              <span className="fin-num" style={{ color: "var(--text-primary)" }}>
                {overview ? formatMoney(overview.payable) : "-"}
              </span>
            </div>
            {overview && Number(overview.overdue_receivable) > 0 ? (
              // Просрочка - единственная цифра в панели, которой положен цвет:
              // это не состояние «идёт как идёт», а срок, который прошёл.
              <div className="fin-acc-row">
                <span className="fin-acc-name">Срок прошёл</span>
                <span className="fin-num fin-out">{formatMoney(overview.overdue_receivable)}</span>
              </div>
            ) : null}
          </div>
          </div>
          ) : null}

          <button
            type="button"
            className="fin-rail-toggle"
            onClick={toggleRail}
            aria-label={railOpen ? "Открепить панель" : "Закрепить панель открытой"}
            title={railOpen ? "Открепить - будет раскрываться наведением" : "Закрепить открытой"}
          >
            <span className="fin-rail-toggle-ico">
              <ChevronRightIcon size={14} />
            </span>
            <span className="fin-nav-text">{railOpen ? "Открепить" : "Закрепить"}</span>
          </button>
          </div>
        </aside>

        <main className="fin-body min-w-0" data-measure={section ? measureOf(section) : "data"}>
          {/* Заголовок раздела. Пока разделы были лентой вкладок, лента и была
              верхом страницы; когда она ушла в колонку, содержимое упёрлось в
              край плиты, и страница читалась обрезанной. */}
          {/* Смена раздела: заголовок поднимается буквами, содержимое
              проявляется. key обязателен у обоих - SplitText переписывает DOM
              надписи, и сменить её текст на месте React уже не сможет. Ключи
              у соседей разные: одинаковые (оба `section`) React в сборке не
              различал, и старые заголовки не удалялись - копились над новыми. */}
          {!section ? (
            <SplitReveal key="title-none" as="h1" className="fin-section-title" duration={0.9}>
              Нет доступа
            </SplitReveal>
          ) : registry ? (
            // Реестр - заголовком, его виды - рядом: «Карточки · Таблица».
            // Заголовок не пересобирается при смене вида (ключ - реестр и его
            // подпись): буквы поднимаются, только когда сменился сам реестр.
            // На узком окне заголовков нет - виды встают своим рядом под
            // лентой разделов (`fin-modes` ниже).
            <div className="fin-title-bar fin-reg-title">
              <SplitReveal
                key={`title-${registry.nav}-${sectionItem?.title ?? ""}`}
                as="h1"
                className="fin-section-title"
                duration={0.9}
              >
                {registry.book ? oneoffTitle : "Реестр"}
              </SplitReveal>
              <nav className="fin-views" aria-label="Вид реестра">
                {registry.modes.map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    className="fin-view"
                    aria-current={mode.key === section ? "page" : undefined}
                    onClick={() => pickView(mode.key)}
                  >
                    {mode.title}
                  </button>
                ))}
              </nav>
              <RegistryActions book={registry.book} onGo={setSection} />
            </div>
          ) : operationActions ? (
            // Журнал: справа от заголовка - новая операция.
            <div className="fin-title-bar">
              <SplitReveal key={`title-${section}`} as="h1" className="fin-section-title" duration={0.9}>
                {sectionItem?.title ?? ""}
              </SplitReveal>
              {operationActions}
            </div>
          ) : (
            <SplitReveal key={`title-${section}`} as="h1" className="fin-section-title" duration={0.9}>
              {sectionItem?.title ?? ""}
            </SplitReveal>
          )}
          {/* На телефоне колонка не работает - там разделы остаются лентой. */}
          <nav className="fin-tabs" aria-label="Разделы финансов">
            {groups.flatMap((group) => group.items).map((item) => (
              <button
                key={item.key}
                type="button"
                className="fin-tab"
                data-on={section ? navKey(section) === item.key : false}
                onClick={() => openNav(item.key)}
              >
                {item.title}
              </button>
            ))}
          </nav>
          {/* На узком окне заголовка нет - кнопки встают своим рядом под лентой. */}
          {operationActions ? <div className="fin-ops-row">{operationActions}</div> : null}
          {registry ? (
            <nav className="fin-modes" aria-label="Вид реестра">
              {registry.modes.map((mode) => (
                <button
                  key={mode.key}
                  type="button"
                  className="fin-mode"
                  aria-current={mode.key === section ? "page" : undefined}
                  onClick={() => pickView(mode.key)}
                >
                  {mode.title}
                </button>
              ))}
            </nav>
          ) : null}
          <FadeIn key={`body-${section}`}>{content}</FadeIn>
        </main>
      </div>
      )}

      {dialog && dictionaries ? (
        <OperationDialog
          kind={dialog.kind}
          plan={dialog.plan}
          dictionaries={dictionaries}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            reload();
          }}
        />
      ) : null}
    </div>
    </SessionScope>
  );
}
