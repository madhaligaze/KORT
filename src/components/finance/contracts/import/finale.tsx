"use client";

/**
 * Финал загрузки: сколько договоров заведено — одним большим числом.
 *
 * Число поднимается буквами (`SplitReveal`), строка под ним проявляется
 * следом. Незаведённые строки перечислены с причиной розой: это отказ, и его
 * нельзя пропустить глазами. «Всё заведено» цветом не показывается.
 */
import { plural } from "@/components/finance/format";
import { SplitReveal } from "@/components/motion/split-reveal";

import styles from "./registry-import.module.css";
import { sectionOf, type BlockItem, type EntityItem, type Report } from "./types";

export type ApplyResult = { created: number; failed: { ref: string; error: string }[] };

export function Finale({ result, report, onDone }: { result: ApplyResult; report: Report | null; onDone: () => void }) {
  const blocks = (report ? (sectionOf(report, "blocks")?.items as BlockItem[] | undefined) : undefined) ?? [];
  const entities = (report ? (sectionOf(report, "entities")?.items as EntityItem[] | undefined) : undefined) ?? [];
  const own = entities.filter((item) => item.own).length;
  const sheets = report?.sheets.length ?? 0;
  const facts = [
    own ? `${own} ${plural(own, "наше юрлицо", "наших юрлица", "наших юрлиц")}` : "",
    sheets ? `${sheets} ${plural(sheets, "лист", "листа", "листов")}` : "",
    blocks.length ? `${blocks.length} ${plural(blocks.length, "блок", "блока", "блоков")}` : "",
  ].filter(Boolean);

  return (
    <div className={styles.finale}>
      <SplitReveal key={result.created} as="p" className={`proto-big ${styles.finaleNumber}`}>
        {String(result.created)}
      </SplitReveal>
      <p className={styles.finaleCaption}>
        {plural(result.created, "договор", "договора", "договоров")} в реестре
      </p>
      {facts.length ? <p className={`fin-soft ${styles.finaleFacts}`}>{facts.join(" · ")}</p> : null}
      {result.failed.length ? (
        <div className={styles.finaleFailed}>
          <p className="fin-fail">
            Не заведены: {result.failed.length} {plural(result.failed.length, "строка", "строки", "строк")}
          </p>
          <ul className={styles.rows}>
            {result.failed.map((item) => (
              <li key={item.ref} className={styles.row}>
                <span className="fin-mono">{item.ref}</span>
                <span className={`fin-fail ${styles.grow}`}>{item.error}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className={styles.actions}>
        <button type="button" className="btn-primary" onClick={onDone}>
          К реестру
        </button>
      </div>
    </div>
  );
}
