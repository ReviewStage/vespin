/**
 * base-drive-connect.ts -- a workspace's base drives filled the moment its GitHub installation connects or is given repositories, so its first agent forks one rather than cloning.
 *
 * A base drive (`base-drive.ts`) is otherwise filled only after a launch
 * finds none, which leaves the first agent on each repository to clone in
 * full. So the connect's callback (`github-install-app.ts`) and the webhook's
 * repositories added (`github-webhook-app.ts`) fill one past the answer for
 * every repository the workspace's installations grant whose drive stands
 * not, a few at once, each failure logged and passed by; a launch fills
 * whatever this missed, as before.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { BaseDriveWorkspace } from "@repo/database/models/base-drive-repositories";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { causeKind } from "@repo/runtime/effect";
import { Sandbox } from "@repo/sandbox";
import { Cause, Effect, type Layer, Option } from "effect";
import { GitHubApp } from "../github/github-app.js";
import { GitHubBackground } from "../github/github-rate-gate.js";
import { afterResponse } from "../http/after-response.js";
import { BASE_WANTED, baseDriveName, fillBaseDrive } from "./base-drive.js";
import { AgentImage } from "./coder-host/agent-image.js";
import {
  firewallSessionOf,
  repositoryFirewallOver,
  repositorySandboxOver,
  type SandboxRunner,
} from "./machine/sandbox-machine.js";

/** How many drives are filled at once. */
const FILL_CONCURRENCY = 4;

/** What a route that fills a connected workspace's drives is handed: the edge's runner a fill's checkout runs through, and the agents' image the function ships. */
export interface BaseDriveFills {
  readonly run: SandboxRunner;
  readonly image: Layer.Layer<AgentImage>;
}

/** One repository's base drive filled where none stands, on a read token for it alone, its firewall written under the workspace's owner. */
const filledOne = (
  run: SandboxRunner,
  image: string,
  workspace: BaseDriveWorkspace,
  fullName: string,
) =>
  Effect.gen(function* () {
    const api = yield* Sandbox;
    if (yield* api.driveStands(baseDriveName({ workspaceId: workspace.workspaceId, fullName }))) {
      return;
    }
    const reached = yield* (yield* GitHubApp).repositoryReadToken(
      workspace.workspaceId,
      fullName,
      undefined,
    );
    if (Option.isNone(reached) || reached.value.access.kind !== GITHUB_ACCESS.APP) return;
    const { repository, token, access } = reached.value;
    const context = yield* Effect.context<DatabaseServices>();
    yield* fillBaseDrive(
      {
        workspaceId: workspace.workspaceId,
        fullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
      },
      image,
      { token, access },
      (running) =>
        repositorySandboxOver(
          api,
          running,
          run,
          repositoryFirewallOver(api, context, firewallSessionOf(running, workspace.userId), {}),
        ),
      BASE_WANTED.MISSING,
    );
  });

/** Every repository the workspace's installations grant given a base drive where none stands. */
export const filledWorkspace = (run: SandboxRunner, workspace: BaseDriveWorkspace) =>
  Effect.gen(function* () {
    const image = yield* Effect.flatMap(AgentImage, (agentImage) => agentImage.reference);
    const listed = yield* (yield* GitHubApp).workspaceRepositories(workspace.workspaceId);
    yield* Effect.forEach(
      Option.getOrElse(listed, () => []),
      (repository) =>
        filledOne(run, image, workspace, repository.fullName).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.logError(
                  `a connected repository's base drive fill failed: ${causeKind(cause)}`,
                ),
          ),
        ),
      { concurrency: FILL_CONCURRENCY, discard: true },
    );
  });

/** The workspace's base drives filled past the request's answer, its GitHub reads in the background lane, since no member waits on them; nothing in a route with no sandboxes. */
export const filledInBackground = (fills: BaseDriveFills, workspace: BaseDriveWorkspace) =>
  Effect.gen(function* () {
    const sandbox = yield* Effect.serviceOption(Sandbox);
    if (Option.isNone(sandbox)) return;
    yield* afterResponse(
      "A connected workspace's base drives",
      filledWorkspace(fills.run, workspace).pipe(
        Effect.provide(fills.image),
        Effect.provideService(GitHubBackground, true),
        Effect.provideService(Sandbox, sandbox.value),
      ),
    );
  });
