"use client";

/**
 * Голосовое в поддержку: запись в браузере, предпрослушка и проверка, что
 * голос вообще слышно.
 *
 * Запись - `MediaRecorder`: Chrome и Edge пишут WebM/Opus, Firefox - Ogg/Opus,
 * Safari - MP4/AAC. 32 кбит/с - речь чистая, а десять минут - 2,4 МБ, а не
 * 10 МБ, как при битрейте по умолчанию. В Telegram голосовое уходит
 * голосовым: WebM сервер перекладывает в Ogg (`app/finance/opus_ogg.py`).
 *
 * «Слышно ли голос» - по уровню звука, а не на слово человека: пока идёт
 * запись, столбики живого уровня и «голоса не слышно», если через три
 * секунды микрофон так и молчит; после - волна записи, посчитанная по самому
 * звуку (`decodeAudioData`), и предупреждение, если в ней почти тишина.
 * Тихая запись - самая частая беда голосовых: выбран не тот микрофон, и
 * поддержка получает минуту шороха.
 */
import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";

import { PauseIcon, PlayIcon } from "@/components/icons";

export type VoiceTake = {
  blob: Blob;
  url: string;
  mime: string;
  /** Секунды - по самому звуку, если браузер его разобрал, иначе по часам записи. */
  duration: number;
  /** Громкость по столбикам, 0..1 - волна предпрослушки. */
  peaks: number[];
  /** Голоса почти не слышно. */
  quiet: boolean;
};

export type RecorderPhase = "idle" | "asking" | "recording" | "processing" | "ready";

/** Сколько столбиков у волны - и у живого уровня, и у записи. */
export const BARS = 44;
/** Громче этого (дБ от полной шкалы) - уже голос, а не шорох комнаты. */
const VOICE_DB = -42;
/** Через сколько секунд тишины во время записи сказать «голоса не слышно». */
const SILENT_AFTER = 3;

const CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm",
];

type AudioContextClass = typeof AudioContext;

function audioContextClass(): AudioContextClass | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext ?? null;
}

export function voiceSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined"
  );
}

function pickMime(): string {
  for (const type of CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* старый браузер без проверки - пусть выберет сам */
    }
  }
  return "";
}

function decibels(rms: number): number {
  return 20 * Math.log10(rms + 1e-9);
}

/** Уровень для столбика: -60 дБ и тише - пусто, 0 дБ - во всю высоту. */
function level(rms: number): number {
  return Math.max(0, Math.min(1, (decibels(rms) + 60) / 60));
}

function micError(exc: unknown): string {
  const name = exc instanceof DOMException ? exc.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Браузер не дал доступ к микрофону. Разрешите его - значок слева от адреса сайта - и нажмите ещё раз.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "Микрофон не найден - подключите его или напишите текстом.";
  }
  if (name === "NotReadableError") {
    return "Микрофон занят другой программой - закройте её или напишите текстом.";
  }
  return "Запись не началась - попробуйте ещё раз или напишите текстом.";
}

/** Волна и тишина - по самому звуку записи. */
async function analyse(blob: Blob): Promise<{ duration: number; peaks: number[]; quiet: boolean } | null> {
  const Context = audioContextClass();
  if (!Context) return null;
  const context = new Context();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const samples = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(samples.length / BARS));
    const peaks: number[] = [];
    let loudest = 0;
    for (let bar = 0; bar < BARS; bar += 1) {
      let sum = 0;
      const from = bar * step;
      const to = Math.min(samples.length, from + step);
      for (let index = from; index < to; index += 1) sum += samples[index] * samples[index];
      const rms = Math.sqrt(sum / Math.max(1, to - from));
      loudest = Math.max(loudest, rms);
      peaks.push(level(rms));
    }
    return { duration: buffer.duration, peaks, quiet: decibels(loudest) < VOICE_DB };
  } catch {
    return null;
  } finally {
    void context.close().catch(() => undefined);
  }
}

