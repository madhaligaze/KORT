"use client";

/**
 * «Восстановление» - изменения таблицы для всех, сделанные из листа реестра, и
 * возврат «как было» (29.09.2026).
 *
 * Перед изменением, которое лист назвал ломающим (удаление договоров, колонка,
 * шапка, лист, порядок строк, вставка во много договоров), сервер запоминает,
 * как было (`contracts/restore.py`). Здесь - эти точки: свои у каждого,
 * у владельца и администратора - все, с автором. «Вернуть» делает то же, что
 * Ctrl+Z в листе сразу после изменения, но и через час, и с другого
 * компьютера. Значения, которые после изменения поменяли коллеги, возврат не
 * трогает - и говорит об этом строкой под записью.
 */
import { useCallback, useEffect, useState } from "react";

import { type RestorePointItem, contractsApi } from "@/components/finance/api";
import { reloadAll } from "@/components/finance/contracts/store";
import { formatDay, formatTime, plural } from "@/components/finance/format";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";

export function RestoreTab() {
  const [items, setItems] = useState<RestorePointItem[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [ask, setAsk] = useState<RestorePointItem | null>(null);
  const [results, setResults] = useState<Record<string, { text: string; fail: boolean }>>({});

  const load = useCallback(async () => {
    try {
      const result = await contractsApi.restorePoints.list();
      setItems(result.items);
      setError("");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Точки восстановления не прочитались");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (item: RestorePointItem) => {
    setBusy(item.id);
    try {
      const result = await contractsApi.restorePoints.restore(item.id);
      const skipped = result.skipped.length
        ? ` Не тронуто: ${result.skipped.slice(0, 3).join("; ")}${result.skipped.length > 3 ? ` и ещё ${result.skipped.length - 3}` : ""}.`
        : "";
      setResults((value) => ({
        ...value,
        [item.id]: { text: `Вернули как было${result.done.length ? `: ${result.done.slice(0, 3).join(", ")}${result.done.length > 3 ? ` и ещё ${result.done.length - 3}` : ""}` : ""}.${skipped}`, fail: false },
      }));
      // Реестр, открытый в этой вкладке, видит вернувшееся сразу.
      void reloadAll().catch(() => undefined);
      await load();
    } catch (exc) {
      setResults((value) => ({ ...value, [item.id]: { text: exc instanceof Error ? exc.message : "Не вернулось", fail: true } }));
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
  if (items === null) return <p className="cab-wait">Читаем…</p>;
  if (!items.length) return <p className="cab-empty">Изменений таблицы для всех пока не было</p>;

  const open = items.filter((item) => !item.restored_at).length;
  return (
    <div className="cab-trash">
      <ul className="cab-trash-list">
        {items.map((item) => {
          const result = results[item.id];
          const when = item.created_at ? `${formatDay(item.created_at)} ${formatTime(item.created_at)}` : "";
          return (
            <li key={item.id} className="cab-trash-row" data-restored={item.restored_at ? "true" : undefined}>
              <div className="cab-trash-main">
                <span className="cab-trash-title">{item.title}</span>
                <span className="cab-trash-meta">
                  {[when, item.mine ? "" : item.by, item.restored_at ? "" : item.returns].filter(Boolean).join(" · ")}
                </span>
                {item.restored_at ? (
                  <span className="cab-trash-meta">
                    Возвращено {formatDay(item.restored_at)} {formatTime(item.restored_at)}
                    {item.restored_by ? ` · ${item.restored_by}` : ""}
                  </span>
                ) : null}
                {result ? (
                  <span className={result.fail ? "cab-trash-fail" : "cab-trash-meta"} role={result.fail ? "alert" : "status"}>
                    {result.text}
                  </span>
                ) : null}
              </div>
              {item.can_restore ? (
                <div className="cab-trash-actions">
                  <button type="button" className="btn-ghost btn-sm" disabled={busy === item.id} onClick={() => setAsk(item)}>
                    {busy === item.id ? "Возвращаем…" : "Вернуть"}
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="cab-trash-count">
        {items.length} {plural(items.length, "изменение", "изменения", "изменений")}
        {open !== items.length ? ` · вернуть можно ${open}` : ""}
      </p>
      <ConfirmDialog
        open={ask !== null}
        title={ask ? `Вернуть как было до ${ask.created_at ? formatTime(ask.created_at) : "изменения"}?` : ""}
        text={
          ask
            ? `${ask.title[0].toUpperCase()}${ask.title.slice(1)} - ${ask.returns}. Это увидят все сотрудники. То, что после поменяли коллеги, не трогается.`
            : ""
        }
        confirm="Вернуть"
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          const item = ask;
          setAsk(null);
          if (item) void restore(item);
        }}
      />
    </div>
  );
}
