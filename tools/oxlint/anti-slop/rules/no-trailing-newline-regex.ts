import { defineRule } from "@oxlint/plugins";

/** A regex that matches a run of newlines anchored at the input's end, such as `/\n+$/`, whose backtracking is quadratic in a long run of them. */
const TRAILING_NEWLINES_PATTERN = /^\\n[*+]\$$/u;

/** Ban a regex literal that trims trailing newlines, which CodeQL flags as polynomial on uncontrolled input; `withoutTrailingNewlines` counts them off in linear time. */
export const noTrailingNewlineRegexRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow `/\\n+$/` and `/\\n*$/`; use `withoutTrailingNewlines` from `@repo/features/trailing-newlines`.",
    },
    messages: {
      trailingNewlineRegex:
        "Replace this end-anchored newline pattern with `withoutTrailingNewlines` from `@repo/features/trailing-newlines`, which runs in linear time on any input.",
    },
  },
  createOnce(context) {
    return {
      Literal(node) {
        if (!("regex" in node) || node.regex === undefined || node.regex === null) return;

        if (TRAILING_NEWLINES_PATTERN.test(node.regex.pattern)) {
          context.report({ node, messageId: "trailingNewlineRegex" });
        }
      },
    };
  },
});
