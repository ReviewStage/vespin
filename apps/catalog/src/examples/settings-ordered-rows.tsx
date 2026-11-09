import {
  MARK_PROVIDER,
  MoreButton,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  SETTINGS_ROW_STATE,
  SettingsOrderedRows,
  SettingsRow,
  SettingsRowStateLine,
  SettingsSection,
} from "@repo/ui";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * settings-ordered-rows.tsx -- a run of settings rows the reader orders, as
 * the account's ChatGPT plans are tried top to bottom: each led by its grip,
 * above a row that is no part of the order; and a run of one, which draws no
 * grip.
 */

const PLANS = [
  { id: "work", name: "ana@work.example", state: "Ready" },
  { id: "personal", name: "ana.personal@example.com", state: "Ready" },
  { id: "side", name: "ana@sideproject.example", state: "Limit until today at 3:40 PM" },
] as const;

/** One plan's row, as Settings › Agents draws it. */
function PlanRow({ name, state }: { name: string; state: string }): React.JSX.Element {
  return (
    <SettingsRow
      leading={<ProviderMark provider={MARK_PROVIDER.CHATGPT} size={PROVIDER_MARK_SIZE.ROW} />}
      label={name}
      description={
        <SettingsRowStateLine
          state={state === "Ready" ? SETTINGS_ROW_STATE.CONNECTED : SETTINGS_ROW_STATE.ATTENTION}
        >
          {state}
        </SettingsRowStateLine>
      }
      end={() => <MoreButton thing={name} />}
    />
  );
}

function SettingsOrderedRowsExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="settings-ordered-rows" title="Several rows, each dragged by its grip">
        <SettingsSection title="Codex">
          <SettingsOrderedRows
            label="ChatGPT plans"
            onPointerDown={() => undefined}
            rows={PLANS.map((plan) => ({ key: plan.id, row: <PlanRow {...plan} /> }))}
          />
          <SettingsRow label="OpenAI API key" />
        </SettingsSection>
      </CatalogSection>
      <CatalogSection id="settings-ordered-rows-one" title="One row, with nowhere to go">
        <SettingsSection title="Codex">
          <SettingsOrderedRows
            label="ChatGPT plans"
            onPointerDown={() => undefined}
            rows={[{ key: "work", row: <PlanRow name="ana@work.example" state="Ready" /> }]}
          />
        </SettingsSection>
      </CatalogSection>
    </>
  );
}

export const SETTINGS_ORDERED_ROWS_EXAMPLE: Example = {
  id: "settings-ordered-rows",
  title: "Settings ordered rows",
  Render: SettingsOrderedRowsExample,
};
