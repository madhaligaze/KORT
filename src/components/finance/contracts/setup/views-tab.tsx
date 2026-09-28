"use client";

/**
 * «Листы»: листы-отборы реестра и «Разовых».
 *
 * Лист ничего не хранит — он показывает договоры, подходящие под его правило
 * (`views.py`). Лист бывает поделён на части с заголовком — «АГЕНТСКИЙ
 * ДОГОВОР», «АРЕНДА», «ФИН. ПОМОЩЬ» в «Прочих договорах», как в Excel, откуда
 * он пришёл; у каждой части своё правило, шапка и подстановки. В данных это
 * блоки листа.
 *
 * 28.09.2026 владелец «понажимал на всё и не понял, как работает»: у каждого
 * листа стояли «Блоки · + блок» и «Весь лист» — даже у листа без частей, а у
 * главного листа «+ условие» ничего не меняло (главный держит все договоры).
 * Теперь:
 * * лист без частей показывает свои настройки сразу, слова «блок» нет;
 * * деление на части — отдельной кнопкой «Разделить лист на части» с
 *   подсказкой, что это и зачем; части появляются, только когда их больше одной;
 * * у главного листа из одной части правило не редактируется — сказано, что в
 *   нём все договоры реестра;
 * * у каждой кнопки и подписи — подсказка при наведении (`tip.tsx`).
 *
 * Правило, в отличие от подписей, не сохраняется на каждый щелчок: условие,
 * у которого ещё не выбрано значение, не отбирает ни одного договора, и
 * недописанное правило на секунду опустошило бы лист у всех, кто сейчас его
 * смотрит. Поэтому правка правила и подсветки — черновик со своим счётчиком
 * «подходит N», а на сервер уходит по «Применить». Подписи, подстановки и
 * название — безвредны и сохраняются сразу.
 */
import { useMemo, useState } from "react";

import { type RegistryView, type ViewBlock, type ViewFilter, contractsApi } from "@/components/finance/api";
import { bookTitle, viewCounts } from "@/components/finance/contracts/schema";
import { useRegistry } from "@/components/finance/contracts/store";
import { plural } from "@/components/finance/format";
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, CloseIcon } from "@/components/icons";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { FilterSentence, RuleCount, ruleProblem } from "@/components/finance/contracts/setup/filter-sentence";
import { InlineText } from "@/components/finance/contracts/setup/inline-text";
import { ChoicePop, MultiPop, type PopOption } from "@/components/finance/contracts/setup/popover";
import { tip } from "@/components/finance/contracts/setup/tip";
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
const BOOK_KEYS = ["", "oneoff"];

function contractsCount(count: number): string {
  return `${count} ${plural(count, "договор", "договора", "договоров")}`;
}

