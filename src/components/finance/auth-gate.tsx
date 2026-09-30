"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { readParam, writeParams } from "@/components/finance/address";
import { type Me, FinanceApiError, financeApi } from "@/components/finance/api";
import { PHONE_NOT_MOBILE, PhoneInput, formatPhone, phoneDigits, phoneValue } from "@/components/finance/ui/phone-input";
import { SplitReveal } from "@/components/motion/split-reveal";
import { AuthStage, AuthWait } from "@/components/stage/auth-stage";

/**
 * Вход и регистрация KORT.
 *
 * Компания регистрируется здесь сама, а не выдаётся администратором. Поэтому
 * первый экран - не «введите логин», а выбор между «войти» и
 * «зарегистрировать компанию», и второе стоит не мельче
 * первого: пока компаний мало, регистрация - главное действие экрана.
 *
 * Облик - страница книги (28.09.2026; прежний - «пилюли везде», регистрация
 * мелкой ссылкой в строке с переносом). Вход и регистрация - две двери:
 * «Вход» и «Регистрация» крупно, одна под другой, и под открытой раскрываются
 * её строки. Номеров у дверей нет - их сняли по просьбе владельца. Поля -
 * строки книги: подпись на полях слева, значение на линейке, без рамок.
 * Значения и кнопка стоят от одной вертикали (`--auth-axis` в globals.css),
 * подписи - слева от неё.
 *
 * Сотрудники входят по номеру телефона (фронт-план, 6.8): номер → «пароль»
 * или «придумайте пароль». Сервер отвечает «пароль» и на незнакомый номер,
 * поэтому экран для него выглядит так же, как для знакомого: вход не
 * выдаёт, кто зарегистрирован. «Запрос отправлен» - тоже одинаково всегда.
 *
 * Ошибку показываем текстом сервера, а не своим «что-то пошло не так»: сервер
 * различает «неверная почта или пароль», «пароль короче восьми символов» и
 * «почта уже зарегистрирована», и каждое из трёх говорит человеку, что делать.
 *
 * Что изменилось после проверки 26.09 («Асхат»):
 * - первое поле принимает и почту, и телефон - сотрудник, пришедший без
 *   ссылки, не ищет «Войти как сотрудник». Саму кнопку 28.09 сняли было
 *   совсем и в тот же день вернули строкой под «Войти»: без неё и владелец не
 *   увидел, как входят сотрудники, - подпись поля такое не объясняет;
 * - ссылка-приглашение `?phone=…` сразу спрашивает у сервера шаг и, если
 *   учётка ждёт пароль, открывает «Придумайте пароль»;
 * - шаг «пароль» у учётки, ждущей пароль, уводит к «Придумайте пароль»
 *   (сервер отвечает 409), а не пишет «неверный пароль» на пароль, которого нет;
 * - заданный пароль сразу впускает - третий ввод того же пароля ничего не
 *   охранял.
 */
type Step = "email" | "register" | "phone" | "password" | "set" | "forgot" | "forgot-sent" | "forgot-email";

/** Заголовок двери «Вход» на каждом шаге. Короткий: он набран крупно в узкой колонке. */
const HEADINGS: Record<Step, string> = {
  email: "Вход",
  register: "Регистрация",
  phone: "Вход сотрудника",
  password: "Вход сотрудника",
  set: "Новый пароль",
  forgot: "Сброс пароля",
  "forgot-sent": "Запрос отправлен",
  "forgot-email": "Сброс пароля",
};

/** Куда ведёт «←» перед заголовком двери. У первого шага стрелки нет. */
const BACK: Partial<Record<Step, Step>> = {
  phone: "email",
  password: "phone",
  set: "phone",
  forgot: "phone",
  "forgot-sent": "phone",
  "forgot-email": "email",
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
    /* не запомнится - ничего страшного */
  }
}

/**
 * Первое поле открытой двери - в фокус, когда дверь открыли рукой. Только там,
 * где есть мышь: на телефоне фокус поднял бы клавиатуру поверх раскрытия.
 */