/** Запись голосового: начать, остановить, выбросить. Лимит - `maxSeconds`. */
export function useVoiceRecorder(maxSeconds: number) {
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [silent, setSilent] = useState(false);
  const [take, setTake] = useState<VoiceTake | null>(null);
  const [error, setError] = useState("");
  const [capped, setCapped] = useState(false);
  const live = useRef<{
    stream: MediaStream;
    recorder: MediaRecorder;
    context: AudioContext | null;
    frame: number;
    timer: number;
    started: number;
    loudest: number;
    discard: boolean;
  } | null>(null);
  const takeRef = useRef<VoiceTake | null>(null);
  useEffect(() => {
    takeRef.current = take;
  }, [take]);

  const teardown = useCallback(() => {
    const now = live.current;
    if (!now) return;
    cancelAnimationFrame(now.frame);
    window.clearInterval(now.timer);
    now.stream.getTracks().forEach((track) => track.stop());
    void now.context?.close().catch(() => undefined);
  }, []);

  const stop = useCallback(() => {
    const now = live.current;
    if (now && now.recorder.state !== "inactive") now.recorder.stop();
  }, []);

  const start = useCallback(async () => {
    setError("");
    setCapped(false);
    if (!voiceSupported()) {
      setError("Запись голоса в этом браузере недоступна - напишите текстом.");
      return;
    }
    setPhase("asking");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (exc) {
      setPhase("idle");
      setError(micError(exc));
      return;
    }
    const mime = pickMime();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
    } catch {
      recorder = new MediaRecorder(stream);
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const Context = audioContextClass();
    let context: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      if (Context) {
        context = new Context();
        analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        context.createMediaStreamSource(stream).connect(analyser);
      }
    } catch {
      analyser = null;
    }
    const state = {
      stream,
      recorder,
      context,
      frame: 0,
      timer: 0,
      started: performance.now(),
      loudest: -120,
      discard: false,
    };
    live.current = state;
    // Живой уровень - столбик раз в ~90 мс: чаще глаз не различает, а
    // перерисовка листа соседнего раздела не должна от этого страдать.
    const data = analyser ? new Float32Array(analyser.fftSize) : null;
    let last = 0;
    const tick = (time: number) => {
      if (analyser && data && time - last > 90) {
        last = time;
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let index = 0; index < data.length; index += 1) sum += data[index] * data[index];
        const rms = Math.sqrt(sum / data.length);
        state.loudest = Math.max(state.loudest, decibels(rms));
        setLevels((was) => [...was.slice(-(BARS - 1)), level(rms)]);
      }
      state.frame = requestAnimationFrame(tick);
    };
    recorder.onstop = () => {
      teardown();
      live.current = null;
      const seconds = (performance.now() - state.started) / 1000;
      if (state.discard || !chunks.length) {
        setPhase("idle");
        return;
      }
      const type = recorder.mimeType || mime || chunks[0]?.type || "audio/webm";
      const blob = new Blob(chunks, { type });
      setPhase("processing");
      void analyse(blob).then((found) => {
        if (state.discard) {
          setPhase("idle");
          return;
        }
        setTake({
          blob,
          url: URL.createObjectURL(blob),
          mime: type,
          duration: found?.duration && Number.isFinite(found.duration) ? found.duration : seconds,
          peaks: found?.peaks ?? [],
          quiet: found ? found.quiet : state.loudest < VOICE_DB,
        });
        setPhase("ready");
      });
    };
    setLevels([]);
    setSilent(false);
    setElapsed(0);
    recorder.start(250);
    state.frame = requestAnimationFrame(tick);
    state.timer = window.setInterval(() => {
      const seconds = (performance.now() - state.started) / 1000;
      setElapsed(seconds);
      setSilent(analyser !== null && seconds >= SILENT_AFTER && state.loudest < VOICE_DB);
      if (seconds >= maxSeconds) {
        setCapped(true);
        stop();
      }
    }, 200);
    setPhase("recording");
  }, [maxSeconds, stop, teardown]);

  /** Выбросить запись - и идущую, и готовую. */
  const discard = useCallback(() => {
    const now = live.current;
    if (now) {
      now.discard = true;
      if (now.recorder.state !== "inactive") now.recorder.stop();
      else teardown();
    }
    const was = takeRef.current;
    if (was) URL.revokeObjectURL(was.url);
    setTake(null);
    setLevels([]);
    setSilent(false);
    setCapped(false);
    setPhase("idle");
  }, [teardown]);

  // Ушли со страницы посреди записи - микрофон отпускается, ссылка на запись снимается.
  useEffect(
    () => () => {
      const now = live.current;
      if (now) {
        now.discard = true;
        if (now.recorder.state !== "inactive") now.recorder.stop();
      }
      teardown();
      const was = takeRef.current;
      if (was) URL.revokeObjectURL(was.url);
    },
    [teardown],
  );

  return { phase, elapsed, levels, silent, take, error, capped, start, stop, discard, clearError: () => setError("") };
}

