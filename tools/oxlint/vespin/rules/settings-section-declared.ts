import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { isTestFile } from "../shared/busy-guard.ts";
import { attributeName } from "../shared/jsx.ts";
import { JSX_SOURCE } from "../shared/press-guard.ts";
import { repositoryPathOf } from "../shared/repository-path.ts";
import {
  ANCHOR_PROP,
  HEAD_PROP,
  isSettingsPage,
  SECTION_HEAD,
  SETTINGS_SECTION,
} from "../shared/settings-section-guard.ts";

type Node = ESTree.Node;

/** Whether `node` is the head's call, or a choice between two heads' calls. */
function isHeadCall(node: Node): boolean {
  if (node.type === "ConditionalExpression") {
    return isHeadCall(node.consequent) && isHeadCall(node.alternate);
  }
  return (
    node.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === SECTION_HEAD
  );
}

/**
 * The rule: a Settings page draws a section's head, its title and the anchor
 * a search result lands on, only by spreading `settingsSectionHead`, which
 * reads the section's one declaration (`settings-sections.tsx`). That
 * declaration is what the settings search finds the section from, so a
 * section written on a page with a title of its own would be drawn and
 * never found, as all of Cloud environment once was.
 */
export const settingsSectionDeclaredRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a Settings page's section to take its title and anchor from its declaration in settings-sections.tsx, which the settings search reads.",
    },
    messages: {
      ownHead:
        "`<SettingsSection title>` writes its own head, which the settings search never reads. Declare the section in settings/settings-sections.tsx and spread `settingsSectionHead(SECTION.…)` instead.",
      otherSpread:
        "A spread onto `<SettingsSection>` may carry a head the settings search never reads. Spread `settingsSectionHead(SECTION.…)` alone.",
      ownAnchor:
        "`<SettingsSection anchor>` beside `settingsSectionHead` overrides the anchor the settings search lands on. Leave the anchor to the section's declaration in settings/settings-sections.tsx.",
    },
  },
  createOnce(context) {
    // Note that the section is known by every name the file imports it under, so an alias draws no section the rule skips.
    const names = new Set<string>();

    return {
      before() {
        const file = repositoryPathOf(context.filename);
        names.clear();
        names.add(SETTINGS_SECTION);
        return JSX_SOURCE.test(file) && !isTestFile(file) && isSettingsPage(context.filename);
      },
      ImportSpecifier(node) {
        const imported =
          node.imported.type === "Identifier" ? node.imported.name : node.imported.value;

        if (imported === SETTINGS_SECTION) names.add(node.local.name);
      },
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || !names.has(node.name.name)) return;

        const headed = node.attributes.some(
          (attribute) => attribute.type === "JSXSpreadAttribute" && isHeadCall(attribute.argument),
        );

        for (const attribute of node.attributes) {
          if (attribute.type === "JSXSpreadAttribute") {
            if (!isHeadCall(attribute.argument)) {
              context.report({ node: attribute, messageId: "otherSpread" });
            }
            continue;
          }
          const name = attributeName(attribute);

          if (name === HEAD_PROP) context.report({ node: attribute, messageId: "ownHead" });
          if (headed && name === ANCHOR_PROP) {
            context.report({ node: attribute, messageId: "ownAnchor" });
          }
        }
      },
    };
  },
});
