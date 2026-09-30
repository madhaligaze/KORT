"use client";

/**
 * «Наши юрлица»: кто в группе компаний - «мы». По ним сторона договора
 * читается как «наше юрлицо», по ним же листы отбирают «исполнитель - наше».
 *
 * Расчётные счета - счета «Финансов», отмеченные за юрлицом. Счёт принадлежит
 * одному юрлицу; занятый другим подписан в списке его кодом, чтобы перенос
 * счёта был виден до щелчка, а не после. Журнал, отчёты и права от этой
 * отметки не меняются - она нужна следующим этапам (оплаты по договорам).
 *
 * БИН и код набраны Martian Mono: их сверяют глазами посимвольно.
 */
import { useEffect, useMemo, useState } from "react";

import { type Account, type OwnEntity, contractsApi, financeApi } from "@/components/finance/api";
import { useRegistry } from "@/components/finance/contracts/store";
import { plural } from "@/components/finance/format";
import { ConfirmDialog } from "@/components/finance/ui/confirm-dialog";
import { InlineText } from "@/components/finance/contracts/setup/inline-text";
import { MultiPop } from "@/components/finance/contracts/setup/popover";
import { errorText, useSetupAction } from "@/components/finance/contracts/setup/use-setup-action";
import { accountLabel, entityShort } from "@/components/finance/contracts/setup/words";
import { useSessionState } from "@/components/session-state";

