"use client";

import { useEffect, useState } from "react";

import { RESOURCE_TITLES, can, isAdmin, isOwner, levelOf } from "@/components/finance/access";
import { type Department, type EmployeeRow, type Me, financeApi, peopleApi } from "@/components/finance/api";
import { ROLE_TITLES } from "@/components/finance/cabinet/status";
import { ChoiceSelect } from "@/components/choice-select";
import { SelectLine } from "@/components/finance/ui/select-line";
import { EditLine } from "@/components/finance/cabinet/edit-line";
import { departmentLabel, plural } from "@/components/finance/format";

/**
 * «Моё · Профиль» (фронт-план, 6.9).
 *
 * Лист формы в две колонки (28.09.2026): у каждого поля — ячейка, подпись
 * над значением. До того были строки «подпись · значение», и у владельца без
 * ФИО и телефона висели прочерки — незаполненное выглядело не полем, а
 * пропуском. Теперь пустое поле говорит, что в него вписать и кто это делает:
 * своё — «Добавить» и образец («+7 ___ ___ __ __»), чужое — «задаёт
 * администратор».
 *
 * ФИО и телефон правят себе владелец и администратор; отдел и должность — тот,
 * у кого право на людей (сервер пускает к своей записи сотрудника, как в
 * карточке). Остальным это текст.
 *
 * «Сменить пароль» раскрывает три поля на месте, и над кнопкой — последствие
 * фактом: «Остальные сеансы закроются: 2». Не ронять человека из всех
 * сеансов молча — урок кабинета дашборда BBC.
 */
const BY_ADMIN = "задаёт администратор";

