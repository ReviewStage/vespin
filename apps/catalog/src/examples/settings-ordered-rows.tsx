import { MODEL_PROVIDER } from "@repo/features/models-wire";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  HarnessMark,
  MoreButton,
  PROGRESS_TONE,
  type ProgressTone,
  SETTINGS_ROW_STATE,
  SettingsOrderedRows,
  SettingsRow,
  SettingsRowAction,
  SettingsRowMark,
  SettingsRowMeter,
  SettingsRowStateLine,
  SettingsRowUsage,
  SettingsSection,
  type UsageMeterRow,
} from "@repo/ui";
import codexOneX from "../../../../packages/panel/marks/codex-16.png";
import codexTwoX from "../../../../packages/panel/marks/codex-32.png";
import codexThreeX from "../../../../packages/panel/marks/codex-48.png";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * settings-ordered-rows.tsx -- a run of settings rows the reader orders, as
 * the account's Codex plans and its API key are tried top to bottom, under
 * the card's header row: each led by its grip in the gutter the card keeps,
 * so the header's mark and every row's stand in one column, a plan's usage
 * under its name as a meter for each of its windows (`SettingsRowUsage`), in
 * place of the words where it has room, or a thin meter full in the attention
 * ink at its limit where no window was heard (`SettingsRowMeter`), with the
 * one small press a plan at its limit offers under it (`SettingsRowAction`);
 * and a run of one, which draws no grip.
 */

interface Plan {
  readonly id: string;
  readonly name: string;
  /** Its line's words; none where its usage says it. */
  readonly state?: string;
  readonly limited?: boolean;
  readonly meter?: { readonly value: number; readonly tone: ProgressTone };
  readonly usage?: readonly UsageMeterRow[];
  /** The press it offers under its meters, a plan at its limit's Use reset. */
  readonly offer?: string;
}

const NOW = Date.now();
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/** Codex's mark, which each of its plans' rows and its card's header lead with. */
const CODEX = (
  <HarnessMark
    provider={MODEL_PROVIDER.OPENAI}
    codexArt={{ oneX: codexOneX, twoX: codexTwoX, threeX: codexThreeX }}
  />
);

const PLANS: readonly Plan[] = [
  {
    id: "work",
    name: "ana@work.example",
    state: "At its limit · back at 3:40 PM",
    limited: true,
    meter: { value: 100, tone: PROGRESS_TONE.ATTENTION },
    offer: "Use reset",
  },
  {
    id: "personal",
    name: "ana.personal@example.com",
    usage: [
      { label: "5-hour", usedPercent: 42, resetsAt: NOW + 2 * HOUR },
      { label: "Weekly", usedPercent: 18, resetsAt: NOW + 3 * DAY },
    ],
  },
  { id: "side", name: "ana@sideproject.example", state: "Ready" },
  { id: "key", name: "API key · sk-proj-…a91F", state: "Ready" },
];

/** One plan's row, as Settings › Agents draws it. */
function PlanRow({ name, state, limited = false, meter, usage, offer }: Plan): React.JSX.Element {
  return (
    <SettingsRow
      leading={<SettingsRowMark>{CODEX}</SettingsRowMark>}
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
          {offer === undefined ? null : (
            <SettingsRowAction>
              <Button variant={BUTTON_VARIANT.OUTLINE} size={BUTTON_SIZE.COMPACT}>
                {offer}
              </Button>
            </SettingsRowAction>
          )}
        </>
      }
      end={() => <MoreButton thing={name} />}
    />
  );
}

/** The card's header row, as Settings › Agents opens a harness's card. */
function HeaderRow(): React.JSX.Element {
  return (
    <SettingsRow leading={<SettingsRowMark>{CODEX}</SettingsRowMark>} label="Codex">
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
