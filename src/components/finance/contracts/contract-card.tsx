"use client";

/**
 * Карточка договора - лист по центру (фронт-план 6.2).
 *
 * Документ, а не форма: поля читаются текстом, правятся по клику, сохраняются
 * сами. Заголовок - сторона, которая не наша; под ним линия сторон с
 * подписями из вида («Арендодатель → Арендатор») и хозяйственным смыслом.
 * Новый договор заводится на сервере по первому заполненному полю - до этого
 * его нет нигде, кроме карточки, и закрытая пустая карточка ничего не оставляет.
 */
import { useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  type Amendment,
  type ContractPayments,
  type ParsedPiece,
  type PaymentItem,
  type RegistryField,
  contractsApi,
} from "@/components/finance/api";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon } from "@/components/icons";
import { type CardScope, CardScopeContext, InlineField } from "@/components/finance/contracts/field-editor";
import {
  CARD_ORDER,
  OWN_BLOCKS,
  WIDE_FIELDS,
  bareNumberOf,
  counterpartTitle,
  economicText,
  fieldOf,
  placesText,
  provenanceWord,
  roleLabels,
} from "@/components/finance/contracts/schema";
import { Shares } from "@/components/finance/contracts/shares";
import {
  create,
  edit as editField,
  ensurePayments,
  ensureStaff,
  dropMany,
  put,
  refreshOne,
  useRegistry,
} from "@/components/finance/contracts/store";
import { contractMoney, formatDay, parseDay } from "@/components/finance/format";
import { CardLayer } from "@/components/finance/ui/card-layer";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { DateInput } from "@/components/finance/ui/date-picker";
import { MenuPopover } from "@/components/finance/ui/menu-popover";

