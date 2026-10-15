"use client";

/**
 * Переписка с поддержкой - окно по центру (16.10.2026: «более серьёзное
 * модальное окно, там должен быть такой чат»).
 *
 * * **лента** - сообщения человека справа, ответы поддержки слева, по дням.
 *   Первое в ленте - приветствие поддержки с тем, как описать проблему: оно
 *   стоит в начале разговора и уходит вверх вместе с ним, а не висит
 *   дежурной подписью над полем;
 * * **вложения** - скрепкой, вставкой из буфера (Ctrl+V после снимка экрана -
 *   самый частый путь скриншота) и перетаскиванием на окно;
 * * **голосовое** - запись, предпрослушка с волной и предупреждение, если
 *   голоса не слышно (`voice.tsx`);
 * * **ответы** - пока окно открыто, переписка перечитывается раз в 5 с, и
 *   новый ответ сразу отмечается прочитанным: человек на него смотрит. Только
 *   что пришедшее помечено «новое», и лента открывается на нём.
 *
 * Состояние - здесь, а не внутри слоя карточки: окно закрыли щелчком мимо -
 * вложения и запись остаются до следующего открытия, текст переживает и
 * перезагрузку (черновик сессии).
 */
import { type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FinanceApiError, supportApi, type SupportItem, type SupportLimits, type SupportState } from "@/components/finance/api";
import { dayTitle, formatTime, plural } from "@/components/finance/format";
import { CardLayer } from "@/components/finance/ui/card-layer";
import { CloseIcon, FileTextIcon, MicIcon, PaperclipIcon, StopIcon } from "@/components/icons";
import { canHover } from "@/components/motion/gsap";
import { useSessionState } from "@/components/session-state";
import { sendToSupport } from "@/components/support/send";
import { markReadThrough } from "@/components/support/store";
import { Bars, VoicePlayer, clock, useVoiceRecorder } from "@/components/support/voice";

const DEFAULT_LIMITS: SupportLimits = {
  max_body: 8000,
  max_files: 10,
  max_file_bytes: 20 * 1024 * 1024,
  max_total_bytes: 40 * 1024 * 1024,
  max_voice_seconds: 600,
};
const POLL_MS = 5000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

type Picked = { key: string; file: File; preview: string | null };

function size(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
  return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

const LINK = /(https?:\/\/[^\s<>"«»]+[^\s<>"«».,;:!?)\]])/g;

