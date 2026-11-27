import { defineRule } from "@oxlint/plugins";

import { repositoryPathOf, TYPESCRIPT_SOURCE } from "../shared/repository-path.ts";

/** The anchors' own name (`@repo/ui/virtual-rows`). */
const ANCHORS = "VIRTUAL_ROWS_ANCHOR";

/** The files that may anchor a run to its end: the log, and the run itself with its tests. */
const ALLOWED = [
  "packages/ui/src/components/conversation/conversation.tsx",
  "packages/ui/src/components/virtual-rows/",
] as const;

/**
 * A run of rows anchored to its end (`VIRTUAL_ROWS_ANCHOR.END`) is a log,
 * and a log keeps to its end through `@repo/ui/conversation`, whose end
 * anchor (`@repo/ui/end-anchor`) is the one thing that decides whether it
 * does. A list anchoring a run to its end of its own would keep to its end
 * by none of it: opening short of its newest line, or pulling a reader who
 * scrolled up back down. So outside the log, and the run and its tests, the
 * end anchor is refused; draw the lines in `ConversationRows` instead.
 */
export const endAnchoredRunInConversationRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow anchoring a VirtualRows run to its end outside @repo/ui/conversation.",
    },
    messages: {
      endAnchor:
        "A run anchored to its end is a log: draw it through `@repo/ui/conversation`'s `ConversationRows`, which keeps it at its end until the reader scrolls away (`@repo/ui/end-anchor`).",
    },
  },
  createOnce(context) {
    // The names the file reads the anchors by: their own, and any it imported them under.
    let anchors = new Set<string>();

    return {
      before() {
        const file = repositoryPathOf(context.filename);
        anchors = new Set([ANCHORS]);
        return TYPESCRIPT_SOURCE.test(file) && !ALLOWED.some((allowed) => file.startsWith(allowed));
      },
      ImportSpecifier(node) {
        const { imported, local } = node;
        const name = imported.type === "Identifier" ? imported.name : imported.value;
        if (name === ANCHORS) anchors.add(local.name);
      },
      MemberExpression(node) {
        const { object, property } = node;
        if (object.type !== "Identifier" || !anchors.has(object.name)) return;
        const named =
          property.type === "Identifier" && !node.computed
            ? property.name
            : property.type === "Literal"
              ? property.value
              : undefined;
        if (named === "END") context.report({ node, messageId: "endAnchor" });
      },
    };
  },
});
