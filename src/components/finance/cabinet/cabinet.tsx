"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { can, headOnly, isAdmin, nameOf } from "@/components/finance/access";
import { type Department, type EmployeeRow, type Me, type NotificationItem, peopleApi } from "@/components/finance/api";
import { readParam, writeParams } from "@/components/finance/address";
import { ActionFeed } from "@/components/finance/cabinet/action-feed";
import { FilterChips } from "@/components/finance/cabinet/filter-chips";
import { PendingStrip } from "@/components/finance/cabinet/pending";
import { PEOPLE_ALL, PeopleTab } from "@/components/finance/cabinet/people-tab";
import { MyAccess, ProfileTab } from "@/components/finance/cabinet/profile-tab";
import { RightsMatrix } from "@/components/finance/cabinet/rights";
import { SessionsList } from "@/components/finance/cabinet/sessions-list";
import { RestoreTab } from "@/components/finance/cabinet/restore-tab";
import { TrashTab } from "@/components/finance/cabinet/trash-tab";
import { ROLE_TITLES } from "@/components/finance/cabinet/status";
import { SelectLine } from "@/components/finance/ui/select-line";
import { formatPhone } from "@/components/finance/ui/phone-input";
import { ArrowLeftIcon } from "@/components/icons";
import { FadeIn } from "@/components/motion/fade-in";
import { LiquidStage } from "@/components/motion/liquid-stage";
import { SplitReveal } from "@/components/motion/split-reveal";

/**
 * Личный кабинет (фронт-план, 6.9).
 *
 * Одно место для всего, что касается людей, а не данных учёта. Кабинет один
 * для всех: сотрудник видит своё (профиль, пароль, тема, что открыто, свои
 * сеансы и действия, «Выйти»), администратор — ещё сотрудников, права и
 * журнал действий. Не бывает «только для администратора» — урок кабинета
 * дашборда BBC.
 *
 * Вход без «Загрузка…»: кто вошёл, уже известно (`me`), поэтому портрет и
 * вкладки рисуются сразу, а данные вкладки подгружаются.
 *
 * Вкладки — два уровня (28.09.2026): крупно разделы «Моё · Команда ·
 * Корзина», под ними — подразделы выбранного. До того три строки вкладок с
 * подписями «Моё / Люди / Учёт» стояли стопкой, выбранной была одна на все
 * три, и стопка читалась как форма, а не как переключатель.
 */
type Tab = "profile" | "access" | "sessions" | "actions" | "restore" | "people" | "rights" | "audit" | "trash";
type Group = "mine" | "team" | "trash";

const MINE: { key: Tab; label: string }[] = [
  { key: "profile", label: "Профиль" },
  { key: "access", label: "Доступ" },
  { key: "sessions", label: "Сеансы" },
  { key: "actions", label: "Действия" },
];

const GROUP_OF: Record<Tab, Group> = {
  profile: "mine",
  access: "mine",
  sessions: "mine",
  actions: "mine",
  restore: "mine",
  people: "team",
  rights: "team",
  audit: "team",
  trash: "trash",
};

const TAB_KEY = "fin_cab_tab";
/** Опрос людей и запросов — раз в 30 с, пока вкладка видна (план, «Живой режим»). */
const POLL_MS = 30000;

function rememberTab(tab: Tab) {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    /* не запомнится */
  }
}

function recallTab(): Tab | null {
  try {
    return (localStorage.getItem(TAB_KEY) as Tab | null) ?? null;
  } catch {
    return null;
  }
}

