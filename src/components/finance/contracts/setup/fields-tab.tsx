"use client";

/**
 * «Поля»: какие колонки есть у договора, как их заполняют и — у списков —
 * какие в них значения.
 *
 * С 28.09.2026 здесь и списки: вкладки «Поля» и «Списки» говорили об одном и
 * том же поле с двух концов, и было непонятно, где что править. Теперь поле —
 * одна строка (название, тип, что с ним не так), а всё о нём — в раскрытии под
 * строкой: название, тип, заполнение, обязательность, видимость и значения
 * списка. Закрытая строка молчит: на экране тридцать полей, и шум семи колонок
 * переключателей на каждой строке — то, что владелец назвал «непонятно, что за
 * реализация».
 *
 * Один список полей управляет листом, карточкой, разбором Excel, выгрузкой и
 * правами на поля, поэтому правка здесь меняет всё сразу — после ответа
 * сервера схема перечитывается, и лист перестраивается сам.
 *
 * Системное поле можно переименовать, спрятать, сделать обязательным, но не
 * убрать и не сменить ему тип: на нём держатся отборы листов, начисления и
 * долги. Это сказано словами у типа и в подсказке, а не молчаливым текстом,
 * который не нажимается.
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { type FieldType, type RegistryField, contractsApi } from "@/components/finance/api";
import { useRegistry } from "@/components/finance/contracts/store";
import { plural } from "@/components/finance/format";
import { useSessionState } from "@/components/session-state";
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon } from "@/components/icons";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { InlineText } from "@/components/finance/contracts/setup/inline-text";
import { ValuesPane, isListField, twins, unmeant } from "@/components/finance/contracts/setup/lists-tab";
import { ChoicePop } from "@/components/finance/contracts/setup/popover";
import { tip } from "@/components/finance/contracts/setup/tip";
import { useSetupAction } from "@/components/finance/contracts/setup/use-setup-action";
import { CUSTOM_TYPES, TYPE_WORDS, fillWord, hasValue } from "@/components/finance/contracts/setup/words";

const READ_ONLY = new Set(["paid_snapshot", "remaining_snapshot", "paid", "remaining", "summary_paid", "summary_remaining", "age_months"]);

/** Что значит тип поля — для подсказки у типа. */
const TYPE_TIPS: Partial<Record<FieldType, string>> = {
  text: "Свободный текст.",
  number: "Число без денег: количество, срок.",
  money: "Сумма в тенге с копейками — её складывают отчёты.",
  date: "Дата вида дд.мм.гггг.",
  bool: "Да или нет.",
  list: "Одно значение из списка — список раскрывается под полем.",
  multi_list: "Несколько значений из списка.",
  url: "Ссылка — в карточке открывается кнопкой.",
  person: "Сотрудник из личного кабинета («Люди»).",
  party: "Сторона договора: контрагент или наше юрлицо.",
  department: "Отдел компании. По нему режутся права «договоры своего отдела».",
  choice: "Выбор из нескольких вариантов, заданных системой.",
};

const FILL_TIP =
  "Как поле заполняют в листе и карточке: только из списка (напечатанное не из списка — отказ) или список с подсказкой, но можно своё (новое значение заведётся само).";

type Ask =
  | { kind: "archive"; field: RegistryField; count: number }
  | { kind: "type"; field: RegistryField; type: FieldType; count: number };

function inContracts(count: number): string {
  return `${count} ${plural(count, "договоре", "договорах", "договорах")}`;
}

