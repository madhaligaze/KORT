"use client";

/**
 * Поле карточки: покой, наведение, правка, сохранение — одно поведение для
 * всех типов (фронт-план 6.2, «Поле»).
 *
 * Кнопки «Сохранить» нет, и сохранение молчит: под полем прочерчивается
 * волосяная линия и гаснет. Сообщение — только при отказе и только у поля.
 * Сторона и сумма существующего договора спрашивают «опечатка или с даты»
 * прямо под полем; пока нет ответа, новое значение стоит приглушённым.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { type Party, type RegistryField, type RegistrySchema, contractsApi } from "@/components/finance/api";
import { ChangeMode } from "@/components/finance/contracts/change-mode";
import { Combo, PartyPicker, type ComboOption } from "@/components/finance/contracts/pickers";
import { departmentText, listText } from "@/components/finance/contracts/schema";
import { isSimilar } from "@/components/finance/contracts/similar";
import {
  answer,
  cancel,
  edit as editField,
  insist,
  reloadSchema,
  useRegistry,
  type Edit,
} from "@/components/finance/contracts/store";
import { contractMoney, formatDay, middleEllipsis, parseDay, shortName } from "@/components/finance/format";
import { useSessionDrop, useSessionState } from "@/components/session-state";

type Props = {
  contractId: string | null;
  field: RegistryField;
  label?: string;
  labelNote?: string;
  wide?: boolean;
  suffix?: string;
  /** Новый договор: первое заполненное поле заводит его на сервере. */
  onDraft?: (key: string, value: unknown) => void;
  placeholder?: string;
};

function display(
  field: RegistryField,
  value: unknown,
  ctx: {
    schema: RegistrySchema | null;
    parties: Readonly<Record<string, Party>>;
    people: Readonly<Record<string, { name: string }>>;
  },
): string {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return "";
  switch (field.type) {
    case "party":
      if (typeof value === "object" && value && "name" in value) return String((value as { name: string }).name);
      return ctx.parties[String(value)]?.name ?? String(value);
    case "list":
      return listText(ctx.schema, field.key, value) || String(value);
    case "multi_list":
      return (value as string[]).map((item) => listText(ctx.schema, field.key, item) || item).join(", ");
    case "department":
      return departmentText(ctx.schema, value) || String(value);
    case "person":
      return (Array.isArray(value) ? value : String(value).split(","))
        .map((item) => {
          const person = ctx.people[String(item)];
          return person ? shortName(person.name) : String(item);
        })
        .join(", ");
    case "money":
    case "number":
      return contractMoney(value);
    case "date":
      return formatDay(value);
    case "bool":
      return value ? "Да" : "Нет";
    case "choice":
      return field.choices?.find((item) => item.value === value)?.label ?? String(value);
    default:
      return String(value);
  }
}

