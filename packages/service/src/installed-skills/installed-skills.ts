/**
 * installed-skills.ts -- the skills members install into the app, as the one operation each door runs: list the ones a workspace offers the account, read one, preview a paste, install from it, and remove one.
 *
 * The hosted procedures (`installed-skills-procedures.ts`) and the member
 * MCP tools (`../member-mcp/tools.ts`) are doors over these: each resolves
 * who is asking and hands the account's id here, and answers a refusal in
 * its own words. The store gates every row in SQL
 * (`installed-skill-store.ts`): a personal skill is its owner's alone, and
 * a workspace skill is installed and read by any of the workspace's members
 * and managed by its installer while still a member or by its owners and
 * admins, as an automation is changed, so a skill the account cannot read
 * answers as not found, and one it reads but may not manage as not
 * permitted. A workspace named in a request must be one the account is a
 * member of, and a workspace skill is refused in the account's personal
 * workspace, where everything is its own, as an automation's workspace
 * scope is.
 *
 * A paste is read afresh on every request (`skill-paste-install.ts`), and
 * its GitHub source through the workspace named, which is the
 * installation that reads it. Every skill an install makes is written in
 * one transaction, so a name already taken among several installs none.
 * Each write answers the transaction it committed in, which a desktop
 * holding the skills live waits for (`installedSkillsRead`).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  type InstalledSkill,
  type InstalledSkillFilesRefused,
  type InstalledSkillNameTaken,
  type InstalledSkillRead,
  installSkill,
  listInstalledSkills,
  readInstalledSkill,
  removeInstalledSkill,
  type WrittenSkill,
} from "@repo/database/models/installed-skill-store";
import type { TaskStoreFailure } from "@repo/database/models/task-store";
import { listWorkspaces, personalWorkspaceOf } from "@repo/database/models/workspace-store";
import type {
  InstalledSkillContent,
  InstalledSkillSummary,
} from "@repo/features/installed-skill-route-wire";
import {
  INSTALLED_SKILL_SCOPE,
  type InstalledSkillScope,
} from "@repo/features/installed-skill-wire";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@repo/features/workspace-wire";
import { Data, Effect, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import {
  recordServerEvent,
  SERVER_EVENT,
  SERVER_SKILL_ACTION,
  type ServerSkillAction,
} from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  installedSkillRefused,
  pathUuid,
} from "../http/http-effect.js";
import { parseSkillPaste } from "./skill-paste.js";
import { type InstallAsked, madeFromPaste, previewOfPaste } from "./skill-paste-install.js";

/** The roles that manage a workspace's skills. */
const MANAGING_ROLES: ReadonlySet<WorkspaceRole> = new Set([
  WORKSPACE_ROLE.OWNER,
  WORKSPACE_ROLE.ADMIN,
]);

/** A workspace the account is a member of: its id, the account's role there, and whether it is the account's personal one. */
interface MemberWorkspace {
  readonly id: string;
  readonly role: WorkspaceRole;
  readonly personal: boolean;
}

/** The workspace as the account is a member of it; not found where it is not. */
const memberWorkspace = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<MemberWorkspace, HostedRefusal, DatabaseServices> {
  const workspaces = yield* hostedStoreOrUnavailable(listWorkspaces(userId));
  const workspace = workspaces.find((one) => one.id === workspaceId);

  if (workspace === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const personal = yield* hostedStoreOrUnavailable(personalWorkspaceOf(userId));

  return {
    id: workspace.id,
    role: workspace.role,
    personal: Option.contains(personal, workspace.id),
  };
});

/**
 * The scope the account may install in: its own, anywhere; the
 * workspace's, as any member, but never in its personal workspace, where
 * a workspace skill would be a personal one by another name.
 */
const checkedScope = /* @__PURE__ */ Effect.fnUntraced(function* (
  workspace: MemberWorkspace,
  scope: InstalledSkillScope,
): Effect.fn.Return<void, HostedRefusal> {
  if (scope === INSTALLED_SKILL_SCOPE.PERSONAL) return;

  if (workspace.personal) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
});

