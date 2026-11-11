import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

/** The tag a screen of the iOS app draws its content in: `@repo/ui-native`'s SwiftUI host. */
const SCREEN_TAG = "Screen";

/** A component presented over a screen from a host of its own, by its name's end: `ConfirmAsk`, `StatusQuestionAsk`, `RenameAsk`, `RemindSheet`. */
const PRESENTED_TAG = /(?:Ask|Sheet)$/u;

/** A presented element held in a name, a member read off a hook (`remind.sheet`, `sidebar.ask`) or a variable (`archiveAsk`, `sheet`), by the name's end; `task` and `basket` are not. */
const PRESENTED_NAME = /^(?:ask|sheet)$|[a-z0-9](?:Ask|Sheet)$/u;

/** The name a JSX tag is written with, where it is a plain identifier. */
function tagName(name: ESTree.JSXElementName): string | undefined {
  return name.type === "JSXIdentifier" ? name.name : undefined;
}

/** The member an expression reads, `sheet` in `remind.sheet`, where it reads one by name. */
function memberName(expression: ESTree.MemberExpression): string | undefined {
  if (expression.computed) return undefined;
  return expression.property.type === "Identifier" ? expression.property.name : undefined;
}

/**
 * An alert or a sheet a screen of the iOS app presents (`ConfirmAsk`,
 * `RemindSheet`, and every ask built on them) stands in a SwiftUI host of
 * its own, so it is drawn beside the screen's `Screen`, never among its
 * children. Note that one drawn inside `Screen`'s own host left the screen
 * taking no press and no key at all: the Tasks list, the task page, and
 * Search, until it moved out. The rule reads the JSX a `Screen` holds and
 * the values it is built from: its elements' props, spreads among them, and
 * the arrays, objects, and call arguments in them. Where it cannot follow a
 * value, a variable or a member, it reads the name the value is held in. A
 * component that draws an ask inside itself is not seen here.
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
          // Note that a prop's elements, a split view's `detail` or a spread of its columns among them, draw inside the host as its children do.
          for (const attribute of node.openingElement.attributes) {
            if (attribute.type === "JSXSpreadAttribute") reportWithin(attribute.argument);
            else if (attribute.value?.type === "JSXExpressionContainer")
              reportWithin(attribute.value);
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
        case "ArrayExpression":
          for (const element of node.elements) {
            if (element !== null) reportWithin(element);
          }
          return;
        case "ObjectExpression":
          for (const property of node.properties) {
            reportWithin(property.type === "Property" ? property.value : property);
          }
          return;
        case "CallExpression":
          for (const argument of node.arguments) reportWithin(argument);
          return;
        case "SpreadElement":
          reportWithin(node.argument);
          return;
        case "ConditionalExpression":
          reportWithin(node.consequent);
          reportWithin(node.alternate);
          return;
        case "LogicalExpression":
          reportWithin(node.right);
          return;
        case "ChainExpression":
        case "ParenthesizedExpression":
        case "TSAsExpression":
        case "TSSatisfiesExpression":
        case "TSNonNullExpression":
          reportWithin(node.expression);
          return;
        case "MemberExpression": {
          const name = memberName(node);
          if (name !== undefined && PRESENTED_NAME.test(name)) {
            context.report({ node, messageId: "insideScreen", data: { name: `.${name}` } });
          }
          return;
        }
        case "Identifier":
          if (PRESENTED_NAME.test(node.name)) {
            context.report({ node, messageId: "insideScreen", data: { name: node.name } });
          }
          return;
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
