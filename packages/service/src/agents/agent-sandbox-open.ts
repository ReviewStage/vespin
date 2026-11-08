/**
 * agent-sandbox-open.ts -- the one way an agent's sandbox is opened, by whichever caller opens it: `Sandbox`'s `getOrCreate` under its session's name, from the agents' image or a snapshot.
 *
 * An agent's sandbox is named after its session (`agentSandboxName`) and
 * opened by `getOrCreate` (`@repo/sandbox`): the one standing under the name
 * is resumed, one is created where none stands, and one whose snapshot is
 * gone is deleted and created again under the same name: from the agents'
 * image, or from the snapshot a launch names
 * (`machine/sandbox-machine.ts`), with the drive of its own a launch has it
 * fork (`base-drive.ts`), whose files already hold a checkout.
 * Whichever caller opens it, a message's
 * launch (`machine/sandbox-machine.ts`), the Terminal, or the agent's browser,
 * opens it here, so a sandbox any of them creates is the same sandbox: the
 * `agent` user made in it as it is created, beside what the
 * caller's own `onCreate` adds, which only a launch adds (the checkout). A
 * sandbox created from a snapshot of another agent's sandbox has that user
 * already, so it is not made again.
 */

import { createHash } from "node:crypto";
import { AGENT_USER, CODEX_PIN } from "@repo/agent-runner/pins";
import {
  type ListedSandbox,
  type OpenedSandbox,
  SANDBOX_STATUS,
  Sandbox,
  type SandboxDrive,
  SandboxEnding,
  type SandboxError,
  type SandboxService,
  SandboxUnavailable,
} from "@repo/sandbox";
import { Duration, Effect, Schedule } from "effect";
import { afterResponse } from "../http/after-response.js";
import { AgentImage } from "./coder-host/agent-image.js";

/**
 * What a sandbox we open is named as, beside a digest of its session's id
 * (`agentSandboxName`), or a UUID for a legacy one opened before
 * `getOrCreate` (`legacySandboxOf`).
 */
export const SANDBOX_NAME = "agent-sandbox-";

/**
 * The tag a sandbox we open carries beside its session's: the agent it was
 * opened for, so a later call and the sweep tell whose it is. Its runner is
 * recorded in our store instead (`@repo/database/models/agent-runner-record`).
 */
export const AGENT_TAG = "agentId";

/** The tag every session's sandbox carries, its value the session's id. */
export const SESSION_TAG = "sessionId";

/**
 * The agent tag's name before the product's rename, read after `AGENT_TAG`'s
 * and never written. Note that a sandbox's tags are written only as it is
 * created, so one made before carries the old name for as long as it lives;
 * it goes with the legacy sandboxes' migration (`legacySandboxOf`), since
 * only a sandbox opened under a UUID can carry it.
 */
const AGENT_TAG_BEFORE_RENAME = "lukeAgent";

/** The agent a sandbox's tags name, under the tag's name or the one it had before the rename. */
export function agentTag(tags: Readonly<Record<string, string>> | undefined): string | undefined {
  return tags?.[AGENT_TAG] ?? tags?.[AGENT_TAG_BEFORE_RENAME];
}

/** The variables the sandbox opens with. */
export const SANDBOX_ENV = { NO_COLOR: "1", GH_STACK_NO_UPDATE_NOTIFIER: "1" } as const;

/** Why a sandbox could not be opened where its build named no agents' image (`coder-host/agent-image.ts`). */
const IMAGE_MISSING = "the agents' image could not be read";

/** The folders the `agent` user's home holds from its making: Codex's `CODEX_HOME`, which Codex refuses to start without. */
const AGENT_HOME_FOLDERS = [CODEX_PIN.HOME];

/**
 * How a create on an image the registry is still preparing is asked again:
 * every `SPACED`, at most `TIMES` times, as the registry's preparation asks
 * (`ImageNotReady`). Note that CI pushes each image and waits for
 * the provider to prepare it before the deploy that names it lands, so only a
 * Preview opened as its image is pushed waits here, and that a member's
 * open waits past its answer instead (`openAgentSandboxPromptly`).
 */
