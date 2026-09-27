"use client";

/**
 * «Листы»: листы-отборы и их блоки.
 *
 * Лист ничего не хранит — он показывает договоры, подходящие под правило
 * одного из своих блоков (`views.py`). Блок без условий у обычного листа не
 * отбирает ничего — новый лист и новый блок пусты, пока не задано условие; у
 * главного листа такой блок держит всё, что не подошло другим блокам
 * (`views.place`), поэтому фраза пустого правила у них разная. Правило, подписи сторон, колонки и
 * подстановки новой строки — у блока; у листа без блоков один блок без
 * названия, и настройка выглядит так же.
 *
 * Правило, в отличие от подписей, не сохраняется на каждый щелчок: условие,
 * у которого ещё не выбрано значение, не отбирает ни одного договора, и
 * недописанное правило на секунду опустошило бы блок у всех, кто сейчас
 * смотрит этот лист. Поэтому правка правила — черновик со своим счётчиком
 * «подходит N», а на сервер уходит по «Применить правило». Подписи,
 * подстановки и название — безвредны и сохраняются сразу.
 */
import { useMemo, useState } from "react";

import { type RegistryView, type ViewBlock, type ViewFilter, contractsApi } from "@/components/finance/api";
import { viewCounts } from "@/components/finance/contracts/schema";
import { useRegistry } from "@/components/finance/contracts/store";
import { plural } from "@/components/finance/format";
import { ArrowDownIcon, ArrowUpIcon } from "@/components/icons";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { FilterSentence, RuleCount, ruleProblem } from "@/components/finance/contracts/setup/filter-sentence";
import { InlineText } from "@/components/finance/contracts/setup/inline-text";
import { ChoicePop, type PopOption } from "@/components/finance/contracts/setup/popover";
import { useSetupAction, type SetupAction } from "@/components/finance/contracts/setup/use-setup-action";
import { BILLING_WORDS, lowerFirst, slotTitles } from "@/components/finance/contracts/setup/words";
import { useSessionState } from "@/components/session-state";

type Slot = "executor" | "customer";

/**
 * Правило одной строкой с постоянным порядком ключей. Сервер хранит правило
 * в jsonb, и тот переставляет ключи условия («op» раньше «field»): без этого
 * черновик, вернувшийся к записанному, всё равно считался бы изменённым.
 */
function canon(filter: ViewFilter | null | undefined): string {
  return JSON.stringify({
    any: (filter?.any ?? []).map((group) => ({
      all: group.all.map((item) => ({ field: item.field, op: item.op, value: item.value ?? null })),
    })),
  });
}

/** Книги листов: реестр (карточки и «Таблица») и «Разовые». */
const BOOKS = [
  { key: "", title: "Реестр", pick: "в реестр" },
  { key: "oneoff", title: "Разовые", pick: "в «Разовые»" },
];

function contractsCount(count: number): string {
  return `${count} ${plural(count, "договор", "договора", "договоров")}`;
}

