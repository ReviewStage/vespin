import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { entityChoiceThroughHelperRule } from "./entity-choice-through-helper.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const MOBILE_FILE = path.join(REPOSITORY_ROOT, "apps/mobile/src/screens/example.ts");
const UI_NATIVE_FILE = path.join(REPOSITORY_ROOT, "packages/ui-native/src/example.ts");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

function mobile(code: string): { code: string; filename: string } {
  return { code, filename: MOBILE_FILE };
}

tester.run("entity-choice-through-helper", entityChoiceThroughHelperRule, {
  valid: [
    // An entity's choice built by its helper carries its mark.
    mobile("const c = statusChoice(status, { on, onPress });"),
    // A plain glyph leads a choice that names no entity, such as Group by's.
    mobile("const c = { label: 'Following', symbol: GLYPH.FOLLOW, on, onPress };"),
    // A submenu's glyph says what the menu holds, and is no choice of it.
    mobile("const m = { label: 'Assignee', symbol: GLYPH.PERSON, choices };"),
    // The helpers themselves draw the entity's glyph.
    {
      code: "const c = { label, symbol: STATUS_MARK_SYMBOL[status], on, onPress };",
      filename: UI_NATIVE_FILE,
    },
  ],
  invalid: [
    {
      code: "const c = { label, symbol: STATUS_MARK_SYMBOL[status], tone, on, onPress };",
      filename: MOBILE_FILE,
      errors: [{ messageId: "bareEntityGlyph", data: { glyph: "STATUS_MARK_SYMBOL[…]" } }],
    },
    {
      code: "const c = { label: member.name, symbol: GLYPH.PERSON, ...press(member) };",
      filename: MOBILE_FILE,
      errors: [{ messageId: "bareEntityGlyph", data: { glyph: "GLYPH.PERSON" } }],
    },
  ],
});
