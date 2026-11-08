import path from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "oxlint/plugins-dev";
import { describe, it } from "vitest";

import { noRawPressOutsideUiNativeRule } from "./no-raw-press-outside-ui-native.ts";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const MOBILE_FILE = path.join(REPOSITORY_ROOT, "apps/mobile/src/screens/example.tsx");
const UI_NATIVE_FILE = path.join(REPOSITORY_ROOT, "packages/ui-native/src/example.tsx");

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

function mobile(code: string): { code: string; filename: string } {
  return { code, filename: MOBILE_FILE };
}

tester.run("no-raw-press-outside-ui-native", noRawPressOutsideUiNativeRule, {
  valid: [
    // A screen composes the design system's components, a press among their props.
    mobile(
      'import { Button, Screen } from "@repo/ui-native"; function A() { return <Screen><Button label="Go" onPress={go} /></Screen>; }',
    ),
    // React Native's primitives draw and lay out; only a press makes one a control.
    mobile(
      'import { View, Text } from "react-native"; function A() { return <View style={s}><Text onLayout={f}>Hi</Text></View>; }',
    ),
    // A press prop on a component of another library is that component's own.
    mobile('import { Link } from "expo-router"; function A() { return <Link onPress={go} />; }'),
    // The design system wraps every one of them.
    {
      code: 'import { Pressable, TextInput } from "react-native"; import { Host } from "@expo/ui/swift-ui"; import { GlassView } from "expo-glass-effect"; function A() { return <Pressable onPress={go}><TextInput /></Pressable>; }',
      filename: UI_NATIVE_FILE,
    },
  ],
  invalid: [
    {
      code: 'import { Pressable } from "react-native"; function A() { return <Pressable onPress={go} />; }',
      filename: MOBILE_FILE,
      errors: [
        { messageId: "rawControl", data: { name: "Pressable" } },
        { messageId: "pressEvent", data: { event: "onPress", tag: "Pressable" } },
      ],
    },
    {
      code: 'import { TextInput as Field, Switch, TouchableOpacity } from "react-native";',
      filename: MOBILE_FILE,
      errors: [
        { messageId: "rawControl", data: { name: "TextInput" } },
        { messageId: "rawControl", data: { name: "Switch" } },
        { messageId: "rawControl", data: { name: "TouchableOpacity" } },
      ],
    },
    {
      code: 'import { View, Text as Words } from "react-native"; function A() { return <View onLongPress={f}><Words onPressIn={g} /></View>; }',
      filename: MOBILE_FILE,
      errors: [
        { messageId: "pressEvent", data: { event: "onLongPress", tag: "View" } },
        { messageId: "pressEvent", data: { event: "onPressIn", tag: "Words" } },
      ],
    },
    {
      code: 'import * as RN from "react-native"; function A() { return <RN.Pressable><RN.View onPress={go} /></RN.Pressable>; }',
      filename: MOBILE_FILE,
      errors: [
        { messageId: "rawControl", data: { name: "Pressable" } },
        { messageId: "pressEvent", data: { event: "onPress", tag: "RN.View" } },
      ],
    },
    {
      code: 'import { Button } from "@expo/ui/swift-ui"; import type { ListProps } from "@expo/ui"; import { GlassView } from "expo-glass-effect";',
      filename: MOBILE_FILE,
      errors: [
        { messageId: "wrappedImport", data: { source: "@expo/ui/swift-ui" } },
        { messageId: "wrappedImport", data: { source: "@expo/ui" } },
        { messageId: "wrappedImport", data: { source: "expo-glass-effect" } },
      ],
    },
    {
      code: 'export { Pressable } from "react-native"; export * from "@expo/ui/swift-ui/modifiers";',
      filename: MOBILE_FILE,
      errors: [
        { messageId: "rawControl", data: { name: "Pressable" } },
        { messageId: "wrappedImport", data: { source: "@expo/ui/swift-ui/modifiers" } },
      ],
    },
  ],
});