/** Ссылки в тексте ответа - нажимаемые: поддержка присылает их часто. */
function linked(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(
      <a key={at} href={match[0]} target="_blank" rel="noopener noreferrer">
        {match[0]}
      </a>,
    );
    last = at + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function stamp(): string {
  const now = new Date();
  return [now.getHours(), now.getMinutes(), now.getSeconds()].map((part) => String(part).padStart(2, "0")).join("-");
}

function Message({ item, fresh }: { item: SupportItem; fresh: boolean }) {
  const own = item.author === "user";
  const images = item.files.filter((file) => file.kind === "image");
  const voices = item.files.filter((file) => file.kind === "voice");
  const others = item.files.filter((file) => file.kind === "file");
  return (
    <div className="sup-msg" data-own={own ? "true" : undefined} data-fresh={fresh ? "true" : undefined} data-id={item.id}>
      {own ? null : (
        <span className="sup-msg-who">
          Поддержка KORT{fresh ? <span className="sup-msg-new">новое</span> : null}
        </span>
      )}
      {item.body ? <p className="sup-msg-text">{linked(item.body)}</p> : null}
      {images.length ? (
        <span className="sup-msg-images" data-count={Math.min(images.length, 3)}>
          {images.map((file) => (
            <a key={file.id} href={supportApi.fileUrl(file.id)} target="_blank" rel="noopener noreferrer" title={file.name}>
              {/* eslint-disable-next-line @next/next/no-img-element -- файл переписки отдаёт API, оптимизатору Next он недоступен */}
              <img src={supportApi.fileUrl(file.id)} alt={file.name} loading="lazy" />
            </a>
          ))}
        </span>
      ) : null}
      {voices.map((file) => (
        <VoicePlayer key={file.id} src={supportApi.fileUrl(file.id)} duration={file.duration} />
      ))}
      {others.map((file) => (
        <a key={file.id} className="sup-file" href={supportApi.fileUrl(file.id)} download={file.name}>
          <FileTextIcon size={16} />
          <span className="sup-file-name">{file.name}</span>
          <span className="sup-file-size">{size(file.size)}</span>
        </a>
      ))}
      <span className="sup-msg-meta">
        {formatTime(item.created_at)}
        {own && item.late ? " · ещё не дошло до поддержки - отправим сами, как появится связь" : ""}
      </span>
    </div>
  );
}

/** Первое в ленте - как описать проблему. Стоит в начале разговора и уходит вверх вместе с ним. */
function Greeting() {
  return (
    <div className="sup-msg sup-greet">
      <span className="sup-msg-who">Поддержка KORT</span>
      <p className="sup-msg-text">
        <b>Расскажите, что случилось.</b> Ошибка, непонятное поведение или функция, которой не хватает, - опишите как
        есть: где это было, что вы сделали и что ожидали увидеть. Чем подробнее, тем быстрее разберёмся и исправим.
      </p>
      <p className="sup-msg-text">
        Скриншот - скрепкой или Ctrl+V прямо сюда. Если проще рассказать, запишите голосовое. Ответ придёт в эту
        переписку - значок поддержки в шапке подскажет.
      </p>
    </div>
  );
}

export function SupportChat({
  open,
  onClose,
  onState,
}: {
  open: boolean;
  onClose: () => void;
  /** Переписка прочитана - раме пора перечитать `me`. */
  onState: (state: SupportState) => void;
}) {
  const [items, setItems] = useState<SupportItem[] | null>(null);
  const [limits, setLimits] = useState<SupportLimits>(DEFAULT_LIMITS);
  const [loadError, setLoadError] = useState("");
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const [text, setText, forgetText] = useSessionState("support.draft", "");
  const [files, setFiles] = useState<Picked[]>([]);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sendError, setSendError] = useState("");
  const [dragging, setDragging] = useState(false);
  const recorder = useVoiceRecorder(limits.max_voice_seconds);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const onStateRef = useRef(onState);
  useEffect(() => {
    onStateRef.current = onState;
  });
  /** Куда встать после загрузки: к первому новому ответу или в конец. */
  const landing = useRef<"fresh" | "bottom" | null>(null);

  const load = useCallback(async (opening: boolean) => {
    try {
      const data = await supportApi.thread();
      setLoadError("");
      setLimits(data.limits);
      const unread = data.items.filter((item) => item.author === "support" && !item.read);
      if (opening) landing.current = unread.length ? "fresh" : "bottom";
      else {
        const box = list.current;
        const near = box ? box.scrollHeight - box.scrollTop - box.clientHeight < 96 : true;
        if (near) landing.current = "bottom";
      }
      setItems(data.items);
      if (unread.length) {
        setFresh((was) => new Set([...(opening ? [] : was), ...unread.map((item) => item.id)]));
        // Человек на них смотрит - прочитаны. Время - сервера, не часов компьютера.
        markReadThrough(unread.map((item) => item.created_at).sort().at(-1) ?? "");
        const next = await supportApi.read();
        onStateRef.current(next);
      } else if (opening) {
        setFresh(new Set());
      }
    } catch (exc) {
      if (opening || !(exc instanceof FinanceApiError && exc.status === 0)) {
        setLoadError(exc instanceof Error ? exc.message : "Переписка не загрузилась");
      }
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, load]);

  /**
   * Лента держится за низ, пока человек внизу: картинки догружаются после
   * того, как сообщение встало, и без этого отправленное уезжало вверх, а
   * голосовое под картинками оказывалось за краем.
   */
  const stick = useRef(true);
  const content = useRef<HTMLDivElement>(null);

  // Встать на место после загрузки: на первом новом ответе или в конце ленты.
  useEffect(() => {
    const box = list.current;
    const where = landing.current;
    if (!box || !where || !items) return;
    landing.current = null;
    if (where === "fresh") {
      const first = box.querySelector<HTMLElement>('[data-fresh="true"]');
      if (first) {
        stick.current = false;
        box.scrollTop = Math.max(0, first.offsetTop - 24);
        return;
      }
    }
    stick.current = true;
    box.scrollTop = box.scrollHeight;
  }, [items]);

  useEffect(() => {
    const box = list.current;
    const inner = content.current;
    if (!open || !box || !inner || typeof ResizeObserver === "undefined") return;
    const onScroll = () => {
      stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 48;
    };
    const observer = new ResizeObserver(() => {
      if (stick.current) box.scrollTop = box.scrollHeight;
    });
    observer.observe(inner);
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      box.removeEventListener("scroll", onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (open && canHover()) input.current?.focus({ preventScroll: true });
  }, [open]);

  // Превью картинок - ссылки на память браузера: снимаются вместе с вложением.
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(
    () => () => {
      filesRef.current.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
    },
    [],
  );

  const attach = useCallback(
    (incoming: File[]) => {
      if (!incoming.length) return;
      const next = [...filesRef.current];
      let problem = "";
      for (const file of incoming) {
        if (next.length >= limits.max_files) {
          problem = `За один раз - не больше ${limits.max_files} вложений`;
          break;
        }
        if (file.size > limits.max_file_bytes) {
          problem = `Файл «${file.name}» больше 20 МБ - сожмите его или пришлите ссылкой`;
          continue;
        }
        next.push({
          key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          preview: IMAGE_TYPES.has(file.type) ? URL.createObjectURL(file) : null,
        });
      }
      filesRef.current = next;
      setFiles(next);
      setSendError(problem);
    },
    [limits],
  );

  const detach = (key: string) => {
    setFiles((was) => {
      const gone = was.find((item) => item.key === key);
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return was.filter((item) => item.key !== key);
    });
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const data = event.clipboardData;
    // Текст вставляется текстом: таблица из Excel несёт и картинку ячеек, и
    // прикреплять её никто не просил. Снимок экрана - только картинка.
    if (!data || data.getData("text/plain")) return;
    const pasted = Array.from(data.files ?? []);
    if (!pasted.length) return;
    event.preventDefault();
    attach(
      pasted.map((file) =>
        file.name && file.name !== "image.png"
          ? file
          : new File([file], `скриншот ${stamp()}.${(file.type.split("/")[1] ?? "png").replace("jpeg", "jpg")}`, {
              type: file.type,
            }),
      ),
    );
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    attach(Array.from(event.dataTransfer?.files ?? []));
  };

  const take = recorder.take;
  const busyVoice = recorder.phase === "asking" || recorder.phase === "recording" || recorder.phase === "processing";
  const canSend = !sending && !busyVoice && Boolean(text.trim() || files.length || take);

  const send = async () => {
    if (!canSend) return;
    const total = files.reduce((sum, item) => sum + item.file.size, 0) + (take?.blob.size ?? 0);
    if (total > limits.max_total_bytes) {
      setSendError("Вложения вместе больше 40 МБ - отправьте их в нескольких сообщениях");
      return;
    }
    if (text.trim().length > limits.max_body) {
      setSendError(`Сообщение длиннее ${limits.max_body} знаков - разбейте его на два`);
      return;
    }
    setSending(true);
    setSendError("");
    setProgress(0);
    try {
      const item = await sendToSupport(
        {
          body: text.trim(),
          files: files.map((picked) => picked.file),
          voice: take ? { blob: take.blob, mime: take.mime, duration: take.duration } : null,
        },
        setProgress,
      );
      landing.current = "bottom";
      setItems((was) => [...(was ?? []), item]);
      setText("");
      forgetText();
      files.forEach((picked) => picked.preview && URL.revokeObjectURL(picked.preview));
      setFiles([]);
      recorder.discard();
    } catch (exc) {
      setSendError(exc instanceof Error ? exc.message : "Сообщение не отправилось - попробуйте ещё раз");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const close = () => {
    // Закрыли посреди записи - запись не теряется: она остановится и будет ждать.
    if (recorder.phase === "recording") recorder.stop();
    onClose();
  };

  const days = useMemo(() => {
    const groups: { title: string; items: SupportItem[] }[] = [];
    for (const item of items ?? []) {
      const title = dayTitle(item.created_at);
      const group = groups.at(-1);
      if (group && group.title === title) group.items.push(item);
      else groups.push({ title, items: [item] });
    }
    return groups;
  }, [items]);

  const sendLabel = sending
    ? files.length || take
      ? `Отправляется ${Math.round(progress * 100)}%`
      : "Отправляется…"
    : "Отправить";

  return (
    <CardLayer open={open} onClose={close} label="Поддержка KORT" className="sup-chat">
      <div className="card-top sup-chat-top">
        <span className="sup-chat-head">
          <span className="sup-chat-title">Поддержка</span>
          <span className="sup-chat-sub">команда разработки KORT</span>
        </span>
        <button type="button" className="fin-icon-btn" onClick={close} aria-label="Закрыть" title="Закрыть">
          <CloseIcon size={18} />
        </button>
      </div>
      <div
        className="sup-chat-body"
        data-drop={dragging ? "true" : undefined}
        onDragEnter={(event) => {
          if (event.dataTransfer?.types.includes("Files")) setDragging(true);
        }}
        onDragOver={(event) => {
          if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <div ref={list} className="sup-chat-list">
          <div ref={content} className="sup-chat-flow">
            <Greeting />
            {days.map((day) => (
              <div key={day.title} className="sup-day">
                <span className="sup-day-title">{day.title}</span>
                {day.items.map((item) => (
                  <Message key={item.id} item={item} fresh={fresh.has(item.id)} />
                ))}
              </div>
            ))}
            {items === null && !loadError ? <p className="sup-chat-wait">Загружаем переписку…</p> : null}
            {loadError ? <p className="sup-warn">{loadError}</p> : null}
          </div>
        </div>
        {dragging ? <div className="sup-drop">Отпустите - файлы прикрепятся к сообщению</div> : null}

        <div className="sup-compose">
          {files.length ? (
            <div className="sup-attach">
              {files.map((picked) => (
                <span key={picked.key} className="sup-chip" title={picked.file.name}>
                  {picked.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element -- превью из памяти браузера
                    <img className="sup-chip-thumb" src={picked.preview} alt="" />
                  ) : (
                    <FileTextIcon size={16} />
                  )}
                  <span className="sup-chip-name">{picked.file.name}</span>
                  <span className="sup-chip-size">{size(picked.file.size)}</span>
                  <button
                    type="button"
                    className="sup-chip-drop"
                    onClick={() => detach(picked.key)}
                    aria-label={`Убрать «${picked.file.name}»`}
                    disabled={sending}
                  >
                    <CloseIcon size={14} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {recorder.phase === "recording" ? (
            <div className="sup-rec">
              <button type="button" className="sup-rec-stop" onClick={recorder.stop} aria-label="Остановить запись" title="Остановить запись">
                <StopIcon size={14} />
              </button>
              <Bars peaks={recorder.levels} className="sup-bars-live" />
              <span className="sup-rec-time">
                {clock(recorder.elapsed)}
                <span className="sup-rec-max"> / {clock(limits.max_voice_seconds)}</span>
              </span>
              <button type="button" className="sup-link" onClick={recorder.discard}>
                Отмена
              </button>
            </div>
          ) : null}
          {recorder.phase === "recording" ? (
            recorder.silent ? (
              <p className="sup-warn">Голоса не слышно - проверьте, тот ли микрофон выбран и не выключен ли он.</p>
            ) : (
              <p className="sup-hint">Идёт запись - говорите. Закончили - квадрат слева.</p>
            )
          ) : null}
          {recorder.phase === "asking" ? <p className="sup-hint">Разрешите доступ к микрофону в окне браузера…</p> : null}
          {recorder.phase === "processing" ? <p className="sup-hint">Готовим запись…</p> : null}
          {take && recorder.phase === "ready" ? (
            <>
              <div className="sup-take">
                <VoicePlayer src={take.url} duration={take.duration} peaks={take.peaks} />
                <button
                  type="button"
                  className="sup-link"
                  onClick={() => {
                    recorder.discard();
                    void recorder.start();
                  }}
                  disabled={sending}
                >
                  Записать заново
                </button>
                <button type="button" className="sup-chip-drop" onClick={recorder.discard} aria-label="Удалить запись" disabled={sending}>
                  <CloseIcon size={14} />
                </button>
              </div>
              {take.quiet ? (
                <p className="sup-warn">
                  Голоса почти не слышно. Проверьте микрофон и запишите заново - иначе поддержка ничего не разберёт.
                </p>
              ) : (
                <p className="sup-hint">Прослушайте запись перед отправкой: голос должен быть хорошо слышен.</p>
              )}
              {recorder.capped ? <p className="sup-hint">Запись остановлена на {Math.round(limits.max_voice_seconds / 60)} минутах.</p> : null}
            </>
          ) : null}
          {recorder.error ? <p className="sup-warn">{recorder.error}</p> : null}

          <textarea
            ref={input}
            className="sup-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={3}
            maxLength={limits.max_body}
            placeholder="Опишите проблему или пожелание…"
            aria-label="Сообщение в поддержку"
          />
          <div className="sup-tools">
            <button type="button" className="sup-tool" onClick={() => picker.current?.click()} disabled={sending}>
              <PaperclipIcon size={17} />
              <span>Файл</span>
            </button>
            <button
              type="button"
              className="sup-tool"
              onClick={() => void recorder.start()}
              disabled={sending || busyVoice || Boolean(take)}
            >
              <MicIcon size={17} />
              <span>Голосовое</span>
            </button>
            <span className="sup-tools-note">
              {files.length ? `${files.length} ${plural(files.length, "вложение", "вложения", "вложений")}` : ""}
            </span>
            <button type="button" className="btn-primary sup-send" onClick={() => void send()} disabled={!canSend} title="Enter - отправить, Shift+Enter - новая строка">
              {sendLabel}
            </button>
          </div>
          {sendError ? <p className="sup-warn" role="alert">{sendError}</p> : null}
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              attach(Array.from(event.target.files ?? []));
              // Тот же файл можно выбрать ещё раз - после «убрать» тоже.
              event.target.value = "";
            }}
          />
        </div>
      </div>
    </CardLayer>
  );
}