export function Cabinet({
  me,
  onMe,
  onBack,
  onLogout,
  onOpenContract,
  onPending,
  hasSections = true,
}: {
  me: Me;
  onMe: (next: Me) => void;
  onBack: () => void;
  /** Открыт ли хоть один раздел учёта. Нет — «К учёту» вести некуда: раньше
   *  кнопка вела из кабинета в тот же кабинет и выглядела сломанной. */
  hasSections?: boolean;
  onLogout: () => void;
  onOpenContract: (id: string) => void;
  /** Новое число запросов — для «N запросов» в раме. */
  onPending: (count: number) => void;
}) {
  const seePeople = can(me, "people", "view");
  const managePeople = can(me, "people", "edit");
  const seeAudit = can(me, "audit", "view");
  // «Восстановление» — изменения таблицы реестра для всех и возврат «как было»:
  // у каждого, кому открыты договоры (своё; у администратора — все).
  const seeRestore = can(me, "contracts", "view");
  const mine = useMemo(
    () => (seeRestore ? [...MINE, { key: "restore" as Tab, label: "Восстановление" }] : MINE),
    [seeRestore],
  );

  const [data, setData] = useState<{ departments: Department[]; employees: EmployeeRow[] } | null>(null);
  const [notes, setNotes] = useState<NotificationItem[]>([]);
  const [loadError, setLoadError] = useState("");
  const staffCount = data?.employees.length;
  const people = useMemo(() => {
    const out: { key: Tab; label: string; count?: number }[] = [];
    if (seePeople) out.push({ key: "people", label: "Сотрудники", count: staffCount });
    if (seePeople) out.push({ key: "rights", label: "Права" });
    if (seeAudit) out.push({ key: "audit", label: "Журнал действий" });
    return out;
  }, [seePeople, seeAudit, staffCount]);
  // Корзина — у владельца и администратора: восстановить и стереть насовсем
  // можно что угодно, от договора до сотрудника.
  const keepsTrash = isAdmin(me);
  const groups = useMemo(() => {
    const out: { key: Group; label: string; tabs: { key: Tab; label: string; count?: number }[] }[] = [
      { key: "mine", label: "Моё", tabs: mine },
    ];
    if (people.length) out.push({ key: "team", label: "Команда", tabs: people });
    // У корзины подразделов нет: раздел и есть экран.
    if (keepsTrash) out.push({ key: "trash", label: "Корзина", tabs: [] });
    return out;
  }, [people, keepsTrash, mine]);
  const allowed = useMemo(
    () => new Set<Tab>([...mine.map((t) => t.key), ...people.map((t) => t.key), ...(keepsTrash ? ["trash" as Tab] : [])]),
    [people, keepsTrash, mine],
  );

  const [tab, setTabState] = useState<Tab>(() => {
    const wanted = (readParam("t") as Tab | null) ?? recallTab();
    if (
      wanted &&
      (MINE.some((t) => t.key === wanted) ||
        (seeRestore && wanted === "restore") ||
        (seePeople && ["people", "rights"].includes(wanted)) ||
        (seeAudit && wanted === "audit") ||
        (isAdmin(me) && wanted === "trash"))
    ) {
      return wanted;
    }
    // Без разделов первым делом видно «Разделов пока не открыто» — ответ на
    // вопрос «а где учёт?», а не профиль с именем и телефоном.
    return managePeople ? "people" : hasSections ? "profile" : "access";
  });
  const [department, setDepartmentState] = useState<string>(() => readParam("d") ?? PEOPLE_ALL);
  const [openId, setOpenIdState] = useState<string | null>(() => readParam("id"));
  const [rightsDept, setRightsDept] = useState<string | null>(null);

  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    rememberTab(next);
    writeParams({ t: next, id: null });
  }, []);
  const setDepartment = useCallback((next: string) => {
    setDepartmentState(next);
    writeParams({ d: next === PEOPLE_ALL ? null : next });
  }, []);
  const setOpenId = useCallback((next: string | null) => {
    setOpenIdState(next);
    writeParams({ id: next }, next !== null);
  }, []);

  useEffect(() => {
    writeParams({ t: tab });
    // Только при входе в кабинет: дальше адрес пишут переключатели.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPop = () => {
      setOpenIdState(readParam("id"));
      const t = readParam("t") as Tab | null;
      if (t) setTabState(t);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const load = useCallback(async () => {
    if (!seePeople) return;
    try {
      const [next, list] = await Promise.all([
        peopleApi.list(),
        managePeople ? peopleApi.notifications.list() : Promise.resolve(null),
      ]);
      setData(next);
      if (list) {
        setNotes(list.items);
        onPending(list.pending);
      }
      setLoadError("");
    } catch (exc) {
      setLoadError(exc instanceof Error ? exc.message : "Сотрудники не прочитались");
    }
  }, [seePeople, managePeople, onPending]);

  useEffect(() => {
    if (!seePeople) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible") await load();
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [seePeople, load]);

  const shownTab: Tab = allowed.has(tab) ? tab : "profile";
  const shownGroup = GROUP_OF[shownTab];
  const group = groups.find((item) => item.key === shownGroup) ?? groups[0];
  // Раздел помнит свой подраздел: вернулся в «Команду» — там же, где был.
  const lastInGroup = useRef<Partial<Record<Group, Tab>>>({});
  useEffect(() => {
    lastInGroup.current[shownGroup] = shownTab;
  }, [shownGroup, shownTab]);
  const openGroup = (key: Group) => {
    const next = groups.find((item) => item.key === key);
    if (!next) return;
    setTab(lastInGroup.current[key] ?? next.tabs[0]?.key ?? (key === "trash" ? "trash" : "profile"));
  };
  const departments = data?.departments ?? [];
  const pickedRightsDept = rightsDept ?? (department !== PEOPLE_ALL && departments.some((d) => d.id === department) ? department : departments[0]?.id ?? null);

  // Почта — не имя. Владелец без ФИО заведён сотрудником под своей почтой, и
  // портрет крупно повторял её в третий раз за экран (шапка, портрет, профиль).
  const own = nameOf(me);
  const name = own && own !== me.user?.email && own !== me.user?.phone ? own : "";
  const role = me.role ?? (me.company?.role as Me["role"]) ?? "employee";
  const line = [me.employee?.job_title, me.employee?.department?.code, me.user?.phone ? formatPhone(me.user.phone) : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="cab">
      <section className="cab-portrait">
        <LiquidStage className="cab-liquid" intensity={0.45} delay={0.1} />
        <div className="cab-portrait-veil" aria-hidden="true" />
        <div className="cab-portrait-top">
          {hasSections ? (
            <button type="button" className="btn-ghost btn-sm cab-portrait-btn" onClick={onBack}>
              <ArrowLeftIcon size={15} />К учёту
            </button>
          ) : (
            <span />
          )}
          <button type="button" className="btn-ghost btn-sm cab-portrait-btn" onClick={onLogout}>
            Выйти
          </button>
        </div>
        <div className="cab-portrait-foot">
          <SplitReveal as="h1" className="headline cab-name" key={`name-${name}`} duration={0.9}>
            {name || "Личный кабинет"}
          </SplitReveal>
          <p className="cab-portrait-line">
            <span className="annot">{ROLE_TITLES[role ?? "employee"]}</span>
            {line ? <span className="cab-portrait-sub">{line}</span> : null}
          </p>
        </div>
      </section>

      <FadeIn className="cab-column">
        {managePeople ? (
          <PendingStrip
            items={notes}
            onChanged={() => void load()}
            onOpenEmployee={(id) => {
              setTab("people");
              setOpenId(id);
            }}
          />
        ) : null}

        <nav className="cab-nav" aria-label="Личный кабинет">
          {/* У сотрудника раздел один — «Моё»; строка из одного слова ничего
              не переключает, поэтому сразу подразделы. */}
          {groups.length > 1 ? (
            <SelectLine
              items={groups.map((item) => ({ key: item.key, label: item.label }))}
              value={shownGroup}
              onChange={openGroup}
              label="Разделы кабинета"
              size="lg"
              className="cab-groups"
            />
          ) : null}
          {group.tabs.length ? (
            <SelectLine
              key={group.key}
              items={group.tabs}
              value={shownTab}
              onChange={setTab}
              label={group.label}
              className="cab-subtabs"
            />
          ) : null}
        </nav>

        {loadError && seePeople ? (
          <p className="cab-error fin-fail" role="alert">
            {loadError}
          </p>
        ) : null}

        <FadeIn key={`tab-${shownTab}`} className="cab-body">
          {shownTab === "profile" ? (
            <ProfileTab
              me={me}
              onMe={onMe}
              departments={data ? departments : null}
              employees={data?.employees ?? null}
              onPeopleChanged={() => void load()}
            />
          ) : null}
          {shownTab === "access" ? <MyAccess me={me} /> : null}
          {shownTab === "sessions" ? <SessionsList /> : null}
          {shownTab === "actions" ? (
            <ActionFeed fixed={{ user_id: me.user?.id }} onOpenContract={onOpenContract} />
          ) : null}
          {shownTab === "people" ? (
            data ? (
              <PeopleTab
                me={me}
                departments={departments}
                employees={data.employees}
                department={department}
                onDepartment={setDepartment}
                onChanged={() => void load()}
                onDepartmentRights={(id) => {
                  setRightsDept(id);
                  setTab("rights");
                }}
                openId={openId}
                onOpen={setOpenId}
              />
            ) : (
              <p className="cab-wait">Читаем сотрудников…</p>
            )
          ) : null}
          {shownTab === "rights" ? (
            departments.length === 0 ? (
              <p className="cab-empty">Отделов пока нет. Отдел заводится во вкладке «Сотрудники».</p>
            ) : (
              <div className="cab-rights-wrap">
                <FilterChips
                  items={departments.map((d) => ({ key: d.id, label: d.code }))}
                  value={pickedRightsDept}
                  onChange={setRightsDept}
                  label="Отдел"
                />
                {pickedRightsDept ? (
                  <>
                    <p className="cab-rights-head">
                      {departments.find((d) => d.id === pickedRightsDept)?.title} · права отдела
                    </p>
                    <RightsMatrix
                      kind="department"
                      id={pickedRightsDept}
                      me={me}
                      readOnly={!managePeople || headOnly(me)}
                    />
                  </>
                ) : null}
                {isAdmin(me) ? null : (
                  <p className="cab-note fin-soft">Права своего отдела меняет администратор.</p>
                )}
              </div>
            )
          ) : null}
          {shownTab === "trash" ? <TrashTab /> : null}
          {shownTab === "restore" ? <RestoreTab /> : null}
          {shownTab === "audit" ? (
            <ActionFeed full people={data?.employees ?? []} onOpenContract={onOpenContract} />
          ) : null}
        </FadeIn>
      </FadeIn>
    </div>
  );
}
