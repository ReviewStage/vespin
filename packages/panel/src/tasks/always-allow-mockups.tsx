/**
 * always-allow-mockups.tsx -- what each Always allow mockup says on a held call's row: before the press, its menu of places, and once answered (prototype, `always-allow-prototype.ts`).
 */

import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import {
  type AlwaysAllowKeeps,
  TEXT_BUTTON_TONE,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
} from "@repo/ui";
import type { ReactNode } from "react";
import { useOpenSettings } from "../open-settings.js";
import {
  ALWAYS_ALLOW_HARNESS,
  ALWAYS_ALLOW_UI,
  type AlwaysAllowHarness,
  type AlwaysAllowUi,
  alwaysAllowHarness,
  answeredScope,
  FIXTURE_REPOSITORY,
  RULE_SCOPE,
  type RuleScope,
  SUGGESTED_RULE,
} from "./always-allow-prototype.js";

/** A rule's words in the monospace face, as a command reads. */
function Rule({ children }: { children: string }): React.JSX.Element {
  return (
    <Text as="span" variant={TEXT_VARIANT.CAPTION} font={TEXT_FONT.MONO}>
      {children}
    </Text>
  );
}

/** What the rule lets through, in the harness's own terms. */
function ruleWords(harness: AlwaysAllowHarness): ReactNode {
  return harness === ALWAYS_ALLOW_HARNESS.CODEX ? (
    <>
      commands that start with <Rule>{SUGGESTED_RULE[harness]}</Rule>
    </>
  ) : (
    <Rule>{SUGGESTED_RULE[harness]}</Rule>
  );
}

/** Where a rule applies, in words. */
function scopeWords(scope: RuleScope): string {
  switch (scope) {
    case RULE_SCOPE.AGENT:
      return "for this agent";
    case RULE_SCOPE.REPOSITORY:
      return `in ${FIXTURE_REPOSITORY}`;
    case RULE_SCOPE.EVERYWHERE:
      return "in every repository";
  }
}

/** The scope a mockup keeps the staged harness's rule for. */
function scopeOf(ui: AlwaysAllowUi, harness: AlwaysAllowHarness): RuleScope {
  if (ui === ALWAYS_ALLOW_UI.CHOOSE) return answeredScope();
  if (ui === ALWAYS_ALLOW_UI.HARNESS && harness === ALWAYS_ALLOW_HARNESS.CODEX) {
    return RULE_SCOPE.EVERYWHERE;
  }
  return RULE_SCOPE.REPOSITORY;
}

/** The staged call's command prefix in harness-neutral words, as `d` keeps it for both. */
function prefixWords(): ReactNode {
  return (
    <>
      commands that start with <Rule>{SUGGESTED_RULE[ALWAYS_ALLOW_HARNESS.CODEX]}</Rule>
    </>
  );
}

/** What Always allow says before it is pressed, under a mockup. */
export function keepsOf(ui: AlwaysAllowUi, onAllow: () => void): AlwaysAllowKeeps | undefined {
  const harness = alwaysAllowHarness();
  if (ui === ALWAYS_ALLOW_UI.CURRENT) return undefined;
  if (ui === ALWAYS_ALLOW_UI.ACCOUNT) {
    return { command: `${SUGGESTED_RULE[ALWAYS_ALLOW_HARNESS.CODEX]} *` };
  }
  if (ui === ALWAYS_ALLOW_UI.CHOOSE) {
    return {
      line: (
        <>
          Always allow won't ask again for {ruleWords(harness)} in {FIXTURE_REPOSITORY}, or choose
          where with the arrow.
        </>
      ),
      scopes: [
        {
          label: `In ${FIXTURE_REPOSITORY}`,
          detail: "Your agents in this repository",
          onSelect: onAllow,
        },
        { label: "In every repository", detail: "All of your agents", onSelect: onAllow },
        { label: "For this agent only", detail: "Until it stops running", onSelect: onAllow },
      ],
    };
  }
  return {
    line: (
      <>
        Always allow won't ask again for {ruleWords(harness)} {scopeWords(scopeOf(ui, harness))}.
      </>
    ),
  };
}

/** The line a held call answered Always allow says under its row, with the way to the list. */
export function AnsweredKeeps({ ui }: { ui: AlwaysAllowUi }): React.JSX.Element {
  const harness = alwaysAllowHarness();
  const openSettings = useOpenSettings();
  const scope = scopeOf(ui, harness);
  const account = ui === ALWAYS_ALLOW_UI.ACCOUNT;
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      Won't ask again for {account ? prefixWords() : ruleWords(harness)}
      {account ? "" : ` ${scopeWords(scope)}`}.{" "}
      {scope === RULE_SCOPE.AGENT ? null : (
        <TextButton
          tone={TEXT_BUTTON_TONE.ACCENT}
          onClick={() => openSettings({ page: SETTINGS_VIEW.AGENTS })}
        >
          Manage
        </TextButton>
      )}
    </Text>
  );
}
