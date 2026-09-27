"use client";

/**
 * Корзина: всё удалённое в «Финансах» — договоры, операции, юрлица, поля,
 * значения списков, листы, отделы, сотрудники, записи справочников.
 *
 * До 27.09.2026 удалённое уходило «в архив», которого нигде не было видно.
 * Здесь его видно целиком: что это, где жило, когда и кем удалено. Вернуть —
 * «Восстановить» (встаёт туда же, откуда ушло). «Удалить насовсем» стирает из
 * базы; справочник, на который ещё ссылаются живые записи, сервер насовсем не
 * отдаёт и говорит почему — такая причина пишется под строкой.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { type TrashItem, trashApi } from "@/components/finance/api";
import { reloadAll } from "@/components/finance/contracts/store";
import { formatDay, formatTime, plural } from "@/components/finance/format";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { SelectLine } from "@/components/finance/ui/select-line";

const ALL = "all";

export function TrashTab() {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState("");
  const [kind, setKind] = useState(ALL);
  const [busy, setBusy] = useState("");
  const [fails, setFails] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState<TrashItem | null>(null);
  const [done, setDone] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await trashApi.list();
      setItems(result.items);
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Корзина не прочиталась");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const kinds = useMemo(() => {
    const counts = new Map<string, { title: string; count: number }>();
    for (const item of items ?? []) {
      const known = counts.get(item.kind);
      counts.set(item.kind, { title: item.kind_title, count: (known?.count ?? 0) + 1 });
    }
    return [
      { key: ALL, label: "Всё", count: items?.length ?? 0 },
      ...[...counts].map(([key, value]) => ({ key, label: value.title, count: value.count })),
    ];
  }, [items]);
  const shown = (items ?? []).filter((item) => kind === ALL || item.kind === kind);

  const act = async (item: TrashItem, what: "restore" | "purge") => {
    const key = `${item.kind}:${item.id}`;
    setBusy(key);
    setFails((value) => ({ ...value, [key]: "" }));
    try {
      if (what === "restore") {
        const result = await trashApi.restore(item.kind, item.id);
        setDone(`«${result.title}» восстановлено — ${result.where}`);
      } else {
        await trashApi.purge(item.kind, item.id);
        setDone(`«${item.title}» удалено насовсем`);
      }
      setItems((list) => (list ?? []).filter((other) => !(other.kind === item.kind && other.id === item.id)));
      // Реестр, открытый в этой вкладке, видит вернувшийся договор и схему сразу.
      void reloadAll().catch(() => undefined);
    } catch (exc) {
      setFails((value) => ({ ...value, [key]: exc instanceof Error ? exc.message : "Не получилось" }));
    } finally {
      setBusy("");
    }
  };

  if (error) {
    return (
      <p className="cab-error fin-fail" role="alert">
        {error} ·{" "}
        <button type="button" className="fin-link-btn" onClick={() => void load()}>
          Повторить
        </button>
      </p>
    );
  }
  if (items === null) return <p className="cab-wait">Читаем корзину…</p>;
  if (!items.length) return <p className="cab-empty">Корзина пуста</p>;

  return (
    <div className="cab-trash">
      {kinds.length > 2 ? (
        <SelectLine
          items={kinds.map((item) => ({ key: item.key, label: item.label, count: item.count }))}
          value={kind}
          onChange={setKind}
          label="Что показать"
          className="cab-people-tabs"
        />
      ) : null}
      {done ? (
        <p className="cab-trash-done" role="status">
          {done}
        </p>
      ) : null}
      <ul className="cab-trash-list">
        {shown.map((item) => {
          const key = `${item.kind}:${item.id}`;
          return (
            <li key={key} className="cab-trash-row">
              <div className="cab-trash-main">
                <span className="cab-trash-title">{item.title}</span>
                <span className="cab-trash-meta">
                  {item.kind_title} · {item.where}
                  {item.deleted_at ? ` · удалено ${formatDay(item.deleted_at)} ${formatTime(item.deleted_at)}` : ""}
                  {item.by ? ` · ${item.by}` : ""}
                </span>
                {fails[key] ? (
                  <span className="cab-trash-fail" role="alert">
                    {fails[key]}
                  </span>
                ) : null}
              </div>
              <div className="cab-trash-actions">
                <button type="button" className="btn-ghost btn-sm" disabled={busy === key} onClick={() => void act(item, "restore")}>
                  Восстановить
                </button>
                <button type="button" className="fin-link-btn cab-trash-purge" disabled={busy === key} onClick={() => setAsk(item)}>
                  Удалить насовсем
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="cab-trash-count">
        {shown.length} {plural(shown.length, "запись", "записи", "записей")}
      </p>
      <ConfirmDialog
        open={ask !== null}
        title={ask ? `Удалить насовсем «${ask.title}»?` : ""}
        text="Из корзины запись уйдёт без возврата. В журнале действий останется, кто и когда её удалил."
        confirm="Удалить насовсем"
        danger
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          const item = ask;
          setAsk(null);
          if (item) void act(item, "purge");
        }}
      />
    </div>
  );
}
