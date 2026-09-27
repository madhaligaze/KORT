"use client";

/**
 * Загрузка реестра из Excel: протокол разбора из девяти пунктов.
 *
 * Это экран на плите, а не окно: разбор бывает длинным, его прерывают и
 * возвращаются к нему по адресу — номер партии лежит в `?batch=…`, и
 * перезагрузка страницы открывает тот же протокол с теми же решениями.
 *
 * Отчёт считает сервер, экран только показывает его и пишет решения. Ничего
 * спорного не решается молча: «Завести» неактивна, пока не приняты
 * блокирующие решения (колонки без поля, наши юрлица), и полоса записи
 * называет, какие именно.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { contractsApi, type ContractImportBatch } from "@/components/finance/api";
import { readParam, writeParams } from "@/components/finance/address";
import { plural } from "@/components/finance/format";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { ChevronRightIcon } from "@/components/icons";
import { gsap, prefersReducedMotion, useGSAP } from "@/components/motion/gsap";

import { ColumnsMap, openColumns, type FieldRef } from "./columns-map";
import { EntitiesStep, entitiesSummary } from "./entities-step";
import { FilePick, Phase, isRegistryFile } from "./file-pick";
import { Finale, type ApplyResult } from "./finale";
import styles from "./registry-import.module.css";
import {
  BlocksStep,
  DiffsStep,
  EndDatesStep,
  NumbersStep,
  OrphansStep,
  RulesStep,
  diffsSummary,
  pendingRules,
  orphansSummary,
  rulesSummary,
  statusesSummary,
  StatusesStep,
} from "./steps";
import {
  SECTION_KEYS,
  blockLabel,
  dictOf,
  isReversed,
  sectionOf,
  type BlockItem,
  type ColumnsBlock,
  type DiffItem,
  type EndDateItem,
  type EntityItem,
  type LooseItem,
  type NumberItem,
  type OrphanItem,
  type Report,
  type RuleItem,
  type SectionKey,
  type SimilarGroup,
  type StatusItem,
} from "./types";
import { Unfold } from "./unfold";
import { useDecisions } from "./use-decisions";

type Stage =
  | { kind: "pick"; error: string | null }
  | { kind: "parsing"; name: string }
  | { kind: "resume"; id: string }
  | { kind: "protocol"; batch: ContractImportBatch }
  | { kind: "done"; result: ApplyResult; report: Report | null };

type Props = {
  onDone: (result: { created: number }) => void;
  onCancel: () => void;
  /**
   * Правило блока теперь правится прямо в протоколе (п. 09), и в настройку
   * листа отсюда не уходят: листов до «Завести» ещё нет. Проп остаётся ради
   * совместимости с местом подключения и не вызывается.
   */
  onEditRule?: (block: string) => void;
};

