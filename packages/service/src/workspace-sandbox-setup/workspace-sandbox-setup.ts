/**
 * workspace-sandbox-setup.ts -- a workspace's cloud sandbox setup, as every door reads and saves it: read it as a member, and save its install script, a repository's setup or archive script, or a repository's run actions, whole or one action at a time, as an owner or admin.
 *
 * The hosted procedures (`workspace-sandbox-setup-procedures.ts`) and the
 * member MCP tools (`read_sandbox_setup`, `edit_sandbox_setup`,
 * `edit_run_action`) go through
 * these, so one rule holds for each: a workspace the account is not a
 * member of is not found, a save by a member who is no owner or admin is
 * not permitted, and a save whose script is empty, or only whitespace,
 * removes the script. Every answer is the setup as it then stands, each
 * script with how it last ran in a sandbox (`../agents/script-runs.ts`). Each
 * door reads its own input and answers in its own words.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  listScriptRuns,
  type WorkspaceScriptRun,
} from "@repo/database/models/workspace-sandbox-script-run-store";
import {
  editRunActions,
  listRepositorySetups,
  listRunActions,
  type RunActionWrite,
  readInstallScript,
  removeInstallScript,
  removeRepositorySetup,
  setInstallScript,
  setRepositorySetup,
  setRunActions,
  type WorkspaceRunAction,
} from "@repo/database/models/workspace-sandbox-script-store";
import { agentName } from "@repo/features/model-label";
import {
  CLOUD_SETUP_SCRIPT,
  type CloudSetupScript,
  type CloudSetupScriptRun,
  REPOSITORY_SCRIPT_KIND,
  type RepositoryRunActions,
  type RepositoryScriptKind,
  type RunActionPut,
  WORKSPACE_SANDBOX_SETUP_BOUNDS,
  type WorkspaceRunActionEdit,
  type WorkspaceSandboxSetupAnswer,
} from "@repo/features/workspace-sandbox-setup-wire";
import { Data, DateTime, Effect, Option, Result } from "effect";
import { answeredWorkspace, managedWorkspace } from "../accounts/workspace-access.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";

/** An edit of one run action the list as it stands refused, which writes nothing. */
class RunActionEditRefused extends Data.TaggedError("RunActionEditRefused")<{
  readonly refusal: HostedRefusal;
}> {}

/** Whether a script saved as given removes the one that stood: one with nothing but whitespace in it. */
function removes(script: string): boolean {
  return script.trim().length === 0;
}

