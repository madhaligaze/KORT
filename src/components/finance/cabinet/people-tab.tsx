"use client";

import { useMemo, useState } from "react";

import { ChoiceSelect } from "@/components/choice-select";
import { can } from "@/components/finance/access";
import { type Department, type EmployeeRow, type Me, peopleApi } from "@/components/finance/api";
import { EmployeeCard } from "@/components/finance/cabinet/employee-card";
import { employeeStatus, sortPeople } from "@/components/finance/cabinet/status";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { PhoneInput, formatPhone, phoneValue } from "@/components/finance/ui/phone-input";
import { SelectLine } from "@/components/finance/ui/select-line";
import { useSessionDrop, useSessionState } from "@/components/session-state";

/**
 * «Люди · Сотрудники» (фронт-план, 6.9).
 *
 * Отделы — вкладками со счётчиками, как отборы реестра. **Порядок — это
 * сообщение:** сначала запросы и неверные пароли, потом «в системе», потом
 * остальные по давности входа, ждущие пароль, без доступа, с закрытым
 * входом. Строка с запросом встаёт наверх на следующем опросе и получает фон
 * выбранной строки — это та «подсветка», что записана в плане.
 *
 * «+ Сотрудник» и «+ Отдел» раскрывают форму первой строкой списка, без окна.
 */
const ALL = "__all";
const NONE = "__none";

