"use client";

import { useEffect, useRef, useState } from "react";

import { readParam, writeParams } from "@/components/finance/address";
import { type Me, FinanceApiError, financeApi } from "@/components/finance/api";
import { PHONE_NOT_MOBILE, PhoneInput, formatPhone, phoneDigits, phoneValue } from "@/components/finance/ui/phone-input";
import { FadeIn } from "@/components/motion/fade-in";
import { SplitReveal } from "@/components/motion/split-reveal";
import { AuthStage, AuthWait } from "@/components/stage/auth-stage";

/**
 * Вход и регистрация KORT.
 *
 * Компания регистрируется здесь сама, а не выдаётся администратором. Поэтому
 * первый экран — не «введите логин», а выбор между «войти» и
 * «зарегистрировать компанию», и второе стоит не мельче
 * первого: пока компаний мало, регистрация — главное действие экрана.
 *
 * Сотрудники входят по номеру телефона (фронт-план, 6.8): номер → «пароль»
 * или «придумайте пароль». Сервер отвечает «пароль» и на незнакомый номер,
 * поэтому экран для него выглядит так же, как для знакомого: вход не
 * выдаёт, кто зарегистрирован. «Запрос отправлен» — тоже одинаково всегда.
 *
 * Ошибку показываем текстом сервера, а не своим «что-то пошло не так»: сервер
 * различает «неверная почта или пароль», «пароль короче восьми символов» и
 * «почта уже зарегистрирована», и каждое из трёх говорит человеку, что делать.
 *
 * Что изменилось после проверки 26.09 («Асхат»):
 * - первое поле принимает и почту, и телефон — сотрудник, пришедший без
 *   ссылки, не ищет «Войти как сотрудник»;
 * - ссылка-приглашение `?phone=…` сразу спрашивает у сервера шаг и, если
 *   учётка ждёт пароль, открывает «Придумайте пароль»;
 * - шаг «пароль» у учётки, ждущей пароль, уводит к «Придумайте пароль»
 *   (сервер отвечает 409), а не пишет «неверный пароль» на пароль, которого нет;
 * - заданный пароль сразу впускает — третий ввод того же пароля ничего не
 *   охранял.
 */
type Step = "email" | "register" | "phone" | "password" | "set" | "forgot" | "forgot-sent" | "forgot-email";

const HEADINGS: Record<Step, string> = {
  email: "Вход в учёт компании",
  register: "Регистрация компании",
  phone: "Вход сотрудника",
  password: "Вход сотрудника",
  set: "Придумайте пароль",
  forgot: "Сброс пароля",
  "forgot-sent": "Запрос отправлен администратору",
  "forgot-email": "Сброс пароля",
};

/** Похоже на номер, а не на почту: цифры и знаки номера, и цифр не меньше десяти. */
function looksLikePhone(value: string): boolean {
  const text = value.trim();
  return !text.includes("@") && /^[+\d\s().-]+$/.test(text) && text.replace(/\D/g, "").length >= 10;
}

/** Кто входил по номеру, в следующий раз сразу видит номер. */
const MODE_KEY = "fin_login_mode";

function readMode(): "phone" | "email" {
  try {
    return localStorage.getItem(MODE_KEY) === "phone" ? "phone" : "email";
  } catch {
    return "email";
  }
}

function rememberMode(mode: "phone" | "email") {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* не запомнится — ничего страшного */
  }
}