const IMAGE_RETRY = {
  SPACED: Duration.seconds(10),
  TIMES: 18,
} as const;

/**
 * The session's sandbox's name, which `getOrCreate` opens it under: the
 * prefix and a digest of the session's id, so every open of the session
 * finds the one sandbox standing under it.
 */
export function agentSandboxName(sessionId: string): string {
  const digest = createHash("sha256").update(sessionId).digest("hex");
  return `${SANDBOX_NAME}${digest.slice(0, 32)}`;
}

/** The tags a sandbox we open carries: its session's, and the agent it is opened for. */
export function agentSandboxTags(sessionId: string, agentId: string): Record<string, string> {
  return { [SESSION_TAG]: sessionId, [AGENT_TAG]: agentId };
}

/** The calls the lookup makes of `Sandbox`. */
type SandboxLookup = Pick<SandboxService, "get" | "listTagged">;

/**
 * MIGRATION: a sandbox opened before sandboxes were named after their
 * session, under a UUID, found by its session's tag, read again by its own
 * name, since a list's status may be stale. It is used where it runs, moved
 * to its session's name at its next resume (`reopenedOf`), never resumed in
 * place, and deleted before the session's own at a reset
 * (`machine/sandbox-machine.ts`'s `discard`). Deleted, with `reopenedOf`'s
 * move and `AGENT_TAG_BEFORE_RENAME`, once no such sandbox is in use (task
 * "Delete the legacy sandbox migration once none is in use").
 */
export const legacySandboxOf = (
  api: SandboxLookup,
  sessionId: string,
): Effect.Effect<ListedSandbox | undefined, SandboxError> =>
  Effect.gen(function* () {
    const listed = (yield* api.listTagged(SESSION_TAG, sessionId)).find(
      (each) => each.name !== agentSandboxName(sessionId),
    );
    return listed === undefined ? undefined : yield* api.get(listed.name);
  });

/**
 * The agent's sandbox as it stands now, read without resuming it (`get`):
 * the one under its session's name, which `getOrCreate` keeps the only one,
 * since a name is a lock; a legacy one while it is migrated
 * (`legacySandboxOf`); none where none stands, as before its first launch
 * opened it.
 */
export const agentSandboxOf = (
  api: SandboxLookup,
  sessionId: string,
): Effect.Effect<ListedSandbox | undefined, SandboxError> =>
  Effect.flatMap(api.get(agentSandboxName(sessionId)), (named) =>
    named === undefined ? legacySandboxOf(api, sessionId) : Effect.succeed(named),
  );

/**
 * What opening the agent's standing sandbox again asks of `getOrCreate`
 * (`openAgentSandbox`): its session's name, with the tags and the size it
 * stood with. MIGRATION: a legacy sandbox (`legacySandboxOf`) is created
 * anew under its session's name from its last snapshot, which holds its
 * disk and the `agent` user, and is left stopped, so it is never resumed in
 * place; one up or on its way down is waited out as any sandbox stopping
 * is (`SandboxEnding`), since the snapshot its stop takes is not there yet,
 * while one that stands in no status, as a failed one, is moved from the
 * snapshot it last kept.
 */
export function reopenedOf(
  sessionId: string,
  standing: ListedSandbox,
): Effect.Effect<AgentSandboxOf, SandboxEnding> {
  if (standing.name === agentSandboxName(sessionId)) {
    return Effect.succeed({ sessionId, tags: { ...standing.tags }, vcpus: standing.vcpus });
  }
  if (standing.status !== undefined && standing.status !== SANDBOX_STATUS.STOPPED) {
    return Effect.fail(new SandboxEnding({}));
  }
  const agentId = agentTag(standing.tags);
  return Effect.succeed({
    sessionId,
    tags:
      agentId === undefined ? { [SESSION_TAG]: sessionId } : agentSandboxTags(sessionId, agentId),
    vcpus: standing.vcpus,
    ...(standing.snapshotId === undefined
      ? undefined
      : { snapshot: { snapshotId: standing.snapshotId, holdsUser: true } }),
  });
}

