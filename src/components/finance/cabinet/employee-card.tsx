"use client";

import { useEffect, useState } from "react";

import { can, headOnly, isOwner } from "@/components/finance/access";
import { type Department, type EmployeeRow, type Me, type SubjectAccess, peopleApi } from "@/components/finance/api";
import { ActionFeed } from "@/components/finance/cabinet/action-feed";
import { EditLine } from "@/components/finance/cabinet/edit-line";
import { RightsMatrix } from "@/components/finance/cabinet/rights";
import { SessionsList } from "@/components/finance/cabinet/sessions-list";
import { ROLE_TITLES, employeeStatus, stamp } from "@/components/finance/cabinet/status";
import { departmentLabel, shortName } from "@/components/finance/format";
import { CardLayer } from "@/components/finance/ui/card-layer";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { PhoneInput, formatPhone, phoneValue } from "@/components/finance/ui/phone-input";
import { SelectLine } from "@/components/finance/ui/select-line";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon } from "@/components/icons";
import { useSessionState } from "@/components/session-state";

/**
 * Карточка сотрудника - по центру, как карточка договора (фронт-план, 6.9).
 *
 * Статус - одна строка словами. Главной кнопкой становится то, что нужно
 * сейчас: «Сбросить пароль» при запросе, «Открыть доступ снова» при
 * истёкшем окне, «Открыть вход» у человека без доступа. Опасное - через
 * подтверждение, текст которого говорит последствие заранее.
 *
 * Администратор не видит «Сбросить пароль» у владельца и других
 * администраторов; пароль владельца сбрасывается только на сервере.
 *
 * Учётка ждёт пароль - главной становится «Скопировать приглашение»: вход
 * открыт, но человек об этом не знает, и спрашивать ему было не с чего
 * («откуда я знаю какой пароль», 26.09). Ссылка открывает вход сразу на
 * «Придумайте пароль» с номером.
 */
type Tab = "profile" | "access" | "sessions" | "actions";
type Confirm = "reset" | "block" | "end" | "close-access" | "archive" | null;

const WINDOW_HOURS = 72;

/** Открытых разделов у человека - без полей договора: они не раздел. */
function openSections(data: SubjectAccess): number {
  return Object.entries(data.effective).filter(([key, level]) => !key.startsWith("contracts.field.") && level !== "none")
    .length;
}

function inviteText(employee: EmployeeRow, company: string): string {
  const digits = employee.phone.replace(/\D/g, "").slice(-10);
  const link = `${window.location.origin}/?phone=${digits}`;
  const until = employee.account?.pending_until ? ` до ${stamp(employee.account.pending_until)}` : "";
  return [
    `Вам открыт вход в учёт${company ? ` «${company}»` : ""}.`,
    `Откройте ссылку и придумайте пароль${until}:`,
    link,
    `Логин - ваш номер ${formatPhone(employee.phone)}.`,
  ].join("\n");
}