export function AuthGate({ onReady, notice = "" }: { onReady: (me: Me) => void; notice?: string }) {
  const [step, setStepState] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [againTouched, setAgainTouched] = useState(false);
  const [digits, setDigits] = useState("");
  const [company, setCompany] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [phoneHint, setPhoneHint] = useState("");
  /** «Сеанс завершён» держится до первого действия человека. */
  const [shownNotice, setShownNotice] = useState(notice);

  const setStep = (next: Step) => {
    setStepState(next);
    setError("");
    setPassword("");
    setAgain("");
    setAgainTouched(false);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setShownNotice("");
    try {
      await action();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  /** Первый шаг по номеру: сервер говорит, есть ли пароль. */
  const startPhone = async (tenDigits: string) => {
    const { step: next } = await financeApi.phoneStart(phoneValue(tenDigits));
    setStep(next === "set_password" ? "set" : "password");
  };

  useEffect(() => {
    // Ссылка-приглашение из карточки сотрудника: номер уже в адресе.
    const invited = readParam("phone");
    if (invited) {
      writeParams({ phone: null });
      const fromLink = phoneDigits(invited);
      if (fromLink.length === 10 && fromLink[0] === "7") {
        setDigits(fromLink);
        setStepState("phone");
        void run(() => startPhone(fromLink));
        return;
      }
    }
    if (readMode() === "phone") setStepState("phone");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- адрес читается один раз при входе
  }, []);

  const phone = phoneValue(digits);
  const phoneReady = digits.length === 10 && digits[0] === "7";
  const mismatch = again.length > 0 && (againTouched || again.length >= password.length) && again !== password;

  /** Вход по номеру с паролем. Учётка ждёт пароль (409) — к «Придумайте пароль». */
  const loginByPhone = async (tenDigits: string, secret: string) => {
    try {
      const me = await financeApi.phoneLogin({ phone: phoneValue(tenDigits), password: secret });
      rememberMode("phone");
      onReady(me);
    } catch (exc) {
      if (exc instanceof FinanceApiError && exc.status === 409) {
        setStep("set");
        return;
      }
      throw exc;
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    switch (step) {
      case "email":
        return run(async () => {
          if (looksLikePhone(email)) {
            // Сотрудник ввёл номер в первое поле — дальше дорога по номеру.
            const fromField = phoneDigits(email);
            if (fromField.length !== 10 || fromField[0] !== "7") throw new Error(PHONE_NOT_MOBILE);
            setDigits(fromField);
            const typed = password;
            const { step: next } = await financeApi.phoneStart(phoneValue(fromField));
            if (next === "set_password") {
              setStep("set");
              return;
            }
            if (!typed) {
              setStep("password");
              return;
            }
            setStep("password");
            await loginByPhone(fromField, typed);
            return;
          }
          const me = await financeApi.login({ email, password });
          rememberMode("email");
          onReady(me);
        });
      case "register":
        if (fullName.trim().length < 2) {
          setError("Укажите своё имя");
          return;
        }
        return run(async () => onReady(await financeApi.register({ email, password, company, full_name: fullName })));
      case "phone":
        if (!phoneReady) return;
        return run(() => startPhone(digits));
      case "password":
        return run(() => loginByPhone(digits, password));
      case "set":
        if (password !== again) {
          setAgainTouched(true);
          return;
        }
        return run(async () => {
          const me = await financeApi.phoneSetPassword({ phone, password });
          rememberMode("phone");
          onReady(me);
        });
      case "forgot":
        if (!phoneReady) return;
        return run(async () => {
          await financeApi.phoneForgot(phone);
          setStep("forgot-sent");
        });
      case "forgot-sent":
        setStep("phone");
        return;
      case "forgot-email":
        setStep("email");
        return;
    }
  };

  const numberLine = (
    <p className="auth-number">
      <span className="fin-mono">{formatPhone(phone)}</span>
      <button type="button" className="fin-link-btn" onClick={() => setStep("phone")}>
        Изменить
      </button>
    </p>
  );

  return (
    <AuthStage intro>
      <SplitReveal key={`h-${step}`} as="h2" className="auth-heading" by="words" duration={0.7}>
        {HEADINGS[step]}
      </SplitReveal>

      <FadeIn key={`b-${step}`}>
        <form className="auth-fields" onSubmit={submit} noValidate>
          {step === "register" ? (
            <label className="auth-field">
              <span className="eyebrow">Название компании</span>
              <input
                className="input-field"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder="ТОО «Компания»"
                autoComplete="organization"
                required
              />
            </label>
          ) : null}

          {shownNotice && (step === "email" || step === "phone") ? <p className="auth-note">{shownNotice}</p> : null}

          {step === "email" || step === "register" ? (
            <>
              <label className="auth-field">
                <span className="eyebrow">{step === "email" ? "Почта или телефон" : "Почта"}</span>
                <input
                  className="input-field"
                  type={step === "email" ? "text" : "email"}
                  inputMode={step === "email" ? "email" : undefined}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={step === "email" ? "buh@company.kz или +7 7__ ___ __ __" : "buh@company.kz"}
                  autoComplete={step === "email" ? "username" : "email"}
                  required
                />
              </label>
              <label className="auth-field">
                <span className="eyebrow">Пароль</span>
                <input
                  className="input-field"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={step === "email" ? "current-password" : "new-password"}
                  required
                />
                {step === "register" ? <span className="auth-hint">От восьми символов.</span> : null}
              </label>
            </>
          ) : null}

          {step === "register" ? (
            <label className="auth-field">
              <span className="eyebrow">Ваше имя</span>
              <input
                className="input-field"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
                required
              />
            </label>
          ) : null}

          {step === "phone" || step === "forgot" ? (
            <label className="auth-field" htmlFor="fin-phone">
              <span className="eyebrow">Телефон</span>
              <PhoneInput
                id="fin-phone"
                value={digits}
                onChange={(next) => {
                  setDigits(next);
                  setError("");
                }}
                autoFocus
                onBlurCheck={setPhoneHint}
                aria-describedby={phoneHint ? "fin-phone-hint" : undefined}
              />
              {phoneHint ? (
                <span id="fin-phone-hint" className="auth-hint fin-fail">
                  {phoneHint}
                </span>
              ) : null}
            </label>
          ) : null}

          {step === "password" || step === "set" ? numberLine : null}

          {step === "password" ? (
            <PasswordField value={password} onChange={setPassword} autoComplete="current-password" autoFocus />
          ) : null}

          {step === "set" ? (
            <>
              <PasswordField
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                autoFocus
                hint="От восьми символов."
              />
              <label className="auth-field">
                <span className="eyebrow">Ещё раз</span>
                <input
                  className="input-field"
                  type="password"
                  value={again}
                  onChange={(event) => setAgain(event.target.value)}
                  onBlur={() => setAgainTouched(true)}
                  autoComplete="new-password"
                  aria-invalid={mismatch || undefined}
                  aria-describedby={mismatch ? "fin-again-hint" : undefined}
                />
                {mismatch ? (
                  <span id="fin-again-hint" className="auth-hint fin-fail">
                    Пароли не совпадают
                  </span>
                ) : null}
              </label>
            </>
          ) : null}

          {step === "forgot-email" ? (
            <p className="auth-note">
              Пароль администратора сбрасывает владелец компании в личном кабинете. Пароль владельца
              восстанавливается только на сервере.
            </p>
          ) : null}
          {step === "forgot-sent" ? (
            <p className="auth-note">Когда пароль сбросят, введите номер снова — система попросит придумать новый.</p>
          ) : null}

          {error ? (
            <p className="auth-error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="btn-primary mt-1"
            disabled={
              busy ||
              ((step === "phone" || step === "forgot") && !phoneReady) ||
              (step === "set" && (password.length === 0 || again.length === 0))
            }
          >
            {busy ? "Минуту…" : ACTIONS[step]}
          </button>
        </form>

        <div className="auth-links">
          {step === "email" ? (
            <>
              <button type="button" className="btn-ghost auth-switch" onClick={() => setStep("phone")}>
                Войти как сотрудник
              </button>
              <button type="button" className="fin-link-btn auth-link" onClick={() => setStep("forgot-email")}>
                Забыли пароль?
              </button>
              <button type="button" className="fin-link-btn auth-link" onClick={() => setStep("register")}>
                Регистрация компании
              </button>
            </>
          ) : null}
          {step === "register" ? (
            <button type="button" className="btn-ghost auth-switch" onClick={() => setStep("email")}>
              У меня уже есть учётная запись
            </button>
          ) : null}
          {step === "phone" ? (
            <button
              type="button"
              className="btn-ghost auth-switch"
              onClick={() => {
                rememberMode("email");
                setStep("email");
              }}
            >
              Войти по почте
            </button>
          ) : null}
          {step === "password" ? (
            <button type="button" className="fin-link-btn auth-link" onClick={() => setStep("forgot")}>
              Забыли пароль?
            </button>
          ) : null}
          {step === "forgot" ? (
            <button type="button" className="btn-ghost auth-switch" onClick={() => setStep("phone")}>
              Ко входу
            </button>
          ) : null}
        </div>
      </FadeIn>
    </AuthStage>
  );
}

const ACTIONS: Record<Step, string> = {
  email: "Войти",
  register: "Зарегистрировать компанию",
  phone: "Далее",
  password: "Войти",
  set: "Задать пароль и войти",
  forgot: "Отправить запрос",
  "forgot-sent": "Ко входу",
  "forgot-email": "Ко входу",
};

function PasswordField({
  value,
  onChange,
  autoComplete,
  autoFocus,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
  hint?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // `autoFocus` в форме, которая проявляется, срабатывает раньше, чем поле
  // становится видимым; фокус после кадра надёжнее.
  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);
  return (
    <label className="auth-field">
      <span className="eyebrow">Пароль</span>
      <input
        ref={ref}
        className="input-field"
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        required
      />
      {hint ? <span className="auth-hint">{hint}</span> : null}
    </label>
  );
}

/**
 * Экран смены временного пароля.
 *
 * Стоит между входом и разделом: пока пароль временный, сервер отказывает во
 * всём, кроме чтения и самой смены. Показывать вместо этого раздел, в котором
 * ничего не сохраняется, — худший из вариантов.
 */
export function PasswordChangeGate({ onDone }: { onDone: () => void }) {
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await financeApi.changePassword({ old_password: oldPassword, new_password: newPassword });
      onDone();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthStage>
      <h2 className="auth-heading">Смените временный пароль</h2>
      <form className="auth-fields" onSubmit={submit}>
        <label className="auth-field">
          <span className="eyebrow">Временный пароль</span>
          <input
            className="input-field"
            type="password"
            value={oldPassword}
            onChange={(event) => setOld(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        <label className="auth-field">
          <span className="eyebrow">Новый пароль</span>
          <input
            className="input-field"
            type="password"
            value={newPassword}
            onChange={(event) => setNew(event.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn-primary mt-1" disabled={busy}>
          {busy ? "Меняем…" : "Сменить пароль"}
        </button>
      </form>
    </AuthStage>
  );
}

/**
 * Пока не знаем, вошёл ли человек, показываем не пустоту, а ожидание.
 *
 * Не афишей: следом почти всегда идёт форма входа, и афиша, собранная дважды
 * за полсекунды (сначала здесь, потом в форме), читалась бы как рывок.
 * Подпись проявляется с задержкой — при обычной проверке её не видно вовсе.
 */
export function AuthLoading() {
  return <AuthWait>Проверяем доступ…</AuthWait>;
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const next = await financeApi.me();
        if (alive) setMe(next.authenticated ? next : null);
      } catch {
        if (alive) setMe(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { me, setMe, loading };
}
