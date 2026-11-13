import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { pressShapeOnLabelRule } from "./press-shape-on-label.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

/** A file of the design system's, where `@expo/ui` is imported. */
const FILE = "packages/ui-native/src/example.tsx";

function tsx(code: string): { code: string; filename: string } {
  return { code, filename: FILE };
}

const IMPORTS =
  'import { Button as SwiftButton, HStack, Menu } from "@expo/ui/swift-ui"; import * as M from "@expo/ui/swift-ui/modifiers";';

tester.run("press-shape-on-label", pressShapeOnLabelRule, {
  valid: [
    // The shape stands on the label, so the whole frame takes the press.
    tsx(`${IMPORTS} function A() { return <SwiftButton onPress={go}><HStack modifiers={[M.frame({ minHeight: 44 }), M.contentShape(M.shapes.rectangle())]} /></SwiftButton>; }`),
    // A frame on a bordered button is its press, as Send's circle is.
    tsx(`${IMPORTS} function A() { return <SwiftButton onPress={go} modifiers={[M.buttonStyle("borderedProminent"), M.frame({ width: 32, height: 32 })]} />; }`),
    // A button of another library is its own.
    tsx(
      'import { Button } from "@repo/ui-native"; function A() { return <Button modifiers={[contentShape(r)]} />; }',
    ),
  ],
  invalid: [
    {
      code: `${IMPORTS} function A() { return <SwiftButton onPress={go} modifiers={[M.buttonStyle("plain"), M.contentShape(M.shapes.rectangle())]}><HStack /></SwiftButton>; }`,
      filename: FILE,
      errors: [{ messageId: "shapeOnControl", data: { tag: "SwiftButton" } }],
    },
    {
      code: `${IMPORTS} function A() { return <Menu label={l} modifiers={[contentShape(r)]} />; }`,
      filename: FILE,
      errors: [{ messageId: "shapeOnControl", data: { tag: "Menu" } }],
    },
  ],
});
