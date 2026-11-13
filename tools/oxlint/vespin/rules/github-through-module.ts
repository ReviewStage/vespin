import path from "node:path";

import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import {
  GITHUB_API_HOST,
  GITHUB_API_VERSION_HEADER,
  MEMBER_TOKENS_FILE,
  mayCallApi,
  mayOpenToken,
  OCTOKIT_SCOPE,
  TOKEN_OPENER,
} from "../shared/github-module-guard.ts";
import { repositoryPathOf, TYPESCRIPT_SOURCE } from "../shared/repository-path.ts";

/**
 * Every request to GitHub's API goes through `@repo/github`, so its
 * identities, throttle, and rate-limit holds see each one. Outside the
 * module and the files `github-through-module.json` names, a string naming
 * `api.github.com` or GitHub's `x-github-api-version` header, and an import
 * of `@octokit/*`, are refused. A member's saved token is opened only by the
 * module's `GitHubMemberTokens` implementation: outside the files the same
 * list names, importing `openGitHubToken` or the service's `github-token.ts`
 * is refused. Tests and what they share are left be.
 */

/** Whether an import's source is the token opener's module, by its file name at the end of any path. */
function isOpenerModule(source: string): boolean {
  return source.endsWith(`/${TOKEN_OPENER.FROM}`) || source.endsWith(`/${TOKEN_OPENER.FROM}.js`);
}

/** The repository path a relative import names, its `.js` read as the `.ts` beside it; none for a package. */
function importedFile(file: string, source: string): string | undefined {
  if (!source.startsWith(".")) return undefined;
  return path.posix.join(path.posix.dirname(file), source).replace(/\.js$/u, ".ts");
}

/** What a string names that only the module may, if anything. */
function apiNameIn(text: string): string | undefined {
  const lowered = text.toLowerCase();
  if (lowered.includes(GITHUB_API_HOST)) return GITHUB_API_HOST;
  if (lowered.includes(GITHUB_API_VERSION_HEADER)) return GITHUB_API_VERSION_HEADER;
  return undefined;
}

export const githubThroughModuleRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require every request to GitHub's API to go through @repo/github, and a member's saved GitHub token to be opened only by its GitHubMemberTokens implementation.",
    },
    messages: {
      apiOutsideModule:
        "`{{name}}` names GitHub's API outside `@repo/github`, so the request would go around its identities, throttle, and rate-limit holds. Send it through `@repo/github` (`GitHub`'s clients, or a helper added there); a file that must name it goes in `tools/oxlint/vespin/github-through-module.json` with its reason.",
      octokitOutsideModule:
        "`{{name}}` is imported outside `@repo/github`, which is the one place Octokit is configured. Use `@repo/github`'s clients, or add what is missing there.",
      tokenOpenedOutsideModule:
        "`{{name}}` opens a member's saved GitHub token outside `@repo/github`'s `GitHubMemberTokens` implementation (`packages/service/src/github/github-token.ts`). Use the token through `@repo/github`'s member-token operations; a file that must open one goes in `tools/oxlint/vespin/github-through-module.json` with its reason.",
    },
  },
  createOnce(context) {
    let file = "";
    let apiAllowed = true;
    let tokenAllowed = true;

    const checkText = (node: ESTree.Node, text: string): void => {
      if (apiAllowed) return;
      const name = apiNameIn(text);
      if (name !== undefined)
        context.report({ node, messageId: "apiOutsideModule", data: { name } });
    };

    const checkSource = (node: ESTree.Node, source: string): void => {
      if (!apiAllowed && source.startsWith(OCTOKIT_SCOPE)) {
        context.report({ node, messageId: "octokitOutsideModule", data: { name: source } });
      }
      if (!tokenAllowed && importedFile(file, source) === MEMBER_TOKENS_FILE) {
        context.report({ node, messageId: "tokenOpenedOutsideModule", data: { name: source } });
      }
    };

    return {
      before() {
        file = repositoryPathOf(context.filename);
        if (!TYPESCRIPT_SOURCE.test(file)) return false;
        apiAllowed = mayCallApi(file);
        tokenAllowed = mayOpenToken(file);
        return !(apiAllowed && tokenAllowed);
      },
      Literal(node) {
        if (typeof node.value === "string") checkText(node, node.value);
      },
      TemplateElement(node) {
        checkText(node, node.value.cooked ?? node.value.raw);
      },
      ImportDeclaration(node) {
        const source = node.source.value;
        checkSource(node, source);
        if (tokenAllowed || !isOpenerModule(source)) return;
        for (const specifier of node.specifiers) {
          // A namespace import reaches the opener too, so it is refused like the name.
          const imported =
            specifier.type === "ImportSpecifier"
              ? specifier.imported.type === "Identifier"
                ? specifier.imported.name
                : String(specifier.imported.value)
              : specifier.type === "ImportNamespaceSpecifier"
                ? TOKEN_OPENER.NAME
                : undefined;
          if (imported !== TOKEN_OPENER.NAME) continue;
          context.report({
            node: specifier,
            messageId: "tokenOpenedOutsideModule",
            data: { name: TOKEN_OPENER.NAME },
          });
        }
      },
      ExportAllDeclaration(node) {
        checkSource(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null) checkSource(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal" && typeof node.source.value === "string") {
          checkSource(node, node.source.value);
        }
      },
    };
  },
});
