import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isTestFile } from "../shared/busy-guard.ts";
import { repositoryPathOf } from "../shared/effect-edges.ts";
import { attributeName, isNode } from "../shared/jsx.ts";
import { JSX_SOURCE } from "../shared/press-guard.ts";
import {
  END_PRESSES,
  MENU_ROW,
  MENU_ROW_CONTROLS,
  SETTINGS_ROW,
} from "../shared/settings-row-end-guard.ts";

type Node = ESTree.Node;

/** The name a JSX element is written with, where it is a plain one. */
function tagOf(element: ESTree.JSXOpeningElement): string | undefined {
  return element.name.type === "JSXIdentifier" ? element.name.name : undefined;
}

/** Every opening element under `node` that draws a press standing in a row's end. */
function endPressesIn(node: Node, found: ESTree.JSXOpeningElement[]): void {
  if (node.type === "JSXOpeningElement") {
    const tag = tagOf(node);
    if (tag !== undefined && END_PRESSES.has(tag)) found.push(node);
  }
  for (const [key, child] of Object.entries(node)) {
    if (key === "parent") continue;
    const children = Array.isArray(child) ? child : [child];
    for (const each of children) {
      if (isNode(each)) endPressesIn(each, found);
    }
  }
}

/** What a `MenuRow`'s `row` prop holds as its controls, where it is written in place. */
function menuRowControls(element: ESTree.JSXOpeningElement): readonly Node[] {
  const row = element.attributes.find(
    (attribute): attribute is ESTree.JSXAttribute =>
      attribute.type === "JSXAttribute" && attributeName(attribute) === "row",
  );
  const value = row?.value;
  if (value?.type !== "JSXExpressionContainer" || value.expression.type !== "ObjectExpression") {
    return [];
  }
  return value.expression.properties.flatMap((property) =>
    property.type === "Property" &&
    property.key.type === "Identifier" &&
    MENU_ROW_CONTROLS.has(property.key.name)
      ? [property.value]
      : [],
  );
}

/**
 * The rule: a settings row's ⋯, a fold's chevron, a dismiss, any press a
 * glyph wide, and the room of one, stand in the row's `end`, never among its
 * controls. A row's controls drop below its words where they would leave the
 * words too little room, as on a phone, while its end keeps to the name's
 * line in one column with every other row's; a glyph among the controls
 * drops with them and leaves its column. A press handed in under a name (a
 * fold's `chevron`) is no element the rule can read, so the fold components
 * hand theirs to the row's end themselves.
 */
export const settingsRowEndRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a settings row's glyph-wide presses (⋯, chevron, dismiss) to stand in its `end`, not among its controls.",
    },
    messages: {
      amongControls:
        "`<{{tag}}>` stands among `<{{row}}>`'s controls, which drop below the words on a narrow row and take it with them. Stand it in the row's `end` instead, which keeps to the name's line at any width.",
    },
  },
  createOnce(context) {
    let watched = false;

    function report(within: Node, row: string): void {
      const found: ESTree.JSXOpeningElement[] = [];
      endPressesIn(within, found);
      for (const press of found) {
        context.report({
          node: press.name,
          messageId: "amongControls",
          data: { tag: tagOf(press) ?? "IconButton", row },
        });
      }
    }

    return {
      before() {
        const file = repositoryPathOf(context.filename);
        watched = JSX_SOURCE.test(file) && !isTestFile(file);
        return watched;
      },
      JSXElement(node) {
        const tag = tagOf(node.openingElement);
        if (tag === SETTINGS_ROW) {
          for (const child of node.children) report(child, tag);
          return;
        }
        if (tag === MENU_ROW) {
          for (const controls of menuRowControls(node.openingElement)) report(controls, tag);
        }
      },
    };
  },
});