export function EmployeeCard({
  employee,
  departments,
  me,
  open,
  onClose,
  onPrev,
  onNext,
  onChanged,
}: {
  employee: EmployeeRow | null;
  departments: Department[];
  me: Me;
  open: boolean;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onChanged: (row: EmployeeRow) => void;
}) {
  // Вкладка карточки и начатое «Открыть вход» переживают перезагрузку
  // (`session-state.tsx`). Форма входа - своя у каждого сотрудника: ключ
  // сменился - значение перечитано, сбрасывать её эффектом не нужно (эффект
  // стёр бы и восстановленное).
  const [tab, setTab] = useSessionState<Tab>("emp.tab", "profile");
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opening, setOpening] = useSessionState(`emp.${employee?.id ?? "none"}.opening`, false);
  const [digits, setDigits] = useSessionState(`emp.${employee?.id ?? "none"}.phone`, "");
  const [note, setNote] = useState("");
  /** Сколько разделов открыто; `null` - не спрашивали (нет учётки, админ). */
  const [sections, setSections] = useState<number | null>(null);

  useEffect(() => {
    setError("");
    setNote("");
    setConfirm(null);
    setSections(null);
  }, [employee?.id]);

  const accountRole = employee?.account?.role ?? null;
  const employeeId = employee?.id ?? null;
  useEffect(() => {
    if (!employeeId || accountRole !== "employee" || !can(me, "people", "view")) return;
    let alive = true;
    peopleApi.access
      .get("employee", employeeId)
      .then((data) => alive && setSections(openSections(data)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [employeeId, accountRole, me]);

  if (!employee) return null;

  const manage = can(me, "people", "edit");
  const owner = isOwner(me);
  const self = employee.account?.user_id === me.user?.id;
  const role = employee.account?.role ?? "employee";
  // Администратор не трогает владельца и других администраторов; себя -
  // через «Моё», а не через карточку.
  const touchable = manage && !self && (role === "employee" || (owner && role === "admin"));
  const status = employeeStatus(employee);
  const short = shortName(employee.full_name);
  const department = departments.find((item) => item.id === employee.department_id);
  const hasRequest = employee.requests.some((item) => item.kind === "password_reset_requested");
  const hasAccount = employee.account !== null;

  /** Строка итога берётся из ответа сервера, а не из того, что ожидали. */
  const act = async (
    action: () => Promise<EmployeeRow>,
    after?: (row: EmployeeRow) => string,
  ): Promise<boolean> => {
    setBusy(true);
    setError("");
    try {
      const row = await action();
      onChanged(row);
      setConfirm(null);
      if (after) setNote(after(row));
      return true;
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не получилось");
      setConfirm(null);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const windowEnd = stamp(new Date(Date.now() + WINDOW_HOURS * 3600 * 1000).toISOString());
  const waitingNote = (row: EmployeeRow) =>
    row.status === "pending" && row.account?.pending_until
      ? `ждёт пароль до ${stamp(row.account.pending_until)}`
      : row.status === "active"
        ? "вход открыт · пароль прежний"
        : employeeStatus(row).text;

  const copyInvite = async () => {
    const text = inviteText(employee, me.company?.title ?? "");
    try {
      await navigator.clipboard.writeText(text);
      setNote("приглашение скопировано");
    } catch {
      setError("Скопировать не получилось - браузер не дал доступ к буферу");
    }
  };
  const whatsapp = () => {
    const text = inviteText(employee, me.company?.title ?? "");
    const number = employee.phone.replace(/\D/g, "");
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  const actions: { key: string; label: string; primary?: boolean; run: () => void }[] = [];
  if (touchable) {
    if (!hasAccount) {
      actions.push({ key: "open", label: "Открыть вход", primary: true, run: () => setOpening(true) });
    } else if (employee.status === "pending_expired") {
      actions.push({ key: "reopen", label: "Открыть доступ снова", primary: true, run: () => setConfirm("reset") });
    } else if (employee.status === "blocked") {
      actions.push({
        key: "unblock",
        label: "Разблокировать",
        primary: true,
        run: () => void act(() => peopleApi.employees.unblock(employee.id)),
      });
    } else {
      if (employee.status === "pending" && employee.phone) {
        actions.push({ key: "invite", label: "Скопировать приглашение", primary: !hasRequest, run: () => void copyInvite() });
        actions.push({ key: "whatsapp", label: "WhatsApp", run: whatsapp });
      }
      actions.push({ key: "reset", label: "Сбросить пароль", primary: hasRequest, run: () => setConfirm("reset") });
      if (employee.status === "active") {
        actions.push({ key: "end", label: "Завершить сеансы", run: () => setConfirm("end") });
      }
      actions.push({ key: "block", label: "Заблокировать", run: () => setConfirm("block") });
    }
    actions.push({ key: "archive", label: "Удалить", run: () => setConfirm("archive") });
  }
  /** Почему кнопок нет - иначе пустая карточка выглядит сломанной. */
  const untouchable =
    manage && !self && hasAccount && !touchable
      ? role === "owner"
        ? "Учёткой владельца управляет только он сам"
        : "Администратором управляет владелец"
      : "";

  const dialogs: Record<Exclude<Confirm, null>, { title: string; text: string; confirm: string; run: () => void }> = {
    reset: {
      title: `Сбросить пароль · ${short}`,
      text: `Старый пароль перестанет действовать, открытые сеансы закроются. Задать новый можно до ${windowEnd}.`,
      confirm: "Сбросить",
      run: () => void act(() => peopleApi.employees.reset(employee.id), (row) => `пароль сброшен · ${waitingNote(row)}`),
    },
    archive: {
      title: `Удалить · ${short}`,
      text: "Человек уйдёт из списка в корзину, вход закроется. В договорах имя останется. Вернуть - из корзины в личном кабинете.",
      confirm: "Удалить",
      run: () =>
        void act(() => peopleApi.employees.archive(employee.id)).then((ok) => {
          if (ok) onClose();
        }),
    },
    block: {
      title: `Заблокировать вход · ${short}`,
      text: "Сеансы закроются, войти будет нельзя, пока вход не откроют снова.",
      confirm: "Заблокировать",
      run: () => void act(() => peopleApi.employees.block(employee.id)),
    },
    end: {
      title: `Завершить сеансы · ${short}`,
      text: "Все сеансы на всех устройствах закроются. Пароль останется прежним.",
      confirm: "Завершить",
      run: () => void act(() => peopleApi.employees.endSessions(employee.id)),
    },
    "close-access": {
      title: `Закрыть доступ · ${short}`,
      text: "Учётка перестанет открываться, сеансы закроются. В справочнике человек останется - например, ответственным в договорах.",
      confirm: "Закрыть доступ",
      run: () => void act(() => peopleApi.employees.update(employee.id, { access: false })),
    },
  };

  const save = (data: Record<string, unknown>) => async () => {
    const row = await peopleApi.employees.update(employee.id, data);
    onChanged(row);
  };

  // Сеансы владельца не видит никто, администратора - только владелец (сервер,
  // `people.employee_sessions`). Раньше вкладка стояла и отвечала «Сотрудник
  // не найден» о человеке, чья карточка открыта.
  const seesSessions = hasAccount && (self || (role !== "owner" && (role !== "admin" || owner)));
  const tabs: { key: Tab; label: string }[] = [
    { key: "profile", label: "Профиль" },
    ...(hasAccount ? [{ key: "access" as Tab, label: "Доступ" }] : []),
    ...(seesSessions ? [{ key: "sessions" as Tab, label: "Сеансы" }] : []),
    { key: "actions", label: "Действия" },
  ];
  const shownTab = tabs.some((item) => item.key === tab) ? tab : "profile";

  return (
    <CardLayer open={open} onClose={onClose} label={`Сотрудник ${employee.full_name}`}>
      <div className="card-top">
        <button type="button" className="fin-icon-btn" aria-label="Предыдущий сотрудник" disabled={!onPrev} onClick={onPrev}>
          <ArrowUpIcon size={16} />
        </button>
        <button type="button" className="fin-icon-btn" aria-label="Следующий сотрудник" disabled={!onNext} onClick={onNext}>
          <ArrowDownIcon size={16} />
        </button>
        <span className="card-top-num">Сотрудник</span>
        <span className="card-top-state" />
        <button type="button" className="fin-icon-btn" aria-label="Закрыть" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>

      <div className="card-body cab-card" key={employee.id}>
        <h2 className="card-title">{employee.full_name}</h2>
        <p className="cab-card-line fin-soft">
          {[employee.job_title, department?.code, employee.phone ? formatPhone(employee.phone) : ""]
            .filter(Boolean)
            .join(" · ") || "-"}
          {hasAccount && role !== "employee" ? <span className="annot cab-card-role">{ROLE_TITLES[role]}</span> : null}
        </p>

        <p className={`cab-card-status ${status.tone === "fail" ? "fin-fail" : status.tone === "wait" ? "fin-wait" : ""}`} data-tone={status.tone || undefined}>
          {note || status.text}
        </p>

        {actions.length > 0 ? (
          <div className="cab-card-actions">
            {actions.map((item) => (
              <button
                key={item.key}
                type="button"
                className={item.primary ? "btn-primary btn-sm" : "btn-ghost btn-sm"}
                disabled={busy}
                onClick={item.run}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
        {untouchable ? <p className="cab-card-note fin-soft">{untouchable}</p> : null}
        {sections === 0 && hasAccount && employee.status !== "blocked" ? (
          <p className="cab-card-note fin-wait">
            Разделов не открыто - войдёт в пустой кабинет ·{" "}
            <button type="button" className="fin-link-btn" onClick={() => setTab("access")}>
              Доступ
            </button>
          </p>
        ) : null}

        {opening ? (
          <form
            className="cab-open-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (digits.length !== 10) return;
              void act(
                () => peopleApi.employees.openAccount(employee.id, { phone: phoneValue(digits) }),
                waitingNote,
              ).then((ok) => ok && setOpening(false));
            }}
          >
            <label className="auth-field">
              <span className="eyebrow">Телефон для входа</span>
              <PhoneInput value={digits} onChange={setDigits} autoFocus />
            </label>
            <div className="cab-open-actions">
              <button type="button" className="btn-ghost btn-sm" onClick={() => setOpening(false)}>
                Отмена
              </button>
              <button type="submit" className="btn-primary btn-sm" disabled={busy || digits.length !== 10}>
                Открыть вход
              </button>
            </div>
          </form>
        ) : null}

        {error ? (
          <p className="cab-error fin-fail" role="alert">
            {error}
          </p>
        ) : null}

        <SelectLine items={tabs} value={shownTab} onChange={setTab} label="Разделы карточки" className="cab-card-tabs" />

        <div className="cab-card-body">
          {shownTab === "profile" ? (
            <div className="cab-lines">
              <EditLine label="ФИО" value={employee.full_name} editable={manage && !self} onSave={(v) => save({ full_name: v })()} />
              <EditLine
                label="Телефон"
                value={employee.phone}
                kind="phone"
                mono
                editable={touchable && hasAccount}
                onSave={(v) => save({ phone: v })()}
              />
              <EditLine
                label="Отдел"
                value={employee.department_id ?? ""}
                kind="select"
                options={[{ value: "", label: "Без отдела" }, ...departments.map((d) => ({ value: d.id, label: departmentLabel(d) }))]}
                shown={department ? departmentLabel(department) : undefined}
                // Начальник отдела переводит людей только администратором.
                editable={manage && !headOnly(me)}
                onSave={(v) => save({ department_id: v || null })()}
              />
              <EditLine label="Должность" value={employee.job_title} editable={manage} onSave={(v) => save({ job_title: v })()} />
              <div className="cab-line">
                <span className="cab-line-label">Доступ в систему</span>
                <span className="cab-line-value">
                  {touchable ? (
                    <SelectLine
                      items={[
                        { key: "yes", label: "Да" },
                        { key: "no", label: "Нет" },
                      ]}
                      value={hasAccount ? "yes" : "no"}
                      onChange={(next) => {
                        if (next === "yes" && !hasAccount) setOpening(true);
                        if (next === "no" && hasAccount) setConfirm("close-access");
                      }}
                      role="radiogroup"
                      label="Доступ в систему"
                      size="sm"
                      className="cab-level"
                    />
                  ) : (
                    <span className="cab-line-static">{hasAccount ? "Да" : "Нет"}</span>
                  )}
                </span>
              </div>
              {owner && hasAccount && role !== "owner" && !self ? (
                <div className="cab-line">
                  <span className="cab-line-label">Роль</span>
                  <span className="cab-line-value">
                    <SelectLine
                      items={[
                        { key: "employee", label: "Сотрудник" },
                        { key: "admin", label: "Администратор" },
                      ]}
                      value={role}
                      onChange={(next) => void act(() => peopleApi.employees.update(employee.id, { role: next }))}
                      role="radiogroup"
                      label="Роль"
                      size="sm"
                      disabled={busy}
                      className="cab-level"
                    />
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
          {shownTab === "access" ? (
            <RightsMatrix
              kind="employee"
              id={employee.id}
              me={me}
              readOnly={!touchable}
              onChanged={(data) => setSections(openSections(data))}
            />
          ) : null}
          {shownTab === "sessions" ? <SessionsList employeeId={employee.id} canEnd={touchable || self} /> : null}
          {shownTab === "actions" ? <ActionFeed fixed={{ employee_id: employee.id }} /> : null}
        </div>
      </div>

      {confirm ? (
        <ConfirmDialog
          open
          title={dialogs[confirm].title}
          text={dialogs[confirm].text}
          confirm={dialogs[confirm].confirm}
          danger={confirm !== "reset"}
          busy={busy}
          onConfirm={dialogs[confirm].run}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </CardLayer>
  );
}
