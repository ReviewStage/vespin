import {
  BUTTON_VARIANT,
  Button,
  MARK_PROVIDER,
  MoreButton,
  PROGRESS_TONE,
  PROVIDER_MARK_SIZE,
  type ProgressTone,
  ProviderMark,
  SETTINGS_ROW_STATE,
  SettingsOrderedRows,
  SettingsRow,
  SettingsRowMark,
  SettingsRowMeter,
  SettingsRowStateLine,
  SettingsRowUsage,
  SettingsSection,
  type UsageMeterRow,
} from "@repo/ui";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * settings-ordered-rows.tsx -- a run of settings rows the reader orders, as
 * the account's Codex plans and its API key are tried top to bottom, under
 * the card's header row: each led by its grip in the gutter the card keeps,
 * so the header's mark and every row's stand in one column, a plan's usage
 * under its name as a meter for each of its windows (`SettingsRowUsage`), in
 * place of the words where it has room, or a thin meter full in the attention
 * ink at its limit where no window was heard (`SettingsRowMeter`); and a run
 * of one, which draws no grip.
 */

interface Plan {
  readonly id: string;
  readonly name: string;
  /** Its line's words; none where its usage says it. */
  readonly state?: string;
  readonly limited?: boolean;
  readonly meter?: { readonly value: number; readonly tone: ProgressTone };
  readonly usage?: readonly UsageMeterRow[];
}

const PLANS: readonly Plan[] = [
  {
    id: "work",
    name: "ana@work.example",
    state: "At its limit · back at 3:40 PM",
    limited: true,
    meter: { value: 100, tone: PROGRESS_TONE.ATTENTION },
  },
  {
    id: "personal",
    name: "ana.personal@example.com",
    usage: [
      { label: "5-hour", usedPercent: 42, resets: "in 2h" },
      { label: "Weekly", usedPercent: 18, resets: "in 3d" },
    ],
  },
  { id: "side", name: "ana@sideproject.example", state: "Ready" },
  { id: "key", name: "API key · sk-proj-…a91F", state: "Ready" },
];

/** One plan's row, as Settings › Agents draws it. */
function PlanRow({ name, state, limited = false, meter, usage }: Plan): React.JSX.Element {
  return (
    <SettingsRow
      leading={<ProviderMark provider={MARK_PROVIDER.CHATGPT} size={PROVIDER_MARK_SIZE.ROW} />}
      label={name}
      description={
        <>
          {state === undefined ? null : (
            <SettingsRowStateLine
              state={limited ? SETTINGS_ROW_STATE.ATTENTION : SETTINGS_ROW_STATE.PLAIN}
            >
              {state}
            </SettingsRowStateLine>
          )}
          {usage === undefined ? null : <SettingsRowUsage rows={usage} />}
          {meter === undefined ? null : <SettingsRowMeter value={meter.value} tone={meter.tone} />}
        </>
      }
      end={() => <MoreButton thing={name} />}
    />
  );
}

/** The card's header row, as Settings › Agents opens a harness's card. */
function HeaderRow(): React.JSX.Element {
  return (
    <SettingsRow
      leading={
        <SettingsRowMark>
          <ProviderMark provider={MARK_PROVIDER.CHATGPT} size={PROVIDER_MARK_SIZE.ROW} />
        </SettingsRowMark>
      }
      label="Codex"
    >
      {() => <Button variant={BUTTON_VARIANT.OUTLINE}>Add</Button>}
    </SettingsRow>
  );
}

function SettingsOrderedRowsExample(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="settings-ordered-rows" title="Several rows, each dragged by its grip">
        <SettingsSection title="Codex">
          <HeaderRow />
          <SettingsOrderedRows
            label="Codex"
            onPointerDown={() => undefined}
            rows={PLANS.map((plan) => ({ key: plan.id, row: <PlanRow {...plan} /> }))}
          />
        </SettingsSection>
      </CatalogSection>
      <CatalogSection id="settings-ordered-rows-one" title="One row, with nowhere to go">
        <SettingsSection title="Codex">
          <HeaderRow />
          <SettingsOrderedRows
            label="Codex"
            onPointerDown={() => undefined}
            rows={[
              { key: "work", row: <PlanRow id="work" name="ana@work.example" state="Ready" /> },
            ]}
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
