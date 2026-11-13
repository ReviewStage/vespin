import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import { attributeName, calleeName } from "../shared/jsx.ts";
import {
  PRESS_SHAPE_MODIFIER,
  SWIFT_UI_MODULE,
  SWIFT_UI_PRESSABLES,
} from "../shared/press-shape-guard.ts";

/** The calls an attribute's array holds, each element whether spread or not. */
function modifierCalls(value: ESTree.JSXAttribute["value"]): readonly ESTree.CallExpression[] {
  if (value?.type !== "JSXExpressionContainer") return [];
  const array = value.expression;
  if (array.type !== "ArrayExpression") return [];

  return array.elements.flatMap((element) =>
    element !== null && element.type === "CallExpression" ? [element] : [],
  );
}

/**
 * A SwiftUI `Button` or `Menu` from `@expo/ui` wears no `contentShape` in its
 * own modifiers. A plain or borderless button, and a menu, take a press only
 * where their label is hit, so a shape on the control widens nothing: the
 * Settings rows (#8437), the composer's denial line (#8934) and five more
 * pressables (#8935) each answered on their words alone. The shape, and the
 * frame it fills, stand on the label instead. A frame on the control stays
 * allowed, since a bordered button's circle is its press, as Send's is.
 */
export const pressShapeOnLabelRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow contentShape on an @expo/ui Button's or Menu's own modifiers, where it widens no press; put it on the label.",
    },
    messages: {
      shapeOnControl:
        "`contentShape` on `<{{tag}}>` widens no press: a SwiftUI button or menu takes a press only where its label is hit. Put the shape, and the frame it fills, on the label.",
    },
  },
  createOnce(context) {
    let pressables = new Set<string>();

    return {
      before() {
        pressables = new Set();
        return true;
      },
      ImportDeclaration(node) {
        if (node.source.value !== SWIFT_UI_MODULE) return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const imported =
            specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : String(specifier.imported.value);
          if (SWIFT_UI_PRESSABLES.has(imported)) pressables.add(specifier.local.name);
        }
      },
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || !pressables.has(node.name.name)) return;
        const tag = node.name.name;

        for (const attribute of node.attributes) {
          if (attribute.type !== "JSXAttribute" || attributeName(attribute) !== "modifiers")
            continue;
          for (const call of modifierCalls(attribute.value)) {
            if (calleeName(call.callee) !== PRESS_SHAPE_MODIFIER) continue;
            context.report({ node: call, messageId: "shapeOnControl", data: { tag } });
          }
        }
      },
    };
  },
});
