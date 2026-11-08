import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import { attributeName } from "../shared/jsx.ts";
import {
  isOutsideUiNative,
  isWrappedModule,
  NATIVE_PRESS_EVENTS,
  RAW_NATIVE_CONTROLS,
  REACT_NATIVE_MODULE,
} from "../shared/native-press-guard.ts";

/** The name an import or export specifier names on the module's side. */
function moduleSideName(name: ESTree.ModuleExportName): string {
  return name.type === "Identifier" ? name.name : String(name.value);
}

/** The name a JSX tag hangs from: `View` for `<View>`, `RN` for `<RN.View>`. */
function tagRoot(name: ESTree.JSXElementName): string | undefined {
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression") return tagRoot(name.object);
  return undefined;
}

/** The member a namespace tag names: `Pressable` for `<RN.Pressable>`. */
function tagMember(name: ESTree.JSXElementName): string | undefined {
  return name.type === "JSXMemberExpression" ? name.property.name : undefined;
}

/**
 * Outside `@repo/ui-native`, the iOS app draws with that package and never
 * builds a control of its own: no React Native control (`Pressable`,
 * `TextInput`, `Switch`, the touchables, its `Button`) is imported or
 * re-exported, no press prop is handed to a React Native primitive, and
 * `@expo/ui` and `expo-glass-effect` are imported nowhere, since every piece
 * of SwiftUI and glass a screen draws is one of the package's wrappers.
 */
export const noRawPressOutsideUiNativeRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow React Native controls, press props on its primitives, and direct @expo/ui or expo-glass-effect imports outside @repo/ui-native.",
    },
    messages: {
      rawControl:
        "`{{name}}` is a raw React Native control. Draw it with a `@repo/ui-native` component, or add the component or variant to `@repo/ui-native`.",
      pressEvent:
        "`{{event}}` on `<{{tag}}>` hears a press outside `@repo/ui-native`. Give the press a home in `@repo/ui-native`: an existing component's prop, or a new component named for what it does.",
      wrappedImport:
        "`{{source}}` is imported only by `@repo/ui-native`, which wraps it. Draw with that package's components, or add the piece you need to it.",
    },
  },
  createOnce(context) {
    let primitives = new Set<string>();
    let namespaces = new Set<string>();

    function reportControls(
      specifiers: readonly (ESTree.ImportSpecifier | ESTree.ExportSpecifier)[],
    ): void {
      for (const specifier of specifiers) {
        const name = moduleSideName(
          specifier.type === "ImportSpecifier" ? specifier.imported : specifier.local,
        );
        if (RAW_NATIVE_CONTROLS.has(name)) {
          context.report({ node: specifier, messageId: "rawControl", data: { name } });
        }
      }
    }

    return {
      before() {
        if (!isOutsideUiNative(context.filename)) return false;
        primitives = new Set();
        namespaces = new Set();
        return true;
      },
      ImportDeclaration(node) {
        const source = node.source.value;
        if (isWrappedModule(source)) {
          context.report({ node: node.source, messageId: "wrappedImport", data: { source } });
          return;
        }
        if (source !== REACT_NATIVE_MODULE) return;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportSpecifier") primitives.add(specifier.local.name);
          else namespaces.add(specifier.local.name);
        }
        reportControls(
          node.specifiers.filter(
            (specifier): specifier is ESTree.ImportSpecifier =>
              specifier.type === "ImportSpecifier",
          ),
        );
      },
      ExportNamedDeclaration(node) {
        if (node.source === null) return;
        const source = node.source.value;
        if (isWrappedModule(source)) {
          context.report({ node: node.source, messageId: "wrappedImport", data: { source } });
        } else if (source === REACT_NATIVE_MODULE) {
          reportControls(node.specifiers);
        }
      },
      ExportAllDeclaration(node) {
        const source = node.source.value;
        if (isWrappedModule(source)) {
          context.report({ node: node.source, messageId: "wrappedImport", data: { source } });
        }
      },
      JSXOpeningElement(node) {
        const root = tagRoot(node.name);
        if (root === undefined) return;
        const fromNamespace = namespaces.has(root);
        if (!primitives.has(root) && !fromNamespace) return;
        const member = tagMember(node.name);
        if (fromNamespace && member !== undefined && RAW_NATIVE_CONTROLS.has(member)) {
          context.report({ node: node.name, messageId: "rawControl", data: { name: member } });
        }
        const tag = fromNamespace && member !== undefined ? `${root}.${member}` : root;
        for (const attribute of node.attributes) {
          if (attribute.type !== "JSXAttribute") continue;
          const event = attributeName(attribute);
          if (!NATIVE_PRESS_EVENTS.has(event)) continue;
          context.report({ node: attribute, messageId: "pressEvent", data: { event, tag } });
        }
      },
    };
  },
});
