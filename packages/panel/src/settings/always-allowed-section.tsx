/**
 * always-allowed-section.tsx -- the rules Always allow kept, listed on Settings › Agents with a Remove on each (prototype, `always-allow-prototype.ts`).
 *
 * Each row leads with its harness's mark, names the rule as its harness
 * writes it, and says under it what it lets through, where it applies, and
 * which agent kept it when. A removed rule leaves the list at once; the
 * next launch of an agent stops handing it over.
 */

import { MODEL_PROVIDER } from "@repo/features/models-wire";
import {
  SettingsLine,
  SettingsRowMark,
  SettingsSection,
  TEXT_FONT,
  TEXT_VARIANT,
  Text,
  TIME_LOOK,
  Time,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useState } from "react";
import { HarnessMark } from "../harness-marks.js";
import {
  ALWAYS_ALLOW_HARNESS,
  ALWAYS_ALLOW_UI,
  type AlwaysAllowUi,
  type KeptRule,
  keptRules,
  RULE_SCOPE,
} from "../tasks/always-allow-prototype.js";
import { MenuRow } from "./menu-row.js";

/** What the section says over its rows, by mockup. */
const CAPTION = {
  [ALWAYS_ALLOW_UI.CURRENT]: "",
  [ALWAYS_ALLOW_UI.HARNESS]:
    "What your agents run without asking. Claude Code keeps a rule for its repository, and Codex for every repository, as each does on its own.",
  [ALWAYS_ALLOW_UI.REPOSITORY]:
    "What your agents run without asking, kept for the repository it was allowed in.",
  [ALWAYS_ALLOW_UI.CHOOSE]: "What your agents run without asking, where you chose.",
  [ALWAYS_ALLOW_UI.ACCOUNT]: "Commands your agents run without asking, in every repository.",
} as const satisfies Record<AlwaysAllowUi, string>;

/** Where a rule applies, as its row says. */
function placeOf(rule: KeptRule): string {
  if (rule.scope === RULE_SCOPE.EVERYWHERE) return "Every repository";
  return rule.repository ?? "";
}

/** One kept rule, its Remove alone at its end. */
function RuleRow({
  rule,
  account,
  onRemove,
}: {
  rule: KeptRule;
  /** Whether the list is `d`'s, one for every harness and repository, so the row names neither. */
  account: boolean;
  onRemove: () => void;
}): React.JSX.Element {
  const provider =
    rule.harness === ALWAYS_ALLOW_HARNESS.CODEX ? MODEL_PROVIDER.OPENAI : MODEL_PROVIDER.ANTHROPIC;
  return (
    <MenuRow
      thing={rule.rule}
      alone
      actions={[{ label: "Remove", icon: <GLYPH.DELETE />, onSelect: onRemove }]}
      row={{
        leading: account ? undefined : (
          <SettingsRowMark>
            <HarnessMark provider={provider} />
          </SettingsRowMark>
        ),
        label: (
          <Text as="span" variant={TEXT_VARIANT.LABEL} font={TEXT_FONT.MONO}>
            {rule.rule}
          </Text>
        ),
        description: account ? (
          <>
            Added <Time at={rule.addedAt} look={TIME_LOOK.PROVENANCE} /> by {rule.from}
          </>
        ) : (
          <>
            {placeOf(rule)} · {rule.says} · Added{" "}
            <Time at={rule.addedAt} look={TIME_LOOK.PROVENANCE} /> by {rule.from}
          </>
        ),
      }}
    />
  );
}

/** The kept rules under a mockup, each removable. */
export function AlwaysAllowedSection({ ui }: { ui: AlwaysAllowUi }): React.JSX.Element {
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const rules = keptRules(ui).filter((rule) => !removed.has(rule.id));
  return (
    <SettingsSection title="Always allowed" caption={CAPTION[ui]}>
      {rules.length === 0 ? (
        <SettingsLine>Nothing yet. Press Always allow on an approval to add a rule.</SettingsLine>
      ) : (
        rules.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            account={ui === ALWAYS_ALLOW_UI.ACCOUNT}
            onRemove={() => setRemoved((was) => new Set(was).add(rule.id))}
          />
        ))
      )}
    </SettingsSection>
  );
}
