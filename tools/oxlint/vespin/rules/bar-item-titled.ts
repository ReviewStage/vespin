import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import {
  BAR_ICON_CHILD,
  BAR_ITEM,
  BAR_LABEL_CHILD,
  BAR_NAMESPACE,
  ICON_PROP,
  MENU_TITLE_PROP,
} from "../shared/bar-item-guard.ts";
import { isMobileSource } from "../shared/entity-choice-guard.ts";
import { attributeName } from "../shared/jsx.ts";

/** The member of `Stack.Toolbar` a tag names, such as `Button` for `<Stack.Toolbar.Button>`; undefined for any other tag. */
function barMember(name: ESTree.JSXElementName): string | undefined {
  if (name.type !== "JSXMemberExpression") return undefined;
  const owner = name.object;
  if (owner.type !== "JSXMemberExpression") return undefined;
  if (owner.object.type !== "JSXIdentifier") return undefined;
  const [root, toolbar] = BAR_NAMESPACE;
  if (owner.object.name !== root || owner.property.name !== toolbar) return undefined;
  return name.property.name;
}

/** The elements an expression may draw: itself, or a branch of a condition. */
function drawnElements(expression: ESTree.Node): readonly ESTree.JSXElement[] {
  if (expression.type === "JSXElement") return [expression];
  if (expression.type === "ConditionalExpression") {
    return [...drawnElements(expression.consequent), ...drawnElements(expression.alternate)];
  }
  if (expression.type === "LogicalExpression") return drawnElements(expression.right);
  return [];
}

/** The `Stack.Toolbar` members an element's children stand as, those drawn on a condition among them. */
function childMembers(element: ESTree.JSXElement): ReadonlySet<string> {
  const members = new Set<string>();

  for (const child of element.children) {
    const drawn =
      child.type === "JSXElement"
        ? [child]
        : child.type === "JSXExpressionContainer" && child.expression.type !== "JSXEmptyExpression"
          ? drawnElements(child.expression)
          : [];
    for (const element of drawn) {
      const member = barMember(element.openingElement.name);
      if (member !== undefined) members.add(member);
    }
  }

  return members;
}

/** Whether an expression can only be markup or nothing, such as a glyph drawn on a condition, rather than words. */
function isMarkup(expression: ESTree.Node): boolean {
  if (expression.type === "JSXElement" || expression.type === "JSXFragment") return true;
  if (expression.type === "Literal") return expression.value === null;
  if (expression.type === "ConditionalExpression") {
    return isMarkup(expression.consequent) && isMarkup(expression.alternate);
  }
  if (expression.type === "LogicalExpression") return isMarkup(expression.right);
  return false;
}

/** Whether an element's children hold words of their own: text, or an expression that may be words. */
function holdsWords(element: ESTree.JSXElement): boolean {
  return element.children.some(
    (child) =>
      (child.type === "JSXText" && child.value.trim() !== "") ||
      (child.type === "JSXExpressionContainer" &&
        child.expression.type !== "JSXEmptyExpression" &&
        !isMarkup(child.expression)),
  );
}

/** Whether an element hands a prop by name. */
function hasProp(element: ESTree.JSXElement, prop: string): boolean {
  return element.openingElement.attributes.some(
    (attribute) => attribute.type === "JSXAttribute" && attributeName(attribute) === prop,
  );
}

/**
 * In the iOS app, a stack bar item that stands a glyph carries its words as
 * its title too: a `Stack.Toolbar.Button` holds them as its children (or a
 * `Stack.Toolbar.Label`), and a `Stack.Toolbar.Menu` as a
 * `Stack.Toolbar.Label` (or its `title`, which heads the menu as well). The
 * bar draws the glyph alone, but where it has no room, as beside an iPad's
 * tab bar, iOS folds its items into the bar's ⋯, which names each by its
 * title, so one with only an `accessibilityLabel` stood there as a bare
 * glyph. Note that a wrapper component cannot carry this for the screens,
 * because expo-router reads a toolbar's children by their own element types.
 */
export const barItemTitledRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a stack bar item that stands a glyph to carry its words as its title, which the bar's overflow names it by.",
    },
    messages: {
      untitledButton:
        "This `Stack.Toolbar.Button` stands a glyph with no title, so the bar's ⋯ names it by nothing where the bar folds it away. Hand its words as its children, or in a `Stack.Toolbar.Label` beside a `Stack.Toolbar.Icon`.",
      untitledMenu:
        "This `Stack.Toolbar.Menu` stands a glyph with no title, so the bar's ⋯ names it by nothing where the bar folds it away. Hand its words in a `<Stack.Toolbar.Label>` among its children.",
    },
  },
  createOnce(context) {
    return {
      before() {
        return isMobileSource(context.filename);
      },
      JSXElement(node) {
        const member = barMember(node.openingElement.name);
        if (member !== BAR_ITEM.BUTTON && member !== BAR_ITEM.MENU) return;
        const children = childMembers(node);
        const glyphed = hasProp(node, ICON_PROP) || children.has(BAR_ICON_CHILD);
        if (!glyphed || children.has(BAR_LABEL_CHILD)) return;

        if (member === BAR_ITEM.BUTTON && !holdsWords(node)) {
          context.report({ node: node.openingElement, messageId: "untitledButton" });
        } else if (member === BAR_ITEM.MENU && !hasProp(node, MENU_TITLE_PROP)) {
          context.report({ node: node.openingElement, messageId: "untitledMenu" });
        }
      },
    };
  },
});