export function RegistryImport({ onDone, onCancel }: Props) {
  const [stage, setStage] = useState<Stage>(() => {
    const id = readParam("batch");
    return id ? { kind: "resume", id } : { kind: "pick", error: null };
  });

  // Возврат к начатому разбору по адресу.
  const resumeId = stage.kind === "resume" ? stage.id : null;
  useEffect(() => {
    if (!resumeId) return;
    let alive = true;
    contractsApi.imports
      .get(resumeId)
      .then((batch) => {
        if (!alive) return;
        if (batch.status === "preview") setStage({ kind: "protocol", batch });
        else if (batch.status === "applied" && batch.report.result) {
          writeParams({ batch: null });
          setStage({ kind: "done", result: batch.report.result, report: batch.report });
        } else {
          writeParams({ batch: null });
          setStage({ kind: "pick", error: null });
        }
      })
      .catch(() => {
        if (!alive) return;
        // Партию отменили или она чужая — начинаем с выбора файла, без упрёка.
        writeParams({ batch: null });
        setStage({ kind: "pick", error: null });
      });
    return () => {
      alive = false;
    };
  }, [resumeId]);

  // Ушли из раздела, пока файл разбирался, — номер партии в адрес чужого
  // раздела не пишется; разбор останется на сервере до следующей загрузки.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const upload = useCallback((file: File) => {
    if (!isRegistryFile(file)) {
      setStage({ kind: "pick", error: "Реестр загружается из .xlsx" });
      return;
    }
    setStage({ kind: "parsing", name: file.name });
    contractsApi.imports
      .upload(file)
      .then((batch) => {
        if (!mounted.current) return;
        writeParams({ batch: batch.id });
        setStage({ kind: "protocol", batch });
      })
      .catch((error: unknown) => {
        setStage({ kind: "pick", error: error instanceof Error ? error.message : "Файл не разобрался" });
      });
  }, []);

  // Файл, брошенный мимо выбора (пока идёт разбор или открыт протокол),
  // браузер открыл бы вместо страницы — и разбор пропал бы вместе с ней.
  useEffect(() => {
    const swallow = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types ?? []).includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  // Заголовок «Загрузка реестра» ставит сам раздел «Финансов» — здесь его нет.
  return (
    <section className={styles.screen} aria-label="Загрузка реестра">
      {stage.kind === "pick" ? (
        <>
          <FilePick onFile={upload} error={stage.error} />
          <div className={styles.actions}>
            <button type="button" className="fin-link-btn fin-soft" onClick={onCancel}>
              К реестру
            </button>
          </div>
        </>
      ) : null}
      {stage.kind === "parsing" ? <Phase note={stage.name}>Разбираем файл…</Phase> : null}
      {stage.kind === "resume" ? <Phase>Читаем разбор…</Phase> : null}
      {stage.kind === "protocol" ? (
        <Protocol
          key={stage.batch.id}
          initial={stage.batch}
          onApplied={(result, report) => {
            writeParams({ batch: null });
            setStage({ kind: "done", result, report });
          }}
          onAnotherFile={() => {
            writeParams({ batch: null });
            setStage({ kind: "pick", error: null });
          }}
          onCancelled={() => {
            writeParams({ batch: null });
            onCancel();
          }}
        />
      ) : null}
      {stage.kind === "done" ? (
        <Finale result={stage.result} report={stage.report} onDone={() => onDone({ created: stage.result.created })} />
      ) : null}
    </section>
  );
}

// ── Протокол ─────────────────────────────────────────────────────────────────

type Confirm = "cancel" | "another" | null;

