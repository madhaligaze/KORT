/**
 * Стороны блока так, как их поняла система: подписи из шапки блока, в
 * порядке колонок файла, со стрелкой в сторону исполнения. Блок, где первая
 * колонка — заказчик, помечен `{ наоборот }`: это не ошибка, а то, ради чего
 * шапка читается по блокам, и человек должен это увидеть.
 */
import { isReversed, type Roles } from "./types";

export function RolesText({ roles }: { roles: Roles }) {
  const executor = roles.executor || "Исполнитель";
  const customer = roles.customer || "Заказчик";
  if (!roles.executor && !roles.customer) return <span className="fin-muted">стороны не найдены</span>;
  const reversed = isReversed(roles);
  return (
    <>
      {reversed ? `${customer} ← ${executor}` : `${executor} → ${customer}`}
      {reversed ? (
        <>
          {" "}
          <span className="annot">наоборот</span>
        </>
      ) : null}
    </>
  );
}
