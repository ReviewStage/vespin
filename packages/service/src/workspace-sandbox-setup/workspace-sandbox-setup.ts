/**
 * workspace-sandbox-setup.ts -- a workspace's cloud sandbox setup, as every door reads and saves it: read it as a member, and save its install script, a repository's setup or archive script, or a repository's run actions as an owner or admin.
 *
 * The hosted procedures (`workspace-sandbox-setup-procedures.ts`) and the
 * member MCP tools (`read_sandbox_setup`, `edit_sandbox_setup`) go through
 * these, so one rule holds for each: a workspace the account is not a
 * member of is not found, a save by a member who is no owner or admin is
 * not permitted, and a save whose script is empty, or only whitespace,
 * removes the script. Every answer is the setup as it then stands. Each
 * door reads its own input and answers in its own words.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  listRepositorySetups,
  listRunActions,
  readInstallScript,
  removeInstallScript,
  removeRepositorySetup,
  setInstallScript,
  setRepositorySetup,
  setRunActions,
  type WorkspaceRunAction,
} from "@repo/database/models/workspace-sandbox-script-store";
import {
  REPOSITORY_SCRIPT_KIND,
  type RepositoryRunActions,
  type RepositoryScriptKind,
  type RunActionPut,
  type WorkspaceSandboxSetupAnswer,
} from "@repo/features/workspace-sandbox-setup-wire";
import { DateTime, Effect, Option } from "effect";
import { answeredWorkspace, managedWorkspace } from "../accounts/workspace-access.js";
import { type HostedRefusal, hostedStoreOrUnavailable } from "../http/http-effect.js";

/** Whether a script saved as given removes the one that stood: one with nothing but whitespace in it. */
function removes(script: string): boolean {
  return script.trim().length === 0;
}

/** Every repository's run actions as the wire lists them: one entry per repository, its actions in their order, stamped with its latest save. */
function runActionLists(rows: readonly WorkspaceRunAction[]): RepositoryRunActions[] {
  const lists: RepositoryRunActions[] = [];
  for (const row of rows) {
    const action = { id: row.id, label: row.label, command: row.command };
    const last = lists.at(-1);
    if (last !== undefined && last.repository.toLowerCase() === row.repository.toLowerCase()) {
      lists[lists.length - 1] = {
        ...last,
        actions: [...last.actions, action],
        updatedAt: Math.max(last.updatedAt, row.updatedAt.getTime()),
      };
    } else {
      lists.push({
        repository: row.repository,
        actions: [action],
        updatedAt: row.updatedAt.getTime(),
      });
    }
  }
  return lists;
}

/** The workspace's sandbox setup as it stands, for the wire. */
const setupAnswer = Effect.fn("web/workspaceSandboxSetupAnswer")(function* (
  workspaceId: string,
): Effect.fn.Return<WorkspaceSandboxSetupAnswer, HostedRefusal, DatabaseServices> {
  const [install, scripts, runActions] = yield* hostedStoreOrUnavailable(
    Effect.all([
      readInstallScript(workspaceId),
      listRepositorySetups(workspaceId),
      listRunActions(workspaceId),
    ]),
  );
  const ofKind = (kind: RepositoryScriptKind) =>
    scripts
      .filter((row) => row.kind === kind)
      .map((row) => ({
        repository: row.repository,
        script: row.script,
        updatedAt: row.updatedAt.getTime(),
      }));
  return {
    install: Option.match(install, {
      onNone: () => null,
      onSome: (row) => ({ script: row.script, updatedAt: row.updatedAt.getTime() }),
    }),
    setups: ofKind(REPOSITORY_SCRIPT_KIND.SETUP),
    archives: ofKind(REPOSITORY_SCRIPT_KIND.ARCHIVE),
    runActions: runActionLists(runActions),
  };
});

/** The sandbox setup of a workspace the account is a member of. */
export const readSandboxSetup = Effect.fn("web/readSandboxSetup")(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<WorkspaceSandboxSetupAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* answeredWorkspace(userId, workspaceId);
  return yield* setupAnswer(workspace.id);
});

/** The install script of a workspace the account manages saved, or removed where it is empty; the setup as it then stands. */
export const saveInstallScript = Effect.fn("web/saveInstallScript")(function* (
  userId: string,
  workspaceId: string,
  script: string,
): Effect.fn.Return<WorkspaceSandboxSetupAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* managedWorkspace(userId, workspaceId);
  const now = yield* DateTime.nowAsDate;
  yield* hostedStoreOrUnavailable(
    removes(script)
      ? Effect.asVoid(removeInstallScript(workspace.id))
      : setInstallScript(workspace.id, script, now),
  );
  return yield* setupAnswer(workspace.id);
});

/** A repository's setup or archive script in a workspace the account manages saved, replacing the one of that kind under any casing of its name, or removed where it is empty; the setup as it then stands. */
export const saveRepositorySetup = Effect.fn("web/saveRepositorySetup")(function* (
  userId: string,
  workspaceId: string,
  repository: string,
  script: string,
  kind: RepositoryScriptKind,
): Effect.fn.Return<WorkspaceSandboxSetupAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* managedWorkspace(userId, workspaceId);
  const now = yield* DateTime.nowAsDate;
  yield* hostedStoreOrUnavailable(
    removes(script)
      ? Effect.asVoid(removeRepositorySetup(workspace.id, repository, kind))
      : setRepositorySetup(workspace.id, repository, kind, script, now),
  );
  return yield* setupAnswer(workspace.id);
});

/**
 * A repository's run actions in a workspace the account manages saved, the
 * whole list in its order, replacing the one under any casing of its name,
 * or removed where the list is empty; the setup as it then stands. An action
 * keeps the id it names only where it is already the repository's
 * (`setRunActions`).
 */
export const saveRunActions = Effect.fn("web/saveRunActions")(function* (
  userId: string,
  workspaceId: string,
  repository: string,
  actions: readonly RunActionPut[],
): Effect.fn.Return<WorkspaceSandboxSetupAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* managedWorkspace(userId, workspaceId);
  const now = yield* DateTime.nowAsDate;
  yield* hostedStoreOrUnavailable(setRunActions(workspace.id, repository, actions, now));
  return yield* setupAnswer(workspace.id);
});