export function ProfileTab({
  me,
  onMe,
  departments,
  employees = null,
  onPeopleChanged,
}: {
  me: Me;
  onMe: (next: Me) => void;
  /** Отделы компании — для выбора своего; `null` — ещё не прочитаны или не видны. */
  departments: Department[] | null;
  /** Люди компании — кому передать владение; `null` — не прочитаны или не видны. */
  employees?: EmployeeRow[] | null;
  onPeopleChanged?: () => void;
}) {
  const admin = isAdmin(me);
  const employee = me.employee;
  const department = employee?.department;
  const [changing, setChanging] = useState(false);
  const [changingEmail, setChangingEmail] = useState(false);
  const [handing, setHanding] = useState(false);
  const role = me.role ?? me.company?.role ?? null;
  // Владелец, зарегистрированный без имени, заведён сотрудником под своей
  // почтой. Показать почту в строке ФИО — значит выдать её за имя; пустая
  // строка честнее и сама просит её заполнить.
  const shownName = employee?.full_name || me.user?.full_name || "";
  const name = shownName && shownName === me.user?.email ? "" : shownName;
  const ownRecord = employee && can(me, "people", "edit") ? employee : null;
  // После любой правки `me` перечитывается целиком. Ответ `/auth/profile` —
  // только `{id, full_name, phone}`, а раньше он ложился в `me` вместо «кто
  // вошёл»: поправил своё ФИО — и до перезагрузки пропадали имя в шапке,
  // роль и права (28.09.2026). Отдел и должность живут в записи сотрудника,
  // и портрет без перечитывания показывал бы прежнее.
  const refresh = async () => {
    onMe(await financeApi.me());
    onPeopleChanged?.();
  };
  const saveSelf = async (patch: { full_name?: string; phone?: string }) => {
    await peopleApi.self.profile(patch);
    await refresh();
  };
  const saveRecord = async (patch: { department_id?: string | null; job_title?: string }) => {
    if (!ownRecord) return;
    await peopleApi.employees.update(ownRecord.id, patch);
    await refresh();
  };
  const email = me.user?.email ?? "";
  // Название компании правит только владелец (сервер: `PATCH /auth/company`).
  // До 29.09.2026 строки не было, и «ТОО "BBC тест"», набранное при
  // регистрации, стояло в шапке и в каждом приглашении сотруднику навсегда.
  const owner = isOwner(me);
  const saveCompany = async (title: string) => {
    await financeApi.renameCompany(title);
    await refresh();
  };

  return (
    <div className="cab-fields">
      {me.company ? (
        <EditLine
          label="Компания"
          wide
          value={me.company.title}
          editable={owner}
          placeholder={owner ? "Название, как в документах" : "задаёт владелец"}
          onSave={saveCompany}
        />
      ) : null}
      <EditLine
        label="ФИО"
        value={name}
        editable={admin}
        placeholder={admin ? "Фамилия и имя" : BY_ADMIN}
        onSave={(value) => saveSelf({ full_name: value })}
      />
      <EditLine
        label="Телефон"
        value={me.user?.phone ?? ""}
        kind="phone"
        mono
        editable={admin}
        placeholder={admin ? "+7 ___ ___ __ __" : BY_ADMIN}
        onSave={(value) => saveSelf({ phone: value })}
      />
      <EditLine
        label="Отдел"
        value={department?.id ?? ""}
        kind="select"
        options={[
          { value: "", label: "Без отдела" },
          ...(departments ?? []).map((item) => ({ value: item.id, label: departmentLabel(item) })),
        ]}
        shown={department ? departmentLabel(department) : undefined}
        editable={Boolean(ownRecord) && departments !== null}
        onSave={(value) => saveRecord({ department_id: value || null })}
      />
      <EditLine
        label="Должность"
        value={employee?.job_title ?? ""}
        editable={Boolean(ownRecord)}
        placeholder={ownRecord ? "Не указана" : BY_ADMIN}
        onSave={(value) => saveRecord({ job_title: value })}
      />
      {email ? (
        // Почта — логин входа. До 29.09.2026 она была только текстом, и
        // однажды заданную почту сменить было нечем. Меняется с паролем:
        // человек у чужого открытого браузера не должен переносить учётку.
        <div className="cab-line cab-line-top">
          <span className="cab-line-label">Почта</span>
          <span className="cab-line-value">
            {changingEmail ? (
              <EmailForm email={email} onDone={() => setChangingEmail(false)} onChanged={refresh} />
            ) : (
              <span className="cab-email">
                <span className="cab-line-static">{email}</span>
                <button type="button" className="btn-ghost btn-sm cab-password-open" onClick={() => setChangingEmail(true)}>
                  Сменить почту
                </button>
              </span>
            )}
          </span>
        </div>
      ) : null}

      <div className="cab-line cab-line-top" data-wide={email ? undefined : "true"}>
        <span className="cab-line-label">Пароль</span>
        <span className="cab-line-value">
          {changing ? (
            <PasswordForm onDone={() => setChanging(false)} />
          ) : (
            <button type="button" className="btn-ghost btn-sm cab-password-open" onClick={() => setChanging(true)}>
              Сменить пароль
            </button>
          )}
        </span>
      </div>

      {/* Роль — у всех словом; владелец может передать владение (29.09.2026:
          «владельцем может стать другой, а я — администратором»). */}
      {role ? (
        <div className="cab-line cab-line-top" data-wide="true">
          <span className="cab-line-label">Роль</span>
          <span className="cab-line-value">
            {handing ? (
              <OwnerForm me={me} employees={employees ?? []} onDone={() => setHanding(false)} onChanged={refresh} />
            ) : (
              <span className="cab-email">
                <span className="cab-line-static">{ROLE_TITLES[role as keyof typeof ROLE_TITLES] ?? role}</span>
                {role === "owner" ? (
                  <button type="button" className="btn-ghost btn-sm cab-password-open" onClick={() => setHanding(true)}>
                    Передать владение
                  </button>
                ) : null}
              </span>
            )}
          </span>
        </div>
      ) : null}

      {/* Тема — тумблером в шапке, как на входе (28.09.2026), а не строкой здесь. */}
      {(me.companies?.length ?? 0) > 1 ? (
        <div className="cab-line" data-wide="true">
          <span className="cab-line-label">Компании</span>
          <span className="cab-line-value cab-companies">
            {(me.companies ?? []).map((company) =>
              company.id === me.company?.id ? (
                <span key={company.id} className="cab-company" aria-current="true">
                  {company.title}
                </span>
              ) : (
                <button
                  key={company.id}
                  type="button"
                  className="fin-link-btn cab-company"
                  onClick={async () => onMe(await financeApi.switchCompany(company.id))}
                >
                  {company.title}
                </button>
              ),
            )}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * «Передать владение»: кому (только тот, кто уже входит сам), кем остаюсь,
 * пароль. Над кнопкой — последствие фактом: вернуть владение сможет только
 * новый владелец. Сервер проверяет всё то же (`auth.transfer_ownership`).
 */
function OwnerForm({
  me,
  employees,
  onDone,
  onChanged,
}: {
  me: Me;
  employees: EmployeeRow[];
  onDone: () => void;
  onChanged: () => Promise<void>;
}) {
  const [to, setTo] = useState("");
  const [keep, setKeep] = useState<"admin" | "employee">("admin");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const candidates = employees.filter(
    (row) => row.account && row.account.status === "active" && row.account.user_id !== me.user?.id && !row.archived,
  );
  const chosen = candidates.find((row) => row.account?.user_id === to) ?? null;

  if (done) {
    return (
      <span className="cab-line-static">
        {done}{" "}
        <button type="button" className="fin-link-btn" onClick={onDone}>
          Готово
        </button>
      </span>
    );
  }

  return (
    <form
      className="cab-password"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!chosen?.account) return;
        setBusy(true);
        setError("");
        try {
          await financeApi.transferOwner({ user_id: chosen.account.user_id, password, keep });
          setDone(`Владелец теперь — ${chosen.full_name}. Вы — ${ROLE_TITLES[keep]}.`);
          await onChanged();
        } catch (exc) {
          setError(exc instanceof Error ? exc.message : "Владение не передано");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="auth-field">
        <span className="eyebrow">Кому</span>
        {candidates.length ? (
          <ChoiceSelect className="input-field" value={to} onChange={setTo} placeholder="Выберите человека">
            {candidates.map((row) => (
              <option key={row.id} value={row.account?.user_id ?? ""}>
                {row.full_name} · {ROLE_TITLES[row.account?.role ?? "employee"]}
              </option>
            ))}
          </ChoiceSelect>
        ) : (
          <span className="auth-hint">Передать некому: нужен человек, который уже входит в KORT сам.</span>
        )}
      </label>
      <span className="auth-field">
        <span className="eyebrow">Вы остаётесь</span>
        <SelectLine
          items={[
            { key: "admin", label: "Администратор" },
            { key: "employee", label: "Сотрудник" },
          ]}
          value={keep}
          onChange={setKeep}
          role="radiogroup"
          label="Кем остаться"
          size="sm"
        />
      </span>
      <label className="auth-field">
        <span className="eyebrow">Ваш пароль</span>
        <input
          className="input-field"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      {chosen ? (
        <p className="cab-consequence">
          {chosen.full_name} станет владельцем, вы — {ROLE_TITLES[keep]}. Вернуть владение сможет только новый владелец.
        </p>
      ) : null}
      {error ? (
        <p className="cab-error fin-fail" role="alert">
          {error}
        </p>
      ) : null}
      <span className="cab-add-actions">
        <button type="button" className="btn-ghost btn-sm" onClick={onDone}>
          Отмена
        </button>
        <button type="submit" className="btn-primary btn-sm" disabled={busy || !chosen || !password}>
          {busy ? "Передаём…" : "Передать владение"}
        </button>
      </span>
    </form>
  );
}

/** «Сменить почту»: новая почта и текущий пароль; вход дальше — по новой. */
function EmailForm({ email, onDone, onChanged }: { email: string; onDone: () => void; onChanged: () => Promise<void> }) {
  const [next, setNext] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  if (done) {
    return (
      <span className="cab-line-static">
        {done}{" "}
        <button type="button" className="fin-link-btn" onClick={onDone}>
          Готово
        </button>
      </span>
    );
  }

  return (
    <form
      className="cab-password"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        try {
          const result = await financeApi.changeEmail({ email: next.trim(), password });
          await onChanged();
          setDone(`Почта изменена. Входите с ${result.email}.`);
        } catch (exc) {
          setError(exc instanceof Error ? exc.message : "Почта не сменилась");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="auth-field">
        <span className="eyebrow">Новая почта</span>
        <input
          className="input-field"
          type="email"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder={email}
          autoComplete="email"
          autoFocus
        />
      </label>
      <label className="auth-field">
        <span className="eyebrow">Пароль</span>
        <input
          className="input-field"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <span className="auth-hint">Нынешний — почта это логин.</span>
      </label>
      {error ? (
        <p className="cab-error fin-fail" role="alert">
          {error}
        </p>
      ) : null}
      <span className="cab-add-actions">
        <button type="button" className="btn-ghost btn-sm" onClick={onDone}>
          Отмена
        </button>
        <button type="submit" className="btn-primary btn-sm" disabled={busy || !next.trim() || !password}>
          {busy ? "Меняем…" : "Сменить почту"}
        </button>
      </span>
    </form>
  );
}

function PasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [others, setOthers] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    financeApi
      .sessions()
      .then((data) => setOthers(data.items.filter((item) => !item.current).length))
      .catch(() => setOthers(null));
  }, []);

  const mismatch = again.length > 0 && again.length >= next.length && again !== next;

  if (done) {
    return (
      <span className="cab-line-static">
        {done}{" "}
        <button type="button" className="fin-link-btn" onClick={onDone}>
          Готово
        </button>
      </span>
    );
  }

  return (
    <form
      className="cab-password"
      onSubmit={async (event) => {
        event.preventDefault();
        if (next !== again) return;
        setBusy(true);
        setError("");
        try {
          const result = await peopleApi.self.changePassword({ old_password: current, new_password: next });
          const closed = result.sessions_closed ?? 0;
          setDone(
            closed > 0
              ? `Пароль изменён, ${plural(closed, "закрыт", "закрыто", "закрыто")} ${closed} ${plural(closed, "сеанс", "сеанса", "сеансов")}.`
              : "Пароль изменён.",
          );
        } catch (exc) {
          setError(exc instanceof Error ? exc.message : "Пароль не сменился");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="auth-field">
        <span className="eyebrow">Текущий</span>
        <input
          className="input-field"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          autoFocus
        />
      </label>
      <label className="auth-field">
        <span className="eyebrow">Новый</span>
        <input
          className="input-field"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
        />
        <span className="auth-hint">От восьми символов.</span>
      </label>
      <label className="auth-field">
        <span className="eyebrow">Ещё раз</span>
        <input
          className="input-field"
          type="password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          autoComplete="new-password"
          aria-invalid={mismatch || undefined}
        />
        {mismatch ? <span className="auth-hint fin-fail">Пароли не совпадают</span> : null}
      </label>
      {others ? (
        <p className="cab-consequence">
          Остальные сеансы закроются: {others}
        </p>
      ) : null}
      {error ? (
        <p className="cab-error fin-fail" role="alert">
          {error}
        </p>
      ) : null}
      <span className="cab-add-actions">
        <button type="button" className="btn-ghost btn-sm" onClick={onDone}>
          Отмена
        </button>
        <button type="submit" className="btn-primary btn-sm" disabled={busy || !current || !next || next !== again}>
          {busy ? "Меняем…" : "Сменить пароль"}
        </button>
      </span>
    </form>
  );
}

/**
 * «Моё · Доступ»: что открыто, в порядке колонки. Закрытое не перечисляется —
 * список закрытого шум, а открытое видно и в колонке.
 */
export function MyAccess({ me }: { me: Me }) {
  if (isAdmin(me)) return <p className="cab-admin-line">Администратор видит и правит всё.</p>;
  const scope = me.contracts_scope;
  const rows = RESOURCE_TITLES.filter((item) => levelOf(me, item.key) !== "none");
  if (rows.length === 0) return <p className="cab-empty">Разделов пока не открыто. Доступ даёт администратор.</p>;
  const hidden = Object.entries(scope?.fields ?? {})
    .filter(([, level]) => level === "none")
    .map(([key]) => key);
  return (
    <div className="cab-lines">
      {rows.map((item) => {
        const level = levelOf(me, item.key);
        const parts = [level === "edit" ? "правит" : "видит"];
        if (item.key === "contracts" && scope) {
          parts.push(
            scope.rows === "department" ? "своего отдела" : scope.rows === "own" ? "где ответственный" : "все договоры",
          );
          parts.push(scope.entities.length ? `юрлиц: ${scope.entities.length}` : "юрлица: все");
          if (hidden.length) parts.push(`скрыто полей: ${hidden.length}`);
        }
        return (
          <div className="cab-line" key={item.key}>
            <span className="cab-line-label">{item.title}</span>
            <span className="cab-line-static">
              {parts.join(" · ")}
              {item.note ? <span className="annot cab-right-note">{item.note}</span> : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
