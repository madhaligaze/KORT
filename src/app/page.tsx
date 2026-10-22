import { DesktopForcedUpdate } from "@/components/desktop/desktop-bars";
import { FinanceClient } from "@/components/finance/finance-client";

export default function KortPage() {
  return (
    <>
      <FinanceClient />
      {/* Только в десктопе: устаревшая версия закрыта окном до обновления. */}
      <DesktopForcedUpdate />
    </>
  );
}
