import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

/** The tag a screen of the iOS app draws its content in: `@repo/ui-native`'s SwiftUI host. */
const SCREEN_TAG = "Screen";

/** A component presented over a screen from a host of its own, by its name's end: `ConfirmAsk`, `StatusQuestionAsk`, `RenameAsk`, `RemindSheet`. */
const PRESENTED_TAG = /(?:Ask|Sheet)$/u;

/** A presented element a hook hands its screen, by the member it is read off: `remind.sheet`, `sidebar.ask`. */
const PRESENTED_MEMBERS = new Set(["ask", "sheet"]);

/** The name a JSX tag is written with, where it is a plain identifier. */
function tagName(name: ESTree.JSXElementName): string | undefined {
  return name.type === "JSXIdentifier" ? name.name : undefined;
}

/** The member an expression reads, `sheet` in `remind.sheet`, where it reads one by name. */
function memberName(expression: ESTree.Node): string | undefined {
  if (expression.type !== "MemberExpression" || expression.computed) return undefined;
  return expression.property.type === "Identifier" ? expression.property.name : undefined;
}

/**
 * An alert or a sheet a screen of the iOS app presents (`ConfirmAsk`,
 * `RemindSheet`, and every ask built on them) stands in a SwiftUI host of
 * its own, so it is drawn beside the screen's `Screen`, never among its
 * children. Note that one drawn inside `Screen`'s own host left the screen
 * taking no press and no key at all: the Tasks list, the task page, and
 * Search, until it moved out. A component that draws an ask inside itself
 * is not seen here; the rule reads only the JSX a `Screen` holds.
 */
export const askBesideScreenRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow an ask or a sheet with a host of its own inside the iOS app's Screen; draw it beside Screen.",
    },
    messages: {
      insideScreen:
        "`{{name}}` presents from a SwiftUI host of its own, and inside `<Screen>`'s host it stops the screen taking presses and keys. Draw it beside `<Screen>`, in the fragment the screen returns.",
    },
  },
  createOnce(context) {
    function reportWithin(node: ESTree.Node): void {
      switch (node.type) {
        case "JSXElement": {
          const name = tagName(node.openingElement.name);
          if (name !== undefined && PRESENTED_TAG.test(name)) {
            context.report({
              node: node.openingElement.name,
              messageId: "insideScreen",
              data: { name },
            });
          }
          for (const child of node.children) reportWithin(child);
          return;
        }
        case "JSXFragment":
          for (const child of node.children) reportWithin(child);
          return;
        case "JSXExpressionContainer":
          if (node.expression.type !== "JSXEmptyExpression") reportWithin(node.expression);
          return;
        case "ConditionalExpression":
          reportWithin(node.consequent);
          reportWithin(node.alternate);
          return;
        case "LogicalExpression":
          reportWithin(node.right);
          return;
        case "MemberExpression": {
          const name = memberName(node);
          if (name !== undefined && PRESENTED_MEMBERS.has(name)) {
            context.report({ node, messageId: "insideScreen", data: { name: `.${name}` } });
          }
          return;
        }
        default:
          return;
      }
    }
    return {
      JSXElement(node) {
        if (tagName(node.openingElement.name) !== SCREEN_TAG) return;
        for (const child of node.children) reportWithin(child);
      },
    };
  },
});