export function ViewsTab() {
  const schema = useRegistry((s) => s.schema);
  const byId = useRegistry((s) => s.byId);
  const action = useSetupAction();
  // Выбранный лист и набранное название нового переживают перезагрузку
  // (`session-state.tsx`).
  const [current, setCurrent] = useSessionState<string | null>("setup.view", null);
  const [title, setTitle] = useSessionState("setup.view-new", "");
  const [newBook, setNewBook] = useSessionState("setup.view-book", "");

  const views = useMemo(() => [...(schema?.views ?? [])].sort((a, b) => a.position - b.position), [schema]);
  const counts = useMemo(() => viewCounts(views, byId.values()), [views, byId]);
  // Листы реестра и «Разовых» — разными группами: у каждой книги свой порядок.
  const groups = useMemo(
    () =>
      BOOKS.map((book) => ({ ...book, views: views.filter((item) => (item.book ?? "") === book.key) })).filter(
        (group) => group.views.length || group.key === "",
      ),
    [views],
  );

  if (!schema) return null;
  const view = views.find((item) => item.id === current) ?? views[0];

  const move = async (group: RegistryView[], index: number, dir: -1 | 1) => {
    const one = group[index];
    const other = group[index + dir];
    if (!one || !other) return;
    // Меняемся местами с соседом. Одинаковые позиции (старые данные) разводим
    // на единицу — иначе обмен ничего бы не поменял.
    const a = one.position;
    const b = other.position === a ? a + dir : other.position;
    await action.run(`move:${one.id}`, async () => {
      await contractsApi.setup.updateView(one.id, { position: b });
      await contractsApi.setup.updateView(other.id, { position: a });
    });
  };

  const add = async () => {
    const clean = title.trim();
    if (!clean) return;
    const sameBook = views.filter((item) => (item.book ?? "") === newBook);
    const main = sameBook.find((item) => item.main) ?? sameBook[0] ?? views.find((item) => item.main) ?? views[0];
    const base = main?.blocks[0];
    // Новый лист получает колонки главного: лист без колонок в таблице был бы
    // пустой полосой, а собирать 20 колонок заново никто не станет.
    const blocks: ViewBlock[] = [
      { title: "", filter: { any: [] }, roles: base?.roles ?? {}, columns: base?.columns ?? [], defaults: {} },
    ];
    const made: { view: RegistryView | null } = { view: null };
    const ok = await action.run("add", async () => {
      made.view = await contractsApi.setup.addView({ title: clean, blocks, book: newBook });
    });
    if (ok) {
      setTitle("");
      if (made.view) setCurrent(made.view.id);
    }
  };

  return (
    <div className="setup-split">
      <div className="setup-side-wrap">
        <nav className="setup-side" aria-label="Листы">
          {groups.map((group) => (
            <div key={group.key || "main"} role="group" aria-label={group.title}>
              {groups.length > 1 ? <p className="setup-side-book">{group.title}</p> : null}
          {group.views.map((item, index) => (
            <div key={item.id} className="setup-side-row">
              <button
                type="button"
                className="setup-side-item"
                aria-current={item.id === view?.id ? "true" : undefined}
                onClick={() => setCurrent(item.id)}
              >
                <span className="setup-side-title">{item.title}</span>
                <span className="setup-side-count">{counts[item.key] ?? 0}</span>
              </button>
              <span className="setup-side-move">
                <button
                  type="button"
                  className="fin-icon-btn setup-move-btn"
                  aria-label={`Поднять лист «${item.title}»`}
                  disabled={index === 0 || action.busy(`move:${item.id}`)}
                  onClick={() => void move(group.views, index, -1)}
                >
                  <ArrowUpIcon size={14} />
                </button>
                <button
                  type="button"
                  className="fin-icon-btn setup-move-btn"
                  aria-label={`Опустить лист «${item.title}»`}
                  disabled={index === group.views.length - 1 || action.busy(`move:${item.id}`)}
                  onClick={() => void move(group.views, index, 1)}
                >
                  <ArrowDownIcon size={14} />
                </button>
              </span>
              {action.error(`move:${item.id}`) ? (
                <span className="setup-error setup-side-error" role="alert">
                  {action.error(`move:${item.id}`)}
                </span>
              ) : null}
            </div>
          ))}
            </div>
          ))}
        </nav>
        <form
          className="setup-add setup-add-side"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <input
            type="text"
            className="setup-input"
            value={title}
            placeholder="Новый лист"
            aria-label="Название нового листа"
            onChange={(event) => setTitle(event.target.value)}
          />
          <button type="submit" className="btn-ghost btn-sm" disabled={!title.trim() || action.busy("add")}>
            + Лист
          </button>
          <span className="setup-book-pick" role="group" aria-label="Книга нового листа">
            {BOOKS.map((book) => (
              <button key={book.key || "main"} type="button" aria-pressed={newBook === book.key} onClick={() => setNewBook(book.key)}>
                {book.pick}
              </button>
            ))}
          </span>
          {action.error("add") ? (
            <span className="setup-error setup-add-error" role="alert">
              {action.error("add")}
            </span>
          ) : null}
        </form>
      </div>
      {view ? <ViewEditor key={view.id} view={view} onGone={() => setCurrent(null)} /> : null}
    </div>
  );
}