function focusFirstField(bodyId: string) {
  if (!window.matchMedia("(hover: hover)").matches) return;
  requestAnimationFrame(() => {
    document.querySelector<HTMLInputElement>(`#${bodyId} input:not([type="hidden"])`)?.focus({ preventScroll: true });
  });
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

  /** Вход по номеру с паролем. Учётка ждёт пароль (409) - к «Придумайте пароль». */
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

  /** «Забыли?» у первого шага: в поле номер - сброс по номеру, иначе - кто сбрасывает пароль по почте. */
  const forgotFromEmail = () => {
    const fromField = looksLikePhone(email) ? phoneDigits(email) : "";
    if (fromField.length === 10 && fromField[0] === "7") {
      setDigits(fromField);
      setStep("forgot");
      return;
    }
    setStep("forgot-email");
  };

  /** «Войти как сотрудник»: к полю номера с маской; номер из первого поля не теряется. */
  const toEmployee = () => {
    const fromField = looksLikePhone(email) ? phoneDigits(email) : "";
    if (fromField.length === 10 && fromField[0] === "7") setDigits(fromField);
    setStep("phone");
  };

  const goBack = (target: Step) => {
    if (target === "email") rememberMode("email");
    setStep(target);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    switch (step) {
      case "email":
        return run(async () => {
          if (looksLikePhone(email)) {
            // Сотрудник ввёл номер в первое поле - дальше дорога по номеру.
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

  /** Регистрация открыта - дверь «Вход» свёрнута на своём первом шаге. */
  const registering = step === "register";
  const inStep: Step = registering ? "email" : step;
  const back = BACK[inStep];

  const failLine = error ? (
    <p className="auth-error" role="alert">
      {error}
    </p>
  ) : null;

  const numberRow = (
    <Row
      label="Телефон"
      aside={
        <button type="button" className="auth-aside-btn" onClick={() => setStep("phone")}>
          Изменить
        </button>
      }
    >
      <span className="auth-fixed">{formatPhone(phone)}</span>
    </Row>
  );

  const phoneRow = (
    <Row label="Телефон" htmlFor="fin-phone" note={phoneHint} noteId="fin-phone-hint" invalid={!!phoneHint}>
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
    </Row>
  );

  return (
    <AuthStage intro>
      <div className="auth-doors">
        <Door
          title={HEADINGS[inStep]}
          open={!registering}
          bodyId="auth-door-in"
          onOpen={() => {
            setStep("email");
            focusFirstField("auth-door-in");
          }}
          back={back && !registering ? { label: "Назад", onClick: () => goBack(back) } : undefined}
        >
          <form key={inStep} className="auth-sheet" onSubmit={submit} noValidate>
            {shownNotice && (inStep === "email" || inStep === "phone") ? <p className="auth-say">{shownNotice}</p> : null}

            {inStep === "email" ? (
              <>
                <Row label="Почта или телефон" htmlFor="auth-login">
                  <input
                    id="auth-login"
                    className="auth-input"
                    type="text"
                    inputMode="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="buh@company.kz"
                    autoComplete="username"
                    required
                  />
                </Row>
                <Row
                  label="Пароль"
                  htmlFor="auth-password"
                  aside={
                    <button type="button" className="auth-aside-btn" onClick={forgotFromEmail}>
                      Забыли?
                    </button>
                  }
                >
                  <PasswordInput id="auth-password" value={password} onChange={setPassword} autoComplete="current-password" />
                </Row>
              </>
            ) : null}

            {inStep === "phone" || inStep === "forgot" ? phoneRow : null}

            {inStep === "password" ? (
              <>
                {numberRow}
                <Row
                  label="Пароль"
                  htmlFor="auth-phone-password"
                  aside={
                    <button type="button" className="auth-aside-btn" onClick={() => setStep("forgot")}>
                      Забыли?
                    </button>
                  }
                >
                  <PasswordInput
                    id="auth-phone-password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="current-password"
                    autoFocus
                  />
                </Row>
              </>
            ) : null}

            {inStep === "set" ? (
              <>
                {numberRow}
                <Row label="Новый пароль" htmlFor="auth-set" aside={<span className="auth-row-hint">от 8 символов</span>}>
                  <PasswordInput id="auth-set" value={password} onChange={setPassword} autoComplete="new-password" autoFocus />
                </Row>
                <Row
                  label="Ещё раз"
                  htmlFor="auth-again"
                  note={mismatch ? "Пароли не совпадают" : ""}
                  noteId="fin-again-hint"
                  invalid={mismatch}
                >
                  <input
                    id="auth-again"
                    className="auth-input"
                    type="password"
                    value={again}
                    onChange={(event) => setAgain(event.target.value)}
                    onBlur={() => setAgainTouched(true)}
                    autoComplete="new-password"
                    aria-invalid={mismatch || undefined}
                    aria-describedby={mismatch ? "fin-again-hint" : undefined}
                  />
                </Row>
              </>
            ) : null}

            {inStep === "forgot-email" ? (
              <p className="auth-say">
                Пароль администратора сбрасывает владелец компании в личном кабинете. Пароль владельца
                восстанавливается только на сервере.
              </p>
            ) : null}
            {inStep === "forgot-sent" ? (
              <p className="auth-say">Когда пароль сбросят, введите номер снова - система попросит придумать новый.</p>
            ) : null}

            {registering ? null : failLine}

            <Go
              busy={busy}
              disabled={
                ((inStep === "phone" || inStep === "forgot") && !phoneReady) ||
                (inStep === "set" && (password.length === 0 || again.length === 0))
              }
            >
              {ACTIONS[inStep]}
            </Go>

            {inStep === "email" ? (
              <button type="button" className="auth-more" onClick={toEmployee}>
                Войти как сотрудник
                <Arrow />
              </button>
            ) : null}
            {inStep === "forgot-email" ? (
              <button type="button" className="auth-more" onClick={() => setStep("forgot")}>
                Сброс по номеру телефона
                <Arrow />
              </button>
            ) : null}
          </form>
        </Door>

        <Door
          title={HEADINGS.register}
          label="Регистрация компании"
          open={registering}
          bodyId="auth-door-new"
          onOpen={() => {
            setStep("register");
            focusFirstField("auth-door-new");
          }}
        >
          <form className="auth-sheet" onSubmit={submit} noValidate>
            <Row label="Компания" htmlFor="auth-company">
              <input
                id="auth-company"
                className="auth-input"
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder="ТОО «Компания»"
                autoComplete="organization"
                required
              />
            </Row>
            <Row label="Ваше имя" htmlFor="auth-name">
              <input
                id="auth-name"
                className="auth-input"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
                required
              />
            </Row>
            <Row label="Почта" htmlFor="auth-email">
              <input
                id="auth-email"
                className="auth-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="buh@company.kz"
                autoComplete="email"
                required
              />
            </Row>
            <Row label="Пароль" htmlFor="auth-new-password" aside={<span className="auth-row-hint">от 8 символов</span>}>
              <PasswordInput id="auth-new-password" value={password} onChange={setPassword} autoComplete="new-password" />
            </Row>
            {registering ? failLine : null}
            <Go busy={busy}>{ACTIONS.register}</Go>
          </form>
        </Door>
      </div>
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

/** Сколько сворачивается дверь (`.auth-door-body` в globals.css) - с запасом. */
const DOOR_FOLD_MS = 700;

/**
 * Дверь: заголовок крупно, под ним - её строки.
 *
 * Закрытая дверь - одна строка: заголовок приглушён, строки свёрнуты.
 * Открывается по щелчку в любом месте строки. Открытую не закрыть: одна из
 * двух открыта всегда. На шагах глубже первого перед заголовком - стрелка
 * назад.
 *
 * Строки закрытой двери снимаются, как только она свернулась: иначе на
 * странице два поля пароля сразу, и менеджер паролей волен заполнить
 * спрятанное. Пока сворачивается - `inert`, ни фокуса, ни ввода.
 */
function Door({
  title,
  label,
  open,
  bodyId,
  onOpen,
  back,
  children,
}: {
  title: string;
  /** Имя для экранного диктора и проверок, если заголовка мало. */
  label?: string;
  open: boolean;
  bodyId: string;
  onOpen: () => void;
  back?: { label: string; onClick: () => void };
  children: ReactNode;
}) {
  const [present, setPresent] = useState(open);
  // Открылась - строки нужны в этом же кадре, а не после эффекта: иначе
  // фокус в первое поле некуда поставить.
  if (open && !present) setPresent(true);
  useEffect(() => {
    if (open) return;
    const timer = window.setTimeout(() => setPresent(false), DOOR_FOLD_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <section className="auth-door" data-open={open || undefined}>
      <div className="auth-door-head">
        {back ? (
          <button type="button" className="auth-door-back" onClick={back.onClick} aria-label={back.label}>
            <Arrow back />
          </button>
        ) : null}
        <h2 className="auth-door-title">
          <button
            type="button"
            aria-label={label}
            aria-expanded={open}
            aria-controls={bodyId}
            tabIndex={open ? -1 : undefined}
            onClick={() => {
              if (!open) onOpen();
            }}
          >
            {/* Текст под SplitText на месте не меняется - новый заголовок новым элементом. */}
            <SplitReveal key={title} by="words" duration={0.8}>
              {title}
            </SplitReveal>
          </button>
        </h2>
      </div>
      <div id={bodyId} className="auth-door-body" inert={!open}>
        <div className="auth-door-inner">{present ? children : null}</div>
      </div>
    </section>
  );
}

/**
 * Строка книги: подпись на полях, значение на линейке, справа - короткое
 * («Забыли?», «от 8 символов», «Изменить»). Отказ - под значением, цветом.
 */
function Row({
  label,
  htmlFor,
  aside,
  note,
  noteId,
  invalid,
  children,
}: {
  label: string;
  htmlFor?: string;
  aside?: ReactNode;
  note?: string;
  noteId?: string;
  invalid?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="auth-row" data-invalid={invalid || undefined}>
      {htmlFor ? (
        <label className="auth-row-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="auth-row-label">{label}</span>
      )}
      <div className="auth-row-value">
        {children}
        {note ? (
          <span id={noteId} className="auth-row-note">
            {note}
          </span>
        ) : null}
      </div>
      {aside ? <div className="auth-row-aside">{aside}</div> : null}
    </div>
  );
}

/** Главное действие - плита от вертикали значений до края, со стрелкой. */
function Go({ busy, disabled, children }: { busy: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="submit" className="auth-go" disabled={busy || disabled} aria-busy={busy || undefined}>
      <span>{busy ? "Минуту…" : children}</span>
      {busy ? null : <Arrow />}
    </button>
  );
}

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg className="auth-arrow" viewBox="0 0 20 20" aria-hidden="true">
      <path d={back ? "M17 10H4M9 5l-5 5 5 5" : "M3 10h13M11 5l5 5-5 5"} />
    </svg>
  );
}

function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  autoFocus?: boolean;
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
    <input
      ref={ref}
      id={id}
      className="auth-input"
      type="password"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      autoComplete={autoComplete}
      required
    />
  );
}

/**
 * Экран смены временного пароля.
 *
 * Стоит между входом и разделом: пока пароль временный, сервер отказывает во
 * всём, кроме чтения и самой смены. Показывать вместо этого раздел, в котором
 * ничего не сохраняется, - худший из вариантов.
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
      <div className="auth-doors">
        <section className="auth-door" data-open="">
          <div className="auth-door-head">
            <h2 className="auth-door-title">Смена пароля</h2>
          </div>
          <div className="auth-door-body">
            <div className="auth-door-inner">
              <form className="auth-sheet" onSubmit={submit}>
                <Row label="Временный пароль" htmlFor="auth-old-password">
                  <PasswordInput
                    id="auth-old-password"
                    value={oldPassword}
                    onChange={setOld}
                    autoComplete="current-password"
                    autoFocus
                  />
                </Row>
                <Row
                  label="Новый пароль"
                  htmlFor="auth-fresh-password"
                  aside={<span className="auth-row-hint">от 8 символов</span>}
                >
                  <PasswordInput id="auth-fresh-password" value={newPassword} onChange={setNew} autoComplete="new-password" />
                </Row>
                {error ? (
                  <p className="auth-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <Go busy={busy}>Сменить пароль</Go>
              </form>
            </div>
          </div>
        </section>
      </div>
    </AuthStage>
  );
}

/**
 * Пока не знаем, вошёл ли человек, показываем не пустоту, а ожидание.
 *
 * Не афишей: следом почти всегда идёт форма входа, и афиша, собранная дважды
 * за полсекунды (сначала здесь, потом в форме), читалась бы как рывок.
 * Подпись проявляется с задержкой - при обычной проверке её не видно вовсе.
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
