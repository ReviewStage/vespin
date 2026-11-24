import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import {
  ENTITY_GLYPH,
  ENTITY_GLYPH_TABLES,
  isMobileSource,
} from "../shared/entity-choice-guard.ts";

/** A property's name where it is written plainly, as `symbol` or `"symbol"`. */
function keyName(property: ESTree.ObjectProperty): string | undefined {
  if (property.computed) return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal" && typeof property.key.value === "string") {
    return property.key.value;
  }
  return undefined;
}

/** The entity glyph a value names, as the message words it: `STATUS_MARK_SYMBOL[…]` or `GLYPH.PERSON`; none for any other glyph. */
function entityGlyph(value: ESTree.Expression): string | undefined {
  if (value.type !== "MemberExpression" || value.object.type !== "Identifier") return undefined;
  const table = value.object.name;

  if (value.computed) return ENTITY_GLYPH_TABLES.has(table) ? `${table}[…]` : undefined;
  if (table !== "GLYPH" || value.property.type !== "Identifier") return undefined;

  return ENTITY_GLYPH.test(value.property.name) ? `GLYPH.${value.property.name}` : undefined;
}

/** Whether an object literal is a menu's choice: it says whether it is on, or takes its press from a spread, as a helper's choices do. */
function isChoice(node: ESTree.ObjectExpression): boolean {
  return node.properties.some(
    (property) =>
      property.type === "SpreadElement" ||
      (property.type === "Property" && keyName(property) === "on"),
  );
}

/**
 * In the iOS app, a menu's choice for an entity (a task's status, its
 * priority, a person, no one) is built by `@repo/ui-native`'s helpers,
 * which carry the entity's own mark every menu draws, never as a choice
 * holding the entity's bare glyph as its `symbol`, which every menu draws as
 * a gray template, as the iPhone's View options did.
 */
export const entityChoiceThroughHelperRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require an iOS menu choice for a status, priority, or person to come from @repo/ui-native's entity choice helpers.",
    },
    messages: {
      bareEntityGlyph:
        "A choice led by `{{glyph}}` draws the entity as a bare gray glyph. Build it with `@repo/ui-native`'s `statusChoice`, `priorityChoice`, `personChoice`, `unassignedChoice`, or `taskChoice`, which carry the mark its rows draw, or add a helper there for a new kind.",
    },
  },
  createOnce(context) {
    return {
      before() {
        return isMobileSource(context.filename);
      },
      ObjectExpression(node) {
        if (!isChoice(node)) return;

        for (const property of node.properties) {
          if (property.type !== "Property" || keyName(property) !== "symbol") continue;
          const glyph = entityGlyph(property.value);

          if (glyph !== undefined) {
            context.report({ node: property, messageId: "bareEntityGlyph", data: { glyph } });
          }
        }
      },
    };
  },
});
