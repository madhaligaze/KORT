"use client";

/**
 * Карточка договора — лист по центру (фронт-план 6.2).
 *
 * Документ, а не форма: поля читаются текстом, правятся по клику, сохраняются
 * сами. Заголовок — сторона, которая не наша; под ним линия сторон с
 * подписями из вида («Арендодатель → Арендатор») и хозяйственным смыслом.
 * Новый договор заводится на сервере по первому заполненному полю — до этого
 * его нет нигде, кроме карточки, и закрытая пустая карточка ничего не оставляет.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type Amendment,
  type ContractPayments,
  type HistoryItem,
  type ParsedPiece,
  type PaymentItem,
  type RegistryField,
  contractsApi,
} from "@/components/finance/api";
import { ArrowDownIcon, ArrowUpIcon, CloseIcon } from "@/components/icons";
import { InlineField } from "@/components/finance/contracts/field-editor";
import {
  CARD_ORDER,
  OWN_BLOCKS,
  WIDE_FIELDS,
  counterpartTitle,
  economicText,
  fieldOf,
  provenanceWord,
  roleLabels,
} from "@/components/finance/contracts/schema";
import {
  create,
  edit as editField,
  ensurePayments,
  ensureStaff,
  ensureSummary,
  put,
  refreshOne,
  remove,
  useRegistry,
} from "@/components/finance/contracts/store";
import { contractMoney, dayTitle, formatDay, formatTime, parseDay, plural } from "@/components/finance/format";
import { CardLayer } from "@/components/finance/ui/card-layer";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { MenuPopover } from "@/components/finance/ui/menu-popover";

type Props = {
  id: string | null;
  open: boolean;
  dock?: "center" | "bottom";
  /** Новый договор из отбора с блоком: подстановки блока ставит сервер. */
  draftContext?: { view?: string; block?: number };
  onClose: () => void;
  onCreated: (id: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
};