/** One skill for the wire, whether the account may manage it said by the caller, which knows its role. */
function summaryOf(skill: InstalledSkill, manageable: boolean): InstalledSkillSummary {
  return {
    id: skill.id,
    scope: skill.scope,
    name: skill.name,
    description: skill.description,
    userInvocable: skill.userInvocable,
    source: skill.source,
    enabled: true,
    ...(skill.organizationId === null ? undefined : { workspaceId: skill.organizationId }),
    installedBy: skill.installedByUserId,
    manageable,
    createdAt: skill.createdAt.getTime(),
    updatedAt: skill.updatedAt.getTime(),
  };
}

/** One skill read whole for the wire: its `SKILL.md` as text, and every file's path and size. */
function contentOf(skill: InstalledSkillRead): InstalledSkillContent {
  return {
    id: skill.id,
    skillFile: new TextDecoder().decode(skill.skillFile),
    files: skill.files,
  };
}

/**
 * Whether the account manages the skill, as the store's rule reads: its
 * own personal one, or its workspace's as the skill's installer or as an
 * owner or admin, a member of the workspace either way.
 */
function managedBy(userId: string, workspace: MemberWorkspace, skill: InstalledSkill): boolean {
  if (skill.scope === INSTALLED_SKILL_SCOPE.PERSONAL) return skill.ownerUserId === userId;

  return (
    skill.organizationId === workspace.id &&
    (skill.installedByUserId === userId || MANAGING_ROLES.has(workspace.role))
  );
}

/** The transaction a write committed in, as its answer carries it; none where it wrote nothing. */
function txidOf(written: WrittenSkill | undefined): { readonly txid?: string } {
  return written === undefined ? {} : { txid: written.txid };
}

/** An install the store refused, since the account is no longer a member of the workspace it installs in; it undoes the transaction it stands in. */
class InstallNotPermitted extends Data.TaggedError("InstallNotPermitted") {}

/** A write's value, or the refusal the store's own error became. */
type Settled<A> = Result.Result<A, HostedRefusal>;

function refusedAs<A>(refusal: HostedRefusal): Effect.Effect<Settled<A>> {
  return Effect.succeed(Result.fail(refusal));
}

/**
 * A store write's own refusals carried onto the answer channel: a name
 * taken, files refused (by the skill's name), an install not permitted,
 * and a store that failed.
 */
function storeWrite<A, R>(
  effect: Effect.Effect<
    A,
    TaskStoreFailure | InstalledSkillNameTaken | InstalledSkillFilesRefused | InstallNotPermitted,
    R
  >,
  name: string | undefined,
): Effect.Effect<A, HostedRefusal, R> {
  const settled = effect.pipe(
    Effect.map((value): Settled<A> => Result.succeed(value)),
    Effect.catchTags({
      InstalledSkillNameTaken: (taken) =>
        refusedAs<A>(installedSkillRefused(HOSTED_REFUSAL.SKILL_NAME_TAKEN, taken.name)),
      InstalledSkillFilesRefused: (refused) =>
        refusedAs<A>(
          installedSkillRefused(HOSTED_REFUSAL.SKILL_FILES_REFUSED, name, refused.reason),
        ),
      InstallNotPermitted: () => refusedAs<A>(HOSTED_REFUSAL.NOT_PERMITTED),
    }),
  );

  return Effect.flatMap(hostedStoreOrUnavailable(settled), (result) =>
    Result.isSuccess(result) ? Effect.succeed(result.success) : Effect.fail(result.failure),
  );
}