export function PeopleTab({
  me,
  departments,
  employees,
  department,
  onDepartment,
  onChanged,
  onDepartmentRights,
  openId,
  onOpen,
}: {
  me: Me;
  departments: Department[];
  employees: EmployeeRow[];
  department: string;
  onDepartment: (key: string) => void;
  onChanged: () => void;
  onDepartmentRights: (id: string) => void;
  openId: string | null;
  onOpen: (id: string | null) => void;
}) {
  const manage = can(me, "people", "edit");
  // Открытая форма и набранное в ней переживают перезагрузку (`session-state.tsx`).
  const [adding, setAdding] = useSessionState<"person" | "department" | null>("people.adding", null);
  const [renaming, setRenaming] = useSessionState("people.renaming", false);
  // Ответ правки показывается сразу, до перечитывания списка; пришёл свежий
  // список — он главнее.
  // Правки привязаны к версии списка, от которой сделаны: новый список делает
  // их устаревшими сам, без эффекта-сброса.
  const [patch, setPatch] = useState<{ source: EmployeeRow[]; rows: Record<string, EmployeeRow> }>({
    source: employees,
    rows: {},
  });
  const patched = patch.source === employees ? patch.rows : null;
  const setPatched = (row: EmployeeRow) =>
    setPatch((prev) => ({
      source: employees,
      rows: { ...(prev.source === employees ? prev.rows : {}), [row.id]: row },
    }));
  /** Только что заведённый — его карточка открывается сразу, до перечитывания списка. */
  const [created, setCreated] = useState<EmployeeRow | null>(null);

  const rows = useMemo(() => {
    const list = employees.map((row) => patched?.[row.id] ?? row);
    if (created && !list.some((row) => row.id === created.id)) list.push(created);
    return list;
  }, [employees, patched, created]);

  const tabs = useMemo(() => {
    const items = [{ key: ALL, label: "Все", count: rows.length }];
    for (const item of departments) {
      items.push({ key: item.id, label: item.code, count: rows.filter((row) => row.department_id === item.id).length });
    }
    const loose = rows.filter((row) => !row.department_id).length;
    if (loose > 0) items.push({ key: NONE, label: "Без отдела", count: loose });
    return items;
  }, [departments, rows]);

  const shown = useMemo(() => {
    const picked =
      department === ALL
        ? rows
        : department === NONE
          ? rows.filter((row) => !row.department_id)
          : rows.filter((row) => row.department_id === department);
    return sortPeople(picked);
  }, [rows, department]);

  const current = departments.find((item) => item.id === department) ?? null;
  const openIndex = openId ? shown.findIndex((row) => row.id === openId) : -1;
  const opened = openId ? (rows.find((row) => row.id === openId) ?? null) : null;

  return (
    <div className="cab-people">
      <div className="cab-people-bar">
        <SelectLine items={tabs} value={department} onChange={onDepartment} label="Отделы" className="cab-people-tabs" />
        {manage ? (
          <span className="cab-people-add">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setAdding("person")}>
              + Сотрудник
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setAdding("department")}>
              + Отдел
            </button>
          </span>
        ) : null}
      </div>

      {current ? (
        <div className="cab-dept-line">
          {renaming ? (
            <DepartmentForm
              initial={current}
              onCancel={() => setRenaming(false)}
              onSaved={(item) => {
                setRenaming(false);
                // Отдел удалён — вкладка возвращается ко всем, а не к пустому.
                if (!item) onDepartment(ALL);
                onChanged();
              }}
            />
          ) : (
            <>
              <span className="cab-dept-title">
                <span className="fin-mono">{current.code}</span> · {current.title}
              </span>
              {can(me, "people", "view") ? (
                <button type="button" className="fin-link-btn cab-dept-act" onClick={() => onDepartmentRights(current.id)}>
                  Права отдела
                </button>
              ) : null}
              {manage ? (
                <button type="button" className="fin-link-btn cab-dept-act" onClick={() => setRenaming(true)}>
                  Переименовать
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {adding === "person" ? (
        <PersonForm
          departments={departments}
          department={current?.id ?? ""}
          onCancel={() => setAdding(null)}
          onSaved={(row) => {
            setAdding(null);
            onChanged();
            // С доступом — следующий шаг в карточке: приглашение и права.
            if (row.account) {
              setCreated(row);
              onOpen(row.id);
            }
          }}
        />
      ) : null}
      {adding === "department" ? (
        <DepartmentForm
          onCancel={() => setAdding(null)}
          onSaved={(item) => {
            setAdding(null);
            onChanged();
            if (item) onDepartment(item.id);
          }}
        />
      ) : null}

      {shown.length === 0 && adding === null ? <p className="cab-empty">В отделе пока никого.</p> : null}

      <div className="cab-list" role="list">
        {shown.map((row) => {
          const status = employeeStatus(row);
          return (
            <button
              key={row.id}
              type="button"
              role="listitem"
              className="cab-row cab-person"
              data-request={status.rank <= 1 ? "true" : undefined}
              onClick={() => onOpen(row.id)}
            >
              <span className="cab-row-main">{row.full_name}</span>
              <span className="cab-person-job fin-soft">{row.job_title || "—"}</span>
              <span className="cab-person-phone fin-mono fin-soft">{row.phone ? formatPhone(row.phone) : "—"}</span>
              <span
                className={`cab-person-status ${status.tone === "fail" ? "fin-fail" : status.tone === "wait" ? "fin-wait" : ""}`}
                data-tone={status.tone || undefined}
              >
                {status.text}
              </span>
            </button>
          );
        })}
      </div>

      {manage ? (
        <button type="button" className="creg-fab only-mobile cab-fab" onClick={() => setAdding("person")}>
          + Сотрудник
        </button>
      ) : null}

      <EmployeeCard
        open={opened !== null}
        employee={opened}
        departments={departments}
        me={me}
        onClose={() => onOpen(null)}
        onPrev={openIndex > 0 ? () => onOpen(shown[openIndex - 1].id) : undefined}
        onNext={openIndex >= 0 && openIndex < shown.length - 1 ? () => onOpen(shown[openIndex + 1].id) : undefined}
        onChanged={(row) => {
          setPatched(row);
          onChanged();
        }}
      />
    </div>
  );
}

function PersonForm({
  departments,
  department,
  onCancel,
  onSaved,
}: {
  departments: Department[];
  department: string;
  onCancel: () => void;
  onSaved: (row: EmployeeRow) => void;
}) {
  const dropDraft = useSessionDrop();
  const cancel = () => {
    dropDraft("people.person");
    onCancel();
  };
  const [name, setName] = useSessionState("people.person.name", "");
  const [digits, setDigits] = useSessionState("people.person.phone", "");
  const [dept, setDept] = useSessionState("people.person.dept", department);
  const [job, setJob] = useSessionState("people.person.job", "");
  // Номер — это логин и ничего больше: вписанный номер сам включает доступ.
  // Раньше переключатель стоял выключенным, «Добавить» было доступно, и номер
  // молча пропадал — человек заведён, а войти не может (26.09, «Асхат»).
  const [accessChoice, setAccessChoice] = useSessionState<boolean | null>("people.person.access", null);
  const access = accessChoice ?? digits.length > 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const ready = name.trim().length >= 2 && (!access || digits.length === 10);

  return (
    <form
      className="cab-add"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!ready || busy) return;
        setBusy(true);
        setError("");
        try {
          const row = await peopleApi.employees.create({
            full_name: name.trim(),
            phone: access && digits ? phoneValue(digits) : undefined,
            department_id: dept || null,
            job_title: job.trim(),
            access,
          });
          dropDraft("people.person");
          onSaved(row);
        } catch (exc) {
          setError(exc instanceof Error ? exc.message : "Не добавилось");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="cab-add-grid">
        <label className="auth-field">
          <span className="eyebrow">ФИО</span>
          <input className="input-field" value={name} onChange={(e) => setName(e.target.value)} autoFocus autoComplete="off" />
        </label>
        <label className="auth-field">
          <span className="eyebrow">Телефон</span>
          <PhoneInput value={digits} onChange={setDigits} />
        </label>
        <label className="auth-field">
          <span className="eyebrow">Отдел</span>
          <ChoiceSelect className="input-field" value={dept} onChange={setDept} placeholder="Без отдела" clearable>
            {departments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} · {item.title}
              </option>
            ))}
          </ChoiceSelect>
        </label>
        <label className="auth-field">
          <span className="eyebrow">Должность</span>
          <input className="input-field" value={job} onChange={(e) => setJob(e.target.value)} autoComplete="off" />
        </label>
      </div>
      <div className="cab-add-foot">
        <button
          type="button"
          className="cab-toggle"
          aria-pressed={access}
          onClick={() => setAccessChoice(!access)}
        >
          Доступ в систему
        </button>
        {access && digits.length !== 10 ? <span className="auth-hint">Для входа нужен телефон.</span> : null}
        {!access && digits.length > 0 ? <span className="auth-hint">Без доступа номер не сохранится.</span> : null}
        <span className="cab-add-actions">
          <button type="button" className="btn-ghost btn-sm" onClick={cancel}>
            Отмена
          </button>
          <button type="submit" className="btn-primary btn-sm" disabled={!ready || busy}>
            {busy ? "Добавляем…" : "Добавить"}
          </button>
        </span>
      </div>
      {error ? (
        <p className="cab-error fin-fail" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function DepartmentForm({
  initial,
  onCancel,
  onSaved,
}: {
  initial?: Department;
  onCancel: () => void;
  onSaved: (item: Department | null) => void;
}) {
  const draft = `people.dept.${initial?.id ?? "new"}`;
  const dropDraft = useSessionDrop();
  const cancel = () => {
    dropDraft(draft);
    onCancel();
  };
  const [code, setCode] = useSessionState(`${draft}.code`, initial?.code ?? "");
  const [title, setTitle] = useSessionState(`${draft}.title`, initial?.title ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [asking, setAsking] = useState(false);
  return (
    <form
      className="cab-add cab-add-dept"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!code.trim() || busy) return;
        setBusy(true);
        setError("");
        try {
          const item = initial
            ? await peopleApi.departments.update(initial.id, { code: code.trim(), title: title.trim() })
            : await peopleApi.departments.create({ code: code.trim(), title: title.trim() });
          dropDraft(draft);
          onSaved(item);
        } catch (exc) {
          setError(exc instanceof Error ? exc.message : "Не сохранилось");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="auth-field cab-add-code">
        <span className="eyebrow">Код</span>
        <input
          className="input-field fin-mono"
          value={code}
          maxLength={12}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
          autoComplete="off"
          placeholder="ЮО"
        />
      </label>
      <label className="auth-field cab-add-title">
        <span className="eyebrow">Название</span>
        <input
          className="input-field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoComplete="off"
          placeholder="Юридический отдел"
        />
      </label>
      <span className="cab-add-actions">
        {initial ? (
          <button type="button" className="fin-link-btn cab-dept-remove" disabled={busy} onClick={() => setAsking(true)}>
            Удалить отдел
          </button>
        ) : null}
        <button type="button" className="btn-ghost btn-sm" onClick={cancel}>
          Отмена
        </button>
        <button type="submit" className="btn-primary btn-sm" disabled={!code.trim() || busy}>
          {initial ? "Сохранить" : "Добавить"}
        </button>
      </span>
      <ConfirmDialog
        open={asking}
        title={initial ? `Удалить отдел ${initial.code}?` : ""}
        text="Отдел уйдёт в корзину. Отдел с сотрудниками не удаляется — сначала переведите их в другой отдел. Вернуть — из корзины в личном кабинете."
        confirm="Удалить"
        danger
        busy={busy}
        onCancel={() => setAsking(false)}
        onConfirm={async () => {
          if (!initial) return;
          setAsking(false);
          setBusy(true);
          setError("");
          try {
            await peopleApi.departments.update(initial.id, { archived: true });
            dropDraft(draft);
            onSaved(null);
          } catch (exc) {
            setError(exc instanceof Error ? exc.message : "Не удалился");
          } finally {
            setBusy(false);
          }
        }}
      />
      {error ? (
        <p className="cab-error fin-fail" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

export const PEOPLE_ALL = ALL;