export function ContractCard({ id, open, dock = "center", draftContext, onClose, onCreated, onPrev, onNext }: Props) {
  const contract = useRegistry((s) => (id ? s.byId.get(id) : undefined));
  const schema = useRegistry((s) => s.schema);
  const parties = useRegistry((s) => s.parties);
  const edits = useRegistry((s) => (id ? s.edits.get(id) : undefined));
  const online = useRegistry((s) => s.live.online);
  const [creating, setCreating] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

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
    <CardLayer open={open} onClose={onClose} dock={dock} label={number ? `Договор ${number}` : "Новый договор"}>
      <div className="card-top">
        <button type="button" className="fin-icon-btn" aria-label="Закрыть" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
        <span className="card-top-num">{contract ? number || "Без номера" : "Новый договор"}</span>
        <span className={`card-top-state ${topState?.cls ?? ""}`}>{topState?.text ?? ""}</span>
        <button type="button" className="fin-icon-btn" aria-label="Предыдущий договор" disabled={!onPrev} onClick={onPrev}>
          <ArrowUpIcon size={16} />
        </button>
        <button type="button" className="fin-icon-btn" aria-label="Следующий договор" disabled={!onNext} onClick={onNext}>
          <ArrowDownIcon size={16} />
        </button>
        <MenuPopover
          items={[
            {
              label: "Скопировать ссылку",
              hidden: !contract,
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
              hidden: !contract || !schema?.access.edit,
              onSelect: () => setConfirmRemove(true),
            },
          ]}
        />
      </div>

      <div className="card-body" key={id ?? "new"}>
        <h2 className="card-title" tabIndex={-1} data-empty={title ? undefined : "true"}>
          {title || "Новый договор"}
        </h2>
        {contract ? <PartiesLine contractId={contract.id} /> : null}
        {draftError ? <p className="ifield-error">{draftError}</p> : null}
        {contract ? <Issues contractId={contract.id} /> : null}

        <div className="card-grid">
          {fields.map((field) => {
            if (field.hidden || OWN_BLOCKS.has(field.key)) return null;
            if (!contract && !["type", "executor", "customer", "number", "signed_at", "subject", "amount", "status", "department", "people"].includes(field.key)) {
              return null;
            }
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
            <Amendments contractId={contract.id} seq={contract.seq} />
            <SourceText contractId={contract.id} seq={contract.seq} />
            <Snapshot contractId={contract.id} />
            <FromSummary contractId={contract.id} />
            <Payments contractId={contract.id} seq={contract.seq} />
            <History contractId={contract.id} seq={contract.seq} />
          </>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        title={`Удалить договор ${number}?`.trim()}
        text="Он уйдёт из реестра и листов в корзину. Вернуть — из корзины в личном кабинете."
        confirm="Удалить"
        danger
        busy={removing}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={async () => {
          if (!contract) return;
          setRemoving(true);
          try {
            await remove(contract.id);
            setConfirmRemove(false);
            onClose();
          } finally {
            setRemoving(false);
          }
        }}
      />
    </CardLayer>
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

/** Окончание: одна дата и её смысл — расторжение или исполнение. */
function EndDate({ field, contractId }: { field: RegistryField; contractId: string | null }) {
  const schema = useRegistry((s) => s.schema);
  const contract = useRegistry((s) => (contractId ? s.byId.get(contractId) : undefined));
  const kindField = fieldOf(schema, "end_kind");
  const kind = String(contract?.values.end_kind ?? "");
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
                disabled={!kindField.editable}
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
  const name = (party: typeof executor) => (party ? (party.own && party.code ? party.code : party.name) : "—");
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

function Issues({ contractId }: { contractId: string }) {
  const contract = useRegistry((s) => s.byId.get(contractId));
  const canEdit = useRegistry((s) => !!s.schema?.access.edit);
  const [busy, setBusy] = useState("");
  if (!contract || !contract.issues.length) return null;
  const acknowledge = async (code: string, on: boolean) => {
    setBusy(code);
    try {
      put(await contractsApi.acknowledge(contractId, code, on));
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="card-issues" role="list">
      {contract.issues.map((issue) => (
        <div key={issue.code} className="card-issue" role="listitem" data-ack={issue.acknowledged ? "true" : undefined}>
          <span>{issue.text}</span>
          {canEdit ? (
            <button
              type="button"
              className="fin-link-btn"
              disabled={busy === issue.code}
              onClick={() => acknowledge(issue.code, !issue.acknowledged)}
            >
              {issue.acknowledged ? "учтено · снять отметку" : "Учтено"}
            </button>
          ) : null}
        </div>
      ))}
    </div>
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
          <span className="amend-when">{item.effective_from ? `с ${formatDay(item.effective_from)}` : "—"}</span>
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
  // Разобранные куски принадлежат версии договора, из которой их разобрали:
  // договор поменялся — куски устарели сами, без эффекта-сброса.
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
        text && schema?.access.edit ? (
          <button type="button" className="fin-link-btn" onClick={parse}>
            Разобрать
          </button>
        ) : null
      }
    >
      {shown ? (
        <p className="source-text" aria-hidden="true">
          {text.slice(0, shown.start)}
          <mark data-hover="true">{text.slice(shown.start, shown.end)}</mark>
          {text.slice(shown.end)}
        </p>
      ) : null}
      <div className="card-grid" style={{ marginTop: shown ? "0.5rem" : 0 }}>
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
          {piece.summary ? <span className="fin-soft"> — {piece.summary}</span> : null}
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
              <input value={from} onChange={(event) => setFrom(event.target.value)} placeholder="дд.мм.гггг" aria-label="С какой даты" style={{ width: "7.5rem" }} />
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
          {snap.paid ? contractMoney(snap.paid) : "—"}
        </span>
        <span>
          <span className="eyebrow">Остаток</span>
          <br />
          {snap.remaining ? contractMoney(snap.remaining) : "—"}
        </span>
      </div>
    </Section>
  );
}

/**
 * «Оплачено» из книги-сводки компании (у BBC — «Осн.Общая сводка»): та же
 * цифра, что колонка «Оплачено» в «Разовых». Нет сводки или договора в ней —
 * раздела нет; номер нашёлся у другого клиента — так и сказано, в «Оплачено»
 * такой договор не идёт (правило «не угадывать»).
 */
function FromSummary({ contractId }: { contractId: string }) {
  const entry = useRegistry((s) => s.summary?.[contractId]);
  const source = useRegistry((s) => s.summarySource ?? s.schema?.summary ?? null);
  const visible = useRegistry((s) => Boolean(s.schema?.fields.some((field) => field.key === "summary_paid")));
  useEffect(() => {
    if (visible && source) void ensureSummary();
  }, [visible, source]);
  if (!visible || !source || !entry || entry.state === "missing") return null;
  const where = <span className="fin-muted">{source.title || "сводка"}</span>;
  if (entry.state !== "found") {
    return (
      <Section title="По сводке" end={where}>
        <p className="fin-soft" style={{ margin: 0 }}>
          {entry.state === "other_client"
            ? `Номер в сводке есть, но у другого клиента: ${(entry.candidates ?? []).join(", ")}`
            : `Номер в сводке у нескольких похожих клиентов: ${(entry.candidates ?? []).join(", ")} — «Оплачено» не посчитано`}
        </p>
      </Section>
    );
  }
  return (
    <Section title="По сводке" end={where}>
      <div className="snapshot">
        <span>
          <span className="eyebrow">Оплачено</span>
          <br />
          <span style={{ color: "var(--fin-text)" }}>{contractMoney(entry.paid)}</span>
        </span>
        {entry.remaining !== null && entry.remaining !== undefined ? (
          <span>
            <span className="eyebrow">Остаток</span>
            <br />
            <span style={{ color: "var(--fin-text)" }}>{contractMoney(entry.remaining)}</span>
          </span>
        ) : null}
        {entry.months?.length ? (
          <span>
            <span className="eyebrow">Месяц в сводке</span>
            <br />
            {entry.months.map((month) => month.toLowerCase()).join(", ")}
          </span>
        ) : null}
      </div>
    </Section>
  );
}

const PAYMENT_ACTIONS: Record<PaymentItem["how"], { label: string; action: "link" | "unlink" | "auto" }> = {
  open: { label: "Отнести к этому договору", action: "link" },
  auto: { label: "Не по этому договору", action: "unlink" },
  manual: { label: "Как по выписке", action: "auto" },
};

/**
 * Оплаты по выписке: платежи журнала, которые система отнесла к договору, и
 * спорные — подходящие и к нему, и к другому договору клиента. Спорный в
 * «Оплачено» не входит, пока человек не отнесёт его сам (`payments.py`).
 * Раздела нет, пока ни одного платежа не нашлось, и у того, кому журнал не
 * открыт: суммы оплат — это деньги компании.
 */
function Payments({ contractId, seq }: { contractId: string; seq: number }) {
  const schema = useRegistry((s) => s.schema);
  const canEdit = Boolean(schema?.access.edit);
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

function History({ contractId, seq }: { contractId: string; seq: number }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let alive = true;
    contractsApi
      .history(contractId)
      .then((result) => alive && setItems(result.items))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [contractId, seq]);
  if (!items || !items.length) return null;
  const shown = all ? items : items.slice(0, 5);
  return (
    <Section title="История">
      {shown.map((item, index) => {
        const day = dayTitle(item.at);
        const head = index === 0 || dayTitle(shown[index - 1].at) !== day ? day : "";
        return (
          <div key={item.id}>
            {head ? <div className="hist-day">{head}</div> : null}
            <div className="hist-row">
              <span className="fin-mono fin-muted">{formatTime(item.at)}</span>
              <span>
                <span className="fin-soft">{item.actor}</span> · {historyText(item.title)}
              </span>
            </div>
          </div>
        );
      })}
      {items.length > 5 ? (
        <button type="button" className="fin-link-btn" style={{ marginTop: "0.5rem", fontSize: "0.8125rem" }} onClick={() => setAll((value) => !value)}>
          {all ? "Свернуть" : `Вся история · ${items.length} ${plural(items.length, "событие", "события", "событий")}`}
        </button>
      ) : null}
    </Section>
  );
}

/** «договор №ЮО/141 · сумма договора: 500 000 → 750 000» → без повтора номера. */
function historyText(title: string): string {
  return title.replace(/^договор\s+[^·]*·\s*/i, "");
}

export function useCardRefresh(id: string | null, open: boolean): void {
  useEffect(() => {
    if (open && id) void refreshOne(id);
  }, [id, open]);
}
