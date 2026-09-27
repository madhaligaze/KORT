"use client";

/**
 * «Списки»: значения статуса, вида, предмета, хозяйственного смысла и своих
 * полей-списков — со смыслом, который за ними стоит.
 *
 * Смысл — то, что система делает со значением: у статуса фаза («действует»,
 * «расторгнут») или «передача бухгалтеру»; у вида и предмета — начисление,
 * хозяйственный смысл и подписи сторон; у своего значения хозяйственного
 * смысла — к какому из четырёх системных оно относится. Статус без смысла
 * набран розой: у договоров с ним горит замечание «статус без смысла», и это
 * отказ, а не оформление.
 *
 * Что можно убрать, решает сервер, а экран показывает его отказ у действия:
 * значение системного списка, стоящее в договорах, в архив не уходит (его
 * сводят с другим); базовые четыре смысла не убираются, не меняют смысл и не
 * сводятся в другое. Значение своего списка уходит в архив свободно — подпись
 * в договорах держится `archived_values` схемы.
 *
 * «Похоже на …» — двойник, найденный сервером («Абонентское обслуживаниее»
 * рядом с «Абонентское обслуживание»): в «списке или своём» новое значение
 * заводится из напечатанного, и опечатка делит отчёт надвое. Свести — тем же
 * сведением, что по отметкам; «разные» — пара больше не подсказывается.
 */
import { useMemo, useState } from "react";

import { type ListValue, type RegistryField, contractsApi } from "@/components/finance/api";
import { useRegistry } from "@/components/finance/contracts/store";
import { plural } from "@/components/finance/format";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { InlineText } from "@/components/finance/contracts/setup/inline-text";
import { ChoicePop, type PopOption } from "@/components/finance/contracts/setup/popover";
import { useSetupAction, type SetupAction } from "@/components/finance/contracts/setup/use-setup-action";
import { useSessionState } from "@/components/session-state";
import {
  BILLING_WORDS,
  ECONOMIC_WORDS,
  PHASE_WORDS,
  SYSTEM_LISTS,
  countByValue,
  slotTitles,
} from "@/components/finance/contracts/setup/words";

type Shape = "status" | "deal" | "economic" | "plain";

function shapeOf(key: string): Shape {
  if (key === "status") return "status";
  if (key === "type" || key === "subject") return "deal";
  if (key === "economic_role") return "economic";
  return "plain";
}

function contractsWord(count: number): string {
  return `${count} ${plural(count, "договоре", "договорах", "договорах")}`;
}

export function ListsTab() {
  const schema = useRegistry((s) => s.schema);
  // Выбранный список переживает перезагрузку (`session-state.tsx`).
  const [current, setCurrent] = useSessionState("setup.list", "status");

  const listFields = useMemo(() => {
    if (!schema) return [] as RegistryField[];
    const system = SYSTEM_LISTS.map((key) => schema.fields.find((item) => item.key === key)).filter(
      (item): item is RegistryField => !!item,
    );
    const own = schema.fields
      .filter((item) => !item.system && (item.type === "list" || item.type === "multi_list"))
      .sort((a, b) => a.position - b.position);
    return [...system, ...own];
  }, [schema]);

  if (!schema) return null;
  const field = listFields.find((item) => item.key === current) ?? listFields[0];

  return (
    <div className="setup-split">
      <nav className="setup-side" aria-label="Списки">
        {listFields.map((item) => (
          <button
            key={item.key}
            type="button"
            className="setup-side-item"
            aria-current={item.key === field?.key ? "true" : undefined}
            onClick={() => setCurrent(item.key)}
          >
            <span className="setup-side-title">{item.title}</span>
            <span className="setup-side-count">
              {schema.lists[item.key]?.length ?? 0}
              {twins(schema.lists[item.key]) ? ` · похожих ${twins(schema.lists[item.key])}` : ""}
            </span>
          </button>
        ))}
      </nav>
      {field ? <ValuesPane key={field.key} field={field} /> : null}
    </div>
  );
}

function twins(values: ListValue[] | undefined): number {
  return (values ?? []).filter((item) => item.similar).length;
}

type Ask =
  | { kind: "merge"; keep: ListValue; drop: ListValue; count: number }
  | { kind: "archive"; value: ListValue; count: number };

