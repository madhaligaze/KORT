"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import {
  type AccessCatalog,
  type AccessLevel,
  type ContractScope,
  type Grant,
  type GrantChange,
  type Me,
  type OwnEntity,
  type SubjectAccess,
  contractsApi,
  peopleApi,
} from "@/components/finance/api";
import { grantCap, headOnly, isAdmin } from "@/components/finance/access";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { SelectLine } from "@/components/finance/ui/select-line";

/**
 * Права галочками — только не галочками (фронт-план, 6.9 «Люди · Права»).
 *
 * Уровень выбирается текстом в строку: «Нет · Видит · Правит». Два флажка
 * «видит» и «правит» допускали бы «правит, но не видит». Изменение уходит
 * сразу; под строкой прочерчивается линия сохранения, отказ — текстом.
 *
 * Режим отдела — одна колонка. Режим человека (карточка сотрудника →
 * «Доступ») — «у отдела» мелкой строкой под названием, «Лично» с первой
 * позицией «Как у отдела» и «Итог». Администратор и владелец видят вместо
 * матрицы одну строку: у них записей прав нет, они видят всё.
 *
 * Кто сам не администратор, раздаёт права не выше своих (29.09.2026): выше
 * своего уровень виден, но не выбирается — подсказка говорит почему. Сервер
 * держит то же правило (`check_grant`). Начальник отдела «Сотрудники и
 * права» не раздаёт вовсе: начальника назначает администратор — строкой
 * «Начальник» в правах отдела.
 */
type Kind = "department" | "employee";
type Choice = AccessLevel | "inherit";

const LEVEL_WORDS: Record<AccessLevel, string> = { none: "Нет", view: "Видит", edit: "Правит" };
const FIELD_WORDS: Record<AccessLevel, string> = { none: "Скрыто", view: "Видит", edit: "Правит" };
const ROW_WORDS = { all: "все", department: "своего отдела", own: "где ответственный" } as const;
const PEOPLE_WORDS = { all: "всех", department: "своего отдела" } as const;
const ROW_RANK = { own: 0, department: 1, all: 2 } as const;
const RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2 };
const ABOVE = "Выше ваших прав — открывает администратор";

let catalogCache: Promise<AccessCatalog> | null = null;
export function loadCatalog(): Promise<AccessCatalog> {
  if (!catalogCache) {
    catalogCache = peopleApi.access.catalog().catch((exc) => {
      catalogCache = null;
      throw exc;
    });
  }
  return catalogCache;
}

export function LevelSwitch({
  value,
  levels,
  words = LEVEL_WORDS,
  inherit,
  onChange,
  label,
  disabled,
  cap = "edit",
}: {
  value: Choice;
  levels: AccessLevel[];
  words?: Record<AccessLevel, string>;
  /** Есть — первой позицией «Как у отдела». */
  inherit?: boolean;
  onChange: (next: Choice) => void;
  label: string;
  disabled?: boolean;
  /** Выше этого уровня выбрать нельзя: раздающий сам не выше. */
  cap?: AccessLevel;
}) {
  const items = [
    ...(inherit ? [{ key: "inherit" as Choice, label: "Как у отдела" }] : []),
    ...levels.map((level) => ({
      key: level as Choice,
      label: words[level],
      disabled: RANK[level] > RANK[cap],
      title: RANK[level] > RANK[cap] ? ABOVE : undefined,
    })),
  ];
  return (
    <SelectLine
      items={items}
      value={value}
      onChange={onChange}
      role="radiogroup"
      label={label}
      size="sm"
      disabled={disabled}
      className="cab-level"
    />
  );
}

type RowState = { sending?: boolean; error?: string };

/**
 * Наборы прав: девятнадцать строк по одной на каждого нового человека —
 * работа, которую никто не доделывает, и сотрудник входит в пустой кабинет.
 * Набор ставит уровни по всем разделам разом; поля договора не трогает.
 * Уровень выше возможного для раздела урезается до возможного (отчёты —
 * только «видит»).
 */
type Preset = { key: string; title: string; levels: (resource: string) => AccessLevel | null };

const MONEY_EDIT = new Set(["journal", "table", "calendar", "invoices", "recurrences", "import", "sheets", "dictionaries", "rules"]);

