import { defineRule } from "@oxlint/plugins";
import {
  isWindowedSource,
  LIVE_QUERY_HOOK,
  LIVE_QUERY_MODULE,
} from "../shared/live-query-guard.ts";
import { repositoryPathOf, TYPESCRIPT_SOURCE } from "../shared/repository-path.ts";

/**
 * Every read of a window of rows in the iOS app goes through `useWindow`,
 * which answers a read state, so no screen draws an empty list or a missing
 * row while its read is still loading. An import of `useLiveQuery` is refused
 * in the app's and its design system's sources but for `use-window.ts`.
 */
export const liveQueryThroughWindowRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow useLiveQuery in the iOS app outside useWindow, which answers a read state.",
    },
    messages: {
      direct:
        "Read the window through `useWindow` (`apps/mobile/src/host/use-window.ts`), which answers a read state, so no screen says a list is empty, or a row missing, while its read is still loading.",
    },
  },
  createOnce(context) {
    return {
      before() {
        const file = repositoryPathOf(context.filename);

        return TYPESCRIPT_SOURCE.test(file) && isWindowedSource(file);
      },
      ImportDeclaration(node) {
        if (node.source.value !== LIVE_QUERY_MODULE) return;

        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const imported = specifier.imported;
          const name = imported.type === "Identifier" ? imported.name : imported.value;

          if (name === LIVE_QUERY_HOOK) context.report({ node: specifier, messageId: "direct" });
        }
      },
    };
  },
});
