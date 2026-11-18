import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { baselineProblems } from "../shared/baseline.ts";
import { isWatchedSource } from "../shared/host-read-guard.ts";
import { repositoryPathOf } from "../shared/repository-path.ts";
import {
  ACT_SENDERS,
  holdsMutation,
  isPortCaller,
  isWriteKind,
  WRITE_MUTATION_BASELINE,
} from "../shared/write-mutation-guard.ts";

/**
 * A write the reader makes is drawn the moment it is asked, so a surface
 * sends it as a TanStack mutation (`act-mutations.ts`'s `actMutation` or
 * `pressMutation`, or `mutationOptions` of its own) and draws what the
 * mutation's `variables` ask for while it `isPending`. A write sent bare
 * holds nothing to draw, so the surface draws the stored value until the
 * answer lands, and the old value flashes back between the press and the
 * answer. In the panel's and the design system's own code, a port sender
 * (`askAct`, `tellAct`, `pressAct`, `sendAct`) handed a kind `@repo/host`'s
 * `PORT_ACT_USE` declares a WRITE stands only inside the arguments of a
 * mutation's call (`mutationOptions`, `useMutation`, or a factory named for
 * a mutation), outside the port's own callers (`act.ts`,
 * `act-mutations.ts`), from a baseline of the files that still send one bare
 * (`write-mutation-baseline.json`), which only shrinks. A kind named but not
 * sent, as a mutation's key, a failure's facts, or a write's declaration,
 * sends nothing, so the rule leaves it be.
 */

/** The write kind a sender's call sends, as `askAct(ACT_KIND.TASKS_RENAME, …)`, where it spells one off an act kinds' table. */
function writeSent(node: ESTree.CallExpression): string | undefined {
  const { callee } = node;
  const [kind] = node.arguments;

  if (callee.type !== "Identifier" || !ACT_SENDERS.has(callee.name)) return undefined;

  if (kind?.type !== "MemberExpression" || kind.computed) return undefined;
  const { object, property } = kind;

  if (object.type !== "Identifier" || !object.name.endsWith("ACT_KIND")) return undefined;

  if (property.type !== "Identifier" || !isWriteKind(property.name)) return undefined;

  return property.name;
}

/** Whether `node` stands inside the arguments of a call that holds a mutation. */
function insideMutation(node: ESTree.Node): boolean {
  let child: ESTree.Node = node;

  for (let parent = child.parent; parent !== undefined && parent !== null; parent = parent.parent) {
    if (
      parent.type === "CallExpression" &&
      parent.callee.type === "Identifier" &&
      holdsMutation(parent.callee.name) &&
      parent.arguments.some((argument) => argument === child)
    ) {
      return true;
    }
    child = parent;
  }

  return false;
}

export const writeThroughMutationRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow sending a write act outside a TanStack mutation in the panel and the design system, from a baseline that only shrinks.",
    },
    messages: {
      bareWrite:
        "`{{kind}}` is a write sent outside a mutation, so the surface holds no pending `variables` to draw and shows the stored value until the answer lands, flashing the old one back. Send it through `useMutation(actMutation(ACT_KIND.{{kind}}))` or `pressMutation` (`packages/panel/src/act-mutations.ts`) and draw `variables` while it `isPending`. This file's bare writes are more than the baseline holds.",
      staleBaseline:
        "This file sends {{found}} write(s) outside a mutation, fewer than `tools/oxlint/vespin/write-mutation-baseline.json` allows ({{expected}}). Lower its count to {{found}}, or delete the row at 0.",
    },
  },
  createOnce(context) {
    let file = "";
    let writes: { node: ESTree.Node; kind: string }[] = [];
    let expected = 0;

    return {
      before() {
        file = repositoryPathOf(context.filename);

        if (!isWatchedSource(file) || isPortCaller(file)) return false;
        writes = [];
        expected = WRITE_MUTATION_BASELINE[file] ?? 0;

        return true;
      },
      CallExpression(node) {
        const kind = writeSent(node);

        if (kind === undefined || insideMutation(node)) return;
        writes.push({ node, kind });
      },
      "Program:exit"(program) {
        const counts = new Map([[file, writes.length]]);
        const baseline = expected === 0 ? {} : { [file]: expected };

        for (const problem of baselineProblems(counts, baseline, true)) {
          if (problem.grew) {
            // Note that the writes past the baseline's count are the ones reported, since the ones before it were already there.
            for (const { node, kind } of writes.slice(expected)) {
              context.report({ node, messageId: "bareWrite", data: { kind } });
            }
          } else {
            context.report({
              node: program,
              messageId: "staleBaseline",
              data: { found: String(writes.length), expected: String(expected) },
            });
          }
        }
      },
    };
  },
});