type Props = {
  id: string | null;
  open: boolean;
  /** Новый договор из отбора с блоком: подстановки блока ставит сервер. */
  draftContext?: { view?: string; block?: number };
  /**
   * Книга, из которой открыта карточка (`""` - реестр, `oneoff` - «Разовые»):
   * выбор списков берётся из блока листа этой книги, где стоит договор.
   */
  book?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
  /** Открыть другой договор (из замечания «номер уже есть у …»); нет - как `onCreated`. */
  onOpen?: (id: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
};

export function ContractCard({
  id,
  open,
  draftContext,
  book,
  onClose,
  onCreated,
  onOpen,
  onPrev,
  onNext,
}: Props) {
  const contract = useRegistry((s) => (id ? s.byId.get(id) : undefined));
  const schema = useRegistry((s) => s.schema);
  const scope = useMemo<CardScope>(() => {
    const readonly = Boolean(contract?.readonly);
    if (book === undefined || !schema) return { choices: null, readonly };
    const own = schema.views.filter((view) => (view.book ?? "") === book).sort((a, b) => a.position - b.position);
    const place =
      contract?.views.find((item) => own.some((view) => view.key === item.view)) ??
      (draftContext?.view ? { view: draftContext.view, block: draftContext.block ?? 0 } : null);
    const view = own.find((item) => item.key === place?.view) ?? own[0];
    return { choices: view?.blocks[place?.block ?? 0]?.choices ?? null, readonly };
  }, [book, schema, contract, draftContext]);
  const parties = useRegistry((s) => s.parties);
  const edits = useRegistry((s) => (id ? s.edits.get(id) : undefined));
  const online = useRegistry((s) => s.live.online);
  const phase = useRegistry((s) => s.phase);
  const [creating, setCreating] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<{ id: string; text: string } | null>(null);
  /**
   * Договор по ссылке, которого нет в реестре: удалён, не открыт человеку или
   * ещё не пришёл опросом - что из трёх, решает сервер.
   *
   * До 01.10.2026 такая карточка открывалась пустой формой «Новый договор»:
   * ссылка из журнала действий на удалённый договор, ссылка коллеги на договор
   * другого отдела - и первое напечатанное поле заводило новый договор.
   */
  const [lost, setLost] = useState<string | null>(null);
  const missing = id !== null && (!contract || contract.deleted);
  useEffect(() => {
    if (!open || !id || contract || phase !== "ready") return;
    let alive = true;
    contractsApi
      .one(id)
      .then((one) => alive && put(one))
      .catch(() => alive && setLost(id));
    return () => {
      alive = false;
    };
  }, [open, id, contract, phase]);

  useEffect(() => {
    if (open) void ensureStaff();
  }, [open]);

  const onDraft = useCallback(
    async (key: string, value: unknown) => {
      if (creating) return;
      setCreating(true);
      setDraftError("");
      try {
        const newId = await create({ [key]: value }, draftContext);
        onCreated(newId);
      } catch (exc) {
        setDraftError(exc instanceof Error ? exc.message : "Договор не завёлся");
      } finally {
        setCreating(false);
      }
    },
    [creating, draftContext, onCreated],
  );

  const title = contract ? counterpartTitle(contract, parties) : "";
  const roles = roleLabels(contract);
  const pending = edits ? [...edits.values()].filter((item) => item.state === "queued" || item.state === "sending").length : 0;
  const failed = edits ? [...edits.values()].some((item) => item.state === "failed" || item.state === "conflict") : false;
  const topState = !online && pending
    ? { text: `Нет связи · правки ждут: ${pending}`, cls: "fin-wait" }
    : failed
      ? { text: "Правка не принята", cls: "fin-fail" }
      : null;

  const fields = useMemo(() => orderFields(schema?.fields ?? []), [schema]);
  const number = contract ? String(contract.values.number ?? "") : "";

  return (
    <CardLayer
      open={open}
      onClose={onClose}
      label={number ? `Договор ${number}` : missing ? "Договор" : "Новый договор"}
    >
      <CardScopeContext.Provider value={scope}>
      <div className="card-top">
        <button type="button" className="fin-icon-btn" aria-label="Предыдущий договор" disabled={!onPrev} onClick={onPrev}>
          <ArrowUpIcon size={16} />
        </button>
        <button type="button" className="fin-icon-btn" aria-label="Следующий договор" disabled={!onNext} onClick={onNext}>
          <ArrowDownIcon size={16} />
        </button>
        <span className="card-top-num">{contract ? number || "Без номера" : missing ? "Договор" : "Новый договор"}</span>
        <span className={`card-top-state ${topState?.cls ?? ""}`}>{topState?.text ?? ""}</span>
        <MenuPopover
          items={[
            {
              label: "Скопировать ссылку",
              hidden: !contract || missing,
              onSelect: () => {
                const url = new URL(window.location.href);
                url.searchParams.set("s", "contracts");
                if (contract) url.searchParams.set("id", contract.id);
                void navigator.clipboard?.writeText(url.toString());
              },
            },
            {
              label: "Удалить договор",
              danger: true,
              hidden: !contract || missing || !schema?.access.edit || scope.readonly,
              onSelect: () => setConfirmRemove(true),
            },
          ]}
        />
        <button type="button" className="fin-icon-btn" aria-label="Закрыть" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </div>

      {missing ? (
        <div className="card-body" key={id ?? "new"}>
          {contract?.deleted || lost === id ? (
            <>
              <h2 className="card-title" tabIndex={-1} data-empty="true">
                Договора нет в реестре
              </h2>
              <p className="card-readonly">Его удалили или он вам не открыт.</p>
            </>
          ) : phase === "error" ? (
            <h2 className="card-title" tabIndex={-1} data-empty="true">
              Реестр не прочитался
            </h2>
          ) : (
            <h2 className="card-title" tabIndex={-1} data-empty="true">
              Читаем договор…
            </h2>
          )}
        </div>
      ) : (
      <div className="card-body" key={id ?? "new"}>
        <h2 className="card-title" tabIndex={-1} data-empty={title ? undefined : "true"}>
          {title || "Новый договор"}
        </h2>
        {contract ? <PartiesLine contractId={contract.id} /> : null}
        {scope.readonly ? <p className="card-readonly">Договор другого отдела - открыт вам только на просмотр</p> : null}
        {draftError ? <p className="ifield-error">{draftError}</p> : null}
        {removeError && removeError.id === contract?.id ? <p className="ifield-error">{removeError.text}</p> : null}
        {contract ? <Issues contractId={contract.id} onOpen={onOpen ?? onCreated} /> : null}

        <div className="card-grid">
          {(contract ? fields : draftFields(fields)).map((field) => {
            if (field.hidden || OWN_BLOCKS.has(field.key)) return null;
            return (
              <FieldSlot
                key={field.key}
                field={field}
                contractId={contract?.id ?? null}
                roles={roles}
                onDraft={onDraft}
              />
            );
          })}
        </div>

        {contract ? (
          <>
            <Shares contractId={contract.id} seq={contract.seq} />
            <Amendments contractId={contract.id} seq={contract.seq} />
            <SourceText contractId={contract.id} seq={contract.seq} />
            <Snapshot contractId={contract.id} />
            <Payments contractId={contract.id} seq={contract.seq} />
          </>
        ) : null}
      </div>
      )}

      <ConfirmDialog
        open={confirmRemove}
        title={`Удалить договор ${number}?`.trim()}
        text="Он уйдёт из реестра, листов и карточек у всех сотрудников в корзину. Вернуть - «Восстановление» в личном кабинете."
        confirm="Удалить"
        danger
        busy={removing}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={async () => {
          if (!contract) return;
          setRemoving(true);
          setRemoveError(null);
          try {
            // Через точку восстановления, как удаление из листа: вернуть договор
            // может тот, кто удалил, а не только администратор из корзины.
            const result = await contractsApi.sheetChange({ action: "delete_contracts", ids: [contract.id], book: book ?? "" });
            if (!(result.done ?? []).includes(contract.id)) {
              throw new Error(result.failed?.[0]?.error ?? "Договор не удалился");
            }
            dropMany([contract.id]);
            setConfirmRemove(false);
            onClose();
          } catch (exc) {
            // Отказ - словами в карточке. До 01.10.2026 он пропадал молча:
            // окно «Удалить?» оставалось открытым, и почему - не говорилось.
            setConfirmRemove(false);
            setRemoveError({ id: contract.id, text: exc instanceof Error ? exc.message : "Договор не удалился" });
          } finally {
            setRemoving(false);
          }
        }}
      />
      </CardScopeContext.Provider>
    </CardLayer>
  );
}

/**
 * Поля нового договора - в том порядке, в каком их переписывают с бумаги:
 * номер и дата первыми. До 29.09.2026 номер стоял предпоследним, и на
 * экране 1280×590 его приходилось искать прокруткой, хотя с него юрист и
 * начинает (он же заводит договор на сервере).
 */
const DRAFT_ORDER = ["number", "signed_at", "customer", "executor", "type", "status", "amount", "subject", "department", "people"];

function draftFields(fields: RegistryField[]): RegistryField[] {
  return DRAFT_ORDER.map((key) => fields.find((field) => field.key === key)).filter(
    (field): field is RegistryField => Boolean(field),
  );
}

function orderFields(fields: RegistryField[]): RegistryField[] {
  const rank = (field: RegistryField) => {
    const index = CARD_ORDER.indexOf(field.key);
    if (index >= 0) return index;
    return field.system ? 100 + field.position / 1e6 : 1000 + field.position / 1e6;
  };
  return [...fields].sort((a, b) => rank(a) - rank(b));
}

function FieldSlot({
  field,
  contractId,
  roles,
  onDraft,
}: {
  field: RegistryField;
  contractId: string | null;
  roles: { executor: string; customer: string; plain: boolean };
  onDraft: (key: string, value: unknown) => void;
}) {
  const contract = useRegistry((s) => (contractId ? s.byId.get(contractId) : undefined));
  const billing = contract ? String(contract.values.billing ?? "") : "";
  let label = field.title;
  let suffix: string | undefined;
  if (field.key === "executor") label = roles.executor;
  if (field.key === "customer") label = roles.customer;
  if (field.key === "amount") {
    if (billing === "month") {
      label = "Сумма в месяц";
      suffix = "/мес";
    } else if (billing === "terms" && !contract?.values.amount) return null;
    else label = "Сумма";
  }
  if (field.key === "amount_terms" && billing !== "terms" && !contract?.values.amount_terms) return null;
  const note = contract && (field.key === "billing" || field.key === "economic_role") ? provenanceWord(contract, field.key) : "";
  if (field.key === "end_date") {
    return <EndDate field={field} contractId={contractId} />;
  }
  return (
    <InlineField
      contractId={contractId}
      field={field}
      label={label}
      labelNote={note}
      wide={WIDE_FIELDS.has(field.key) || !field.system && field.type === "text"}
      suffix={suffix}
      onDraft={onDraft}
    />
  );
}

/** Окончание: одна дата и её смысл - расторжение или исполнение. */
function EndDate({ field, contractId }: { field: RegistryField; contractId: string | null }) {
  const schema = useRegistry((s) => s.schema);
  const contract = useRegistry((s) => (contractId ? s.byId.get(contractId) : undefined));
  const kindField = fieldOf(schema, "end_kind");
  const kind = String(contract?.values.end_kind ?? "");
  const locked = useContext(CardScopeContext).readonly;
  return (
    <div className="ifield">
      <InlineField contractId={contractId} field={field} label="Окончание" />
      {contract?.values.end_date && kindField ? (
        <div className="ifield-note" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          {kind === "unknown" || !kind ? <span className="fin-fail">Смысл даты не ясен:</span> : null}
          {(kindField.choices ?? [])
            .filter((choice) => choice.value !== "unknown")
            .map((choice) => (
              <button
                key={choice.value}
                type="button"
                className="fin-link-btn"
                style={{ fontWeight: kind === choice.value ? 600 : 400, color: kind === choice.value ? "var(--fin-text)" : undefined }}
                aria-pressed={kind === choice.value}
                disabled={!kindField.editable || locked}
                onClick={() => {
                  if (contractId) editField(contractId, "end_kind", choice.value);
                }}
              >
                {choice.label.toLowerCase()}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

function PartiesLine({ contractId }: { contractId: string }) {
  const contract = useRegistry((s) => s.byId.get(contractId));
  const parties = useRegistry((s) => s.parties);
  const schema = useRegistry((s) => s.schema);
  if (!contract) return null;
  const executor = parties[String(contract.values.executor ?? "")];
  const customer = parties[String(contract.values.customer ?? "")];
  if (!executor && !customer) return null;
  const roles = roleLabels(contract);
  const sense = economicText(schema, contract);
  const name = (party: typeof executor) => (party ? (party.own && party.code ? party.code : party.name) : "-");
  return (
    <>
      <div className="parties-line">
        <span>
          {!roles.plain ? <small>{roles.executor}</small> : null}
          {name(executor)}
        </span>
        <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="5" x2="97" y2="5" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d="M92 1 L98 5 L92 9" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>
        <span>
          {!roles.plain ? <small>{roles.customer}</small> : null}
          {name(customer)}
        </span>
      </div>
      {sense ? (
        <div className="parties-sense">
          <span className="annot">{sense}</span>
        </div>
      ) : null}
    </>
  );
}

function Issues({ contractId, onOpen }: { contractId: string; onOpen: (id: string) => void }) {
  const contract = useRegistry((s) => s.byId.get(contractId));
  const canEdit = useRegistry((s) => !!s.schema?.access.edit) && !contract?.readonly;
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!contract || !contract.issues.length) return null;
  const acknowledge = async (code: string, on: boolean) => {
    setBusy(code);
    setError("");
    try {
      put(await contractsApi.acknowledge(contractId, code, on));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Отметка не сохранилась");
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="card-issues" role="list">
      {contract.issues.map((issue) => (
        <div key={issue.code} className="card-issue" role="listitem" data-ack={issue.acknowledged ? "true" : undefined}>
          <span>
            {issue.acknowledged ? <span className="annot">учтено</span> : null} {issue.text}
            {issue.others?.length ? <OtherContracts ids={issue.others} onOpen={onOpen} /> : null}
          </span>
          {canEdit ? (
            <button
              type="button"
              className="fin-link-btn"
              disabled={busy === issue.code}
              onClick={() => acknowledge(issue.code, !issue.acknowledged)}
            >
              {issue.acknowledged ? "Снять отметку" : "Учтено"}
            </button>
          ) : null}
        </div>
      ))}
      {error ? (
        <p className="ifield-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Договоры, о которых замечание («номер уже есть у …»): номер, сторона, где
 * стоит - и открыть. Договор, который человеку не открыт (другой отдел),
 * только называется: его строки у человека нет.
 */
export function OtherContracts({ ids, onOpen }: { ids: string[]; onOpen: (id: string) => void }) {
  const byId = useRegistry((s) => s.byId);
  const parties = useRegistry((s) => s.parties);
  const schema = useRegistry((s) => s.schema);
  const shown = ids.map((id) => byId.get(id)).filter((item): item is NonNullable<typeof item> => !!item && !item.deleted);
  const hidden = ids.length - shown.length;
  return (
    <span className="issue-others">
      {shown.map((other) => (
        <span key={other.id} className="issue-other">
          <button type="button" className="fin-link-btn" onClick={() => onOpen(other.id)}>
            {bareNumberOf(other) || "без номера"} · {counterpartTitle(other, parties) || "-"}
          </button>
          <span className="fin-muted"> {placesText(schema, other)}</span>
        </span>
      ))}
      {hidden ? (
        <span className="issue-other fin-muted">
          ещё {hidden} - {hidden === 1 ? "договор вам не открыт" : "договоры вам не открыты"}
        </span>
      ) : null}
    </span>
  );
}

function Section({ title, count, end, children }: { title: string; count?: number; end?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="card-section">
        <span>
          {title}
          {count ? <span className="fin-muted" style={{ fontWeight: 400 }}> {count}</span> : null}
        </span>
        <span className="card-section-line" />
        {end ? <span className="card-section-end">{end}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Amendments({ contractId, seq }: { contractId: string; seq: number }) {
  const [items, setItems] = useState<Amendment[] | null>(null);
  useEffect(() => {
    let alive = true;
    contractsApi.amendments
      .list(contractId)
      .then((result) => alive && setItems(result.items))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [contractId, seq]);
  if (!items || !items.length) return null;
  const sorted = [...items].sort((a, b) => (b.effective_from ?? "").localeCompare(a.effective_from ?? ""));
  return (
    <Section title="Соглашения" count={items.length}>
      {sorted.map((item) => (
        <div key={item.id} className="amend-row">
          <span className="amend-when">{item.effective_from ? `с ${formatDay(item.effective_from)}` : "-"}</span>
          <span>
            {[item.number, item.signed_at ? `от ${formatDay(item.signed_at)}` : "", effectWord(item.effect)].filter(Boolean).join(" · ")}
            {item.before_label || item.after_label ? (
              <>
                <br />
                <s>{item.before_label}</s> → {item.after_label}
              </>
            ) : null}
            {item.summary ? (
              <>
                <br />
                <span className="fin-soft">{item.summary}</span>
              </>
            ) : null}
          </span>
          <span>
            {item.ahead ? <span className="annot">впереди</span> : null}
            {item.origin === "parsed" ? <span className="annot">из текста</span> : null}
          </span>
        </div>
      ))}
    </Section>
  );
}

function effectWord(effect: string): string {
  return (
    {
      amount: "сумма",
      executor: "замена лиц",
      customer: "замена заказчика",
      end_date: "срок",
      other: "иное",
    } as Record<string, string>
  )[effect] ?? "";
}

function SourceText({ contractId, seq }: { contractId: string; seq: number }) {
  const schema = useRegistry((s) => s.schema);
  const contract = useRegistry((s) => s.byId.get(contractId));
  const locked = useContext(CardScopeContext).readonly;
  // Разобранные куски принадлежат версии договора, из которой их разобрали:
  // договор поменялся - куски устарели сами, без эффекта-сброса.
  const version = `${contractId}:${seq}`;
  const [parsed, setParsed] = useState<{ version: string; pieces: ParsedPiece[] } | null>(null);
  const pieces = parsed?.version === version ? parsed.pieces : null;
  const setPieces = (update: (list: ParsedPiece[] | null) => ParsedPiece[]) =>
    setParsed((prev) => ({ version, pieces: update(prev?.version === version ? prev.pieces : null) }));
  const [error, setError] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const textField = fieldOf(schema, "amendments_text");
  const summaryField = fieldOf(schema, "amendments_summary_text");
  const text = String(contract?.values.amendments_text ?? "");
  const summary = String(contract?.values.amendments_summary_text ?? "");

  if (!textField && !summaryField) return null;
  if (!text && !summary && !textField?.editable) return null;
  const parse = async () => {
    setError("");
    try {
      const result = await contractsApi.amendments.parse(contractId);
      setPieces(() => result.pieces);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не разобралось");
    }
  };
  const shown = pieces?.[hover ?? -1];
  return (
    <Section
      title="Соглашения в файле"
      end={
        text && schema?.access.edit && !locked ? (
          <button type="button" className="fin-link-btn" onClick={parse}>
            Разобрать
          </button>
        ) : null
      }
    >
      {/* Текст стоит всё время разбора, наведение только подсвечивает кусок.
          До 30.09.2026 абзац появлялся по наведению на строку разбора и
          сдвигал строки вниз из-под курсора: уход - абзац пропал - строка
          вернулась под курсор - и так по кругу, карточка дрожала. */}
      {pieces && pieces.length && text ? (
        <p className="source-text" aria-hidden="true">
          {shown ? (
            <>
              {text.slice(0, shown.start)}
              <mark data-hover="true">{text.slice(shown.start, shown.end)}</mark>
              {text.slice(shown.end)}
            </>
          ) : (
            text
          )}
        </p>
      ) : null}
      <div className="card-grid" style={{ marginTop: pieces && pieces.length && text ? "0.5rem" : 0 }}>
        {textField ? <InlineField contractId={contractId} field={textField} wide /> : null}
        {summaryField ? <InlineField contractId={contractId} field={summaryField} wide /> : null}
      </div>
      {error ? <p className="ifield-error">{error}</p> : null}
      {pieces ? (
        <div style={{ marginTop: "0.75rem" }}>
          {pieces.length === 0 ? <p className="fin-muted" style={{ fontSize: "0.8125rem" }}>Номеров соглашений в тексте не нашлось</p> : null}
          {pieces.map((piece) => (
            <PieceRow
              key={piece.index}
              contractId={contractId}
              piece={piece}
              onHover={(on) => setHover(on ? pieces.indexOf(piece) : null)}
              onDone={() => setPieces((list) => (list ?? []).filter((item) => item !== piece))}
            />
          ))}
        </div>
      ) : null}
    </Section>
  );
}

function PieceRow({
  contractId,
  piece,
  onHover,
  onDone,
}: {
  contractId: string;
  piece: ParsedPiece;
  onHover: (on: boolean) => void;
  onDone: () => void;
}) {
  const [effect, setEffect] = useState(piece.effect);
  const [value, setValue] = useState(piece.value_hint);
  const [from, setFrom] = useState(formatDay(piece.effective_from));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const needsValue = effect === "amount" || effect === "executor" || effect === "customer";
  const fromIso = parseDay(from);
  const ready = !needsValue || (value.trim() && fromIso);
  return (
    <div className="piece-row" onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <span className="fin-mono fin-muted">{String(piece.index + 1).padStart(2, "0")}</span>
      <span style={{ display: "grid", gap: "0.35rem" }}>
        <span>
          {piece.text}
          {piece.summary ? <span className="fin-soft"> - {piece.summary}</span> : null}
        </span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <select value={effect} onChange={(event) => setEffect(event.target.value)} aria-label="Что меняет">
            <option value="none">ничего не меняет в полях</option>
            <option value="amount">сумму</option>
            <option value="executor">исполнителя (замена лиц)</option>
            <option value="customer">заказчика</option>
            <option value="other">иное</option>
          </select>
          {needsValue ? (
            <>
              <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={effect === "amount" ? "новая сумма" : "кто теперь"} aria-label="Новое значение" />
              <span>с</span>
              <DateInput value={from} onChange={setFrom} ariaLabel="С какой даты" style={{ width: "7.5rem" }} />
            </>
          ) : null}
        </span>
        {error ? <span className="fin-fail">{error}</span> : null}
      </span>
      <span style={{ whiteSpace: "nowrap" }}>
        <button
          type="button"
          className="fin-link-btn"
          disabled={!ready || busy || (piece.confirmed ?? []).includes(effect)}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const one = await contractsApi.amendments.confirm(contractId, {
                text: piece.text,
                number: piece.number,
                signed_at: piece.signed_at,
                summary: piece.summary,
                effect,
                effective_from: fromIso,
                value: needsValue ? value : null,
              });
              put(one);
              onDone();
            } catch (exc) {
              setError(exc instanceof Error ? exc.message : "Не подтвердилось");
            } finally {
              setBusy(false);
            }
          }}
        >
          {(piece.confirmed ?? []).includes(effect) ? "подтверждено" : "Подтвердить"}
        </button>{" "}
        ·{" "}
        <button type="button" className="fin-link-btn" onClick={onDone}>
          Пропустить
        </button>
      </span>
    </div>
  );
}

function Snapshot({ contractId }: { contractId: string }) {
  const contract = useRegistry((s) => s.byId.get(contractId));
  const snap = contract?.file_snapshot;
  if (!snap || (!snap.paid && !snap.remaining)) return null;
  return (
    <Section
      title="Как было в файле"
      end={<span className="fin-muted">{[snap.file, snap.as_of ? formatDay(snap.as_of) : ""].filter(Boolean).join(", ")}</span>}
    >
      <div className="snapshot">
        <span>
          <span className="eyebrow">Оплачено</span>
          <br />
          {snap.paid ? contractMoney(snap.paid) : "-"}
        </span>
        <span>
          <span className="eyebrow">Остаток</span>
          <br />
          {snap.remaining ? contractMoney(snap.remaining) : "-"}
        </span>
      </div>
    </Section>
  );
}

/*
 * Раздела «По сводке» в карточке больше нет (29.09.2026): откуда «Оплачено»
 * в «Разовых» - внутренняя логика, её никому не нужно читать, а разделу
 * приходилось бы делить карточку на «разовую» и прочие. Цифра сводки
 * остаётся колонкой листа «Разовых» и в «По сотрудникам».
 */

const PAYMENT_ACTIONS: Record<PaymentItem["how"], { label: string; action: "link" | "unlink" | "auto" }> = {
  open: { label: "Отнести к этому договору", action: "link" },
  auto: { label: "Не по этому договору", action: "unlink" },
  manual: { label: "Как по выписке", action: "auto" },
};

/**
 * Оплаты по выписке: платежи журнала, которые система отнесла к договору, и
 * спорные - подходящие и к нему, и к другому договору клиента. Спорный в
 * «Оплачено» не входит, пока человек не отнесёт его сам (`payments.py`).
 * Раздела нет, пока ни одного платежа не нашлось, и у того, кому журнал не
 * открыт: суммы оплат - это деньги компании.
 */
function Payments({ contractId, seq }: { contractId: string; seq: number }) {
  const schema = useRegistry((s) => s.schema);
  const locked = useContext(CardScopeContext).readonly;
  const canEdit = Boolean(schema?.access.edit) && !locked;
  const visible = Boolean(schema?.fields.some((field) => field.key === "paid"));
  const [data, setData] = useState<{ id: string; value: ContractPayments } | null>(null);
  // Снятые «не по этому договору» остаются строкой с «Вернуть», пока карточка открыта.
  const [dropped, setDropped] = useState<PaymentItem[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    contractsApi.payments
      .of(contractId)
      .then((value) => alive && setData({ id: contractId, value }))
      .catch(() => alive && setData({ id: contractId, value: { summary: null, items: [] } }));
    return () => {
      alive = false;
    };
  }, [contractId, seq, visible]);
  const value = data?.id === contractId ? data.value : null;
  const gone = dropped.filter((item) => !value?.items.some((other) => other.operation_id === item.operation_id));
  if (!visible || !value || (!value.items.length && !gone.length)) return null;

  const decide = async (item: PaymentItem, action: "link" | "unlink" | "auto") => {
    setBusy(item.operation_id);
    setError("");
    try {
      const next = await contractsApi.payments.decide(contractId, item.operation_id, action);
      setData({ id: contractId, value: next });
      setDropped((list) =>
        action === "unlink" ? [...list, item] : list.filter((other) => other.operation_id !== item.operation_id),
      );
      void ensurePayments(true);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не записалось");
    } finally {
      setBusy("");
    }
  };

  const summary = value.summary;
  const rows: { item: PaymentItem; gone: boolean }[] = [
    ...value.items.map((item) => ({ item, gone: false })),
    ...gone.map((item) => ({ item, gone: true })),
  ];
  return (
    <Section title="Оплаты по выписке" count={value.items.length}>
      {summary?.paid ? (
        <div className="snapshot" style={{ marginBottom: "0.5rem" }}>
          <span>
            <span className="eyebrow">Оплачено</span>
            <br />
            <span style={{ color: "var(--fin-text)" }}>{contractMoney(summary.paid)}</span>
          </span>
          {summary.remaining !== null ? (
            <span>
              <span className="eyebrow">Остаток</span>
              <br />
              <span style={{ color: "var(--fin-text)" }}>{contractMoney(summary.remaining)}</span>
            </span>
          ) : null}
        </div>
      ) : null}
      {rows.map(({ item, gone: isGone }) => {
        const action = isGone ? { label: "Вернуть", action: "auto" as const } : PAYMENT_ACTIONS[item.how];
        const place = [item.counterparty, item.account].filter(Boolean).join(" · ");
        return (
          <div key={item.operation_id} className="amend-row" data-muted={isGone || item.how === "open" ? "true" : undefined}>
            <span className="amend-when fin-mono">{formatDay(item.paid_at)}</span>
            <span>
              {isGone ? <s>{contractMoney(item.amount)}</s> : contractMoney(item.amount)}
              {place ? <span className="fin-soft"> · {place}</span> : null}
              {item.comment ? (
                <>
                  <br />
                  <span className="fin-soft">{item.comment}</span>
                </>
              ) : null}
            </span>
            <span style={{ whiteSpace: "nowrap", textAlign: "right" }}>
              {isGone ? <span className="annot">не по договору</span> : null}
              {!isGone && item.how === "open" ? <span className="annot">спорный</span> : null}
              {!isGone && item.how === "manual" ? <span className="annot">вручную</span> : null}
              {canEdit ? (
                <>
                  {" "}
                  <button
                    type="button"
                    className="fin-link-btn"
                    disabled={busy === item.operation_id}
                    onClick={() => void decide(item, action.action)}
                  >
                    {action.label}
                  </button>
                </>
              ) : null}
            </span>
          </div>
        );
      })}
      {error ? <p className="ifield-error">{error}</p> : null}
    </Section>
  );
}

export function useCardRefresh(id: string | null, open: boolean): void {
  useEffect(() => {
    if (open && id) void refreshOne(id);
  }, [id, open]);
}