/**
 * A snapshot an agent's sandbox is created from in place of the image, and
 * whether the `agent` user stands in it already, as in a snapshot of another
 * agent's sandbox.
 */
export interface AgentSnapshotSource {
  readonly snapshotId: string;
  readonly holdsUser: boolean;
}

/**
 * What an agent's sandbox is opened as: its session, its tags, how many
 * vCPUs it runs on, the provider's default where unsaid, and the snapshot it is
 * created from where it is created, the image where unsaid, with the drive
 * it opens with where it names one. A launch names
 * the agent's own (`agentSandboxTags`, `sandboxVcpus`); a caller that opens
 * one already standing again names those it stands with.
 */
export interface AgentSandboxOf {
  readonly sessionId: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly vcpus: number | undefined;
  readonly snapshot?: AgentSnapshotSource;
  readonly drive?: SandboxDrive;
}

/**
 * The agent's sandbox opened once through `getOrCreate`, as above, from the
 * agents' image or the snapshot named: running, with whether this call
 * created it. A sandbox it creates has the `agent` user made in it, and is
 * then handed to the caller's `onCreate` where it gives one; a failure of
 * either fails the open, as does an image the build named none of, which
 * reads as the sandbox unavailable.
 */
const openedOnce = (of: AgentSandboxOf, onCreate?: (created: OpenedSandbox) => Promise<void>) =>
  Effect.gen(function* () {
    const from =
      of.snapshot === undefined
        ? {
            image: yield* Effect.flatMap(AgentImage, (agentImage) => agentImage.reference).pipe(
              Effect.catchTag("AgentImageMissing", () =>
                Effect.fail(new SandboxUnavailable({ detail: IMAGE_MISSING })),
              ),
            ),
          }
        : { snapshotId: of.snapshot.snapshotId };
    let created = false;
    const sandbox = yield* (yield* Sandbox).getOrCreate(
      {
        name: agentSandboxName(of.sessionId),
        from,
        ...(of.drive === undefined ? undefined : { drive: of.drive }),
        tags: of.tags,
        ...(of.vcpus === undefined ? undefined : { vcpus: of.vcpus }),
        env: SANDBOX_ENV,
        ...(of.snapshot?.holdsUser === true
          ? undefined
          : { user: { name: AGENT_USER, homeFolders: AGENT_HOME_FOLDERS } }),
      },
      async (opened) => {
        created = true;
        await onCreate?.(opened);
      },
    );
    return { sandbox, created };
  });

/**
 * The agent's sandbox opened as `openedOnce` opens it, asked again while the
 * registry still prepares the image (`IMAGE_RETRY`): what a launch waits on,
 * since its turn needs the sandbox before it can go on.
 */
export const openAgentSandbox = (
  of: AgentSandboxOf,
  onCreate?: (created: OpenedSandbox) => Promise<void>,
) =>
  openedOnce(of, onCreate).pipe(
    Effect.retry({
      schedule: Schedule.spaced(IMAGE_RETRY.SPACED),
      times: IMAGE_RETRY.TIMES,
      while: (failure) => failure._tag === "ImageNotReady",
    }),
  );

/**
 * The agent's sandbox opened for a member's request, which must answer
 * within its client's deadline: asked once, and where the registry still
 * prepares the image, opened after the request's answer instead, waiting on
 * the image as `openAgentSandbox` does, while the request fails at once with
 * the image not ready, for its caller to answer as starting. Note that the
 * Terminal's and the Browser's panes ask again on their own wait meanwhile,
 * and find it running once the open after the answer made it.
 */
export const openAgentSandboxPromptly = (of: AgentSandboxOf) =>
  openedOnce(of).pipe(
    Effect.tapError((failure) =>
      failure._tag === "ImageNotReady"
        ? afterResponse("an agent's sandbox opened on its image", openAgentSandbox(of))
        : Effect.void,
    ),
  );
