"use client";

import { useEffect, useState } from "react";

import { RESOURCE_TITLES, can, isAdmin, isOwner, levelOf } from "@/components/finance/access";
import { type Department, type Me, financeApi, peopleApi } from "@/components/finance/api";
import { EditLine } from "@/components/finance/cabinet/edit-line";
import { plural } from "@/components/finance/format";

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
  onPeopleChanged,
}: {
  me: Me;
  onMe: (next: Me) => void;
  /** Отделы компании — для выбора своего; `null` — ещё не прочитаны или не видны. */
  departments: Department[] | null;
  onPeopleChanged?: () => void;
}) {
  const admin = isAdmin(me);
  const employee = me.employee;
  const department = employee?.department;
  const [changing, setChanging] = useState(false);
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
          ...(departments ?? []).map((item) => ({ value: item.id, label: `${item.code} · ${item.title}` })),
        ]}
        shown={department ? `${department.code} · ${department.title}` : undefined}
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
      {email ? <EditLine label="Почта" value={email} onSave={async () => undefined} /> : null}

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