export function EntitiesTab() {
  const schema = useRegistry((s) => s.schema);
  const byId = useRegistry((s) => s.byId);
  const action = useSetupAction();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountsError, setAccountsError] = useState("");
  const [optimistic, setOptimistic] = useState<Record<string, string[]>>({});
  const [binError, setBinError] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState<{ entity: OwnEntity; count: number } | null>(null);
  // Набранное новое юрлицо переживает перезагрузку (`session-state.tsx`).
  const [name, setName] = useSessionState("setup.entity-new", "");

  useEffect(() => {
    let alive = true;
    financeApi
      .dictionaries()
      .then((data) => {
        if (alive) setAccounts(data.accounts);
      })
      .catch((exc: unknown) => {
        if (alive) setAccountsError(errorText(exc));
      });
    return () => {
      alive = false;
    };
  }, []);

  const entities = useMemo(() => schema?.own_entities ?? [], [schema]);

  const ownerOf = useMemo(() => {
    const out = new Map<string, OwnEntity>();
    for (const entity of entities) for (const account of entity.accounts) out.set(account.id, entity);
    return out;
  }, [entities]);

  const contractsOf = useMemo(() => {
    const out = new Map<string, number>();
    for (const contract of byId.values()) {
      if (contract.deleted) continue;
      const seen = new Set([contract.values.executor, contract.values.customer].map(String));
      for (const id of seen) out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
  }, [byId]);

  if (!schema) return null;

  const setAccountsOf = async (entity: OwnEntity, ids: string[]) => {
    setOptimistic((value) => ({ ...value, [entity.id]: ids }));
    const was = entity.accounts.map((item) => item.id);
    await action.run(`accounts:${entity.id}`, () => contractsApi.setup.updateEntity(entity.id, { accounts: ids }), "schema", {
      text: `Счета «${entity.code || entity.name}» изменены`,
      revert: () => contractsApi.setup.updateEntity(entity.id, { accounts: was }),
    });
    setOptimistic((value) => {
      const next = { ...value };
      delete next[entity.id];
      return next;
    });
  };

  const add = async () => {
    const clean = name.trim();
    if (!clean) return;
    const ok = await action.run("add", () => contractsApi.setup.addEntity({ name: clean }), "schema", (made) => ({
      text: `«${clean}» - наше юрлицо`,
      revert: () => contractsApi.setup.updateEntity(made.id, { archived: true }),
    }));
    if (ok) setName("");
  };

  return (
    <div className="setup-entities">
      <div className="setup-erow setup-ehead" aria-hidden="true">
        <span className="eyebrow">Код</span>
        <span className="eyebrow">Название</span>
        <span className="eyebrow">БИН</span>
        <span className="eyebrow">НДС</span>
        <span className="eyebrow">Расчётные счета</span>
        <span />
      </div>
      {entities.length ? null : <p className="creg-empty">Наших юрлиц пока нет</p>}
      {entities.map((entity) => {
        const chosen = optimistic[entity.id] ?? entity.accounts.map((item) => item.id);
        const chosenLabels = chosen.flatMap((id) => {
          const account = accounts?.find((item) => item.id === id) ?? entity.accounts.find((item) => item.id === id);
          return account ? [accountLabel(account)] : [];
        });
        const count = contractsOf.get(entity.id) ?? 0;
        const errors = [
          binError[entity.id],
          ...["code", "full_name", "bin", "vat", "accounts", "archive"].map((slot) => action.error(`${slot}:${entity.id}`)),
        ].filter(Boolean);
        return (
          <div key={entity.id} className="setup-erow">
            <span className="setup-ecode" data-label="Код">
              <InlineText
                value={entity.code}
                mono
                placeholder="код"
                allowEmpty
                maxLength={16}
                label={`Код юрлица «${entity.name}»`}
                trace={action.trace(`code:${entity.id}`)}
                onCommit={(next) =>
                  void action.run(`code:${entity.id}`, () => contractsApi.setup.updateEntity(entity.id, { code: next }), "schema", {
                    text: `Код «${entity.name}»: ${next || "без кода"}`,
                    revert: () => contractsApi.setup.updateEntity(entity.id, { code: entity.code }),
                  })
                }
              />
            </span>
            <span className="setup-ename">
              <span className="setup-ename-main">{entity.name}</span>
              <InlineText
                value={entity.full_name}
                placeholder="полное название"
                allowEmpty
                label={`Полное название «${entity.name}»`}
                trace={action.trace(`full_name:${entity.id}`)}
                onCommit={(next) =>
                  void action.run(`full_name:${entity.id}`, () => contractsApi.setup.updateEntity(entity.id, { full_name: next }), "schema", {
                    text: `Полное название «${entity.name}» изменено`,
                    revert: () => contractsApi.setup.updateEntity(entity.id, { full_name: entity.full_name }),
                  })
                }
              />
            </span>
            <span className="setup-ebin" data-label="БИН">
              <InlineText
                value={entity.bin}
                mono
                placeholder="-"
                allowEmpty
                inputMode="numeric"
                maxLength={12}
                label={`БИН «${entity.name}»`}
                trace={action.trace(`bin:${entity.id}`)}
                onCommit={(next) => {
                  const clean = next.replace(/\s+/g, "");
                  if (clean && !/^\d{12}$/.test(clean)) {
                    setBinError((value) => ({ ...value, [entity.id]: "БИН - двенадцать цифр" }));
                    return;
                  }
                  setBinError((value) => ({ ...value, [entity.id]: "" }));
                  void action.run(`bin:${entity.id}`, () => contractsApi.setup.updateEntity(entity.id, { bin: clean }), "schema", {
                    text: `БИН «${entity.name}» изменён`,
                    revert: () => contractsApi.setup.updateEntity(entity.id, { bin: entity.bin }),
                  });
                }}
              />
            </span>
            <span className="setup-evat" data-label="НДС" role="radiogroup" aria-label={`Плательщик НДС: ${entity.name}`}>
              {[true, false].map((on) => (
                <button
                  key={String(on)}
                  type="button"
                  role="radio"
                  className="setup-toggle"
                  aria-checked={entity.vat_payer === on}
                  data-on={entity.vat_payer === on ? "true" : undefined}
                  disabled={action.busy(`vat:${entity.id}`)}
                  onClick={() => {
                    if (entity.vat_payer === on) return;
                    void action.run(`vat:${entity.id}`, () => contractsApi.setup.updateEntity(entity.id, { vat_payer: on }), "schema", {
                      text: `«${entity.code || entity.name}» ${on ? "- плательщик НДС" : "не платит НДС"}`,
                      revert: () => contractsApi.setup.updateEntity(entity.id, { vat_payer: !on }),
                    });
                  }}
                >
                  {on ? "да" : "нет"}
                </button>
              ))}
            </span>
            <span className="setup-eaccounts" data-label="Счета">
              <span className="setup-eaccounts-list">{chosenLabels.length ? chosenLabels.join(", ") : "-"}</span>{" "}
              {accounts ? (
                accounts.length ? (
                  <MultiPop
                    values={chosen}
                    options={accounts.map((account) => {
                      const owner = ownerOf.get(account.id);
                      return {
                        value: account.id,
                        label: accountLabel(account),
                        hint: owner && owner.id !== entity.id ? `у ${entityShort(owner)}` : undefined,
                      };
                    })}
                    onChange={(ids) => void setAccountsOf(entity, ids)}
                    label={`Расчётные счета «${entity.name}»`}
                    text="выбрать…"
                    disabled={action.busy(`accounts:${entity.id}`)}
                  />
                ) : (
                  <span className="fin-muted">счетов в учёте пока нет</span>
                )
              ) : accountsError ? (
                <span className="fin-fail">счета не прочитались: {accountsError}</span>
              ) : null}
            </span>
            <span className="setup-eaction">
              <button
                type="button"
                className="fin-link-btn setup-quiet"
                disabled={action.busy(`archive:${entity.id}`)}
                onClick={() => setAsk({ entity, count })}
              >
                Удалить
              </button>
            </span>
            {errors.length ? (
              <span className="setup-enote setup-error" role="alert">
                {errors[0]}
              </span>
            ) : null}
          </div>
        );
      })}

      <form
        className="setup-add"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <span className="setup-add-lead">+ Юрлицо</span>
        <input
          type="text"
          className="setup-input"
          value={name}
          placeholder="Название, как в договорах"
          aria-label="Название нового юрлица"
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="btn-primary btn-sm" disabled={!name.trim() || action.busy("add")}>
          Добавить
        </button>
        {action.error("add") ? (
          <span className="setup-error setup-add-error" role="alert">
            {action.error("add")}
          </span>
        ) : null}
      </form>

      <ConfirmDialog
        open={!!ask}
        title={ask ? `Удалить «${ask.entity.name}» из наших юрлиц?` : ""}
        text={
          ask?.count
            ? `За ним ${ask.count} ${plural(ask.count, "договор", "договора", "договоров")}: они останутся в реестре, но это юрлицо перестанет считаться нашим - договоры уйдут из листов по «нашему исполнителю» и получат замечание «ни одна сторона не наша». Вернуть - из корзины в личном кабинете.`
            : "Договоров за ним нет. Как контрагент оно останется в справочнике; вернуть - из корзины в личном кабинете."
        }
        confirm="Удалить"
        danger
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          if (!ask) return;
          const { entity } = ask;
          setAsk(null);
          void action.run(`archive:${entity.id}`, () => contractsApi.setup.updateEntity(entity.id, { archived: true }), "schema", {
            text: `«${entity.code || entity.name}» больше не наше юрлицо`,
            revert: () => contractsApi.setup.updateEntity(entity.id, { archived: false }),
          });
        }}
      />
    </div>
  );
}
