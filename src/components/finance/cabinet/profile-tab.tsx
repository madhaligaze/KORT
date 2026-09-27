"use client";

import { useEffect, useState } from "react";

import { RESOURCE_TITLES, isAdmin, levelOf } from "@/components/finance/access";
import { type Me, financeApi, peopleApi } from "@/components/finance/api";
import { EditLine } from "@/components/finance/cabinet/edit-line";
import { ThemeLine } from "@/components/finance/cabinet/theme-line";
import { plural } from "@/components/finance/format";

/**
 * «Моё · Профиль» (фронт-план, 6.9).
 *
 * Страница про себя, а не форма: «подпись · значение», строки 44px. ФИО,
 * телефон, отдел и должность сотруднику задаёт администратор — у него это
 * текст без рамки наведения; владелец и администратор правят свои на месте.
 *
 * «Сменить пароль» раскрывает три поля на месте, и над кнопкой — последствие
 * фактом: «Остальные сеансы закроются: 2». Не ронять человека из всех
 * сеансов молча — урок кабинета дашборда BBC.
 */
export function ProfileTab({ me, onMe }: { me: Me; onMe: (next: Me) => void }) {
  const admin = isAdmin(me);
  const employee = me.employee;
  const department = employee?.department;
  const [changing, setChanging] = useState(false);
  // Владелец, зарегистрированный без имени, заведён сотрудником под своей
  // почтой. Показать почту в строке ФИО — значит выдать её за имя; пустая
  // строка честнее и сама просит её заполнить.
  const shownName = employee?.full_name || me.user?.full_name || "";
  const name = shownName && shownName === me.user?.email ? "" : shownName;

  return (
    <div className="cab-lines">
      <EditLine
        label="ФИО"
        value={name}
        editable={admin}
        onSave={async (value) => onMe(await peopleApi.self.profile({ full_name: value }))}
      />
      <EditLine
        label="Телефон"
        value={me.user?.phone ?? ""}
        kind="phone"
        mono
        editable={admin}
        onSave={async (value) => onMe(await peopleApi.self.profile({ phone: value }))}
      />
      {me.user?.email ? <EditLine label="Почта" value={me.user.email} onSave={async () => undefined} /> : null}
      <EditLine
        label="Отдел"
        value={department ? `${department.code} · ${department.title}` : ""}
        onSave={async () => undefined}
      />
      <EditLine label="Должность" value={employee?.job_title ?? ""} onSave={async () => undefined} />

      <div className="cab-lines-gap" />
      <div className="cab-line cab-line-top">
        <span className="cab-line-label">Пароль</span>
        <span className="cab-line-value">
          {changing ? (
            <PasswordForm onDone={() => setChanging(false)} />
          ) : (
            <button type="button" className="cab-line-text" onClick={() => setChanging(true)}>
              Сменить пароль
            </button>
          )}
        </span>
      </div>

      <div className="cab-lines-gap" />
      <ThemeLine />
      {(me.companies?.length ?? 0) > 1 ? (
        <div className="cab-line">
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