/** Every repository's run actions as the wire lists them: one entry per repository, its actions in their order, stamped with its latest save. */
function runActionLists(rows: readonly WorkspaceRunAction[]): RepositoryRunActions[] {
  const lists: RepositoryRunActions[] = [];

  for (const row of rows) {
    const action = {
      id: row.id,
      label: row.label,
      command: row.command,
      ...(row.icon === null ? undefined : { icon: row.icon }),
      ...(row.isDefault ? { isDefault: true } : undefined),
    };

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

/** The list with the action put at the place, a place past the end being the last. */
function placed(
  list: readonly RunActionWrite[],
  action: RunActionWrite,
  position: number,
): RunActionWrite[] {
  return [...list.slice(0, position), action, ...list.slice(position)];
}

/**
 * The list an edit of one action makes of the repository's as it stands:
 * an action added, last where no place is named, or the one its id names
 * changed in what the edit names, staying where it stood unless moved, or
 * removed. An action made the default makes no other the default. Refused
 * where the id names none of the list's, or an add names no label and
 * command, would pass the most a repository keeps, or asks to remove.
 */
function editedRunActions(
  standing: readonly WorkspaceRunAction[],
  edit: WorkspaceRunActionEdit,
): Result.Result<RunActionWrite[], HostedRefusal> {
  const list: RunActionWrite[] = standing.map((row) => ({
    id: row.id,
    label: row.label,
    command: row.command,
    icon: row.icon ?? undefined,
    isDefault: row.isDefault,
  }));

  let edited: RunActionWrite;
  let next: RunActionWrite[];

  if (edit.actionId === undefined) {
    const { label, command } = edit;

    if (edit.remove === true || label === undefined || command === undefined) {
      return Result.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }

    if (list.length >= WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTIONS) {
      return Result.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }

    edited = { label, command, icon: edit.icon ?? undefined, isDefault: edit.isDefault === true };
    next = placed(list, edited, edit.position ?? list.length);
  } else {
    const at = list.findIndex((action) => action.id === edit.actionId);
    const found = list[at];

    if (found === undefined) return Result.fail(HOSTED_REFUSAL.NOT_FOUND);
    const rest = list.filter((_, index) => index !== at);

    if (edit.remove === true) return Result.succeed(rest);
    edited = {
      ...found,
      ...(edit.label === undefined ? undefined : { label: edit.label }),
      ...(edit.command === undefined ? undefined : { command: edit.command }),
      ...(edit.icon === undefined ? undefined : { icon: edit.icon ?? undefined }),
      ...(edit.isDefault === undefined ? undefined : { isDefault: edit.isDefault }),
    };
    next = placed(rest, edited, edit.position ?? at);
  }

  if (edited.isDefault !== true) return Result.succeed(next);

  return Result.succeed(
    next.map((action) => (action === edited ? action : { ...action, isDefault: false })),
  );
}

/** A script's last run as the wire says it, its agent by the name every place gives it; none where it never ran. */
function lastRunOf(
  runs: readonly WorkspaceScriptRun[],
  script: CloudSetupScript,
  repository: string | null,
): { readonly lastRun?: CloudSetupScriptRun } {
  const run = runs.find(
    (each) => each.script === script && each.repository === (repository?.toLowerCase() ?? null),
  );

  if (run === undefined) return {};
  const { agent } = run;

  return {
    lastRun: {
      ranAt: run.ranAt.getTime(),
      exitCode: run.exitCode,
      agent: { id: agent.id, taskId: agent.taskId, name: agentName(agent) },
    },
  };
}

/** The workspace's sandbox setup as it stands, for the wire, each script with how it last ran. */
const setupAnswer = Effect.fn("web/workspaceSandboxSetupAnswer")(function* (
  workspaceId: string,
): Effect.fn.Return<WorkspaceSandboxSetupAnswer, HostedRefusal, DatabaseServices> {
  const [install, scripts, runActions, runs] = yield* hostedStoreOrUnavailable(
    Effect.all([
      readInstallScript(workspaceId),
      listRepositorySetups(workspaceId),
      listRunActions(workspaceId),
      listScriptRuns(workspaceId),
    ]),
  );

  const ofKind = (kind: RepositoryScriptKind) =>
    scripts
      .filter((row) => row.kind === kind)
      .map((row) => ({
        repository: row.repository,
        script: row.script,
        updatedAt: row.updatedAt.getTime(),
        ...lastRunOf(runs, kind, row.repository),
      }));

  return {
    install: Option.match(install, {
      onNone: () => null,
      onSome: (row) => ({
        script: row.script,
        updatedAt: row.updatedAt.getTime(),
        ...lastRunOf(runs, CLOUD_SETUP_SCRIPT.INSTALL, null),
      }),
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

/**
 * One of a repository's run actions in a workspace the account manages
 * added, changed, moved, or removed (`editedRunActions`), the list read and
 * written back under the repository's lock (`editRunActions`), so an edit
 * made at the same time as another changes what that one wrote rather than
 * undoing it; the setup as it then stands.
 */
export const editRunAction = Effect.fn("web/editRunAction")(function* (
  userId: string,
  workspaceId: string,
  edit: WorkspaceRunActionEdit,
): Effect.fn.Return<WorkspaceSandboxSetupAnswer, HostedRefusal, DatabaseServices> {
  const workspace = yield* managedWorkspace(userId, workspaceId);
  const now = yield* DateTime.nowAsDate;

  const refused = yield* hostedStoreOrUnavailable(
    editRunActions(
      workspace.id,
      edit.repository,
      (standing) =>
        Result.match(editedRunActions(standing, edit), {
          onSuccess: (actions) => Effect.succeed(actions),
          onFailure: (refusal) => Effect.fail(new RunActionEditRefused({ refusal })),
        }),
      now,
    ).pipe(
      Effect.as(Option.none<HostedRefusal>()),
      Effect.catchTag("RunActionEditRefused", ({ refusal }) =>
        Effect.succeed(Option.some(refusal)),
      ),
    ),
  );

  if (Option.isSome(refused)) return yield* Effect.fail(refused.value);

  return yield* setupAnswer(workspace.id);
});