function Protocol({
  initial,
  onApplied,
  onAnotherFile,
  onCancelled,
}: {
  initial: ContractImportBatch;
  onApplied: (result: ApplyResult, report: Report) => void;
  onAnotherFile: () => void;
  onCancelled: () => void;
}) {
  const { batch, decisions, decide, flush, retry, error, dirty } = useDecisions(initial);
  const report = batch.report;
  const idBase = useId();
  const list = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState<Set<SectionKey>>(() => {
    const first = SECTION_KEYS.find((key) => report.blocking.includes(key));
    return new Set(first ? [first] : []);
  });
  const [confirm, setConfirm] = useState<Confirm>(null);
  // Постоянная ссылка: диалог по каждой новой ставит фокус заново, а протокол
  // перерисовывается с каждым ответом сервера.
  const closeConfirm = useCallback(() => setConfirm(null), []);
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [schemaFields, setSchemaFields] = useState<FieldRef[] | null>(null);

  useEffect(() => {
    let alive = true;
    contractsApi
      .schema()
      .then((schema) => {
        if (!alive) return;
        setSchemaFields(
          schema.fields
            .filter((field) => !field.hidden)
            .sort((a, b) => a.position - b.position)
            .map((field) => ({ key: field.key, title: field.title, position: field.position })),
        );
      })
      .catch(() => {
        /* без схемы поля подписаны шапками файла — разбору это не мешает */
      });
    return () => {
      alive = false;
    };
  }, []);

  const applying = startedAt > 0;
  useEffect(() => {
    if (!applying) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [applying]);

  // ── чтение отчёта ──
  const items = <T,>(key: SectionKey) => (sectionOf(report, key)?.items ?? []) as T[];
  const blocks = items<BlockItem>("blocks");
  const columnBlocks = items<ColumnsBlock>("columns");
  const entities = items<EntityItem>("entities");
  const similar = (sectionOf(report, "entities")?.similar ?? []) as SimilarGroup[];
  const statuses = items<StatusItem>("statuses");
  const subjects = (sectionOf(report, "statuses")?.subjects ?? []) as { value: string; count: number }[];
  const endDates = items<EndDateItem>("end_dates");
  const endCounts = (sectionOf(report, "end_dates")?.counts ?? {}) as Record<string, number>;
  const numbers = items<NumberItem>("numbers");
  const orphans = items<OrphanItem>("orphans");
  const loose = (sectionOf(report, "orphans")?.loose ?? []) as LooseItem[];
  const numberOnly = (sectionOf(report, "orphans")?.number_only ?? []) as LooseItem[];
  const rulesPending = pendingRules((sectionOf(report, "rules")?.pending ?? []) as string[], decisions);
  const diffs = items<DiffItem>("diffs");
  const rules = items<RuleItem>("rules");
  const mainSheet = typeof decisions.main_sheet === "string" ? decisions.main_sheet : report.main_sheet;

  const fields = useMemo<FieldRef[]>(() => {
    if (schemaFields) return schemaFields;
    const seen = new Map<string, FieldRef>();
    for (const block of columnBlocks)
      for (const column of block.columns)
        if (column.key && column.key !== "row_number" && !seen.has(column.key))
          seen.set(column.key, { key: column.key, title: column.header.replace(/\s+/g, " "), position: column.index });
    return [...seen.values()];
  }, [schemaFields, columnBlocks]);

  // Блокирующие пункты: сервер знает точно, но пока решение летит, экран
  // уже знает ответ сам — иначе «Завести» ждала бы полсекунды после клика.
  const openCount = openColumns(columnBlocks, decisions);
  const confirmed = Boolean(dictOf(decisions, "entities").confirmed);
  const blocking = report.blocking.filter((key) => {
    if (key === "columns") return openCount > 0;
    if (key === "entities") return !confirmed;
    if (key === "rules") return rulesPending.length > 0;
    return true;
  });

  const rowsTotal = blocks.reduce((sum, block) => sum + block.rows, 0);
  const reversed = blocks.filter((block) => isReversed(block.roles)).length;
  const columnsTotal = columnBlocks.reduce((sum, block) => sum + block.columns.length, 0);
  const create = report.totals.create;

  const summaries: Record<SectionKey, string> = {
    blocks: [
      `${report.sheets.length} ${plural(report.sheets.length, "лист", "листа", "листов")}`,
      `${blocks.length} ${plural(blocks.length, "блок", "блока", "блоков")}`,
      reversed ? `${reversed} наоборот` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    columns: `${columnsTotal - openCount} из ${columnsTotal} легли на поля`,
    entities: entitiesSummary(entities, decisions),
    statuses: statusesSummary(statuses, decisions),
    end_dates: `расторжение ${endCounts.terminated ?? 0} · исполнение ${endCounts.fulfilled ?? 0} · не ясно ${endCounts.unknown ?? 0}`,
    numbers: numbers.length
      ? `${numbers.length} ${plural(numbers.length, "номер", "номера", "номеров")} · предупреждение`
      : "повторов нет",
    orphans: orphansSummary(orphans, loose, numberOnly, decisions),
    diffs: diffsSummary(diffs, mainSheet, decisions),
    rules: rulesSummary(rules),
  };
  const waiting: Partial<Record<SectionKey, string>> = {
    columns: openCount ? `ждут решения: ${openCount}` : undefined,
    entities: confirmed ? undefined : "ждёт решения",
    rules: rulesPending.length ? `ждут решения: ${rulesPending.length}` : undefined,
  };
  const titleOf = (key: SectionKey) => sectionOf(report, key)?.title ?? key;
  const anchor = (key: SectionKey) => `${idBase}-${key}`;

  const toggle = (key: SectionKey) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** К пункту, который держит «Завести»: раскрыть и докрутить. */
  const reveal = (key: SectionKey) => {
    setOpen((current) => new Set(current).add(key));
    window.requestAnimationFrame(() =>
      document.getElementById(anchor(key))?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" }),
    );
  };

  // Вход протокола: линии между пунктами прочерчиваются, номера и сводки
  // проявляются — ровно вход `IndexList`. Длинный вход здесь законен: экран
  // открывается раз в жизни реестра и сам рассказывает, что нашёл.
  useGSAP(
    () => {
      const el = list.current;
      if (!el) return;
      const rules = el.querySelectorAll("[data-rule]");
      const quiet = el.querySelectorAll(".proto-head .ix-num, .proto-head .proto-summary, .proto-head .proto-state");
      if (prefersReducedMotion()) return;
      gsap.set(rules, { scaleX: 0, transformOrigin: "0% 50%" });
      gsap.set(quiet, { opacity: 0 });
      gsap
        .timeline()
        .to(rules, { scaleX: 1, duration: 1.5, ease: "expo.inOut", stagger: 0.09, clearProps: "transform" })
        // Прозрачность не снимается: `.motion .ix-num` из globals.css прячет
        // номера первые четыре секунды после загрузки, и снятый стиль отдал бы
        // их обратно этому правилу.
        .to(quiet, { opacity: 1, duration: 0.7, ease: "power2.out", stagger: 0.04 }, 0.45);
    },
    { scope: list },
  );

  const apply = async () => {
    setApplyError(null);
    const started = Date.now();
    setStartedAt(started);
    setNow(started);
    try {
      const fresh = await flush();
      if (fresh.report.blocking.length) {
        setStartedAt(0);
        return;
      }
      const { result } = await contractsApi.imports.apply(fresh.id);
      onApplied(result, fresh.report);
    } catch (caught) {
      setStartedAt(0);
      setApplyError(caught instanceof Error ? caught.message : "Не завелось");
    }
  };

  const drop = async (then: () => void) => {
    setBusy(true);
    try {
      await contractsApi.imports.cancel(batch.id);
      setConfirm(null);
      then();
    } catch (caught) {
      setConfirm(null);
      setApplyError(caught instanceof Error ? caught.message : "Загрузка не отменилась");
    } finally {
      setBusy(false);
    }
  };

  const bodies: Record<SectionKey, ReactNode> = {
    blocks: <BlocksStep items={blocks} mainSheet={mainSheet} decide={decide} />,
    columns: <ColumnsMap blocks={columnBlocks} decisions={decisions} decide={decide} fields={fields} />,
    entities: <EntitiesStep items={entities} similar={similar} decisions={decisions} decide={decide} />,
    statuses: <StatusesStep items={statuses} decisions={decisions} decide={decide} />,
    end_dates: <EndDatesStep items={endDates} counts={endCounts} decisions={decisions} decide={decide} />,
    numbers: <NumbersStep items={numbers} />,
    orphans: (
      <OrphansStep
        items={orphans}
        loose={loose}
        numberOnly={numberOnly}
        blocks={blocks}
        mainSheet={mainSheet}
        decisions={decisions}
        decide={decide}
      />
    ),
    diffs: <DiffsStep items={diffs} mainSheet={mainSheet} decisions={decisions} decide={decide} />,
    rules: <RulesStep items={rules} statuses={statuses} subjects={subjects} decisions={decisions} decide={decide} />,
  };

  const elapsed = Math.max(0, Math.round((now - startedAt) / 1000));

  return (
    <>
      <p className={styles.fileLine}>
        <span className={styles.fileName}>{batch.file_name}</span>
        <span className="fin-soft">
          {" · "}
          {report.sheets.length} {plural(report.sheets.length, "лист", "листа", "листов")} · {rowsTotal}{" "}
          {plural(rowsTotal, "строка", "строки", "строк")}
        </span>
        <button type="button" className={`fin-link-btn ${styles.fileAction}`} onClick={() => setConfirm("another")} disabled={applying}>
          Другой файл
        </button>
      </p>

      <div ref={list} className={`proto ${styles.proto}`}>
        {SECTION_KEYS.map((key, index) => {
          const section = sectionOf(report, key);
          if (!section) return null;
          const isOpen = open.has(key);
          return (
            <div key={key} id={anchor(key)} className={`proto-item ${styles.item}`}>
              <span className={styles.rule} data-rule="" aria-hidden="true" />
              <button
                type="button"
                className="proto-head"
                aria-expanded={isOpen}
                aria-controls={`${anchor(key)}-body`}
                onClick={() => toggle(key)}
              >
                <span className="ix-num">{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.headText}>
                  <span className="proto-title">{titleOf(key)}</span>
                  <span className="proto-summary">{summaries[key]}</span>
                </span>
                <span className={`proto-state ${styles.state}`}>
                  {waiting[key] ? <span className={styles.wait}>{waiting[key]}</span> : null}
                  <ChevronRightIcon size={16} className={styles.chev} data-open={isOpen ? "true" : undefined} aria-hidden="true" />
                </span>
              </button>
              <Unfold open={isOpen} id={`${anchor(key)}-body`}>
                <div className="proto-body">{bodies[key]}</div>
              </Unfold>
            </div>
          );
        })}
        <span className={`${styles.rule} ${styles.ruleEnd}`} data-rule="" aria-hidden="true" />
      </div>

      <div className={`fin-apply-bar ${styles.bar}`}>
        <div className={styles.barText} aria-live="polite">
          {error && !error.retry ? (
            <span className={`fin-fail ${styles.barReason}`}>Решение не принято: {error.text}</span>
          ) : null}
          {error?.retry ? (
            <span className="fin-fail">
              Решение не сохранилось: {error.text} ·{" "}
              <button type="button" className="fin-link-btn" onClick={retry}>
                Повторить
              </button>
            </span>
          ) : applyError ? (
            <span className="fin-fail">{applyError}</span>
          ) : blocking.length ? (
            <span>
              Сначала решите:{" "}
              {blocking.map((key, index) => (
                <span key={key}>
                  {index ? ", " : ""}
                  <button type="button" className="fin-link-btn" onClick={() => reveal(key as SectionKey)}>
                    {titleOf(key as SectionKey)}
                  </button>
                </span>
              ))}
              {rulesPending.length ? (
                <span className={styles.barReason}>
                  {rulesPending
                    .slice(0, 2)
                    .map((block) => {
                      const rule = rules.find((item) => item.block === block);
                      return rule ? `${blockLabel(rule.sheet, rule.title)}: ${rule.reason}` : block;
                    })
                    .join("; ")}
                  {rulesPending.length > 2 ? ` и ещё ${rulesPending.length - 2}` : ""}
                </span>
              ) : null}
            </span>
          ) : (
            <span>Всё решено</span>
          )}
        </div>
        <div className={styles.barActions}>
          <button type="button" className="btn-ghost" onClick={() => setConfirm("cancel")} disabled={applying}>
            Отменить загрузку
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={blocking.length > 0 || applying || Boolean(error?.retry)}
            aria-busy={applying || dirty || undefined}
            onClick={() => void apply()}
          >
            {applying ? `Заводим… ${elapsed} с` : `Завести ${create} ${plural(create, "договор", "договора", "договоров")}`}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "another" ? "Загрузить другой файл?" : "Отменить загрузку?"}
        text={`Решения по «${batch.file_name}» пропадут, договоры не заведутся.`}
        confirm={confirm === "another" ? "Другой файл" : "Отменить загрузку"}
        danger
        busy={busy}
        onCancel={closeConfirm}
        onConfirm={() => void drop(confirm === "another" ? onAnotherFile : onCancelled)}
      />
    </>
  );
}