export function clock(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(seconds ?? 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Столбики уровня: живые во время записи и волна готовой. */
export function Bars({ peaks, progress = 0, className = "" }: { peaks: number[]; progress?: number; className?: string }) {
  const filled = Array.from({ length: BARS }, (_, index) => peaks[peaks.length - BARS + index] ?? 0);
  return (
    <span className={`sup-bars ${className}`} aria-hidden="true">
      {filled.map((value, index) => (
        <span
          key={index}
          className="sup-bar"
          data-on={index / BARS < progress ? "true" : undefined}
          style={{ height: `${Math.max(8, Math.round(value * 100))}%` }}
        />
      ))}
    </span>
  );
}

/** Сейчас играющее голосовое: запуск другого останавливает его. */
let playing: HTMLAudioElement | null = null;

/**
 * Голосовое в переписке и в предпрослушке. Длительность - известная
 * (`duration`): WebM из MediaRecorder своей длительности не несёт, и
 * `<audio>` показывал бы «Infinity», а перемотка не работала бы, - поэтому
 * при неизвестной длительности браузер один раз отправляется в конец записи
 * и обратно, после чего знает её сам.
 */
export function VoicePlayer({ src, duration, peaks }: { src: string; duration: number | null; peaks?: number[] }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [on, setOn] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(duration ?? 0);
  const probing = useRef(false);

  useEffect(() => {
    if (!on) return;
    let frame = 0;
    const step = () => {
      const element = audio.current;
      if (element && !probing.current) setTime(element.currentTime);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [on]);

  useEffect(
    () => () => {
      if (playing === audio.current) playing = null;
    },
    [],
  );

  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    if (playing && playing !== element) playing.pause();
    playing = element;
    void element.play().catch(() => setOn(false));
  };

  const seek = (event: MouseEvent<HTMLSpanElement>) => {
    const element = audio.current;
    if (!element || !length) return;
    const box = event.currentTarget.getBoundingClientRect();
    const part = Math.max(0, Math.min(1, (event.clientX - box.left) / Math.max(1, box.width)));
    element.currentTime = part * length;
    setTime(element.currentTime);
  };

  const progress = length ? Math.min(1, time / length) : 0;
  return (
    <span className="sup-voice">
      <button
        type="button"
        className="sup-voice-play"
        onClick={toggle}
        aria-label={on ? "Пауза" : "Слушать"}
        title={on ? "Пауза" : "Слушать"}
      >
        {on ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
      </button>
      <span className="sup-voice-track" onClick={seek} role="presentation">
        {peaks && peaks.length ? (
          <Bars peaks={peaks} progress={progress} />
        ) : (
          <span className="sup-voice-line">
            <span className="sup-voice-fill" style={{ width: `${progress * 100}%` }} />
          </span>
        )}
      </span>
      <span className="sup-voice-time">{clock(on || time > 0 ? time : length)}</span>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const element = event.currentTarget;
          if (Number.isFinite(element.duration) && element.duration > 0) {
            setLength(element.duration);
          } else {
            probing.current = true;
            element.currentTime = 1e101;
          }
        }}
        onDurationChange={(event) => {
          const element = event.currentTarget;
          if (probing.current && Number.isFinite(element.duration)) {
            probing.current = false;
            setLength(element.duration);
            element.currentTime = 0;
          }
        }}
        onPlay={() => setOn(true)}
        onPause={() => setOn(false)}
        onEnded={(event) => {
          setOn(false);
          setTime(0);
          event.currentTarget.currentTime = 0;
        }}
      />
    </span>
  );
}