export function InlineField({ contractId, field, label, labelNote, wide, suffix, onDraft, placeholder }: Props) {
  const schema = useRegistry((s) => s.schema);
  const parties = useRegistry((s) => s.parties);
  const people = useRegistry((s) => s.people);
  const contract = useRegistry((s) => (contractId ? s.byId.get(contractId) : undefined));
  const edit: Edit | undefined = useRegistry((s) => (contractId ? s.edits.get(contractId)?.get(field.key) : undefined));
  // Поле, открытое на правку, и набранный в нём текст переживают перезагрузку
  // (`session-state.tsx`); принятая или отменённая правка черновик стирает.
  const draftKey = `card.${contractId ?? "new"}.${field.key}`;
  const dropDraft = useSessionDrop();
  const [editing, setEditing] = useSessionState(`${draftKey}.editing`, false);
  const [done, setDone] = useState(false);
  const wasSending = useRef(false);

  const stored = contract?.values[field.key];
  const value = edit && edit.state !== "conflict" ? edit.value : stored;
  const text = display(field, value, { schema, parties, people });
  const readOnly = !field.editable;

  // Прочерк «сохранено» гаснет сам: включается в кадре анимации после ответа,
  // выключается через 0,7 с — оба раза из таймера, а не посреди эффекта.
  useEffect(() => {
    if (edit?.state === "sending") {
      wasSending.current = true;
      return;
    }
    if (edit || !wasSending.current) return;
    wasSending.current = false;
    const on = requestAnimationFrame(() => setDone(true));
    const off = setTimeout(() => setDone(false), 700);
    return () => {
      cancelAnimationFrame(on);
      clearTimeout(off);
    };
  }, [edit]);

  const commit = (next: unknown) => {
    setEditing(false);
    dropDraft(draftKey);
    if (contractId) editField(contractId, field.key, next);
    else onDraft?.(field.key, next);
  };
  const stopEditing = () => {
    setEditing(false);
    dropDraft(draftKey);
  };

  const traceState = edit?.state === "sending" || edit?.state === "queued"
    ? "sending"
    : edit?.state === "failed" || edit?.state === "conflict"
      ? "failed"
      : done
        ? "done"
        : undefined;

  let control: ReactNode;
  if (editing && !readOnly) {
    // Наша сторона закрыта на наши юрлица, но у покупки наше ТОО — заказчик, и
    // исполнитель законно чужой (правило сервера `_OTHER_SIDE`).
    const other = field.key === "executor" ? "customer" : field.key === "customer" ? "executor" : "";
    const otherOwn = Boolean(other && parties[String(contract?.values[other] ?? "")]?.own);
    control = (
      <Editor
        field={field}
        value={stored}
        otherOwn={otherOwn}
        onCommit={commit}
        onCancel={stopEditing}
        placeholder={placeholder ?? label ?? field.title}
        draftKey={`${draftKey}.text`}
      />
    );
  } else if (field.type === "url" && typeof value === "string" && value) {
    control = (
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem" }}>
        <button
          type="button"
          className="ifield-value fin-mono"
          style={{ flex: 1, fontSize: "0.8125rem" }}
          data-readonly={readOnly ? "true" : undefined}
          title={readOnly ? "Нет права правки" : value}
          onClick={() => !readOnly && setEditing(true)}
        >
          {middleEllipsis(value)}
        </button>
        <a href={value} target="_blank" rel="noopener noreferrer" className="fin-link-btn" style={{ whiteSpace: "nowrap", fontSize: "0.8125rem" }}>
          Открыть ↗
        </a>
      </div>
    );
  } else {
    control = (
      <button
        type="button"
        className="ifield-value"
        data-empty={text ? undefined : "true"}
        data-pending={edit?.state === "asking" ? "true" : undefined}
        data-readonly={readOnly ? "true" : undefined}
        title={readOnly ? "Нет права правки" : undefined}
        onClick={() => !readOnly && setEditing(true)}
        aria-label={`${label ?? field.title}: ${text || "пусто"}`}
      >
        {text ? (
          <>
            {text}
            {suffix ? <small className="fin-muted"> {suffix}</small> : null}
          </>
        ) : (
          "—"
        )}
      </button>
    );
  }

  return (
    <div className="ifield" data-wide={wide ? "true" : undefined}>
      <div className="ifield-label">
        <span className="eyebrow">{label ?? field.title}</span>
        {labelNote ? <span className="annot">{labelNote}</span> : null}
      </div>
      {control}
      <span className="ifield-trace" data-state={traceState} aria-hidden="true" />
      {edit?.state === "asking" && contractId ? (
        <ChangeMode
          onFix={() => answer(contractId, field.key, { kind: "fix" })}
          onFromDate={(iso) => answer(contractId, field.key, { kind: "from_date", effective_from: iso })}
          onCancel={() => cancel(contractId, field.key)}
        />
      ) : null}
      {edit?.state === "failed" ? <div className="ifield-error">{edit.error}</div> : null}
      {edit?.state === "conflict" && contractId ? (
        <div className="ifield-error">
          Только что изменено{edit.by ? `: ${edit.by}` : ""} — {display(field, edit.theirs, { schema, parties, people }) || "пусто"}.
          Ваше: {display(field, edit.value, { schema, parties, people }) || "пусто"} ·{" "}
          <button type="button" className="fin-link-btn" onClick={() => insist(contractId, field.key)}>
            Поставить моё
          </button>{" "}
          ·{" "}
          <button type="button" className="fin-link-btn" onClick={() => cancel(contractId, field.key)}>
            Оставить
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Завести значение закрытого списка прямо из выбора — только тому, кто
 * настраивает реестр. Значение заводится в настройке тем же запросом, что во
 * вкладке «Списки», схема перечитывается, и в поле уходит уже идентификатор:
 * иначе карточка на секунду показала бы его вместо подписи.
 */
async function addToList(field: RegistryField, text: string): Promise<string> {
  const created =
    field.type === "department"
      ? await contractsApi.setup.addDepartment({ code: text })
      : await contractsApi.setup.addValue(field.key, text);
  await reloadSchema();
  return created.id;
}

function Editor({
  field,
  value,
  otherOwn = false,
  onCommit,
  onCancel,
  placeholder,
  draftKey,
}: {
  field: RegistryField;
  value: unknown;
  otherOwn?: boolean;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
  placeholder: string;
  /** Где в сессии лежит набранный текст (`TextEditor`). */
  draftKey: string;
}) {
  const schema = useRegistry((s) => s.schema);
  const people = useRegistry((s) => s.people);
  const staff = useRegistry((s) => s.staff);
  const [failure, setFailure] = useState("");
  // Напечатано почти то же, что уже есть в списке, — сначала вопрос.
  const [twin, setTwin] = useState<{ text: string; option: ComboOption } | null>(null);
  const canSetup = Boolean(schema?.access.setup);
  // Сбой «добавить в список» показывается под полем, а выбор остаётся открытым.
  const guarded = (run: () => Promise<void>) => {
    setFailure("");
    run().catch((exc) => setFailure(exc instanceof Error ? exc.message : "Не добавилось"));
  };

  if (field.type === "party") {
    const own: Party[] = (schema?.own_entities ?? []).map((item) => ({
      id: item.id,
      name: item.name,
      own: true,
      code: item.code,
      bin: item.bin,
    }));
    return (
      <>
        <PartyPicker
          slot={field.key === "customer" ? "customer" : "executor"}
          label={placeholder}
          own={own}
          ownOnly={field.fill === "own" && !otherOwn}
          onCreateOwn={
            canSetup
              ? (name) =>
                  guarded(async () => {
                    const created = await contractsApi.setup.addEntity({ name });
                    await reloadSchema();
                    onCommit(created.id);
                  })
              : undefined
          }
          onPick={(choice) => onCommit("id" in choice ? choice.id : choice.name)}
          onCancel={onCancel}
        />
        {failure ? <div className="ifield-error">{failure}</div> : null}
      </>
    );
  }
  if (field.type === "list" || field.type === "department" || field.type === "choice" || field.type === "bool") {
    let options: ComboOption[] = [];
    if (field.type === "list") {
      options = (schema?.lists[field.key] ?? []).map((item) => ({ id: item.id, label: item.value }));
    } else if (field.type === "department") {
      options = (schema?.departments ?? []).map((item) => ({ id: item.id, label: item.code, hint: item.title !== item.code ? item.title : undefined }));
    } else if (field.type === "choice") {
      options = (field.choices ?? []).map((item) => ({ id: item.value, label: item.label }));
    } else {
      options = [
        { id: "true", label: "Да" },
        { id: "false", label: "Нет" },
      ];
    }
    const listy = field.type === "list" || field.type === "department";
    const closed = listy && field.fill === "list";
    const create = (text: string) => {
      if (closed) guarded(async () => onCommit(await addToList(field, text)));
      else onCommit(text);
    };
    if (twin) {
      return (
        <div className="ifield-note" style={{ color: "var(--fin-text)" }}>
          Это «{twin.option.label}»?{" "}
          <button type="button" className="fin-link-btn" onClick={() => onCommit(twin.option.id)}>
            Да, оно
          </button>{" "}
          ·{" "}
          <button type="button" className="fin-link-btn" onClick={() => create(twin.text)}>
            Нет, новое «{twin.text}»
          </button>{" "}
          ·{" "}
          <button type="button" className="fin-link-btn" onClick={onCancel}>
            Отмена
          </button>
        </div>
      );
    }
    return (
      <>
        <Combo
          options={options}
          placeholder={placeholder}
          allowCreate={listy && (!closed || canSetup)}
          createLabel={closed ? (text) => `+ Добавить «${text}» в список` : undefined}
          emptyText={
            closed
              ? field.type === "department"
                ? "Такого отдела нет — отделы заводят в личном кабинете"
                : "Нет в списке — список пополняют в настройке реестра"
              : undefined
          }
          onPick={(option) => onCommit(field.type === "bool" ? option.id === "true" : option.id)}
          onCreate={(text) => {
            const option = listy ? options.find((item) => isSimilar(item.label, text)) : undefined;
            if (option) setTwin({ text, option });
            else create(text);
          }}
          onCancel={onCancel}
        />
        {failure ? <div className="ifield-error">{failure}</div> : null}
      </>
    );
  }
  if (field.type === "person") {
    return (
      <PeopleEditor
        value={Array.isArray(value) ? (value as string[]) : []}
        people={people}
        staff={staff}
        closed={field.fill === "list"}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );
  }
  return <TextEditor field={field} value={value} onCommit={onCommit} onCancel={onCancel} placeholder={placeholder} draftKey={draftKey} />;
}

function TextEditor({
  field,
  value,
  onCommit,
  onCancel,
  placeholder,
  draftKey,
}: {
  field: RegistryField;
  value: unknown;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
  placeholder: string;
  draftKey: string;
}) {
  const initial =
    field.type === "date"
      ? formatDay(value)
      : field.type === "money" || field.type === "number"
        ? value === undefined || value === null ? "" : String(value).replace(/\.00$/, "")
        : value === undefined || value === null ? "" : String(value);
  const [draft, setDraft] = useSessionState(draftKey, initial);
  const [error, setError] = useState("");
  const multiline = ["note", "subject", "amount_terms", "amendments_text", "amendments_summary_text"].includes(field.key);
  const finish = () => {
    const text = draft.trim();
    if (text === initial.trim()) {
      onCancel();
      return;
    }
    if (field.type === "date" && text) {
      const iso = parseDay(text);
      if (!iso) {
        setError("Ждём дату вида дд.мм.гггг");
        return;
      }
      onCommit(iso);
      return;
    }
    onCommit(text);
  };
  const common = {
    className: "ifield-input",
    value: draft,
    placeholder: field.type === "date" ? "дд.мм.гггг" : placeholder,
    autoFocus: true,
    onChange: (event: { target: { value: string } }) => {
      setDraft(event.target.value);
      setError("");
    },
    onBlur: finish,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      } else if (event.key === "Enter" && (!multiline || event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        finish();
      }
    },
  };
  return (
    <>
      {multiline ? (
        <textarea {...common} rows={3} />
      ) : (
        <input {...common} inputMode={field.type === "money" || field.type === "number" ? "decimal" : undefined} />
      )}
      {error ? <div className="ifield-error">{error}</div> : null}
    </>
  );
}

/**
 * Ответственные. Выбор — из справочника сотрудников личного кабинета, а не
 * из тех, кто уже стоит в договорах: иначе человека, только что заведённого в
 * «Людях», выбрать было нельзя, а напечатанное «Асхат» заводило второго
 * «Асхата» рядом с «Асхатом Ибраевым».
 */
function PeopleEditor({
  value,
  people,
  staff,
  closed,
  onCommit,
  onCancel,
}: {
  value: string[];
  people: Readonly<Record<string, { id: string; name: string }>>;
  staff: readonly { id: string; name: string }[] | null;
  closed: boolean;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState<string[]>(value);
  const [adding, setAdding] = useState(value.length === 0);
  // Пока справочник не прочитан — те, кто уже стоит в договорах.
  const pool = staff ?? Object.values(people);
  const options: ComboOption[] = pool
    .filter((person) => !chosen.includes(person.id))
    .map((person) => ({ id: person.id, label: person.name }));
  const save = (next: string[]) => {
    setChosen(next);
    onCommit(next);
  };
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem 0.75rem", alignItems: "baseline", minHeight: "2rem" }}>
        {chosen.map((id) => (
          <span key={id}>
            {shortName(people[id]?.name ?? id)}{" "}
            <button type="button" className="fin-link-btn" aria-label="Убрать" onClick={() => save(chosen.filter((item) => item !== id))}>
              ×
            </button>
          </span>
        ))}
        {!adding ? (
          <button type="button" className="fin-link-btn" onClick={() => setAdding(true)}>
            +
          </button>
        ) : null}
        <button type="button" className="fin-link-btn fin-muted" onClick={onCancel}>
          Готово
        </button>
      </div>
      {adding ? (
        <Combo
          options={options}
          placeholder="Сотрудник"
          allowCreate={!closed}
          emptyText={closed ? "Нет среди сотрудников — их заводят в личном кабинете, «Люди»" : undefined}
          onPick={(option) => {
            setAdding(false);
            save([...chosen, option.id]);
          }}
          onCreate={(text) => {
            setAdding(false);
            save([...chosen, text]);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}
