"use client";

import { useEffect, useRef, useState } from "react";

import { type NotificationItem, peopleApi } from "@/components/finance/api";
import { deviceOf, stamp, when } from "@/components/finance/cabinet/status";
import { shortName } from "@/components/finance/format";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { gsap, prefersReducedMotion } from "@/components/motion/gsap";

/**
 * «Ждут решения» (фронт-план, 6.9).
 *
 * Видна только тем, кто правит людей, и только когда есть что решать:
 * пустой полосы и «Запросов нет» не бывает. Просьба о сбросе — вес без
 * цвета (это просьба, а не отказ); пять неверных паролей — роза (может быть
 * перебор). Решённая строка сменяет текст на итог и через 4 с сворачивается
 * — единственное место, где строка уходит сама: это список дел.
 *
 * «Недавно» — одна приглушённая строка сведений за сутки («пароль задан»);
 * действия не требует.
 */
const WINDOW_HOURS = 72;

export function PendingStrip({
  items,
  onChanged,
  onOpenEmployee,
}: {
  items: NotificationItem[];
  onChanged: () => void;
  onOpenEmployee: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState<NotificationItem | null>(null);
  const [busy, setBusy] = useState(false);
  // Решённые держатся здесь до конца своих 4 с, даже если следующий опрос
  // уже не прислал их: иначе строка исчезла бы, не показав итога.
  const [done, setDone] = useState<Record<string, { item: NotificationItem; text: string }>>({});
  const [error, setError] = useState("");

  const open = items.filter((item) => item.actionable && !item.resolved_at && !done[item.id]);
  const actionable = [...open, ...Object.values(done).map((entry) => entry.item)];
  const recent = items.filter((item) => !item.actionable).slice(0, 3);
  if (actionable.length === 0 && recent.length === 0) return null;

  const finish = (item: NotificationItem, text: string) => {
    setDone((prev) => ({ ...prev, [item.id]: { item, text } }));
  };

  const reset = async () => {
    const item = confirm;
    const employee = item?.subject?.employee_id;
    if (!item || !employee) return;
    setBusy(true);
    setError("");
    try {
      await peopleApi.employees.reset(employee);
      const until = stamp(new Date(Date.now() + WINDOW_HOURS * 3600 * 1000).toISOString());
      finish(item, `пароль сброшен · ждёт новый до ${until}`);
      setConfirm(null);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Сбросить не получилось");
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (item: NotificationItem) => {
    setError("");
    try {
      await peopleApi.notifications.resolve(item.id);
      finish(item, "решено");
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Не получилось");
    }
  };

  return (
    <section className="cab-pending" aria-label="Ждут решения">
      {actionable.length > 0 ? <p className="cab-block-title">Ждут решения</p> : null}
      {actionable.map((item) => (
        <PendingRow
          key={item.id}
          item={item}
          done={done[item.id]?.text}
          onGone={() => {
            setDone((prev) => {
              const next = { ...prev };
              delete next[item.id];
              return next;
            });
            onChanged();
          }}
          onReset={() => setConfirm(item)}
          onOpen={() => item.subject?.employee_id && onOpenEmployee(item.subject.employee_id)}
          onResolve={() => void resolve(item)}
        />
      ))}
      {recent.length > 0 ? (
        <p className="cab-recent fin-soft">
          Недавно:{" "}
          {recent
            .map((item) => {
              const who = shortName(item.subject?.name) || "—";
              const device = item.payload?.user_agent ? ` · ${deviceOf(String(item.payload.user_agent))}` : "";
              return `${who} — пароль задан${device} · ${when(item.created_at)}`;
            })
            .join("; ")}
        </p>
      ) : null}
      {error ? (
        <p className="cab-error fin-fail" role="alert">
          {error}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        title={`Сбросить пароль · ${shortName(confirm?.subject?.name) || ""}`}
        text={`Старый пароль перестанет действовать, открытые сеансы закроются. Задать новый можно до ${stamp(
          new Date(Date.now() + WINDOW_HOURS * 3600 * 1000).toISOString(),
        )}.`}
        confirm="Сбросить"
        busy={busy}
        onConfirm={reset}
        onCancel={() => setConfirm(null)}
      />
    </section>
  );
}

function PendingRow({
  item,
  done,
  onGone,
  onReset,
  onOpen,
  onResolve,
}: {
  item: NotificationItem;
  done?: string;
  onGone: () => void;
  onReset: () => void;
  onOpen: () => void;
  onResolve: () => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const locked = item.kind === "login_locked";
  const count = Number(item.payload?.count ?? 5) || 5;
  // Колбэк — через ссылку: новый на каждой отрисовке перезапускал бы таймер,
  // и строка не ушла бы никогда, пока идёт опрос.
  const gone = useRef(onGone);
  useEffect(() => {
    gone.current = onGone;
  });

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => {
      const el = row.current;
      if (!el || prefersReducedMotion()) {
        gone.current();
        return;
      }
      gsap.to(el, {
        height: 0,
        opacity: 0,
        paddingTop: 0,
        paddingBottom: 0,
        duration: 0.32,
        ease: "power2.inOut",
        onComplete: () => gone.current(),
      });
    }, 4000);
    return () => clearTimeout(timer);
  }, [done]);

  const what = locked ? `${count} неверных паролей подряд` : "просит сбросить пароль";
  return (
    <div ref={row} className="cab-pending-row" data-kind={locked ? "locked" : "reset"}>
      <span className="cab-pending-who">{item.subject?.name || item.subject?.phone || "—"}</span>
      <span className={`cab-pending-what ${locked && !done ? "fin-fail" : ""}`}>{done ?? what}</span>
      <span className="cab-pending-time fin-mono fin-soft">{when(item.created_at)}</span>
      <span className="cab-pending-act">
        {done ? null : locked ? (
          <>
            <button type="button" className="btn-ghost btn-sm" onClick={onOpen}>
              Открыть
            </button>
            <button type="button" className="fin-link-btn cab-pending-resolve" onClick={onResolve}>
              Решено
            </button>
          </>
        ) : (
          <button type="button" className="btn-primary btn-sm" onClick={onReset} disabled={!item.subject?.employee_id}>
            Сбросить
          </button>
        )}
      </span>
    </div>
  );
}