const PRESETS: Preset[] = [
  { key: "contracts", title: "Договоры", levels: (r) => (r === "contracts" ? "edit" : "none") },
  {
    key: "money",
    title: "Учёт денег",
    levels: (r) =>
      MONEY_EDIT.has(r) ? "edit" : r.startsWith("reports.") || r === "integrations" || r === "contracts" ? "view" : "none",
  },
  { key: "view", title: "Только просмотр", levels: (r) => (r === "people" || r === "audit" ? "none" : "view") },
  // Весь учёт: людей и журнал действий набор не открывает — это решение о
  // начальнике и администраторе, а не об отделе.
  { key: "all", title: "Все разделы", levels: (r) => (r === "people" || r === "audit" ? "none" : "edit") },
];

export function RightsMatrix({
  kind,
  id,
  me,
  readOnly = false,
  onChanged,
}: {
  kind: Kind;
  id: string;
  /** Кто смотрит: не администратор раздаёт не выше своего. */
  me?: Me | null;
  readOnly?: boolean;
  /** Права записаны — карточка пересчитывает «разделов не открыто». */
  onChanged?: (data: SubjectAccess) => void;
}) {
  const [catalog, setCatalog] = useState<AccessCatalog | null>(null);
  const [data, setData] = useState<SubjectAccess | null>(null);
  const [entities, setEntities] = useState<OwnEntity[]>([]);
  const [departments, setDepartments] = useState<{ id: string; code: string; title: string }[]>([]);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [pickEntities, setPickEntities] = useState(false);
  const [preset, setPreset] = useState<Preset | "inherit" | "none" | null>(null);
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetError, setPresetError] = useState("");
  const [headBusy, setHeadBusy] = useState("");
  const [headError, setHeadError] = useState("");
  const admin = isAdmin(me);
  const head = headOnly(me);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    Promise.all([loadCatalog(), peopleApi.access.get(kind, id), contractsApi.schema().catch(() => null)])
      .then(([nextCatalog, nextData, schema]) => {
        if (!alive) return;
        setCatalog(nextCatalog);
        setData(nextData);
        setEntities(schema?.own_entities ?? []);
        setDepartments(schema?.departments ?? []);
      })
      .catch((exc) => alive && setError(exc instanceof Error ? exc.message : "Права не прочитались"));
    return () => {
      alive = false;
    };
  }, [kind, id]);

  const save = useCallback(
    async (resource: string, change: GrantChange) => {
      setRows((prev) => ({ ...prev, [resource]: { sending: true } }));
      try {
        const next = await peopleApi.access.put(kind, id, { [resource]: change });
        setData(next);
        onChanged?.(next);
        setRows((prev) => ({ ...prev, [resource]: {} }));
      } catch (exc) {
        setRows((prev) => ({
          ...prev,
          [resource]: { error: exc instanceof Error ? exc.message : "Не сохранилось" },
        }));
      }
    },
    [kind, id, onChanged],
  );

  const applyPreset = useCallback(async () => {
    if (!catalog || !preset) return;
    const changes: Record<string, GrantChange> = {};
    for (const item of catalog.resources) {
      // Начальник отдела «Сотрудники и права» не раздаёт — набор их не трогает.
      if (head && item.key === "people") continue;
      if (preset === "inherit") {
        changes[item.key] = null;
        continue;
      }
      const wanted = preset === "none" ? "none" : preset.levels(item.key);
      if (wanted === null) continue;
      const top = item.levels.reduce<AccessLevel>((best, level) => (RANK[level] > RANK[best] ? level : best), "none");
      // Не выше возможного у раздела и не выше своих прав.
      const cap = grantCap(me, item.key);
      const bounded = RANK[wanted] > RANK[top] ? top : wanted;
      changes[item.key] = RANK[bounded] > RANK[cap] ? cap : bounded;
    }
    setPresetBusy(true);
    setPresetError("");
    try {
      const next = await peopleApi.access.put(kind, id, changes);
      setData(next);
      onChanged?.(next);
      setPreset(null);
    } catch (exc) {
      setPresetError(exc instanceof Error ? exc.message : "Набор не записался");
      setPreset(null);
    } finally {
      setPresetBusy(false);
    }
  }, [catalog, preset, kind, id, onChanged, me, head]);

  const groups = useMemo(() => {
    const out: { title: string; items: AccessCatalog["resources"] }[] = [];
    for (const item of catalog?.resources ?? []) {
      const last = out[out.length - 1];
      if (last && last.title === item.group) last.items.push(item);
      else out.push({ title: item.group, items: [item] });
    }
    return out;
  }, [catalog]);

  if (error) return <p className="cab-error fin-fail">{error}</p>;
  if (!catalog || !data) return <p className="cab-wait">Читаем права…</p>;
  if (data.subject.admin) {
    return <p className="cab-admin-line">Администратор видит и правит всё.</p>;
  }

  const person = kind === "employee";
  const own = data.grants;
  const dept = data.department_grants ?? {};
  const deptTitle = data.subject.department?.code ?? "";
  /** У человека без отдела «у отдела: Нет» читалось как решение отдела, которого нет. */
  const noDept = person && !data.subject.department;

  const choiceOf = (resource: string): Choice => {
    const grant = own[resource];
    if (person) return grant ? grant.level : noDept ? (data.effective[resource] ?? "none") : "inherit";
    // Поле договора без записи — «как у договоров», а не «скрыто».
    if (!grant && resource.startsWith("contracts.field.")) return data.effective[resource] ?? contractsLevel;
    return grant?.level ?? "none";
  };

  const contractsGrant: Grant | undefined = own.contracts ?? (person ? dept.contracts : undefined);
  const scopeInherited = person && !own.contracts;
  const scope: ContractScope = contractsGrant?.scope ?? {};
  const contractsLevel = data.effective.contracts ?? "none";

  const setScope = (next: ContractScope) => {
    const level = own.contracts?.level ?? (person ? dept.contracts?.level : undefined) ?? "view";
    void save("contracts", {
      level,
      scope: { rows: scope.rows ?? "all", entities: scope.entities ?? [], departments: scope.departments ?? [], ...next },
    });
  };

  const renderRow = (resource: string, title: string, levels: AccessLevel[], words = LEVEL_WORDS, note?: string) => {
    const state = rows[resource] ?? {};
    const deptLevel = dept[resource]?.level ?? (resource.startsWith("contracts.field.") ? null : "none");
    return (
      <div className="cab-right" key={resource} data-sending={state.sending ? "true" : undefined}>
        <span className="cab-right-title">
          {title}
          {note ? <span className="annot cab-right-note">{note}</span> : null}
          {person && !noDept ? (
            <span className="cab-right-sub fin-soft">
              у отдела{deptTitle ? ` ${deptTitle}` : ""}: {deptLevel ? words[deptLevel as AccessLevel] : "как у договоров"}
            </span>
          ) : null}
        </span>
        <LevelSwitch
          value={choiceOf(resource)}
          levels={levels}
          words={words}
          inherit={person && !noDept}
          label={title}
          disabled={readOnly || state.sending || (head && resource === "people")}
          cap={grantCap(me, resource)}
          onChange={(next) => void save(resource, next === "inherit" ? null : next)}
        />
        {person ? (
          <span className="cab-right-total" aria-label="Итог">
            {words[(data.effective[resource] ?? "none") as AccessLevel]}
          </span>
        ) : null}
        <span className="cab-trace" aria-hidden="true" />
        {state.error ? <span className="cab-line-error fin-fail">{state.error}</span> : null}
      </div>
    );
  };

  const presetTitle =
    preset === "inherit" ? "Как у отдела" : preset === "none" ? "Снять всё" : preset ? preset.title : "";

  return (
    <div className="cab-rights" data-person={person ? "true" : undefined}>
      {readOnly ? null : (
        <div className="cab-presets">
          <span className="eyebrow">Набор</span>
          {PRESETS.map((item) => (
            <button key={item.key} type="button" className="fin-link-btn" disabled={presetBusy} onClick={() => setPreset(item)}>
              {item.title}
            </button>
          ))}
          <button
            type="button"
            className="fin-link-btn"
            disabled={presetBusy}
            onClick={() => setPreset(person && !noDept ? "inherit" : "none")}
          >
            {person && !noDept ? "Как у отдела" : "Снять всё"}
          </button>
          {presetError ? <span className="cab-line-error fin-fail">{presetError}</span> : null}
        </div>
      )}
      <ConfirmDialog
        open={preset !== null}
        title={`Набор прав · ${presetTitle}`}
        text="Права по всем разделам заменятся набором. Поля договора останутся как есть."
        confirm="Заменить"
        busy={presetBusy}
        onConfirm={() => void applyPreset()}
        onCancel={() => setPreset(null)}
      />
      {!person && data.members?.length ? (
        // Начальник — право «Сотрудники и права» своего отдела, записанное
        // человеку лично; здесь оно ставится одним нажатием. Заместителей
        // может быть несколько.
        <div className="cab-right cab-right-sub-row cab-heads">
          <span className="cab-right-title">
            Начальник отдела
            <span className="cab-right-sub fin-soft">заводит людей в отдел, правит их доступ не выше своего, удаляет</span>
          </span>
          <span className="cab-entity-list">
            {data.members
              .filter((member) => !member.admin)
              .map((member) => {
                const on = data.heads?.includes(member.id) ?? false;
                return (
                  <button
                    key={member.id}
                    type="button"
                    className="cab-toggle"
                    aria-pressed={on}
                    disabled={readOnly || !admin || headBusy !== ""}
                    title={admin ? undefined : "Начальника назначает администратор"}
                    onClick={async () => {
                      setHeadBusy(member.id);
                      setHeadError("");
                      try {
                        await peopleApi.access.put("employee", member.id, {
                          people: on ? null : { level: "edit", scope: { rows: "department" } },
                        });
                        setData(await peopleApi.access.get("department", id));
                      } catch (exc) {
                        setHeadError(exc instanceof Error ? exc.message : "Не записалось");
                      } finally {
                        setHeadBusy("");
                      }
                    }}
                  >
                    {member.name}
                  </button>
                );
              })}
          </span>
          {headError ? <span className="cab-line-error fin-fail">{headError}</span> : null}
        </div>
      ) : null}
      {person ? (
        <div className="cab-right cab-right-head" aria-hidden="true">
          <span />
          <span className="eyebrow">Лично</span>
          <span className="eyebrow cab-right-total">Итог</span>
        </div>
      ) : null}
      {groups.map((group) => (
        <Fragment key={group.title}>
          <p className="cab-rights-group eyebrow">{group.title}</p>
          {group.items.map((item) => (
            <Fragment key={item.key}>
              {renderRow(item.key, item.title, item.levels, LEVEL_WORDS, item.note)}
              {item.key === "people" && (data.effective.people ?? "none") !== "none" ? (
                <div className="cab-right-more">
                  <div className="cab-right cab-right-sub-row">
                    <span className="cab-right-title">
                      Чьих сотрудников
                      {person && !own.people ? <span className="cab-right-sub fin-soft">как у отдела</span> : null}
                    </span>
                    <SelectLine
                      items={(catalog.people_scopes ?? ["all", "department"]).map((key) => ({
                        key,
                        label: PEOPLE_WORDS[key],
                      }))}
                      value={((own.people ?? (person ? dept.people : undefined))?.scope?.rows as "department" | undefined) ?? "all"}
                      onChange={(rowsScope) => {
                        const level = own.people?.level ?? (person ? dept.people?.level : undefined) ?? "view";
                        void save("people", { level, scope: { rows: rowsScope } });
                      }}
                      role="radiogroup"
                      label="Чьих сотрудников"
                      size="sm"
                      disabled={readOnly || !admin || rows.people?.sending}
                      className="cab-level"
                    />
                  </div>
                </div>
              ) : null}
              {item.key === "contracts" && contractsLevel !== "none" ? (
                <div className="cab-right-more">
                  <div className="cab-right cab-right-sub-row">
                    <span className="cab-right-title">
                      Какие договоры
                      {scopeInherited ? <span className="cab-right-sub fin-soft">как у отдела</span> : null}
                    </span>
                    <SelectLine
                      items={(catalog.row_scopes ?? ["all", "department", "own"]).map((key) => {
                        const wider = !admin && ROW_RANK[key] > ROW_RANK[me?.contracts_scope?.rows ?? "all"];
                        return { key, label: ROW_WORDS[key], disabled: wider, title: wider ? ABOVE : undefined };
                      })}
                      value={scope.rows ?? "all"}
                      onChange={(rowsScope) => setScope({ rows: rowsScope })}
                      role="radiogroup"
                      label="Какие договоры"
                      size="sm"
                      disabled={readOnly || scopeInherited || rows.contracts?.sending}
                      className="cab-level"
                    />
                    {noDept && scope.rows === "department" ? (
                      <span className="cab-line-error fin-wait">Отдела нет — договоров своего отдела не увидит</span>
                    ) : null}
                  </div>
                  {(scope.rows ?? "all") !== "all" && departments.length ? (
                    // Другие отделы — только просмотр (28.09.2026): юристу ЮО
                    // показать договоры НО, не давая их править. Правку такого
                    // договора сервер не примет, лист и карточка её не предложат.
                    <div className="cab-right cab-right-sub-row">
                      <span className="cab-right-title">
                        Ещё видит отделы
                        <span className="cab-right-sub fin-soft">только просмотр</span>
                      </span>
                      <span className="cab-entity-list">
                        {departments
                          // Свой отдел не предлагается: его договоры и так видны.
                          .filter((department) =>
                            person ? data.subject.department?.id !== department.id : data.subject.id !== department.id,
                          )
                          .map((department) => {
                            const on = scope.departments?.includes(department.id) ?? false;
                            // Не администратор открывает только те отделы, что видит сам.
                            const closed =
                              !admin &&
                              (me?.contracts_scope?.rows ?? "all") !== "all" &&
                              !(me?.contracts_scope?.departments ?? []).includes(department.id);
                            return (
                              <button
                                key={department.id}
                                type="button"
                                className="cab-toggle"
                                aria-pressed={on}
                                title={
                                  closed && !on
                                    ? ABOVE
                                    : department.title && department.title !== department.code
                                      ? department.title
                                      : undefined
                                }
                                disabled={readOnly || scopeInherited || rows.contracts?.sending || (closed && !on)}
                                onClick={() => {
                                  const current = scope.departments ?? [];
                                  setScope({
                                    departments: on
                                      ? current.filter((item) => item !== department.id)
                                      : [...current, department.id],
                                  });
                                }}
                              >
                                {department.code || department.title}
                              </button>
                            );
                          })}
                      </span>
                    </div>
                  ) : null}
                  <div className="cab-right cab-right-sub-row">
                    <span className="cab-right-title">Какими юрлицами</span>
                    <span className="cab-entities">
                      <SelectLine
                        items={[
                          { key: "all", label: "все" },
                          { key: "pick", label: "выбрать…" },
                        ]}
                        value={(scope.entities?.length ?? 0) > 0 || pickEntities ? "pick" : "all"}
                        onChange={(next) => {
                          if (next === "all") {
                            setPickEntities(false);
                            setScope({ entities: [] });
                          } else setPickEntities(true);
                        }}
                        role="radiogroup"
                        label="Какими юрлицами"
                        size="sm"
                        disabled={readOnly || scopeInherited || entities.length === 0}
                        className="cab-level"
                      />
                      {(scope.entities?.length ?? 0) > 0 || pickEntities ? (
                        <span className="cab-entity-list">
                          {entities.map((entity) => {
                            const on = scope.entities?.includes(entity.id) ?? false;
                            return (
                              <button
                                key={entity.id}
                                type="button"
                                className="cab-toggle"
                                aria-pressed={on}
                                disabled={readOnly || scopeInherited}
                                onClick={() => {
                                  const current = scope.entities ?? [];
                                  setScope({
                                    entities: on ? current.filter((item) => item !== entity.id) : [...current, entity.id],
                                  });
                                }}
                              >
                                {entity.code || entity.name}
                              </button>
                            );
                          })}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  {catalog.fields.length > 0 ? (
                    <>
                      <button
                        type="button"
                        className="fin-link-btn cab-right-fold"
                        aria-expanded={fieldsOpen}
                        onClick={() => setFieldsOpen((value) => !value)}
                      >
                        Поля договора {fieldsOpen ? "⌃" : "⌄"}
                      </button>
                      {fieldsOpen
                        ? catalog.fields.map((field) => renderRow(field.key, field.title, field.levels, FIELD_WORDS))
                        : null}
                    </>
                  ) : null}
                  {rows.contracts?.error ? <p className="cab-line-error fin-fail">{rows.contracts.error}</p> : null}
                </div>
              ) : null}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
