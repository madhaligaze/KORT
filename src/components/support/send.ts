"use client";

/**
 * Отправка сообщения в поддержку - XHR, а не `fetch`: у `fetch` нет хода
 * загрузки, а голосовое с несколькими скриншотами на медленной сети
 * грузится заметно, и «Отправляется…» без чисел выглядит зависшим.
 *
 * Ошибки - те же, что у `request` в `finance/api.ts`: текст из `detail`,
 * сигналы раме на 401 и 403, «нет связи» кодом 0.
 */
import {
  AUTH_LOST_EVENT,
  FORBIDDEN_EVENT,
  FinanceApiError,
  OFFLINE_TEXT,
  supportApi,
  type SupportItem,
} from "@/components/finance/api";

export type VoiceAttachment = { blob: Blob; mime: string; duration: number };

export type Outgoing = { body: string; files: File[]; voice: VoiceAttachment | null };

function extension(mime: string): string {
  const base = mime.split(";")[0]?.trim() ?? "";
  if (base === "audio/ogg") return "ogg";
  if (base === "audio/mp4" || base === "audio/x-m4a") return "m4a";
  if (base === "audio/mpeg") return "mp3";
  return "webm";
}

export function sendToSupport(message: Outgoing, onProgress?: (part: number) => void): Promise<SupportItem> {
  const form = new FormData();
  form.append("body", message.body);
  for (const file of message.files) form.append("files", file, file.name);
  if (message.voice) {
    form.append("voice", message.voice.blob, `голосовое.${extension(message.voice.mime)}`);
    form.append("voice_duration", String(Math.round(message.voice.duration * 100) / 100));
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", supportApi.sendUrl);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        /* не JSON - ниже останется код ответа */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as SupportItem);
        return;
      }
      if (xhr.status === 401) window.dispatchEvent(new Event(AUTH_LOST_EVENT));
      if (xhr.status === 403) window.dispatchEvent(new Event(FORBIDDEN_EVENT));
      const detail = (payload as { detail?: unknown } | null)?.detail;
      const text =
        typeof detail === "string"
          ? detail
          : xhr.status === 413
            ? "Вложения слишком большие - отправьте их в нескольких сообщениях"
            : `Сервер ответил ${xhr.status}`;
      reject(new FinanceApiError(text, xhr.status, payload));
    };
    xhr.onerror = () => reject(new FinanceApiError(OFFLINE_TEXT, 0));
    xhr.ontimeout = () => reject(new FinanceApiError("Сервер не ответил вовремя. Попробуйте ещё раз.", 0));
    xhr.timeout = 180_000;
    xhr.send(form);
  });
}
