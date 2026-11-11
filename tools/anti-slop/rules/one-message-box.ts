import { defineRule } from "@oxlint/plugins";
import {
  BOX_BUILDERS,
  BOX_PARTS,
  isExemptFile,
  isPartModule,
} from "../shared/message-box-guard.ts";
import { repositoryPathOf, TYPESCRIPT_SOURCE } from "../shared/repository-path.ts";

/**
 * Every box words are written in is drawn on the one message box
 * (`packages/panel/src/tasks/message-box.tsx`): an agent's, a comment's, an
 * Inbox form's field, an automation's prompt. Outside the files
 * `message-box.json` names, importing a part a box is built from (the
 * composer's field, its `@` and `/` lists, the composer card, or
 * `@repo/ui`'s `ComposerBody` and `ComposerFoot`) is refused, by name or
 * through a namespace, so a new box cannot be put together by hand and go
 * without the files, dictation, lists, note, and narrow-card fold every box
 * takes.
 */
export const oneMessageBoxRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require every box words are written in to be drawn on the one message box, never put together from its parts.",
    },
    messages: {
      partOutsideBox:
        "`{{part}}` is a part of the message box. Draw the box with `useMessageBox` and `MessageBox` (or `MessageField` for a field alone) from `message-box.tsx`, adding a slot or an option there if it lacks one; a box that differs on purpose goes in `tools/anti-slop/message-box.json` with its reason.",
    },
  },
  createOnce(context) {
    // Note that a namespace's local name maps to its module, so `ui.ComposerFoot` is no way around the rule.
    let namespaces = new Map<string, string>();

    return {
      before() {
        const file = repositoryPathOf(context.filename);
        if (
          !TYPESCRIPT_SOURCE.test(file) ||
          BOX_BUILDERS[file] !== undefined ||
          isExemptFile(file)
        ) {
          return false;
        }
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
          const part =
            specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : String(specifier.imported.value);
          const from = BOX_PARTS.get(part);
          if (from === undefined || !isPartModule(source, from)) continue;
          context.report({ node: specifier, messageId: "partOutsideBox", data: { part } });
        }
      },
      MemberExpression(node) {
        if (node.computed || node.object.type !== "Identifier") return;
        if (node.property.type !== "Identifier") return;
        const source = namespaces.get(node.object.name);
        const from = BOX_PARTS.get(node.property.name);
        if (source === undefined || from === undefined || !isPartModule(source, from)) return;
        context.report({ node, messageId: "partOutsideBox", data: { part: node.property.name } });
      },
      JSXMemberExpression(node) {
        if (node.object.type !== "JSXIdentifier") return;
        const source = namespaces.get(node.object.name);
        const from = BOX_PARTS.get(node.property.name);
        if (source === undefined || from === undefined || !isPartModule(source, from)) return;
        context.report({ node, messageId: "partOutsideBox", data: { part: node.property.name } });
      },
    };
  },
});