function ValuesPane({ field }: { field: RegistryField }) {
  const schema = useRegistry((s) => s.schema);
  const byId = useRegistry((s) => s.byId);
  const action = useSetupAction();
  const [picked, setPicked] = useState<string[]>([]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [draft, setDraft] = useSessionState(`setup.list.${field.key}.new`, "");
  const [draftSystem, setDraftSystem] = useSessionState(`setup.list.${field.key}.new-system`, "");
  const [addError, setAddError] = useState("");

  const shape = shapeOf(field.key);
  const systemList = SYSTEM_LISTS.includes(field.key);
  const values = useMemo(() => schema?.lists[field.key] ?? [], [schema, field.key]);
  const counts = useMemo(() => countByValue(byId.values(), field.key), [byId, field.key]);
  const slots = slotTitles(schema);

  // Четыре базовых значения хозяйственного смысла сервер не даёт убрать,
  // перевести на другой смысл или свести в другое (`setup._base_economic`:
  // первое по порядку значение с каждым системным смыслом). Здесь это знание
  // нужно только чтобы не открывать диалог «В архив?» ради заведомого отказа —
  // сам отказ и его текст приходят с сервера.
  const protectedIds = useMemo(() => {
    if (shape !== "economic") return new Set<string>();
    const seen = new Set<string>();
    const out = new Set<string>();
    for (const value of [...values].sort((a, b) => a.position - b.position)) {
      const system = value.meaning.system;
      if (system && !seen.has(system)) {
        seen.add(system);
        out.add(value.id);
      }
    }
    return out;
  }, [values, shape]);

  const pickedValues = picked.map((id) => values.find((item) => item.id === id)).filter((item): item is ListValue => !!item);

  const setMeaning = (value: ListValue, meaning: ListValue["meaning"], slot: string) => {
    void action.run(`${slot}:${value.id}`, () => contractsApi.setup.updateValue(value.id, { meaning }));
  };

  const add = async () => {
    const clean = draft.trim();
    if (!clean) return;
    setAddError("");
    if (values.some((item) => item.value.trim().toLowerCase() === clean.toLowerCase())) {
      setAddError(`«${clean}» в этом списке уже есть`);
      return;
    }
    const meaning = shape === "economic" ? { system: draftSystem } : undefined;
    const ok = await action.run("add", () => contractsApi.setup.addValue(field.key, clean, meaning));
    if (ok) {
      setDraft("");
      setDraftSystem("");
    }
  };

  const phaseOptions: PopOption[] = [
    ...(schema?.status_phases ?? Object.keys(PHASE_WORDS)).map((phase) => ({
      value: phase,
      label: `фаза: ${PHASE_WORDS[phase] ?? phase}`,
    })),
    { value: "handover", label: "передача бухгалтеру" },
    { value: "", label: "не назначен", fail: true },
  ];
  const billingOptions: PopOption[] = [
    ...(schema?.billing_kinds ?? Object.keys(BILLING_WORDS)).map((kind) => ({ value: kind, label: BILLING_WORDS[kind] ?? kind })),
    { value: "", label: "—" },
  ];
  const economicOptions: PopOption[] = (schema?.economic_roles ?? Object.keys(ECONOMIC_WORDS)).map((role) => ({
    value: role,
    label: ECONOMIC_WORDS[role] ?? role,
  }));

  return (
    <section className="setup-pane" aria-label={field.title}>
      <div className="setup-vrow setup-vhead" data-shape={shape} aria-hidden="true">
        <span />
        <span className="eyebrow">Значение</span>
        {shape === "status" ? <span className="eyebrow">Смысл</span> : null}
        {shape === "deal" ? (
          <>
            <span className="eyebrow">Стороны</span>
            <span className="eyebrow">Начисление</span>
            <span className="eyebrow">Смысл</span>
          </>
        ) : null}
        {shape === "economic" ? <span className="eyebrow">Системный смысл</span> : null}
        <span className="eyebrow setup-num">В договорах</span>
        <span />
      </div>

      {values.length ? null : <p className="creg-empty">В этом списке пока пусто</p>}

      {values.map((value) => {
        const count = counts.get(value.id) ?? 0;
        const errors = ["name", "meaning", "billing", "economic", "roles-executor", "roles-customer", "archive", "distinct"]
          .map((slot) => action.error(`${slot}:${value.id}`))
          .filter(Boolean);
        const twin = value.similar ? values.find((item) => item.id === value.similar) : undefined;
        const statusValue = value.meaning.handover ? "handover" : value.meaning.phase ?? "";
        const roles = value.meaning.roles ?? {};
        return (
          <div key={value.id} className="setup-vrow" data-shape={shape}>
            <span className="setup-vcheck">
              <input
                type="checkbox"
                aria-label={`Отметить «${value.value}» для сведения`}
                checked={picked.includes(value.id)}
                onChange={(event) =>
                  setPicked((list) => (event.target.checked ? [...list, value.id] : list.filter((id) => id !== value.id)))
                }
              />
            </span>
            <span className="setup-vname">
              <InlineText
                value={value.value}
                label="Значение"
                trace={action.trace(`name:${value.id}`)}
                onCommit={(next) =>
                  void action.run(`name:${value.id}`, () => contractsApi.setup.updateValue(value.id, { value: next }))
                }
              />
            </span>

            {shape === "status" ? (
              <span className="setup-vmeaning" data-label="Смысл">
                <ChoicePop
                  value={statusValue}
                  options={phaseOptions}
                  label={`Смысл статуса «${value.value}»`}
                  fail={!statusValue}
                  disabled={action.busy(`meaning:${value.id}`)}
                  onPick={(next) =>
                    setMeaning(
                      value,
                      next === "handover" ? { handover: "accounting" } : next ? { phase: next } : {},
                      "meaning",
                    )
                  }
                />
              </span>
            ) : null}

            {shape === "deal" ? (
              <>
                <span className="setup-vroles" data-label="Стороны">
                  <InlineText
                    value={roles.executor ?? ""}
                    placeholder={slots.executor}
                    allowEmpty
                    label="Первая сторона"
                    trace={action.trace(`roles-executor:${value.id}`)}
                    onCommit={(next) =>
                      void action.run(`roles-executor:${value.id}`, () =>
                        contractsApi.setup.updateValue(value.id, {
                          meaning: { ...value.meaning, roles: { ...roles, executor: next } },
                        }),
                      )
                    }
                  />
                  <span className="setup-arrow" aria-hidden="true">
                    →
                  </span>
                  <InlineText
                    value={roles.customer ?? ""}
                    placeholder={slots.customer}
                    allowEmpty
                    label="Вторая сторона"
                    trace={action.trace(`roles-customer:${value.id}`)}
                    onCommit={(next) =>
                      void action.run(`roles-customer:${value.id}`, () =>
                        contractsApi.setup.updateValue(value.id, {
                          meaning: { ...value.meaning, roles: { ...roles, customer: next } },
                        }),
                      )
                    }
                  />
                </span>
                <span className="setup-vbilling" data-label="Начисление">
                  <ChoicePop
                    value={value.meaning.billing ?? ""}
                    options={billingOptions}
                    label={`Начисление «${value.value}»`}
                    disabled={action.busy(`billing:${value.id}`)}
                    onPick={(next) => setMeaning(value, { ...value.meaning, billing: next }, "billing")}
                  />
                </span>
                <span className="setup-veconomic" data-label="Смысл">
                  <ChoicePop
                    value={value.meaning.economic_role ?? ""}
                    options={[...economicOptions, { value: "", label: "—" }]}
                    label={`Хозяйственный смысл «${value.value}»`}
                    disabled={action.busy(`economic:${value.id}`)}
                    onPick={(next) => setMeaning(value, { ...value.meaning, economic_role: next }, "economic")}
                  />
                </span>
              </>
            ) : null}

            {shape === "economic" ? (
              <span className="setup-vmeaning" data-label="Системный смысл">
                <ChoicePop
                  value={value.meaning.system ?? ""}
                  options={[...economicOptions, ...(value.meaning.system ? [] : [{ value: "", label: "не назначен", fail: true }])]}
                  label={`Системный смысл «${value.value}»`}
                  fail={!value.meaning.system}
                  empty="не назначен"
                  disabled={action.busy(`meaning:${value.id}`)}
                  onPick={(next) => setMeaning(value, { ...value.meaning, system: next }, "meaning")}
                />
              </span>
            ) : null}

            <span className="setup-vcount setup-num">{count}</span>
            <span className="setup-vaction">
              <button
                type="button"
                className="fin-link-btn setup-quiet"
                disabled={action.busy(`archive:${value.id}`)}
                onClick={() => {
                  // Заведомый отказ (базовый смысл, используемое значение
                  // системного списка) — без диалога: запрос сразу, и под
                  // строкой встаёт объяснение сервера.
                  if (protectedIds.has(value.id) || (systemList && count > 0)) {
                    void action.run(`archive:${value.id}`, () =>
                      contractsApi.setup.updateValue(value.id, { archived: true }),
                    );
                  } else {
                    setAsk({ kind: "archive", value, count });
                  }
                }}
              >
                Удалить
              </button>
            </span>
            {errors.length ? (
              <span className="setup-vnote setup-error" role="alert">
                {errors[0]}
              </span>
            ) : null}
            {twin && !errors.length ? (
              <span className="setup-vnote">
                похоже на «{twin.value}» ·{" "}
                <button
                  type="button"
                  className="fin-link-btn"
                  disabled={action.busy("merge")}
                  onClick={() => setAsk({ kind: "merge", keep: twin, drop: value, count })}
                >
                  свести в «{twin.value}»
                </button>{" "}
                ·{" "}
                <button
                  type="button"
                  className="fin-link-btn"
                  disabled={action.busy(`distinct:${value.id}`)}
                  onClick={() =>
                    void action.run(`distinct:${value.id}`, () => contractsApi.setup.updateValue(value.id, { distinct: twin.id }))
                  }
                >
                  это разные
                </button>
              </span>
            ) : null}
          </div>
        );
      })}

      {pickedValues.length ? (
        <MergeBar
          picked={pickedValues}
          counts={counts}
          action={action}
          onClear={() => setPicked([])}
          onAsk={(keep, drop) => setAsk({ kind: "merge", keep, drop, count: counts.get(drop.id) ?? 0 })}
        />
      ) : null}

      <form
        className="setup-add"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <span className="setup-add-lead">+ Значение</span>
        <input
          type="text"
          className="setup-input"
          value={draft}
          placeholder={field.key === "status" ? "Например, «на согласовании»" : "Значение"}
          aria-label={`Новое значение списка «${field.title}»`}
          onChange={(event) => {
            setDraft(event.target.value);
            setAddError("");
          }}
        />
        {shape === "economic" ? (
          <span className="setup-add-type">
            относится к{" "}
            <ChoicePop
              value={draftSystem}
              options={economicOptions}
              empty="выбрать…"
              label="Системный смысл нового значения"
              onPick={setDraftSystem}
            />
          </span>
        ) : null}
        <button
          type="submit"
          className="btn-primary btn-sm"
          disabled={!draft.trim() || action.busy("add") || (shape === "economic" && !draftSystem)}
        >
          Добавить
        </button>
        {addError || action.error("add") ? (
          <span className="setup-error setup-add-error" role="alert">
            {addError || action.error("add")}
          </span>
        ) : null}
      </form>

      <ConfirmDialog
        open={ask?.kind === "merge"}
        title={ask?.kind === "merge" ? `Свести «${ask.drop.value}» в «${ask.keep.value}»?` : ""}
        text={
          ask?.kind === "merge"
            ? ask.count > 0
              ? `В ${contractsWord(ask.count)} «${ask.drop.value}» сменится на «${ask.keep.value}». «${ask.drop.value}» уйдёт из списка.`
              : `«${ask.drop.value}» ни в одном договоре не стоит и уйдёт из списка.`
            : ""
        }
        confirm="Свести"
        busy={action.busy("merge")}
        onCancel={() => setAsk(null)}
        onConfirm={async () => {
          if (ask?.kind !== "merge") return;
          const { keep, drop } = ask;
          setAsk(null);
          const ok = await action.run("merge", () => contractsApi.setup.mergeValues(keep.id, drop.id), "all");
          if (ok) setPicked([]);
        }}
      />
      <ConfirmDialog
        open={ask?.kind === "archive"}
        title={ask?.kind === "archive" ? `Удалить «${ask.value.value}»?` : ""}
        text={
          ask?.kind === "archive" && ask.count > 0
            ? `Значение стоит в ${contractsWord(ask.count)}: там его подпись останется, а для выбора его больше не будет.`
            : "Значение ни в одном договоре не стоит и уйдёт из списка в корзину. Вернуть — из корзины в личном кабинете."
        }
        confirm="Удалить"
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          if (ask?.kind !== "archive") return;
          const { value } = ask;
          setAsk(null);
          void action.run(`archive:${value.id}`, () => contractsApi.setup.updateValue(value.id, { archived: true }));
        }}
      />
    </section>
  );
}