// ── Лист ─────────────────────────────────────────────────────────────────────

function ViewEditor({ view, onGone }: { view: RegistryView; onGone: () => void }) {
  const byId = useRegistry((s) => s.byId);
  const action = useSetupAction();
  const [open, setOpen] = useSessionState<number | null>(`setup.view.${view.key}.open`, view.blocks.length === 1 ? 0 : null);
  const [ask, setAsk] = useState<{ kind: "view" } | { kind: "block"; index: number } | null>(null);
  const [newBlock, setNewBlock] = useState<string | null>(null);

  const blockCounts = useMemo(() => {
    const out: number[] = view.blocks.map(() => 0);
    for (const contract of byId.values()) {
      if (contract.deleted) continue;
      for (const place of contract.views) if (place.view === view.key && out[place.block] !== undefined) out[place.block] += 1;
    }
    return out;
  }, [byId, view]);

  const saveBlocks = (blocks: ViewBlock[], slot: string) =>
    action.run(slot, () => contractsApi.setup.updateView(view.id, { blocks }));

  const addBlock = async () => {
    const clean = (newBlock ?? "").trim();
    const base = view.blocks[0];
    const blocks: ViewBlock[] = [
      ...view.blocks,
      { title: clean, filter: { any: [] }, roles: base?.roles ?? {}, columns: base?.columns ?? [], defaults: {} },
    ];
    const ok = await saveBlocks(blocks, "block-add");
    if (ok) {
      setNewBlock(null);
      setOpen(blocks.length - 1);
    }
  };

  return (
    <section className="setup-pane" aria-label={`Лист «${view.title}»`}>
      <div className="setup-view-head">
        <span className="setup-view-title">
          <InlineText
            value={view.title}
            label="Название листа"
            strong
            trace={action.trace("title")}
            error={action.error("title")}
            onCommit={(next) => void action.run("title", () => contractsApi.setup.updateView(view.id, { title: next }))}
          />
        </span>
        {view.main ? (
          <span className="annot">главный лист</span>
        ) : (
          <button type="button" className="fin-link-btn setup-quiet" onClick={() => setAsk({ kind: "view" })}>
            Удалить лист
          </button>
        )}
      </div>
      {action.error("archive") ? (
        <p className="setup-error" role="alert">
          {action.error("archive")}
        </p>
      ) : null}

      <div className="setup-blocks-head">
        <span className="setup-blocks-title">Блоки</span>
        {newBlock === null ? (
          <button type="button" className="fin-link-btn" onClick={() => setNewBlock("")}>
            + блок
          </button>
        ) : (
          <form
            className="setup-inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              void addBlock();
            }}
          >
            <input
              type="text"
              className="setup-input"
              value={newBlock}
              autoFocus
              placeholder="Название блока"
              aria-label="Название нового блока"
              onChange={(event) => setNewBlock(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setNewBlock(null);
                }
              }}
            />
            <button type="submit" className="btn-primary btn-sm" disabled={action.busy("block-add")}>
              Добавить
            </button>
            <button type="button" className="fin-link-btn setup-quiet" onClick={() => setNewBlock(null)}>
              Отмена
            </button>
          </form>
        )}
      </div>
      {action.error("block-add") ? (
        <p className="setup-error" role="alert">
          {action.error("block-add")}
        </p>
      ) : null}

      <div className="setup-blocks">
        {view.blocks.map((block, index) => (
          <div key={index} className="setup-block" data-open={open === index ? "true" : undefined}>
            <button
              type="button"
              className="setup-block-head"
              aria-expanded={open === index}
              onClick={() => setOpen(open === index ? null : index)}
            >
              <span className="setup-block-name" data-empty={block.title ? undefined : "true"}>
                {block.title || (view.blocks.length === 1 ? "Весь лист" : "Без названия")}
              </span>
              <span className="setup-block-count">{contractsCount(blockCounts[index] ?? 0)}</span>
            </button>
            {open === index ? (
              <BlockEditor
                key={index}
                view={view}
                index={index}
                block={block}
                action={action}
                saveBlocks={saveBlocks}
                onRemove={view.blocks.length > 1 ? () => setAsk({ kind: "block", index }) : undefined}
              />
            ) : null}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={ask?.kind === "view"}
        title={`Удалить лист «${view.title}»?`}
        text="Лист уйдёт в корзину, договоры останутся в реестре и в других листах. Вернуть — из корзины в личном кабинете."
        confirm="Удалить"
        danger
        onCancel={() => setAsk(null)}
        onConfirm={async () => {
          setAsk(null);
          const ok = await action.run("archive", () => contractsApi.setup.updateView(view.id, { archived: true }));
          if (ok) onGone();
        }}
      />
      <ConfirmDialog
        open={ask?.kind === "block"}
        title={
          ask?.kind === "block"
            ? `Удалить блок «${view.blocks[ask.index]?.title || "без названия"}»?`
            : ""
        }
        text="Договоры блока останутся в реестре; в этом листе они встанут в другой блок, если подходят под его правило."
        confirm="Удалить"
        danger
        onCancel={() => setAsk(null)}
        onConfirm={async () => {
          if (ask?.kind !== "block") return;
          const index = ask.index;
          setAsk(null);
          const ok = await saveBlocks(
            view.blocks.filter((_, i) => i !== index),
            "block-remove",
          );
          if (ok) setOpen(null);
        }}
      />
      {action.error("block-remove") ? (
        <p className="setup-error" role="alert">
          {action.error("block-remove")}
        </p>
      ) : null}
    </section>
  );
}

// ── Блок ─────────────────────────────────────────────────────────────────────

type BlockProps = {
  view: RegistryView;
  index: number;
  block: ViewBlock;
  action: SetupAction;
  saveBlocks: (blocks: ViewBlock[], slot: string) => Promise<boolean>;
  onRemove?: () => void;
};

function BlockEditor({ view, index, block, action, saveBlocks, onRemove }: BlockProps) {
  const schema = useRegistry((s) => s.schema);
  const saved = canon(block.filter);
  // Черновик правила сбрасывается, когда меняется записанное правило: после
  // «Применить» (черновик и есть записанное) или правки коллеги. Счётчик при
  // этом не пересоздаётся и поднимает новое число, а не мигает пустотой.
  // Черновик правила переживает перезагрузку (`session-state.tsx`); записанное
  // правило поменялось, пока страница перезагружалась, — черновик сбросится
  // той же проверкой ниже.
  const [rule, setRule] = useSessionState<{ saved: string; draft: ViewFilter }>(`setup.view.${view.key}.${index}.rule`, () => ({
    saved,
    draft: JSON.parse(saved) as ViewFilter,
  }));
  if (rule.saved !== saved) setRule({ saved, draft: JSON.parse(saved) as ViewFilter });
  const draft = rule.draft;
  const setDraft = (next: ViewFilter) => setRule((value) => ({ ...value, draft: next }));
  const [showColumns, setShowColumns] = useState(false);

  const dirty = canon(draft) !== saved;
  const problem = ruleProblem(draft);
  const replace = (next: Partial<ViewBlock>) => view.blocks.map((item, i) => (i === index ? { ...item, ...next } : item));
  const slot = (name: string) => `${name}:${index}`;

  // Подписи сторон по умолчанию — из вида, который ставит блок; нет вида —
  // названия полей «Исполнитель» / «Заказчик».
  const titles = slotTitles(schema);
  const typeRoles = schema?.lists.type?.find((item) => item.id === block.defaults?.type)?.meaning.roles ?? {};
  const fallback = { executor: typeRoles.executor || titles.executor, customer: typeRoles.customer || titles.customer };
  const roles = block.roles ?? {};
  const order: Slot[] = roles.order?.length === 2 ? (roles.order as Slot[]) : ["executor", "customer"];
  const reversed = order[0] === "customer";

  const setRole = (who: Slot, label: string) => {
    const before = roles[who] || "";
    // Подпись колонки стороны в шапке блока шла за подписью стороны — меняем
    // её вместе, если человек не переписывал её отдельно.
    const columns = block.columns.map((column) =>
      column.key === who && (!column.label || column.label === before) ? { ...column, label: label || fallback[who] } : column,
    );
    void saveBlocks(replace({ roles: { ...roles, [who]: label, order }, columns }), slot(`role-${who}`));
  };

  const swap = () => {
    const nextOrder: Slot[] = [order[1], order[0]];
    const columns = [...block.columns];
    const a = columns.findIndex((column) => column.key === "executor");
    const b = columns.findIndex((column) => column.key === "customer");
    if (a >= 0 && b >= 0) [columns[a], columns[b]] = [columns[b], columns[a]];
    void saveBlocks(replace({ roles: { ...roles, order: nextOrder }, columns }), slot("swap"));
  };

  const setDefault = (key: string, value: string) => {
    const defaults = { ...(block.defaults ?? {}) };
    if (value) defaults[key] = value;
    else delete defaults[key];
    void saveBlocks(replace({ defaults }), slot(`default-${key}`));
  };

  // Подстановка, поставленная до того, как значение ушло в архив, читается
  // его словом с пометкой, а не «—»: иначе казалось бы, что её нет.
  const listOptions = (key: string): PopOption[] => [
    ...(schema?.lists[key] ?? []).map((item) => ({ value: item.id, label: item.value })),
    ...(schema?.archived_values?.[key] ?? [])
      .filter((item) => item.id === block.defaults?.[key])
      .map((item) => ({ value: item.id, label: `${item.value} (в корзине)` })),
    { value: "", label: "—" },
  ];
  const fieldTitle = (key: string) =>
    key === "row_number" ? "номер строки" : lowerFirst(schema?.fields.find((item) => item.key === key)?.title ?? key);

  const defaultParts: { key: string; word: string; options: PopOption[] }[] = [
    { key: "type", word: fieldTitle("type"), options: listOptions("type") },
    { key: "subject", word: fieldTitle("subject"), options: listOptions("subject") },
    { key: "status", word: fieldTitle("status"), options: listOptions("status") },
    {
      key: "billing",
      word: "начисление",
      options: [
        ...(schema?.billing_kinds ?? []).map((kind) => ({ value: kind, label: BILLING_WORDS[kind] ?? kind })),
        { value: "", label: "—" },
      ],
    },
    { key: "economic_role", word: "смысл", options: listOptions("economic_role") },
    {
      key: "department",
      word: "отдел",
      options: [
        ...(schema?.departments ?? []).map((item) => ({ value: item.id, label: item.code || item.title })),
        { value: "", label: "—" },
      ],
    },
    {
      key: "own_side",
      word: "наша сторона",
      options: [
        { value: "executor", label: lowerFirst(fallback.executor) },
        { value: "customer", label: lowerFirst(fallback.customer) },
        { value: "", label: "—" },
      ],
    },
  ];

  const errors = [
    "title", "rule", "role-executor", "role-customer", "swap",
    ...defaultParts.map((part) => `default-${part.key}`),
  ]
    .map((name) => action.error(slot(name)))
    .filter(Boolean);

  return (
    <div className="setup-block-body">
      <div className="setup-brow">
        <span className="setup-blabel">Название</span>
        <span className="setup-bvalue">
          <InlineText
            value={block.title}
            allowEmpty
            placeholder={view.blocks.length === 1 ? "без названия — весь лист" : "без названия"}
            label="Название блока"
            trace={action.trace(slot("title"))}
            onCommit={(next) => void saveBlocks(replace({ title: next }), slot("title"))}
          />
        </span>
      </div>

      <div className="setup-brow">
        <span className="setup-blabel">Правило</span>
        <span className="setup-bvalue">
          <FilterSentence
            value={draft}
            onChange={setDraft}
            {...(view.main
              ? {
                  emptyText:
                    view.blocks.length === 1
                      ? "Показывать все договоры"
                      : "Показывать договоры, которые не подошли другим блокам",
                  emptyAdd: "+ условие",
                }
              : {})}
          />
          <span className="setup-rule-foot">
            {/* У пустого правила счётчик не нужен: фраза уже говорит, что в
                блоке — ни одного договора или (у главного листа) все. Сервер
                на пустое правило отвечает нулём и у главного листа ошибся бы. */}
            {draft.any.length ? <RuleCount filter={draft} /> : null}
            {dirty ? (
              <>
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={!!problem || action.busy(slot("rule"))}
                  onClick={() => void saveBlocks(replace({ filter: draft }), slot("rule"))}
                >
                  Применить правило
                </button>
                <button
                  type="button"
                  className="fin-link-btn setup-quiet"
                  onClick={() => setDraft(JSON.parse(saved) as ViewFilter)}
                >
                  Вернуть как было
                </button>
                {problem ? <span className="fin-soft">{problem}</span> : null}
              </>
            ) : null}
          </span>
        </span>
      </div>

      <div className="setup-brow">
        <span className="setup-blabel">Стороны</span>
        <span className="setup-bvalue setup-sides">
          {order.map((who, i) => (
            <span key={who} className="setup-side-slot">
              {i === 1 ? (
                <span className="setup-arrow" aria-hidden="true">
                  →
                </span>
              ) : null}
              <InlineText
                value={roles[who] ?? ""}
                placeholder={fallback[who]}
                allowEmpty
                label={who === "executor" ? "Подпись исполнителя" : "Подпись заказчика"}
                trace={action.trace(slot(`role-${who}`))}
                onCommit={(next) => setRole(who, next)}
              />
              <span className="setup-slot-word">{who === "executor" ? lowerFirst(titles.executor) : lowerFirst(titles.customer)}</span>
            </span>
          ))}
          <span className="setup-sides-tools">
            {reversed ? <span className="annot">наоборот</span> : null}
            <button type="button" className="fin-link-btn" disabled={action.busy(slot("swap"))} onClick={swap}>
              Поменять местами
            </button>
          </span>
        </span>
      </div>

      <div className="setup-brow">
        <span className="setup-blabel">Новая строка</span>
        <span className="setup-bvalue setup-defaults">
          {defaultParts.map((part, i) => (
            <span key={part.key} className="setup-default">
              {i > 0 ? <span className="fin-muted"> · </span> : null}
              {part.word}{" "}
              <ChoicePop
                value={block.defaults?.[part.key] ?? ""}
                options={part.options}
                label={`Новая строка блока: ${part.word}`}
                disabled={action.busy(slot(`default-${part.key}`))}
                onPick={(value) => setDefault(part.key, value)}
              />
            </span>
          ))}
        </span>
      </div>

      <div className="setup-brow">
        <span className="setup-blabel">Колонки</span>
        <span className="setup-bvalue">
          <button type="button" className="fin-link-btn" aria-expanded={showColumns} onClick={() => setShowColumns((v) => !v)}>
            {block.columns.length
              ? `${block.columns.length} ${plural(block.columns.length, "колонка", "колонки", "колонок")} · ${showColumns ? "свернуть" : "показать"}`
              : "колонок нет"}
          </button>
          {showColumns && block.columns.length ? (
            <ol className="setup-columns">
              {block.columns.map((column, i) => {
                const own = fieldTitle(column.key);
                return (
                  <li key={`${column.key}:${i}`} className="setup-column">
                    <span className="fin-mono setup-column-num">{String(i + 1).padStart(2, "0")}</span>
                    <span className="setup-column-label">{column.label || own}</span>
                    {column.label && column.label.toLowerCase() !== own.toLowerCase() ? (
                      <span className="setup-column-field">{own}</span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
        </span>
      </div>

      {errors.length ? (
        <p className="setup-error" role="alert">
          {errors[0]}
        </p>
      ) : null}

      {onRemove ? (
        <div className="setup-block-foot">
          <button type="button" className="fin-link-btn setup-quiet" onClick={onRemove}>
            Удалить блок
          </button>
        </div>
      ) : null}
    </div>
  );
}
