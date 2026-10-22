"use client";

/**
 * Строки десктопа над шапкой и окно обязательного обновления. В браузере
 * моста нет (`bridge.ts`) - ничего из этого не рисуется.
 *
 * Строка «нет связи» стоит, пока связи нет: человек, отошедший на обед,
 * должен увидеть её и по возвращении, а не пропустить единственный показ.
 * Цвет - янтарь «нет связи», как у строки живого режима реестра.
 */
import { useEffect, useState } from "react";

import { type DesktopStatus, type DesktopUpdate, desktop } from "@/components/desktop/bridge";
import { pendingCount, useRegistry } from "@/components/finance/contracts/store";
import { formatTime } from "@/components/finance/format";

function useDesktopStatus(): DesktopStatus | null {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    let alive = true;
    void bridge.status().then((value) => alive && setStatus(value));
    const stop = bridge.onStatus(setStatus);
    return () => {
      alive = false;
      stop();
    };
  }, []);
  return status;
}

function useDesktopUpdate(): DesktopUpdate | null {
  const [update, setUpdate] = useState<DesktopUpdate | null>(null);
  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    let alive = true;
    void bridge.update().then((value) => alive && setUpdate(value));
    const stop = bridge.onUpdate(setUpdate);
    return () => {
      alive = false;
      stop();
    };
  }, []);
  return update;
}

/** «14:05» сегодня, «22.10, 14:05» - раньше. */
function since(at: number): string {
  const date = new Date(at);
  const time = formatTime(date.toISOString());
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}, ${time}`;
}

function UpdateButton({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn-primary"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void desktop()?.installUpdate();
      }}
    >
      {busy ? "Перезапускаем…" : label}
    </button>
  );
}

export function DesktopBars() {
  const status = useDesktopStatus();
  const update = useDesktopUpdate();
  // Число правок в очереди меняется вместе с правками и новыми договорами.
  useRegistry((s) => s.edits);
  useRegistry((s) => s.creates);
  const waiting = pendingCount();
  const offline = status !== null && !status.online;
  const soft = update?.phase === "ready" && !update.forced;
  // Обычная правка при связи ждёт ответа доли секунды - строка не мигает на
  // каждой; встаёт, только если очередь не уходит дольше полутора секунд.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setStuck(waiting > 0), waiting ? 1500 : 0);
    return () => window.clearTimeout(timer);
  }, [waiting]);
  return (
    <>
      {offline ? (
        <div className="desk-line" data-state="wait" role="status">
          <span>
            Нет связи с сервером{status.offlineSince ? ` с ${since(status.offlineSince)}` : ""} · правки договоров
            сохраняются на этом компьютере{waiting ? ` · ждут отправки: ${waiting}` : ""}
          </span>
        </div>
      ) : waiting && stuck && status ? (
        <div className="desk-line" role="status">
          <span>Отправляем правки, сделанные без связи: {waiting}</span>
        </div>
      ) : null}
      {soft ? (
        <div className="desk-line" role="status">
          <span>Вышла новая версия KORT{update.version ? ` ${update.version}` : ""}</span>
          <UpdateButton label="Обновите приложение" />
        </div>
      ) : null}
    </>
  );
}

/**
 * Версия устарела - сервер ждёт другого, и работать в ней дальше нельзя.
 * Окно поверх всего, без «Позже»: закрыть его можно только обновлением.
 * Не скачалось (нет связи с GitHub) - окна нет: без связи работа идёт
 * дальше, а обновление скачается, когда связь вернётся.
 */
export function DesktopForcedUpdate() {
  const update = useDesktopUpdate();
  if (!update?.forced || update.phase === "idle") return null;
  return (
    <div className="desk-force" role="alertdialog" aria-modal="true" aria-labelledby="desk-force-title">
      <div className="desk-force-card">
        <h2 id="desk-force-title" className="desk-force-title">
          Эта версия KORT устарела
        </h2>
        <p>
          Чтобы продолжить работу, обновите приложение - оно закроется и откроется само. Правки, сделанные без
          связи, сохранятся.
        </p>
        {update.phase === "ready" ? (
          <UpdateButton label="Обновить" />
        ) : (
          <button type="button" className="btn-primary" disabled>
            Скачиваем обновление · {update.percent}%
          </button>
        )}
      </div>
    </div>
  );
}
