import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import {
  ARCHIVE_ALLOWED,
  ARCHIVE_COLUMNS,
  ARCHIVE_WRITERS,
  isStoreModule,
  isTestFile,
  WRITE_METHODS,
} from "../shared/archive-write-guard.ts";
import { repositoryPathOf, TYPESCRIPT_SOURCE } from "../shared/repository-path.ts";

/**
 * Every archive of an agent, and every bring-back, goes through
 * `agents/agent-change.ts`, so what follows one happens on every path.
 * Outside the files `archive-writes.json` allows, importing one of the
 * store's archive writers is refused, and so is a Drizzle `.set()` or
 * `.values()` that writes the agent table's `archivedAt` or `archivedBy`.
 */

/** The name a property is keyed by, where the key is written out. */
function keyName(property: ESTree.ObjectExpression["properties"][number]): string | undefined {
  if (property.type !== "Property" || property.computed) return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal" && typeof property.key.value === "string") {
    return property.key.value;
  }
  return undefined;
}

export const archiveThroughAgentChangeRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require every archive of an agent, and every bring-back, to go through agents/agent-change.ts.",
    },
    messages: {
      writerOutside:
        "`{{writer}}` archives an agent or brings one back outside agents/agent-change.ts, so what follows an archive is skipped here. Call agent-change.ts instead; a file that must call the store itself goes in `tools/oxlint/vespin/archive-writes.json` with its reason.",
      columnOutside:
        "This writes the agent's `{{column}}` outside agents/agent-change.ts and the store's archive writes, so what follows an archive is skipped here. Call agent-change.ts instead; a file that must write it goes in `tools/oxlint/vespin/archive-writes.json` with its reason.",
    },
  },
  createOnce(context) {
    return {
      before() {
        const file = repositoryPathOf(context.filename);
        return (
          TYPESCRIPT_SOURCE.test(file) && ARCHIVE_ALLOWED[file] === undefined && !isTestFile(file)
        );
      },
      ImportDeclaration(node) {
        const source = node.source.value;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const writer =
            specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : String(specifier.imported.value);
          const store = ARCHIVE_WRITERS.get(writer);
          if (store === undefined || !isStoreModule(source, store)) continue;
          context.report({ node: specifier, messageId: "writerOutside", data: { writer } });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") return;
        if (!WRITE_METHODS.has(callee.property.name)) return;
        const written = node.arguments[0];
        if (written?.type !== "ObjectExpression") return;
        for (const property of written.properties) {
          const column = keyName(property);
          if (column === undefined || !ARCHIVE_COLUMNS.has(column)) continue;
          context.report({ node: property, messageId: "columnOutside", data: { column } });
        }
      },
    };
  },
});
