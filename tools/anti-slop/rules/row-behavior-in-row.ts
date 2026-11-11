import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import { attributeName } from "../shared/jsx.ts";
import { JSX_SOURCE } from "../shared/press-guard.ts";
import { repositoryPathOf } from "../shared/repository-path.ts";
import {
  GUARDED_ROWS,
  isRowModule,
  isTestFile,
  ROW_DRAWERS,
} from "../shared/row-behavior-guard.ts";

/**
 * What a row does lives in its row component, never in the page that draws
 * it: a shared row's menu, its rename, its selection, and its muted and
 * unread states are built inside the one component every list of that kind
 * draws, so a list that draws the row gets all of it. Outside the row
 * components `row-behavior.json` names, passing a guarded row
 * (`@repo/ui`'s `TaskRow`, `TaskListRow`, `AgentListRow`) one of its
 * behavior props is refused, and so is a spread onto one, which may carry
 * one the rule cannot read.
 */

/** The name a guarded row is exported under, where the element draws one through this file's imports. */
function rowOf(
  name: ESTree.JSXElementName,
  rows: ReadonlyMap<string, string>,
  namespaces: ReadonlyMap<string, string>,
): string | undefined {
  if (name.type === "JSXIdentifier") return rows.get(name.name);
  if (name.type !== "JSXMemberExpression" || name.object.type !== "JSXIdentifier") return undefined;
  const source = namespaces.get(name.object.name);
  const row = GUARDED_ROWS.get(name.property.name);
  return source !== undefined && row !== undefined && isRowModule(source, row.from)
    ? name.property.name
    : undefined;
}

export const rowBehaviorInRowRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a shared row's menu, rename, selection, and muted and unread states to be built inside its row component, never handed in by the page that draws it.",
    },
    messages: {
      behaviorOutsideRow:
        "`{{prop}}` is handed to `<{{row}}>` outside its row component, so every other list drawing it goes without. Build it inside the row component every list of its kind draws (`TaskListRow`, `AgentListRow`); a new row component goes in `tools/anti-slop/row-behavior.json` with its reason.",
      spreadOntoRow:
        "A spread onto `<{{row}}>` outside its row component may hand it a menu, a rename, a selection, or a muted or unread state. Pass its props by name, and build that behavior inside the row component.",
    },
  },
  createOnce(context) {
    // Note that each maps a local name to what it was imported as, so an alias is no way around the rule.
    let rows = new Map<string, string>();
    let namespaces = new Map<string, string>();

    return {
      before() {
        const file = repositoryPathOf(context.filename);
        if (!JSX_SOURCE.test(file) || ROW_DRAWERS[file] !== undefined || isTestFile(file)) {
          return false;
        }
        rows = new Map();
        namespaces = new Map();
        return true;
      },
      ImportDeclaration(node) {
        const source = node.source.value;
        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") {
            namespaces.set(specifier.local.name, source);
            continue;
          }
          if (specifier.type !== "ImportSpecifier") continue;
          const imported =
            specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : String(specifier.imported.value);
          const row = GUARDED_ROWS.get(imported);
          if (row !== undefined && isRowModule(source, row.from)) {
            rows.set(specifier.local.name, imported);
          }
        }
      },
      JSXOpeningElement(node) {
        const row = rowOf(node.name, rows, namespaces);
        if (row === undefined) return;
        const behavior = GUARDED_ROWS.get(row)?.behavior;
        for (const attribute of node.attributes) {
          if (attribute.type === "JSXSpreadAttribute") {
            context.report({ node: attribute, messageId: "spreadOntoRow", data: { row } });
            continue;
          }
          const prop = attributeName(attribute);
          if (behavior?.has(prop) !== true) continue;
          context.report({ node: attribute, messageId: "behaviorOutsideRow", data: { prop, row } });
        }
      },
    };
  },
});
