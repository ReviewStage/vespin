import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { repositoryPathOf, TYPESCRIPT_SOURCE } from "../shared/repository-path.ts";
import { DELETE_HELPERS, isExemptFile } from "../shared/sandbox-delete-guard.ts";

/**
 * An agent's sandbox is deleted in one place, `session-sandboxes.ts`, so
 * every delete goes through its ledger and its kill switch. Outside the
 * files `sandbox-deletes.json` names, calling `Sandbox`'s `delete` or
 * `deleteDrive`, or a helper that deletes a sandbox or a drive, is refused.
 * The rule reads names, not types: a `Sandbox` is what `yield* Sandbox`
 * answers, what a callback over it takes, or what is typed `SandboxService`,
 * and `deleteDrive` is `Sandbox`'s alone.
 */

const SANDBOX_MODULE = "@repo/sandbox";

/** The name a call's callee calls, where it is a plain or member name. */
function calleeName(callee: ESTree.Expression | ESTree.Super): string | undefined {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && callee.property.type === "Identifier") {
    return callee.property.name;
  }
  return undefined;
}

export const sandboxDeleteInOnePlaceRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require an agent's sandbox to be deleted in session-sandboxes.ts alone, never by a delete written anywhere else.",
    },
    messages: {
      deleteOutsideOwner:
        "`{{name}}` deletes a sandbox or a drive outside the files that own deleting one. Delete an agent's sandbox through `packages/service/src/agents/session-sandboxes.ts`; a file that must delete one goes in `tools/oxlint/vespin/sandbox-deletes.json` with its reason.",
    },
  },
  createOnce(context) {
    // Note that each holds local names, so an alias of `Sandbox` or `SandboxService` is no way around the rule.
    let services = new Set<string>();
    let serviceTypes = new Set<string>();
    let bindings = new Set<string>();

    const isService = (node: ESTree.Node | null | undefined): boolean =>
      node?.type === "Identifier" && services.has(node.name);
    const isYieldedService = (node: ESTree.Node): boolean =>
      node.type === "YieldExpression" && node.delegate && isService(node.argument);
    const bindFirstParameter = (node: ESTree.Node): void => {
      if (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression") return;
      const first = node.params[0];
      if (first?.type === "Identifier") bindings.add(first.name);
    };

    return {
      before() {
        const file = repositoryPathOf(context.filename);
        if (!TYPESCRIPT_SOURCE.test(file) || isExemptFile(file)) return false;
        services = new Set();
        serviceTypes = new Set();
        bindings = new Set();
        return true;
      },
      ImportDeclaration(node) {
        if (node.source.value !== SANDBOX_MODULE) return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          const imported =
            specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : String(specifier.imported.value);
          if (imported === "Sandbox") services.add(specifier.local.name);
          if (imported === "SandboxService") serviceTypes.add(specifier.local.name);
        }
      },
      Identifier(node) {
        const annotation = node.typeAnnotation?.typeAnnotation;
        if (
          annotation?.type === "TSTypeReference" &&
          annotation.typeName.type === "Identifier" &&
          serviceTypes.has(annotation.typeName.name)
        ) {
          bindings.add(node.name);
        }
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && node.init !== null && isYieldedService(node.init)) {
          bindings.add(node.id.name);
        }
      },
      CallExpression(node) {
        const { callee } = node;
        // A callback over the service takes it as its first parameter: `Sandbox.use((api) => …)`, `Effect.map(Sandbox, (api) => …)`.
        const overService =
          (callee.type === "MemberExpression" && isService(callee.object)) ||
          node.arguments.some((argument) => isService(argument));
        if (overService) for (const argument of node.arguments) bindFirstParameter(argument);

        const name = calleeName(callee);
        if (name === undefined) return;
        const sandboxDelete =
          callee.type === "MemberExpression" &&
          (name === "deleteDrive" ||
            (name === "delete" &&
              ((callee.object.type === "Identifier" && bindings.has(callee.object.name)) ||
                isYieldedService(callee.object))));
        if (!sandboxDelete && !DELETE_HELPERS.has(name)) return;
        context.report({ node, messageId: "deleteOutsideOwner", data: { name } });
      },
    };
  },
});
