import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { settingsRowEndRule } from "./settings-row-end.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const PANEL_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/settings/example.tsx");
const TEST_FILE = path.join(REPOSITORY_ROOT, "packages/panel/src/settings/example.test.tsx");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

function panel(code: string): { code: string; filename: string } {
  return { code, filename: PANEL_FILE };
}

tester.run("settings-row-end", settingsRowEndRule, {
  valid: [
    // A row's glyphs in its end, beside the controls that may drop.
    panel(
      "function A() { return <SettingsRow label={L} end={() => <MoreButton thing={T} />}>{() => <Button>Connect</Button>}</SettingsRow>; }",
    ),
    panel(
      "function A() { return <MenuRow thing={T} actions={[]} row={{ label: L, control: <Button>Copy link</Button>, end: <SettingsRowActSlot /> }} />; }",
    ),
    // A test draws what it checks.
    {
      code: "function A() { return <SettingsRow label={L}>{() => <IconButton label={L} />}</SettingsRow>; }",
      filename: TEST_FILE,
    },
  ],
  invalid: [
    {
      ...panel(
        "function A() { return <SettingsRow label={L}>{() => <><Button>Add</Button><Tooltip label={L}><IconButton label={L} /></Tooltip></>}</SettingsRow>; }",
      ),
      errors: [{ messageId: "amongControls", data: { tag: "IconButton", row: "SettingsRow" } }],
    },
    {
      ...panel(
        "function A() { return <MenuRow thing={T} actions={[]} row={{ label: L, control: <><SettingsRowValue>Admin</SettingsRowValue><SettingsRowActSlot /></> }} />; }",
      ),
      errors: [{ messageId: "amongControls", data: { tag: "SettingsRowActSlot", row: "MenuRow" } }],
    },
  ],
});
