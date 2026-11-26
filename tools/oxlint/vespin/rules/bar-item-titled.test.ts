import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { barItemTitledRule } from "./bar-item-titled.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const MOBILE_FILE = path.join(REPOSITORY_ROOT, "apps/mobile/src/screens/example.tsx");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

function mobile(code: string): { code: string; filename: string } {
  return { code, filename: MOBILE_FILE };
}

tester.run("bar-item-titled", barItemTitledRule, {
  valid: [
    // A glyph's button holds its words, which the overflow names it by.
    mobile(
      "function A() { return <Stack.Toolbar.Button icon={g} accessibilityLabel={RUNS} onPress={go}>{RUNS}</Stack.Toolbar.Button>; }",
    ),
    // A glyph's menu holds its words in a Label.
    mobile(
      "function A() { return <Stack.Toolbar.Menu icon={g} accessibilityLabel={MORE}><Stack.Toolbar.Label>{MORE}</Stack.Toolbar.Label><Stack.Toolbar.MenuAction onPress={go}>Copy</Stack.Toolbar.MenuAction></Stack.Toolbar.Menu>; }",
    ),
    // A button of words alone stands its words in the bar.
    mobile(
      "function A() { return <Stack.Toolbar.Button onPress={go}>Done</Stack.Toolbar.Button>; }",
    ),
  ],
  invalid: [
    {
      ...mobile(
        "function A() { return <Stack.Toolbar.Button icon={g} accessibilityLabel={RUNS} onPress={go} />; }",
      ),
      errors: [{ messageId: "untitledButton" }],
    },
    {
      ...mobile(
        "function A() { return <Stack.Toolbar.Menu icon={g} accessibilityLabel={MORE}><Stack.Toolbar.MenuAction onPress={go}>Copy</Stack.Toolbar.MenuAction></Stack.Toolbar.Menu>; }",
      ),
      errors: [{ messageId: "untitledMenu" }],
    },
    // A glyph drawn on a condition is no title.
    {
      ...mobile(
        "function A() { return <Stack.Toolbar.Button accessibilityLabel={l} onPress={go}>{s === undefined ? null : <Stack.Toolbar.Icon xcasset={s} />}</Stack.Toolbar.Button>; }",
      ),
      errors: [{ messageId: "untitledButton" }],
    },
  ],
});
