import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { settingsSectionDeclaredRule } from "./settings-section-declared.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const SETTINGS_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/settings/example.tsx");
const OTHER_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/tasks/example.tsx");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

function settings(code: string): { code: string; filename: string } {
  return { code, filename: SETTINGS_FILE };
}

tester.run("settings-section-declared", settingsSectionDeclaredRule, {
  valid: [
    // A head from its declaration, or a choice between two declarations' heads.
    settings(
      "function A() { return <SettingsSection {...settingsSectionHead(SECTION.MEMBERS)} action={B}>{C}</SettingsSection>; }",
    ),
    settings(
      "function A() { return <SettingsSection {...(p ? settingsSectionHead(SECTION.A, w) : settingsSectionHead(SECTION.B))}>{C}</SettingsSection>; }",
    ),
    // An untitled section, which may wear an anchor for a row the search finds.
    settings("function A() { return <SettingsSection anchor={ROW.LEAVE}>{C}</SettingsSection>; }"),
    // A section drawn outside the Settings pages.
    {
      code: 'function A() { return <SettingsSection title="Trigger">{C}</SettingsSection>; }',
      filename: OTHER_FILE,
    },
  ],
  invalid: [
    {
      ...settings(
        'function A() { return <SettingsSection title="Run actions">{C}</SettingsSection>; }',
      ),
      errors: [{ messageId: "ownHead" }],
    },
    {
      ...settings("function A() { return <SettingsSection {...head}>{C}</SettingsSection>; }"),
      errors: [{ messageId: "otherSpread" }],
    },
    // An anchor beside the declared head overrides the one the search lands on.
    {
      ...settings(
        "function A() { return <SettingsSection {...settingsSectionHead(SECTION.MEMBERS)} anchor={ROW.OTHER}>{C}</SettingsSection>; }",
      ),
      errors: [{ messageId: "ownAnchor" }],
    },
    // The section imported under another name is still the section.
    {
      ...settings(
        'import { SettingsSection as Section } from "@repo/ui"; function A() { return <Section title="Run actions">{C}</Section>; }',
      ),
      errors: [{ messageId: "ownHead" }],
    },
  ],
});
