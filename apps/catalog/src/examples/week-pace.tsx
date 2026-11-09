import {
  MARK_PROVIDER,
  MoreButton,
  PROGRESS_TONE,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  SETTINGS_ROW_STATE,
  SettingsRow,
  SettingsRowMeter,
  type SettingsRowState,
  SettingsRowStateLine,
  SettingsSection,
} from "@repo/ui";
import { weekPace } from "@repo/ui/week-pace";
import { WeekPaceChart } from "@repo/ui/week-pace-chart";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * week-pace.tsx -- a plan's week under its usage, as Settings › Agents
 * draws it, at each of its paces: running out before the reset in the
 * attention tint, leaving much of it unused in the complete green, and
 * landing about on it, plain; each with its chart, the week so far solid and
 * its pace dashed on to the limit or the reset.
 */

/** A week that started Monday, Nov 9, 2026, read halfway through. */
const RESETS_AT = Date.parse("2026-11-16T00:00:00Z");
const READ_AT = Date.parse("2026-11-12T12:00:00Z");

interface Plan {
  readonly id: string;
  readonly name: string;
  readonly fiveHour: number;
  readonly weekly: number;
  readonly week: string;
  readonly state: SettingsRowState;
}

const PLANS: readonly Plan[] = [
  {
    id: "runs-out",
    name: "ana@work.example",
    fiveHour: 64,
    weekly: 70,
    week: "70% of the weekly limit used · runs out Sat, 2 days before reset",
    state: SETTINGS_ROW_STATE.ATTENTION,
  },
  {
    id: "unused",
    name: "ana.personal@example.com",
    fiveHour: 12,
    weekly: 25,
    week: "25% of the weekly limit used · about 50% will go unused",
    state: SETTINGS_ROW_STATE.SPARE,
  },
  {
    id: "on-track",
    name: "ana@sideproject.example",
    fiveHour: 38,
    weekly: 46,
    week: "46% of the weekly limit used · on track",
    state: SETTINGS_ROW_STATE.PLAIN,
  },
];

/** One plan's row with its week under its usage. */
function PlanRow({ name, fiveHour, weekly, week, state }: Plan): React.JSX.Element {
  const pace = weekPace({ usedPercent: weekly, readAt: READ_AT, resetsAt: RESETS_AT });
  return (
    <SettingsRow
      leading={<ProviderMark provider={MARK_PROVIDER.CHATGPT} size={PROVIDER_MARK_SIZE.ROW} />}
      label={name}
      description={
        <>
          <SettingsRowStateLine>{`${String(fiveHour)}% of the 5-hour limit used`}</SettingsRowStateLine>
          <SettingsRowMeter value={fiveHour} tone={PROGRESS_TONE.WORKING} />
          <SettingsRowStateLine state={state} block>
            {week}
          </SettingsRowStateLine>
          {pace === undefined ? null : <WeekPaceChart pace={pace} />}
        </>
      }
      end={() => <MoreButton thing={name} />}
    />
  );
}

function WeekPaceExample(): React.JSX.Element {
  return (
    <CatalogSection id="week-pace" title="Each pace, under a plan's usage">
      <SettingsSection title="Codex">
        {PLANS.map((plan) => (
          <PlanRow key={plan.id} {...plan} />
        ))}
      </SettingsSection>
    </CatalogSection>
  );
}

export const WEEK_PACE_EXAMPLE: Example = {
  id: "week-pace",
  title: "Week pace",
  Render: WeekPaceExample,
};