/** Новая часть или новый лист — с колонками, подписями и выбором того, от чего он начат. */
function blockFrom(base: ViewBlock | undefined, title: string): ViewBlock {
  return {
    title,
    filter: { any: [] },
    roles: base?.roles ?? {},
    columns: base?.columns ?? [],
    defaults: {},
    ...(base?.choices ? { choices: base.choices } : {}),
    ...(base?.paint ? { paint: base.paint } : {}),
  };
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
      BOOK_KEYS.map((key) => ({
        key,
        title: bookTitle(schema, key),
        views: views.filter((item) => (item.book ?? "") === key),
      })).filter((group) => group.views.length || group.key === ""),
    [views, schema],
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
    const otherWas = other.position;
    await action.run(
      `move:${one.id}`,
      async () => {
        await contractsApi.setup.updateView(one.id, { position: b });
        await contractsApi.setup.updateView(other.id, { position: a });
      },
      "schema",
      {
        text: `Лист «${one.title}» ${dir === -1 ? "левее" : "правее"}`,
        revert: async () => {
          await contractsApi.setup.updateView(one.id, { position: a });
          await contractsApi.setup.updateView(other.id, { position: otherWas });
        },
      },
    );
  };

  const add = async () => {
    const clean = title.trim();
    if (!clean) return;
    const sameBook = views.filter((item) => (item.book ?? "") === newBook);
    const main = sameBook.find((item) => item.main) ?? sameBook[0] ?? views.find((item) => item.main) ?? views[0];
    // Новый лист получает колонки (и выбор, подсветку) главного листа своей
    // книги: лист без колонок в таблице был бы пустой полосой.
    const blocks: ViewBlock[] = [blockFrom(main?.blocks[0], "")];
    const made: { view: RegistryView | null } = { view: null };
    const ok = await action.run(
      "add",
      async () => {
        made.view = await contractsApi.setup.addView({ title: clean, blocks, book: newBook });
      },
      "schema",
      () =>
        made.view
          ? { text: `Лист «${clean}» добавлен`, revert: () => contractsApi.setup.updateView(made.view!.id, { archived: true }) }
          : null,
    );
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
              {groups.length > 1 ? (
                <p
                  className="setup-side-book"
                  {...tip(
                    group.key
                      ? "Листы раздела «Разовые» — своя книга с теми же договорами, что в реестре."
                      : "Листы раздела «Реестр»: вкладки над списком договоров и листы таблицы.",
                  )}
                >
                  {group.title}
                </p>
              ) : null}
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
                      {...tip("Левее во вкладках листа и таблицы.")}
                      disabled={index === 0 || action.busy(`move:${item.id}`)}
                      onClick={() => void move(group.views, index, -1)}
                    >
                      <ArrowUpIcon size={14} />
                    </button>
                    <button
                      type="button"
                      className="fin-icon-btn setup-move-btn"
                      aria-label={`Опустить лист «${item.title}»`}
                      {...tip("Правее во вкладках листа и таблицы.")}
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
          <button
            type="submit"
            className="btn-ghost btn-sm"
            {...tip("Новый лист-отбор: он пуст, пока не задано правило «кто в листе». Колонки — как у главного листа.")}
            disabled={!title.trim() || action.busy("add")}
          >
            + Лист
          </button>
          <span className="setup-book-pick" role="group" aria-label="Куда новый лист">
            <span className="fin-muted">в</span>
            {BOOK_KEYS.map((key) => (
              <button key={key || "main"} type="button" aria-pressed={newBook === key} onClick={() => setNewBook(key)}>
                {bookTitle(schema, key)}
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

/** Что сделано с частями листа — словами строки «Вернуть» (`setup/undo.ts`). */
function blocksText(title: string, slot: string): string {
  const name = `«${title}»`;
  const base = slot.split(":")[0];
  if (base === "block-add") return `В листе ${name} новая часть`;
  if (base === "block-remove") return `Из листа ${name} удалена часть`;
  if (base.startsWith("role-")) return `Подпись стороны в листе ${name} изменена`;
  if (base === "swap") return `Стороны в листе ${name} поменялись местами`;
  if (base.startsWith("default-")) return `Подстановка новой строки листа ${name} изменена`;
  if (base === "choices") return `Выбор в листе ${name} изменён`;
  if (base === "title") return `Заголовок части листа ${name} изменён`;
  if (base === "rule") return `Правило листа ${name} изменено`;
  if (base === "paint") return `Подсветка строк листа ${name} изменена`;
  if (base.startsWith("col")) return `Колонки листа ${name} изменены`;
  return `Лист ${name} изменён`;
}

function ViewEditor({ view, onGone }: { view: RegistryView; onGone: () => void }) {
  const byId = useRegistry((s) => s.byId);
  const schema = useRegistry((s) => s.schema);
  const action = useSetupAction();
  const [open, setOpen] = useSessionState<number | null>(`setup.view.${view.key}.open`, null);
  const [ask, setAsk] = useState<{ kind: "view" } | { kind: "block"; index: number } | null>(null);
  const [newBlock, setNewBlock] = useState<string | null>(null);
  const single = view.blocks.length === 1;

  const blockCounts = useMemo(() => {
    const out: number[] = view.blocks.map(() => 0);
    for (const contract of byId.values()) {
      if (contract.deleted) continue;
      for (const place of contract.views) if (place.view === view.key && out[place.block] !== undefined) out[place.block] += 1;
    }
    return out;
  }, [byId, view]);
  const total = blockCounts.reduce((sum, count) => sum + count, 0);

  // Любая правка частей листа возвращается прежними частями целиком.
  const saveBlocks = (blocks: ViewBlock[], slot: string) => {
    const previous = view.blocks;
    return action.run(slot, () => contractsApi.setup.updateView(view.id, { blocks }), "schema", {
      text: blocksText(view.title, slot),
      revert: () => contractsApi.setup.updateView(view.id, { blocks: previous }),
    });
  };

  const addBlock = async () => {
    const clean = (newBlock ?? "").trim();
    const blocks: ViewBlock[] = [...view.blocks, blockFrom(view.blocks[0], clean)];
    const ok = await saveBlocks(blocks, "block-add");
    if (ok) {
      setNewBlock(null);
      setOpen(blocks.length - 1);
    }
  };

  const partForm =
    newBlock === null ? null : (
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
          placeholder="Заголовок части, например «АРЕНДА»"
          aria-label="Заголовок новой части листа"
          onChange={(event) => setNewBlock(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setNewBlock(null);
            }
          }}
        />
        <button type="submit" className="btn-primary btn-sm" disabled={action.busy("block-add")}>
          Добавить часть
        </button>
        <button type="button" className="fin-link-btn setup-quiet" onClick={() => setNewBlock(null)}>
          Отмена
        </button>
      </form>
    );

  const splitTip =
    "Лист можно поделить на части с заголовком — как «Прочие договоры»: «АГЕНТСКИЙ ДОГОВОР», «АРЕНДА», «ФИН. ПОМОЩЬ». В листе части идут друг под другом, у каждой своё правило, своя шапка и своя пустая строка для нового договора.";

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
            onCommit={(next) =>
              void action.run("title", () => contractsApi.setup.updateView(view.id, { title: next }), "schema", {
                text: `Лист «${view.title}» теперь «${next}»`,
                revert: () => contractsApi.setup.updateView(view.id, { title: view.title }),
              })
            }
          />
        </span>
        <span className="setup-view-count" {...tip("Сколько договоров сейчас в листе.")}>
          {contractsCount(total)}
        </span>
      </div>
      <p className="setup-view-kind">
        <span {...tip(view.book ? "Книга «Разовых»: те же договоры, свои листы." : "Листы реестра: вкладки над списком договоров и листы таблицы.")}>
          {bookTitle(schema, view.book ?? "")}
        </span>
        {view.main ? (
          <span
            className="setup-view-main"
            {...tip("В главном листе все договоры реестра. Его нельзя удалить; если он поделён на части, правила частей только раскладывают договоры по частям.")}
          >
            · главный лист
          </span>
        ) : null}
        {view.main ? null : (
          <button
            type="button"
            className="fin-link-btn setup-quiet setup-view-drop"
            {...tip("Лист уйдёт в корзину. Договоры останутся в реестре и в других листах.")}
            onClick={() => setAsk({ kind: "view" })}
          >
            Удалить лист
          </button>
        )}
      </p>
      {action.error("archive") ? (
        <p className="setup-error" role="alert">
          {action.error("archive")}
        </p>
      ) : null}

      {single ? (
        <>
          <BlockEditor view={view} index={0} block={view.blocks[0]} action={action} saveBlocks={saveBlocks} />
          <div className="setup-split-line">
            {newBlock === null ? (
              <button type="button" className="fin-link-btn" {...tip(splitTip, "Части листа")} onClick={() => setNewBlock("")}>
                Разделить лист на части
              </button>
            ) : (
              partForm
            )}
          </div>
        </>
      ) : (
        <>
          <div className="setup-blocks-head">
            <span className="setup-blocks-title" {...tip(splitTip, "Части листа")}>
              Части листа · {view.blocks.length}
            </span>
            {newBlock === null ? (
              <button type="button" className="fin-link-btn" {...tip("Ещё одна часть — встанет в листе последней.")} onClick={() => setNewBlock("")}>
                + часть
              </button>
            ) : (
              partForm
            )}
          </div>
          <div className="setup-blocks">
            {view.blocks.map((block, index) => (
              <div key={index} className="setup-block" data-open={open === index ? "true" : undefined}>
                <button
                  type="button"
                  className="setup-block-head"
                  aria-expanded={open === index}
                  onClick={() => setOpen(open === index ? null : index)}
                >
                  <span className="setup-fchev" aria-hidden="true">
                    <ChevronRightIcon size={14} />
                  </span>
                  <span className="setup-block-name" data-empty={block.title ? undefined : "true"}>
                    {block.title || "Часть без заголовка"}
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
                    onRemove={() => setAsk({ kind: "block", index })}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}
      {action.error("block-add") ? (
        <p className="setup-error" role="alert">
          {action.error("block-add")}
        </p>
      ) : null}

      <ConfirmDialog
        open={ask?.kind === "view"}
        title={`Удалить лист «${view.title}»?`}
        text="Лист уйдёт в корзину, договоры останутся в реестре и в других листах. Вернуть — из корзины в личном кабинете."
        confirm="Удалить"
        danger
        onCancel={() => setAsk(null)}
        onConfirm={async () => {
          setAsk(null);
          const ok = await action.run("archive", () => contractsApi.setup.updateView(view.id, { archived: true }), "schema", {
            text: `Лист «${view.title}» удалён в корзину`,
            revert: () => contractsApi.setup.updateView(view.id, { archived: false }),
          });
          if (ok) onGone();
        }}
      />
      <ConfirmDialog
        open={ask?.kind === "block"}
        title={ask?.kind === "block" ? `Удалить часть «${view.blocks[ask.index]?.title || "без заголовка"}»?` : ""}
        text="Договоры части останутся в реестре; в этом листе они встанут в другую часть, если подходят под её правило."
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

// ── Часть листа ──────────────────────────────────────────────────────────────

type BlockProps = {
  view: RegistryView;
  index: number;
  block: ViewBlock;
  action: SetupAction;
  saveBlocks: (blocks: ViewBlock[], slot: string) => Promise<boolean>;
  onRemove?: () => void;
};

/**
 * Черновик правила: сбрасывается, когда меняется записанное (после
 * «Применить» или правки коллеги), и переживает перезагрузку страницы.
 */
function useRuleDraft(key: string, saved: string) {
  const [rule, setRule] = useSessionState<{ saved: string; draft: ViewFilter }>(key, () => ({
    saved,
    draft: JSON.parse(saved) as ViewFilter,
  }));
  if (rule.saved !== saved) setRule({ saved, draft: JSON.parse(saved) as ViewFilter });
  const draft = rule.draft;
  const setDraft = (next: ViewFilter) => setRule((value) => ({ ...value, draft: next }));
  const reset = () => setDraft(JSON.parse(saved) as ViewFilter);
  return { draft, setDraft, reset, dirty: canon(draft) !== saved };
}

function BlockEditor({ view, index, block, action, saveBlocks, onRemove }: BlockProps) {
  const schema = useRegistry((s) => s.schema);
  const solo = view.blocks.length === 1;
  const rule = useRuleDraft(`setup.view.${view.key}.${index}.rule`, canon(block.filter));
  const paintSaved = canon(block.paint?.[0]?.filter);
  const paint = useRuleDraft(`setup.view.${view.key}.${index}.paint`, paintSaved);
  const [showColumns, setShowColumns] = useState(false);

  const problem = ruleProblem(rule.draft);
  const paintProblem = ruleProblem(paint.draft);
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
    // Подпись колонки стороны в шапке шла за подписью стороны — меняем её
    // вместе, если человек не переписывал её отдельно.
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

  // Выбор в списках: поля-списки, которые есть в колонках этой части.
  const listColumns = block.columns
    .map((column) => schema?.fields.find((field) => field.key === column.key))
    .filter((field): field is NonNullable<typeof field> => !!field && (field.type === "list" || field.type === "multi_list"));
  const choices = block.choices ?? {};
  const setChoices = (key: string, ids: string[] | null) => {
    const next = { ...choices };
    if (ids && ids.length) next[key] = ids;
    else delete next[key];
    void saveBlocks(replace({ choices: next }), slot("choices"));
  };

  const errors = [
    "title", "rule", "paint", "choices", "role-executor", "role-customer", "swap",
    ...defaultParts.map((part) => `default-${part.key}`),
  ]
    .map((name) => action.error(slot(name)))
    .filter(Boolean);

  const mainAll = view.main && solo;

  return (
    <div className="setup-block-body">
      {solo ? null : (
        <div className="setup-brow">
          <span className="setup-blabel" {...tip("Заголовок части — строкой над её шапкой в листе, как в Excel.")}>
            Заголовок
          </span>
          <span className="setup-bvalue">
            <InlineText
              value={block.title}
              allowEmpty
              placeholder="без заголовка"
              label="Заголовок части"
              trace={action.trace(slot("title"))}
              onCommit={(next) => void saveBlocks(replace({ title: next }), slot("title"))}
            />
          </span>
        </div>
      )}

      <div className="setup-brow">
        <span
          className="setup-blabel"
          {...tip(
            mainAll
              ? "В главном листе — все договоры реестра, правило ему не нужно."
              : "Какие договоры попадают сюда. Условия в строке — «и», строки между собой — «или». Правило действует после «Применить»; до этого видно, сколько договоров подошло бы.",
          )}
        >
          Кто в листе
        </span>
        <span className="setup-bvalue">
          {mainAll ? (
            <span className="setup-rule-static">Все договоры реестра</span>
          ) : (
            <>
              <FilterSentence
                value={rule.draft}
                onChange={rule.setDraft}
                lead="Договоры, где"
                {...(view.main
                  ? { emptyText: "Договоры, которые не подошли другим частям", emptyAdd: "+ условие" }
                  : { emptyText: "Пока ни одного договора — нужно условие", emptyAdd: "+ условие" })}
              />
              <span className="setup-rule-foot">
                {/* У пустого правила счётчик не нужен: фраза уже говорит, что в
                    листе ни одного договора или (у главного) все остальные. */}
                {rule.draft.any.length ? <RuleCount filter={rule.draft} /> : null}
                {rule.dirty ? (
                  <>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={!!problem || action.busy(slot("rule"))}
                      onClick={() => void saveBlocks(replace({ filter: rule.draft }), slot("rule"))}
                    >
                      Применить правило
                    </button>
                    <button type="button" className="fin-link-btn setup-quiet" onClick={rule.reset}>
                      Вернуть как было
                    </button>
                    {problem ? <span className="fin-soft">{problem}</span> : null}
                  </>
                ) : null}
              </span>
            </>
          )}
        </span>
      </div>

      <div className="setup-brow">
        <span
          className="setup-blabel"
          {...tip(
            "Как условное форматирование в Google Таблицах: строка договора, подходящего под условие, заливается зелёным во всю ширину листа. В «Разовых» так отмечены исполненные.",
            "Подсветка строк",
          )}
        >
          Подсветка
        </span>
        <span className="setup-bvalue">
          <FilterSentence
            value={paint.draft}
            onChange={paint.setDraft}
            lead="Строка зелёная, где"
            emptyText="Строки не подсвечиваются"
            emptyAdd="+ подсветить по условию"
          />
          {paint.dirty ? (
            <span className="setup-rule-foot">
              <button
                type="button"
                className="btn-primary btn-sm"
                disabled={!!paintProblem || action.busy(slot("paint"))}
                onClick={() =>
                  void saveBlocks(
                    replace({
                      paint: paint.draft.any.length
                        ? [{ filter: paint.draft, tone: "done" }, ...(block.paint ?? []).slice(1)]
                        : (block.paint ?? []).slice(1),
                    }),
                    slot("paint"),
                  )
                }
              >
                Применить подсветку
              </button>
              <button type="button" className="fin-link-btn setup-quiet" onClick={paint.reset}>
                Вернуть как было
              </button>
              {paintProblem ? <span className="fin-soft">{paintProblem}</span> : null}
            </span>
          ) : null}
        </span>
      </div>

      {listColumns.length ? (
        <div className="setup-brow">
          <span
            className="setup-blabel"
            {...tip(
              "Что предлагает выпадающий список в этом листе. В «Разовых» статус — только «на исполнении» и «исполнен», хотя в реестре их больше. Значения договоров это не меняет.",
              "Выбор в списках",
            )}
          >
            Выбор
          </span>
          <span className="setup-bvalue setup-choices">
            {Object.keys(choices).length === 0 ? <span className="fin-muted">во всех списках — все значения</span> : null}
            {Object.entries(choices).map(([key, ids]) => {
              const field = schema?.fields.find((item) => item.key === key);
              const values = schema?.lists[key] ?? [];
              const labels = ids.map((id) => values.find((item) => item.id === id)?.value).filter(Boolean);
              return (
                <span key={key} className="setup-choice">
                  <span className="fin-soft">{lowerFirst(field?.title ?? key)} — только</span>{" "}
                  <MultiPop
                    values={ids}
                    options={values.map((item) => ({ value: item.id, label: item.value }))}
                    label={`Выбор «${field?.title ?? key}» в этом листе`}
                    text={labels.map((label) => `«${label}»`).join(", ") || "ничего"}
                    onChange={(next) => setChoices(key, next)}
                    disabled={action.busy(slot("choices"))}
                  />
                  <button
                    type="button"
                    className="choice-clear choice-clear-inline"
                    aria-label={`Все значения «${field?.title ?? key}»`}
                    {...tip("Снять ограничение: список предложит все значения.")}
                    onClick={() => setChoices(key, null)}
                  >
                    <CloseIcon size={12} />
                  </button>
                </span>
              );
            })}
            {listColumns.some((field) => !choices[field.key]) ? (
              <ChoicePop
                value={null}
                options={listColumns
                  .filter((field) => !choices[field.key])
                  .map((field) => ({ value: field.key, label: field.title }))}
                text="+ ограничить выбор"
                label="Какой список ограничить в этом листе"
                onPick={(key) => setChoices(key, (schema?.lists[key] ?? []).map((item) => item.id))}
              />
            ) : null}
          </span>
        </div>
      ) : null}

      <div className="setup-brow">
        <span
          className="setup-blabel"
          {...tip("Что подставится в договор, заведённый здесь — в пустой строке под листом или кнопкой «Новый договор». Остальное человек заполнит сам.")}
        >
          Новая строка
        </span>
        <span className="setup-bvalue setup-defaults">
          {defaultParts.map((part, i) => (
            <span key={part.key} className="setup-default">
              {i > 0 ? <span className="fin-muted"> · </span> : null}
              {part.word}{" "}
              <ChoicePop
                value={block.defaults?.[part.key] ?? ""}
                options={part.options}
                label={`Новая строка: ${part.word}`}
                disabled={action.busy(slot(`default-${part.key}`))}
                onPick={(value) => setDefault(part.key, value)}
              />
            </span>
          ))}
        </span>
      </div>

      <div className="setup-brow">
        <span
          className="setup-blabel"
          {...tip("Как подписаны стороны в шапке этого листа. «Поменять местами» — если заказчик идёт первой колонкой, как в «Заказчик ГК».")}
        >
          Стороны
        </span>
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
            {reversed ? <span className="fin-muted">заказчик первым</span> : null}
            <button type="button" className="fin-link-btn" disabled={action.busy(slot("swap"))} onClick={swap}>
              Поменять местами
            </button>
          </span>
        </span>
      </div>

      <div className="setup-brow">
        <span className="setup-blabel" {...tip("Колонки листа по порядку — как в загруженном Excel. Название колонки может отличаться от названия поля.")}>
          Колонки
        </span>
        <span className="setup-bvalue">
          <button type="button" className="fin-link-btn" aria-expanded={showColumns} onClick={() => setShowColumns((v) => !v)}>
            {block.columns.length
              ? `${block.columns.length} ${plural(block.columns.length, "колонка", "колонки", "колонок")} · ${showColumns ? "свернуть" : "показать"}`
              : "как поля реестра"}
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
          <button
            type="button"
            className="fin-link-btn setup-quiet"
            {...tip("Часть уйдёт из листа; её договоры встанут в другую часть, если подходят под её правило.")}
            onClick={onRemove}
          >
            Удалить часть
          </button>
        </div>
      ) : null}
    </div>
  );
}