/** Why a write the store refused was refused: not permitted where the account still reads the skill, not found where it does not. */
const refusedWrite = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  id: string,
): Effect.fn.Return<never, HostedRefusal, DatabaseServices> {
  const readable = yield* hostedStoreOrUnavailable(readInstalledSkill(userId, id));

  return yield* Effect.fail(
    Option.isSome(readable) ? HOSTED_REFUSAL.NOT_PERMITTED : HOSTED_REFUSAL.NOT_FOUND,
  );
});

/** A skill change counted under the account that made it; a skill may be personal, so no workspace is named. */
function skillChanged(userId: string, action: ServerSkillAction) {
  return recordServerEvent(SERVER_EVENT.SKILL_CHANGE, { userId }, { action });
}

/** A paste read in a workspace: its text, and the workspace whose GitHub installation reads its source. */
export interface SkillPasteAsked {
  readonly text: string;
  readonly workspaceId: string;
}

/** An install: the paste, whose the skills are, and what it asks of the paste beside it. */
export interface SkillInstallAsked extends SkillPasteAsked, InstallAsked {
  readonly scope: InstalledSkillScope;
}

/** The skills the account sees in the workspace: the workspace's, then its own. */
export const listSkills = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* memberWorkspace(userId, workspaceId);
  const listed = yield* hostedStoreOrUnavailable(listInstalledSkills(userId, workspace.id));

  return {
    skills: listed.map((skill) => summaryOf(skill, managedBy(userId, workspace, skill))),
  };
});

/** One skill the account reads, whole: its `SKILL.md` and its files. */
export const readSkill = /* @__PURE__ */ Effect.fnUntraced(function* (userId: string, id: string) {
  const uuid = yield* pathUuid(id);
  const read = yield* hostedStoreOrUnavailable(readInstalledSkill(userId, uuid));

  if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  return contentOf(read.value);
});

/** What a paste would install, read as an install reads it; nothing is written. */
export const previewSkillPaste = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  asked: SkillPasteAsked,
) {
  const workspace = yield* memberWorkspace(userId, asked.workspaceId);

  return yield* previewOfPaste(userId, workspace.id, parseSkillPaste(asked.text));
});

/** The skills a paste makes, installed in the scope asked, all or none. */
export const installSkills = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  asked: SkillInstallAsked,
) {
  const workspace = yield* memberWorkspace(userId, asked.workspaceId);
  yield* checkedScope(workspace, asked.scope);
  const made = yield* madeFromPaste(userId, workspace.id, parseSkillPaste(asked.text), asked);

  const owner =
    asked.scope === INSTALLED_SKILL_SCOPE.PERSONAL
      ? { scope: INSTALLED_SKILL_SCOPE.PERSONAL }
      : { scope: INSTALLED_SKILL_SCOPE.WORKSPACE, organizationId: workspace.id };

  // Note that the store's own transactions nest as savepoints, so one refusal undoes every install before it.
  const installed = yield* storeWrite(
    Effect.flatMap(SqlClient.SqlClient, (client) =>
      client.withTransaction(
        Effect.forEach(made, (skill) =>
          Effect.flatMap(installSkill(userId, { ...skill, owner }), (written) =>
            Option.isSome(written)
              ? Effect.succeed(written.value)
              : Effect.fail(new InstallNotPermitted()),
          ),
        ),
      ),
    ),
    made.length === 1 ? made[0]?.name : undefined,
  );

  yield* skillChanged(userId, SERVER_SKILL_ACTION.INSTALL);

  // Note that every skill of an install is written in the one transaction, so the first's names it.
  return {
    skills: installed.map((skill) => summaryOf(skill, true)),
    ...txidOf(installed[0]),
  };
});

/** One skill removed with its files. */
export const removeSkill = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  id: string,
) {
  const uuid = yield* pathUuid(id);
  const removed = yield* hostedStoreOrUnavailable(removeInstalledSkill(userId, uuid));

  if (Option.isNone(removed)) return yield* refusedWrite(userId, uuid);
  yield* skillChanged(userId, SERVER_SKILL_ACTION.REMOVE);

  return { id: uuid, txid: removed.value };
});
