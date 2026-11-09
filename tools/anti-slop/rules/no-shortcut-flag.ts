import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { calleeName } from "../shared/jsx.ts";
import { SUBJECT_ARGUMENT } from "../shared/shortcut-flag-guard.ts";

type Node = ESTree.Node;

/** The operators whose answer is a boolean. */
const BOOLEAN_OPERATORS: ReadonlySet<string> = new Set([
  "==",
  "!=",
  "===",
  "!==",
  "<",
  "<=",
  ">",
  ">=",
  "in",
  "instanceof",
]);

/** Whether `node` names nothing: `undefined`, `null`, or `void` of anything. */
function namesNothing(node: Node): boolean {
  if (node.type === "Identifier") return node.name === "undefined";
  if (node.type === "Literal") return node.value === null;
  return node.type === "UnaryExpression" && node.operator === "void";
}

/**
 * Whether `node`, where a builder takes the menu's subject, is a flag: a
 * literal `true` or `false`, a negation, a comparison, `&&` or `||`, or a
 * condition choosing between the subject and nothing, as `keyed ? subject :
 * undefined` decides by hand whether the menu prints its keys.
 */
function isFlag(node: Node): boolean {
  switch (node.type) {
    case "Literal":
      return typeof node.value === "boolean";
    case "UnaryExpression":
      return node.operator === "!";
    case "BinaryExpression":
      return BOOLEAN_OPERATORS.has(node.operator);
    case "LogicalExpression":
      return node.operator === "&&" || node.operator === "||";
    case "ConditionalExpression":
      return (
        namesNothing(node.consequent) ||
        namesNothing(node.alternate) ||
        isFlag(node.consequent) ||
        isFlag(node.alternate)
      );
    default:
      return false;
  }
}

/**
 * The rule: where `commandAction` and its siblings take the menu's subject,
 * they take the subject, never a flag. Whether a menu item prints its key is
 * the shortcut target's to say (`shortcut-target.ts`): the key prints where
 * the place offering it says it acts on the subject. A caller that passes
 * `true`, `false`, or a condition of its own decides it by hand again, which
 * is what the subject replaced. The rule started clean, so it takes no
 * baseline.
 */
export const noShortcutFlagRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow a boolean where a menu-item builder takes the menu's subject; the shortcut target decides whether its key prints.",
    },
    messages: {
      flag: "`{{name}}` takes the menu's subject, not a flag. Pass what the menu acts on (`shortcutSubject`), or `undefined` where no key reaches it; the shortcut target says whether its key prints (`packages/panel/src/shortcut-target.ts`).",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const name = calleeName(node.callee);
        if (name === undefined) return;
        const at = SUBJECT_ARGUMENT.get(name);
        const argument = at === undefined ? undefined : node.arguments[at];
        if (argument === undefined || argument.type === "SpreadElement") return;
        if (isFlag(argument)) context.report({ node: argument, messageId: "flag", data: { name } });
      },
    };
  },
});