export function FieldsTab() {
  const schema = useRegistry((s) => s.schema);
  const byId = useRegistry((s) => s.byId);
  const action = useSetupAction();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // Раскрытое поле и набранное новое переживают перезагрузку (`session-state.tsx`).
  const [openKey, setOpenKey] = useSessionState<string | null>("setup.field-open", null);
  const [title, setTitle] = useSessionState("setup.field-new.title", "");
  const [type, setType] = useSessionState<FieldType>("setup.field-new.type", "text");

  const fields = useMemo(
    () => [...(schema?.fields ?? [])].sort((a, b) => a.position - b.position),
    [schema],
  );

  // Сколько договоров держат значение поля — «в 212 договорах». Считается по
  // хранилищу: все договоры уже в браузере.
  const filled = useMemo(() => {
    const counts = new Map<string, number>();
    for (const contract of byId.values()) {
      if (contract.deleted) continue;
      for (const [key, value] of Object.entries(contract.values)) {
        if (hasValue(value)) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [byId]);

  // Строка, которую подвинули с клавиатуры, после перестройки списка снова
  // в фокусе: иначе второй Alt+↓ подряд уходил бы в никуда.
  useEffect(() => {
    if (!focusKey) return;
    document.querySelector<HTMLElement>(`[data-field-head="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: false });
  }, [focusKey, fields]);

  if (!schema) return null;

  const move = (index: number, dir: -1 | 1) => {
    const field = fields[index];
    const target = index + dir;
    if (!field || target < 0 || target >= fields.length) return;
    // Сервер ставит поле «после такого-то»; `null` — в самое начало.
    const after = dir === -1 ? (index >= 2 ? fields[index - 2].key : null) : fields[index + 1].key;
    void action.run(`move:${field.key}`, () => contractsApi.setup.updateField(field.key, { after }));
  };

  const onHeadKey = (event: KeyboardEvent<HTMLButtonElement>, index: number, key: string) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    setFocusKey(key);
    move(index, event.key === "ArrowUp" ? -1 : 1);
  };

  const patch = (field: RegistryField, data: Record<string, unknown>, slot: string) => {
    void action.run(`${slot}:${field.key}`, () => contractsApi.setup.updateField(field.key, data));
  };

  const add = async () => {
    const clean = title.trim();
    if (!clean) return;
    const ok = await action.run("add", () => contractsApi.setup.addField(clean, type));
    if (ok) {
      setTitle("");
      setType("text");
    }
  };

  return (
    <div className="setup-fields">
      <div className="setup-fhead">
        <span />
        <span className="eyebrow" {...tip("Колонка договора — в листе, карточке, выгрузке и правах. Щёлкните строку, чтобы открыть её настройки.")}>
          Поле
        </span>
        <span className="eyebrow" {...tip("Что в поле хранится: текст, сумма, дата, список… От типа зависит, как его заполняют и считают.")}>
          Тип
        </span>
        <span />
        <span className="eyebrow setup-num" {...tip("В скольких договорах поле заполнено.")}>
          Заполнено
        </span>
        <span />
      </div>
      <div role="list" aria-label="Поля договора">
        {fields.map((field, index) => {
          const count = filled.get(field.key) ?? 0;
          const open = openKey === field.key;
          const list = isListField(field);
          const values = schema.lists[field.key] ?? [];
          const twinCount = list ? twins(values) : 0;
          const bare = list ? unmeant(field, values) : 0;
          const errors = ["move", "required", "hidden", "type", "fill", "archive", "title"]
            .map((slot) => action.error(`${slot}:${field.key}`))
            .filter(Boolean);
          // Особое — только то, что отличает поле от обычного: так строка
          // молчит, пока с полем всё как у всех.
          const notes: { text: string; fail?: boolean; tip: string }[] = [];
          if (list) notes.push({ text: `${values.length} ${plural(values.length, "значение", "значения", "значений")}`, tip: "Значения списка — раскройте поле, чтобы их править." });
          if (bare) notes.push({ text: `без смысла ${bare}`, fail: true, tip: "У этих значений не назначен смысл — у договоров с ними горит замечание." });
          if (twinCount) notes.push({ text: `похожих ${twinCount}`, fail: true, tip: "Похоже на опечатку: два значения почти одинаковы и делят отчёт надвое. Раскройте поле — там «свести» или «это разные»." });
          if (field.required) notes.push({ text: "обязательное", tip: "Пустое поле даёт договору замечание «Не заполнено»." });
          if (field.hidden) notes.push({ text: "спрятано", tip: "Поля нет в листе и карточке, значения в договорах сохранены." });
          if (!field.system) notes.push({ text: "своё", tip: "Поле заведено здесь, а не системой: его можно удалить и сменить ему тип." });
          return (
            <div key={field.key} role="listitem" className="setup-frow" data-open={open ? "true" : undefined} data-hidden={field.hidden ? "true" : undefined}>
              <span className="setup-field-move">
                <button
                  type="button"
                  className="fin-icon-btn setup-move-btn"
                  aria-label={`Поднять «${field.title}»`}
                  {...tip("Выше в списке — левее в листе, выше в карточке. С клавиатуры: Alt и стрелка.")}
                  disabled={index === 0 || action.busy(`move:${field.key}`)}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpIcon size={15} />
                </button>
                <button
                  type="button"
                  className="fin-icon-btn setup-move-btn"
                  aria-label={`Опустить «${field.title}»`}
                  {...tip("Ниже в списке — правее в листе, ниже в карточке.")}
                  disabled={index === fields.length - 1 || action.busy(`move:${field.key}`)}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownIcon size={15} />
                </button>
              </span>
              <button
                type="button"
                className="setup-fhead-btn"
                data-field-head={field.key}
                aria-expanded={open}
                aria-label={`${field.title}, ${index + 1} из ${fields.length}. Alt и стрелка — подвинуть`}
                onKeyDown={(event) => onHeadKey(event, index, field.key)}
                onClick={() => setOpenKey(open ? null : field.key)}
              >
                <span className="setup-ftitle">{field.title}</span>
                <span className="setup-ftype">{TYPE_WORDS[field.type] ?? field.type}</span>
                <span className="setup-fnotes">
                  {notes.map((note) => (
                    <span key={note.text} className={note.fail ? "fin-fail" : undefined} {...tip(note.tip)}>
                      {note.text}
                    </span>
                  ))}
                </span>
                <span className="setup-fcount setup-num">{count || "—"}</span>
                <span className="setup-fchev" aria-hidden="true">
                  <ChevronRightIcon size={14} />
                </span>
              </button>
              {errors.length && !open ? (
                <span className="setup-field-note setup-error" role="alert">
                  {errors[0]}
                </span>
              ) : null}

              {open ? (
                <div className="setup-fbody">
                  <div className="setup-brow">
                    <span className="setup-blabel" {...tip("Так поле подписано в шапке листа, в карточке и в выгрузке. Загрузка Excel узнаёт колонку и по прежним названиям.")}>
                      Название
                    </span>
                    <span className="setup-bvalue">
                      <InlineText
                        value={field.title}
                        label="Название поля"
                        trace={action.trace(`title:${field.key}`)}
                        error={action.error(`title:${field.key}`)}
                        onCommit={(next) =>
                          void action.run(`title:${field.key}`, () => contractsApi.setup.updateField(field.key, { title: next }))
                        }
                      />
                    </span>
                  </div>

                  <div className="setup-brow">
                    <span className="setup-blabel" {...tip(TYPE_TIPS[field.type] ?? "Что в поле хранится.")}>
                      Тип
                    </span>
                    <span className="setup-bvalue">
                      {field.system ? (
                        <span className="setup-fixed" {...tip("Системное поле: на его типе держатся отборы листов, начисления и долги, поэтому тип не меняется. Нужен другой тип — заведите своё поле внизу списка.")}>
                          {TYPE_WORDS[field.type] ?? field.type}
                          <span className="fin-muted"> · системное, тип не меняется</span>
                        </span>
                      ) : (
                        <ChoicePop
                          value={field.type}
                          options={CUSTOM_TYPES.map((item) => ({ value: item, label: TYPE_WORDS[item], hint: TYPE_TIPS[item] }))}
                          label={`Тип поля «${field.title}»`}
                          disabled={action.busy(`type:${field.key}`)}
                          onPick={(next) => {
                            if (count > 0) setAsk({ kind: "type", field, type: next as FieldType, count });
                            else patch(field, { type: next }, "type");
                          }}
                        />
                      )}
                    </span>
                  </div>

                  {field.fill && field.fills && field.fills.length > 1 ? (
                    <div className="setup-brow">
                      <span className="setup-blabel" {...tip(FILL_TIP)}>
                        Заполнение
                      </span>
                      <span className="setup-bvalue">
                        <ChoicePop
                          value={field.fill}
                          options={field.fills.map((item) => ({ value: item, label: fillWord(field.type, item) }))}
                          label={`Как заполняется «${field.title}»`}
                          disabled={action.busy(`fill:${field.key}`)}
                          onPick={(next) => patch(field, { fill: next }, "fill")}
                        />
                      </span>
                    </div>
                  ) : null}

                  <div className="setup-brow">
                    <span className="setup-blabel" {...tip("Обязательное поле не запрещает сохранить договор: пустое даёт замечание «Не заполнено», и договор виден в «N замечаний».")}>
                      Обязательное
                    </span>
                    <span className="setup-bvalue">
                      {READ_ONLY.has(field.key) ? (
                        <span className="fin-muted">считается само — только чтение</span>
                      ) : (
                        <span className="setup-pair" role="radiogroup" aria-label={`«${field.title}» обязательное`}>
                          {[
                            { on: false, label: "нет" },
                            { on: true, label: "да — пустое даёт замечание" },
                          ].map((item) => (
                            <button
                              key={String(item.on)}
                              type="button"
                              role="radio"
                              className="setup-toggle"
                              aria-checked={field.required === item.on}
                              data-on={field.required === item.on ? "true" : undefined}
                              disabled={action.busy(`required:${field.key}`)}
                              onClick={() => field.required !== item.on && patch(field, { required: item.on }, "required")}
                            >
                              {item.label}
                            </button>
                          ))}
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="setup-brow">
                    <span className="setup-blabel" {...tip("Спрятанного поля нет в листе и карточке ни у кого. Значения в договорах остаются — покажете, и они вернутся.")}>
                      Видно
                    </span>
                    <span className="setup-bvalue">
                      <span className="setup-pair" role="radiogroup" aria-label={`«${field.title}» видно`}>
                        {[
                          { hidden: false, label: "в листе и карточке" },
                          { hidden: true, label: "спрятано" },
                        ].map((item) => (
                          <button
                            key={String(item.hidden)}
                            type="button"
                            role="radio"
                            className="setup-toggle"
                            aria-checked={field.hidden === item.hidden}
                            data-on={field.hidden === item.hidden ? "true" : undefined}
                            disabled={action.busy(`hidden:${field.key}`)}
                            onClick={() => field.hidden !== item.hidden && patch(field, { hidden: item.hidden }, "hidden")}
                          >
                            {item.label}
                          </button>
                        ))}
                      </span>
                    </span>
                  </div>

                  {list ? (
                    <div className="setup-fvalues">
                      <p className="setup-fvalues-title" {...tip("Что можно выбрать в этом поле. Переименование, смысл и сведение двух значений в одно — здесь; договоры следуют сами.")}>
                        Значения
                      </p>
                      <ValuesPane field={field} />
                    </div>
                  ) : null}

                  {errors.length ? (
                    <p className="setup-error" role="alert">
                      {errors[0]}
                    </p>
                  ) : null}

                  {field.system ? null : (
                    <div className="setup-block-foot">
                      <button
                        type="button"
                        className="fin-link-btn setup-quiet"
                        {...tip(count ? `Значения в ${inContracts(count)} уйдут вместе с полем в корзину.` : "Поле уйдёт в корзину. Вернуть — из корзины в личном кабинете.")}
                        disabled={action.busy(`archive:${field.key}`)}
                        onClick={() => setAsk({ kind: "archive", field, count })}
                      >
                        Удалить поле
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <form
        className="setup-add"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <span className="setup-add-lead" {...tip("Своё поле — колонка, которой нет в системе: «Источник», «Коммент БИС». Встанет в конец списка, в листы — через «Листы» → колонки.")}>
          + Поле
        </span>
        <input
          type="text"
          className="setup-input"
          value={title}
          placeholder="Название"
          aria-label="Название нового поля"
          onChange={(event) => setTitle(event.target.value)}
        />
        <span className="setup-add-type">
          тип{" "}
          <ChoicePop
            value={type}
            options={CUSTOM_TYPES.map((item) => ({ value: item, label: TYPE_WORDS[item], hint: TYPE_TIPS[item] }))}
            label="Тип нового поля"
            onPick={(next) => setType(next as FieldType)}
          />
        </span>
        <button type="submit" className="btn-primary btn-sm" disabled={!title.trim() || action.busy("add")}>
          Добавить
        </button>
        {action.error("add") ? (
          <span className="setup-error setup-add-error" role="alert">
            {action.error("add")}
          </span>
        ) : null}
      </form>

      <ConfirmDialog
        open={ask?.kind === "archive"}
        title={ask ? `Удалить поле «${ask.field.title}»?` : ""}
        text={
          ask && ask.count > 0
            ? `Значения в ${inContracts(ask.count)} уйдут вместе с ним в корзину. Вернуть — из корзины в личном кабинете.`
            : "В договорах оно пока не заполнено. Вернуть — из корзины в личном кабинете."
        }
        confirm="Удалить"
        danger
        busy={ask ? action.busy(`archive:${ask.field.key}`) : false}
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          if (!ask) return;
          const field = ask.field;
          setAsk(null);
          setOpenKey(null);
          void action.run(`archive:${field.key}`, () => contractsApi.setup.updateField(field.key, { archived: true }));
        }}
      />
      <ConfirmDialog
        open={ask?.kind === "type"}
        title={ask ? `Сменить тип поля «${ask.field.title}»?` : ""}
        text={
          ask?.kind === "type"
            ? `Значения в ${inContracts(ask.count)} останутся как записаны — к типу «${TYPE_WORDS[ask.type]}» они не приводятся.`
            : ""
        }
        confirm="Сменить"
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          if (ask?.kind !== "type") return;
          const { field, type: next } = ask;
          setAsk(null);
          patch(field, { type: next }, "type");
        }}
      />
    </div>
  );
}
