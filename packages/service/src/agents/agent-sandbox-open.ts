/**
 * agent-sandbox-open.ts -- the one way an agent's sandbox is opened, by whichever caller opens it: `Sandbox`'s `getOrCreate` under its session's name, from the agents' image.
 *
 * An agent's sandbox is named after its session (`agentSandboxName`) and
 * opened by `getOrCreate` (`@repo/sandbox`): the one up under the name is
 * used as it runs, and one is created from the agents' image where none is
 * up, with the drive a launch has it fork (`workspace-drive.ts`), whose files
 * already hold a checkout, or its own. Every open of a sandbox standing under
 * its session's name asks for its own drive (`AGENT_OWN_DRIVE`), so one
 * stopped is made again from the image with that drive mounted, whichever
 * caller wakes it. Whichever caller opens it, a message's launch
 * (`machine/sandbox-machine.ts`), the Terminal, or the agent's browser, opens
 * it here, so a sandbox any of them creates is the same sandbox: the `agent`
 * user made in it as it is created, beside what the caller's own `onCreate`
 * adds, which only a launch adds (the checkout).
 */

import { createHash } from "node:crypto";
import { AGENT_USER, CODEX_PIN } from "@repo/agent-runner/pins";
import {
  type CreatedSandbox,
  type ListedSandbox,
  Sandbox,
  type SandboxDrive,
  type SandboxError,
  type SandboxService,
  SandboxUnavailable,
} from "@repo/sandbox";
import { Duration, Effect, Predicate, Schedule } from "effect";
import { afterResponse } from "../http/after-response.js";
import { AgentImage } from "./coder-host/agent-image.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "./repository-sandbox-contract.js";

/** What a sandbox we open is named as, beside a digest of its session's id (`agentSandboxName`). */
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
 * The tag a sandbox we create carries for the workspace it is billed to,
 * an agent's and a workspace drive's fill's alike, so Vercel's dashboard
 * names it too; the record billing reads is `sandbox_owner`
 * (`@repo/database/models/sandbox-owners`).
 */
export const ORGANIZATION_TAG = "organizationId";

/** The agent a sandbox's tags name. */
export function agentTag(tags: Readonly<Record<string, string>> | undefined): string | undefined {
  return tags?.[AGENT_TAG];
}

/**
 * The agent's own drive, mounted where the checkout's workspace stands: the
 * one its first open forked or made, as it stands, else one made empty
 * (`@repo/sandbox`'s `SandboxDrive`), so no agent's work lives only on its
 * sandbox's disk.
 */
export const AGENT_OWN_DRIVE = {
  own: true,
  at: REPOSITORY_SANDBOX_CONTRACT.PATH.WORKSPACE,
} as const satisfies SandboxDrive;

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

/** The tags a sandbox we open carries: its session's, the agent it is opened for, and the agent's workspace. */
export function agentSandboxTags(
  sessionId: string,
  agent: { readonly id: string; readonly organizationId: string },
) {
  return {
    [SESSION_TAG]: sessionId,
    [AGENT_TAG]: agent.id,
    [ORGANIZATION_TAG]: agent.organizationId,
  } satisfies Record<string, string>;
}

/**
 * The agent's sandbox as it stands now, read without waking it (`get`): the
 * one under its session's name, which `getOrCreate` keeps the only one,
 * since a name is a lock; none where none stands, as before its first launch
 * opened it.
 */
export const agentSandboxOf = (
  api: Pick<SandboxService, "get">,
  sessionId: string,
): Effect.Effect<ListedSandbox | undefined, SandboxError> => api.get(agentSandboxName(sessionId));

/**
 * What opening the agent's standing sandbox again asks of `getOrCreate`
 * (`openAgentSandbox`): its session's name, with the tags and the size it
 * stood with, and its own drive (`AGENT_OWN_DRIVE`).
 */
export function reopenedOf(sessionId: string, standing: ListedSandbox): AgentSandboxOf {
  return {
    sessionId,
    tags: { ...standing.tags },
    vcpus: standing.vcpus,
    drive: AGENT_OWN_DRIVE,
  };
}

/**
 * What an agent's sandbox is opened as: its session, its tags, how many
 * vCPUs it runs on, the provider's default where unsaid, and the drive it
 * opens with where it names one. A launch names the agent's own
 * (`agentSandboxTags`, `sandboxVcpus`); a caller that opens one already
 * standing again names those it stands with.
 */
export interface AgentSandboxOf {
  readonly sessionId: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly vcpus: number | undefined;
  readonly drive?: SandboxDrive;
}

/**
 * The agent's sandbox opened once through `getOrCreate`, as above, from the
 * agents' image: running, with whether this call
 * created it and, where it did, whether it mounted the agent's own drive as
 * it stood (`driveKept`). A sandbox it creates has the `agent` user made in it, and is
 * then handed to the caller's `onCreate` where it gives one; a failure of
 * either fails the open, as does an image the build named none of, which
 * reads as the sandbox unavailable.
 */
const openedOnce = (of: AgentSandboxOf, onCreate?: (created: CreatedSandbox) => Promise<void>) =>
  Effect.gen(function* () {
    const image = yield* Effect.flatMap(AgentImage, (agentImage) => agentImage.reference).pipe(
      Effect.catchTag("AgentImageMissing", () =>
        Effect.fail(new SandboxUnavailable({ detail: IMAGE_MISSING })),
      ),
    );

    let created = false;
    let driveKept = false;

    const sandbox = yield* (yield* Sandbox).getOrCreate(
      {
        name: agentSandboxName(of.sessionId),
        from: { image },
        ...(of.drive === undefined ? undefined : { drive: of.drive }),
        tags: of.tags,
        ...(of.vcpus === undefined ? undefined : { vcpus: of.vcpus }),
        env: SANDBOX_ENV,
        user: { name: AGENT_USER, homeFolders: AGENT_HOME_FOLDERS },
      },
      async (opened) => {
        created = true;
        driveKept = opened.driveKept;
        await onCreate?.(opened);
      },
    );

    return { sandbox, created, driveKept };
  });

/**
 * The agent's sandbox opened as `openedOnce` opens it, asked again while the
 * registry still prepares the image (`IMAGE_RETRY`): what a launch waits on,
 * since its turn needs the sandbox before it can go on.
 */
export const openAgentSandbox = (
  of: AgentSandboxOf,
  onCreate?: (created: CreatedSandbox) => Promise<void>,
) =>
  openedOnce(of, onCreate).pipe(
    Effect.retry({
      schedule: Schedule.spaced(IMAGE_RETRY.SPACED),
      times: IMAGE_RETRY.TIMES,
      while: (failure) => Predicate.isTagged(failure, "ImageNotReady"),
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
      Predicate.isTagged(failure, "ImageNotReady")
        ? afterResponse("an agent's sandbox opened on its image", openAgentSandbox(of))
        : Effect.void,
    ),
  );
