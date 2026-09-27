"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type Account,
  type ImportAnswer,
  type ImportPreview,
  type SheetBook,
  type SheetTab,
  financeApi,
} from "@/components/finance/api";
import { PreviewView } from "@/components/finance/preview-view";

/**
 * Книги Google внутри раздела.
 *
 * Учёт у людей уже ведётся — руками, в книгах, годами. Обычный ответ программы
 * учёта: «выгрузите в Excel и загрузите к нам», и дорога получается в один
 * конец. Здесь книга остаётся на месте: её видно списком, вкладку выбирают
 * здесь же, и строки проходят тот же разбор, что выписка из банка.
 *
 * Правка книги отсюда не делается — у сервисного аккаунта только чтение
 * (`app/finance/google.py`). Поэтому ссылка на саму книгу стоит рядом: работа
 * в Google продолжается там, а её цифры живут здесь.
 */
export function SheetsPanel({ accounts, onChanged }: { accounts: Account[]; onChanged: () => void }) {
  const [books, setBooks] = useState<SheetBook[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [query, setQuery] = useState("");
  const [book, setBook] = useState<{ id: string; title: string; url: string; tabs: SheetTab[] } | null>(null);
  const [tab, setTab] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const next = await financeApi.sheetBooks();
      setConfigured(next.configured);
      setBooks(next.items);
    } catch (exc) {
      setBooks([]);
      setError(exc instanceof Error ? exc.message : "Список книг не пришёл");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openBook = async (id: string) => {
    setBusy(true);
    setError("");
    setPreview(null);
    setTab("");
    try {
      setBook(await financeApi.sheetBook(id));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Книга не открылась");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Прочитать вкладку с ответами на вопросы разбора.
   *
   * Ответы копятся (см. `ImportPanel`): второй вопрос не должен стирать ответ
   * на первый, иначе разбор спрашивает про даты по кругу.
   */
  const answersRef = useRef<ImportAnswer>({});
  const read = async (title: string, answer: ImportAnswer = {}) => {
    if (!book) throw new Error("Книга не выбрана");
    answersRef.current = { ...answersRef.current, ...answer };
    return financeApi.sheetPreview({ book_id: book.id, tab: title, ...answersRef.current });
  };

  const openTab = async (title: string) => {
    setBusy(true);
    setError("");
    answersRef.current = {};
    try {
      const next = await read(title);
      setTab(title);
      setPreview(next);
    } catch (exc) {
      setPreview(null);
      setError(exc instanceof Error ? exc.message : "Вкладка не прочиталась");
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = books ?? [];
    return needle ? list.filter((item) => item.name.toLowerCase().includes(needle)) : list;
  }, [books, query]);

  if (!configured) {
    return (
      <div className="fin-card p-4 flex flex-col gap-2">
        <p className="fin-label">Google Таблицы</p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Доступ к Google не настроен.
        </p>
      </div>
    );
  }

  if (preview) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="fin-label">{book?.title}</span>
          <span style={{ color: "var(--text-muted)" }}>·</span>
          <span className="text-sm" style={{ color: "var(--text-primary)" }}>
            {tab}
          </span>
          {book ? (
            <a className="btn-ghost text-xs" href={book.url} target="_blank" rel="noreferrer">
              Открыть в Google
            </a>
          ) : null}
        </div>
        <PreviewView
          preview={preview}
          setPreview={setPreview}
          accounts={accounts}
          reload={(answer) => read(tab, answer)}
          onApplied={onChanged}
          onReset={() => {
            setPreview(null);
            setTab("");
          }}
          resetLabel="Другая вкладка"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input-field"
          style={{ maxWidth: "20rem" }}
          placeholder="Книга"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => void load()}>
          Обновить список
        </button>
      </div>

      {error ? (
        <p className="text-xs" style={{ color: "var(--accent-rose)" }}>
          {error}
        </p>
      ) : null}

      {book ? (
        <div className="fin-card p-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="fin-label">{book.title}</span>
            <a className="btn-ghost text-xs" href={book.url} target="_blank" rel="noreferrer">
              Открыть в Google
            </a>
            <button type="button" className="btn-ghost text-xs" onClick={() => setBook(null)}>
              Другая книга
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {book.tabs.map((item) => (
              <button
                key={item.title}
                type="button"
                className="fin-chip"
                data-on={tab === item.title ? "" : undefined}
                disabled={busy}
                onClick={() => void openTab(item.title)}
              >
                {item.title}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="fin-card">
          {books === null ? (
            <p className="text-sm p-3" style={{ color: "var(--text-muted)" }}>
              Читаем список…
            </p>
          ) : shown.length ? (
            shown.map((item) => (
              <button
                key={item.id}
                type="button"
                className="fin-acc-row w-full text-left"
                disabled={busy}
                onClick={() => void openBook(item.id)}
              >
                <span className="fin-acc-name" title={item.name}>
                  {item.name}
                </span>
              </button>
            ))
          ) : (
            <p className="text-sm p-3" style={{ color: "var(--text-muted)" }}>
              Книг не видно
            </p>
          )}
        </div>
      )}
    </div>
  );
}
