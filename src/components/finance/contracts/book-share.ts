/**
 * Сумма договора в книге одного отдела - доля этого отдела (30.09.2026).
 *
 * Юристы и финансисты BBC: в «Разовых ЮО» №ОКР/59 на 348 000 стоял суммой
 * 348 000, хотя он разделён HR 70% / ЮО 30% и юротделу из него - 104 400. В
 * списке, в листе и в выгрузке «Разовых ЮО» сумма - доля ЮО; в карточке
 * договора - по-прежнему вся сумма. Книга «про отдел», если все её листы
 * отобраны одним отделом (`bookDepartmentId`); доля приходит с договором
 * (`department_share`, считает сервер - `shares.py`).
 *
 * «Оплачено» и «Остаток» из сводки - той же частью договора: клиент платит
 * за договор целиком, отделу приходится его доля платежа. Так же «По
 * сотрудникам» считает остаток у человека с долей (`staff.ts`).
 *
 * Отделов в договоре несколько, а доли этого нет - договор у отдела
 * целиком, как у «По сотрудникам», но это не молча: сумма приглушена, а
 * подсказка говорит, что доля не задана.
 */
import type { Contract, SummaryEntry } from "@/components/finance/api";
import { contractMoney } from "@/components/finance/format";

export type BookShare = {
  /** Что стоит в «Сумме»: доля отдела, а без неё - сумма договора. */
  amount: number | null;
  /** Часть договора для «Оплачено» и «Остатка»; `null` - не посчитать. */
  fraction: number | null;
  /** `share` - доля задана; `whole` - отдел в договоре один; `unset` - отделов несколько, доли нет. */
  kind: "share" | "whole" | "unset";
};

function numberOf(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = typeof raw === "number" ? raw : Number(String(raw).replace(/\s/g, ""));
  return Number.isFinite(value) ? value : null;
}

/** Доля отдела книги в договоре; книга не про отдел (`department` пуст) - `null`. */
export function bookShareOf(contract: Contract | undefined, department: string): BookShare | null {
  if (!contract || !department) return null;
  const total = numberOf(contract.values.amount);
  const entry = contract.department_share?.[department];
  if (entry) {
    const amount = numberOf(entry.amount);
    const percent = numberOf(entry.percent);
    const fraction = percent !== null ? percent / 100 : amount !== null && total ? amount / total : null;
    return { amount, fraction, kind: "share" };
  }
  const departments = Array.isArray(contract.values.department) ? contract.values.department : [];
  return { amount: total, fraction: 1, kind: departments.length > 1 ? "unset" : "whole" };
}

/** Сумма в «Сумме» книги: доля, а без книги отдела - сумма договора как есть. */
export function bookAmount(contract: Contract, share: BookShare | null): unknown {
  return share?.kind === "share" ? share.amount : contract.values.amount;
}

/**
 * Вся сумма договора, если в «Сумме» книги стоит доля и она от неё
 * отличается (ОКР/59: доля 104 400 из 348 000); иначе `null` - в «Сумме» и
 * так весь договор. Её по очереди с долей показывает `total-preview.tsx`.
 */
export function wholeAmount(contract: Contract, share: BookShare | null): number | null {
  if (share?.kind !== "share" || share.amount === null) return null;
  const total = numberOf(contract.values.amount);
  return total !== null && total !== share.amount ? total : null;
}

/** «Оплачено» или «Остаток» из сводки частью договора; не посчитать - `null`. */
export function bookPart(raw: unknown, share: BookShare | null): number | null {
  const value = numberOf(raw);
  if (value === null) return null;
  if (!share || share.kind !== "share") return value;
  return share.fraction === null ? null : Math.round(value * share.fraction * 100) / 100;
}

/** Что сказать о сумме строки: «Доля ЮО - 30% от 348 000»; целый договор одного отдела - пусто. */
export function shareNote(contract: Contract, share: BookShare | null, code: string): string {
  if (!share || share.kind === "whole") return "";
  const total = contractMoney(contract.values.amount);
  const monthly = contract.values.billing === "month" ? " /мес" : "";
  if (share.kind === "unset") {
    return `Доля ${code} не задана - показана вся сумма договора${total ? ` ${total}${monthly}` : ""}`;
  }
  const percent = share.fraction !== null ? `${(Math.round(share.fraction * 10000) / 100).toLocaleString("ru-RU")}%` : "";
  const parts = [percent, total ? `от ${total}${monthly}` : ""].filter(Boolean).join(" ");
  return `Доля ${code}${parts ? ` - ${parts}` : ""}; «Оплачено» и «Остаток» - той же долей`;
}

/**
 * Итог части листа, как в книге юротдела: «договоров: 19 · остаток: 25 250
 * 754 ₸». Остаток - у частей, где есть колонка «Остаток (сводка)», и только
 * когда хоть один остаток известен: сводки нет - нет и нуля.
 */
export function blockTally(
  rows: readonly Contract[],
  withRemaining: boolean,
  summary: Readonly<Record<string, SummaryEntry>> | null,
  department: string,
): string {
  // Подпись, а не счёт словами: «договоров: 1», как в книге.
  let text = `договоров: ${rows.length}`;
  if (!withRemaining) return text;
  let sum = 0;
  let known = false;
  for (const contract of rows) {
    const entry = summary?.[contract.id];
    if (entry?.state !== "found") continue;
    const part = bookPart(entry.remaining, bookShareOf(contract, department));
    if (part === null) continue;
    sum += part;
    known = true;
  }
  if (known) text += ` · остаток: ${contractMoney(Math.round(sum * 100) / 100)} ₸`;
  return text;
}