function MergeBar({
  picked,
  counts,
  action,
  onClear,
  onAsk,
}: {
  picked: ListValue[];
  counts: Map<string, number>;
  action: SetupAction;
  onClear: () => void;
  onAsk: (keep: ListValue, drop: ListValue) => void;
}) {
  const [a, b] = picked;
  return (
    <div className="setup-merge" role="group" aria-label="Свести значения">
      {picked.length === 1 ? (
        <span className="fin-soft">Отметьте второе значение, чтобы свести их в одно.</span>
      ) : picked.length > 2 ? (
        <span className="fin-soft">Сводятся два значения за раз — отмечено {picked.length}.</span>
      ) : (
        <>
          <span>Свести в одно:</span>
          <button type="button" className="fin-link-btn" disabled={action.busy("merge")} onClick={() => onAsk(a, b)}>
            оставить «{a.value}»
          </button>
          <span className="setup-num fin-muted">{counts.get(a.id) ?? 0}</span>
          <span className="fin-muted">·</span>
          <button type="button" className="fin-link-btn" disabled={action.busy("merge")} onClick={() => onAsk(b, a)}>
            оставить «{b.value}»
          </button>
          <span className="setup-num fin-muted">{counts.get(b.id) ?? 0}</span>
        </>
      )}
      <button type="button" className="fin-link-btn setup-quiet setup-merge-clear" onClick={onClear}>
        Снять отметки
      </button>
      {action.error("merge") ? (
        <span className="setup-error setup-merge-error" role="alert">
          {action.error("merge")}
        </span>
      ) : null}
    </div>
  );
}
