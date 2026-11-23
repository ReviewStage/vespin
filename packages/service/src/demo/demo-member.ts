/**
 * demo-member.ts -- a fresh member of their own for one end-to-end journey: an account with its empty personal workspace, a task in it where asked, a model credential where handed in, and setup finished where asked, written through the store's own models.
 *
 * Every id is new (`randomUUID`), so journeys seeded into one database
 * never meet: the account's, and the workspace's and member's that the
 * caller's Better Auth mints (`demoAuth` with a random `mintId`). Note that
 * the task names no repository, so nothing reached through it calls
 * GitHub, and that the credential is saved and marked the member's agents'
 * payer as the demo seed saves Dean's, because a Start with none is refused
 * (`AgentCredentialMissing`).
 */

import { randomUUID } from "node:crypto";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { writeAccountPreferences } from "@repo/database/models/account-store";
import { createTaskOnce, type TaskAssigneeNotMember } from "@repo/database/models/task-store";
import { ensurePersonalWorkspace } from "@repo/database/models/workspace-store";
import { TASK_STATUS } from "@repo/features/task-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { type Cause, Clock, Effect, Option } from "effect";
import {
  type DemoAuth,
  type DemoCredential,
  DemoSeedRefused,
  sealedCredential,
  seedCredential,
} from "./demo-seed.js";

/** The name every journey's member goes by. */
const MEMBER_NAME = "Journey Member";

/** What a journey asks of its member's world beyond the account and the workspace. */
export interface DemoMemberAsk {
  /** The name of a task to make in the workspace, assigned to the member; none where absent. */
  readonly taskName?: string;
  /** A credential saved as the member's, for their agents; none where absent. */
  readonly credential?: DemoCredential;
  /** Whether the account finished setup, so the window lets it in at once (`setupGate`); not where absent. */
  readonly setupFinished?: boolean;
}

/** The ids of what was written. */
export interface DemoMemberSeeded {
  readonly userId: string;
  readonly email: string;
  readonly workspaceId: string;
  /** The task's id, where one was asked for. */
  readonly taskId: string | undefined;
}

/** The value written, or the step refused by name where its model wrote nothing. */
function written<A>(step: string, outcome: Option.Option<A>) {
  return Option.match(outcome, {
    onNone: () => Effect.fail(new DemoSeedRefused({ step })),
    onSome: Effect.succeed,
  });
}

/**
 * Writes a fresh member, their personal workspace, and what the journey
 * asked for. The credential is sealed first, so a ring that does not parse
 * refuses the seed before anything is written.
 */
export function seedDemoMember(
  auth: DemoAuth,
  ask: DemoMemberAsk,
): Effect.Effect<
  DemoMemberSeeded,
  DemoSeedRefused | Cause.UnknownError | StoreFailure | TaskAssigneeNotMember,
  DatabaseServices
> {
  return Effect.gen(function* () {
    const userId = randomUUID();
    const email = `${userId}@example.com`;

    const sealed = yield* Effect.transposeOption(
      Option.map(Option.fromNullishOr(ask.credential), (handed) =>
        sealedCredential(handed, userId),
      ),
    );

    const now = new Date(yield* Clock.currentTimeMillis);
    const person = { id: userId, name: MEMBER_NAME, email, role: WORKSPACE_ROLE.OWNER };
    yield* auth.createUser(person, now);

    const workspaceId = yield* written(
      "the member's own workspace",
      yield* ensurePersonalWorkspace(userId, auth.workspaces),
    );

    if (Option.isSome(sealed)) yield* seedCredential(sealed.value);

    if (ask.setupFinished === true) yield* writeAccountPreferences(userId, { setupFinished: true });

    if (ask.taskName === undefined) return { userId, email, workspaceId, taskId: undefined };

    const made = yield* createTaskOnce(userId, {
      id: randomUUID(),
      organizationId: workspaceId,
      name: ask.taskName,
      status: TASK_STATUS.TODO,
      assigneeId: userId,
      text: "",
    });

    const task = yield* written(ask.taskName, made);

    return { userId, email, workspaceId, taskId: task.id };
  });
}
