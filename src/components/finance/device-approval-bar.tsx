"use client";

import { useState } from "react";

import { type PendingDevice, financeApi } from "@/components/finance/api";

/**
 * Полоса подтверждения входа с нового устройства.
 *
 * Появляется там, где человек уже вошёл, когда кто-то входит его учёткой со
 * слабым паролем с незнакомого устройства (`auth.py`, доверенные устройства).
 * Знание пароля перестало быть достаточным: без «Разрешить» отсюда тот вход
 * сеанса не получит.
 *
 * Смысл несут подпись, браузер, адрес и время, а не цвет: если устройство не
 * твоё, это и есть попытка войти под тобой - «Отклонить». «Разрешить» - плита
 * (главное действие своего же нового входа), «Отклонить» - рамка.
 */
function deviceLine(ua: string): string {
  const browser =
    /YaBrowser/i.test(ua) ? "Яндекс.Браузер" :
    /Edg/i.test(ua) ? "Edge" :
    /OPR|Opera/i.test(ua) ? "Opera" :
    /Firefox/i.test(ua) ? "Firefox" :
    /Chrome/i.test(ua) ? "Chrome" :
    /Safari/i.test(ua) ? "Safari" : "";
  const os =
    /Android/i.test(ua) ? "Android" :
    /iPhone|iPad|iOS/i.test(ua) ? "iOS" :
    /Windows/i.test(ua) ? "Windows" :
    /Mac OS X|Macintosh/i.test(ua) ? "macOS" :
    /Linux/i.test(ua) ? "Linux" : "";
  return [browser, os].filter(Boolean).join(" · ") || "неизвестное устройство";
}

function whenLine(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function DeviceApprovalBar({
  devices,
  onDecided,
}: {
  devices: PendingDevice[];
  onDecided: () => void;
}) {
  const [busy, setBusy] = useState("");

  if (devices.length === 0) return null;

  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    try {
      if (approve) await financeApi.approveDevice(id);
      else await financeApi.denyDevice(id);
      onDecided();
    } catch {
      /* не вышло - полоса останется, человек попробует снова */
    } finally {
      setBusy("");
    }
  };

  return (
    <div role="alert" className="flex flex-col gap-3 px-4 py-3 border-b" style={{ borderColor: "currentColor" }}>
      {devices.map((device) => (
        <div key={device.id} className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="mr-auto min-w-0">
            <p className="text-sm font-semibold">Вход с нового устройства</p>
            <p className="text-sm opacity-80 truncate">
              {deviceLine(device.user_agent)}
              {device.ip ? ` · ${device.ip}` : ""}
              {whenLine(device.created_at) ? ` · ${whenLine(device.created_at)}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy === device.id}
              onClick={() => void decide(device.id, true)}
            >
              Разрешить
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={busy === device.id}
              onClick={() => void decide(device.id, false)}
            >
              Отклонить
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
