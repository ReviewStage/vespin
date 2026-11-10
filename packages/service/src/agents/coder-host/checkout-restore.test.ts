/**
 * checkout-restore.test.ts -- a coding agent's sandbox checkout put back to a snapshot, over the memory sandbox: the one restore script run in the checkout with the snapshot in its variables, and what each way it ends comes to.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  CHECKOUT_RESTORE_EXIT,
  CHECKOUT_RESTORE_SCRIPT,
  checkoutRestoreEnv,
} from "@repo/features/checkout-restore";
import { Sandbox } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { Effect } from "effect";
import { agentSandboxName } from "../agent-sandbox-open.js";
import { RESTORE_OUTCOME } from "../machine/agent-machine.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import { restoreCheckout } from "./checkout-restore.js";

const SESSION = "session-for-restore";
const SNAPSHOT = {
  commit: "0123456789abcdef0123456789abcdef01234567",
  head: "89abcdef0123456789abcdef0123456789abcdef",
  branch: "feat/invitations",
};

/** The restore asked of the agent's sandbox, up under its session's name, whose run exits as scripted. */
const restored = (exitCode: number, sessionId = SESSION) =>
  Effect.gen(function* () {
    const memory = memorySandbox({ run: () => ({ exitCode, stdout: "", stderr: "" }) });
    const outcome = yield* Effect.gen(function* () {
      const sandboxes = yield* Sandbox;
      yield* sandboxes.getOrCreate({
        name: agentSandboxName(SESSION),
        from: { image: "agents" },
        tags: { sessionId: SESSION },
        env: {},
      });
      return yield* restoreCheckout(sandboxes, { sessionId, snapshot: SNAPSHOT });
    }).pipe(Effect.provide(memory.layer));
    return { outcome, commands: memory.state.commands };
  });

it.effect(
  "runs the restore script in the checkout with the snapshot in its variables, and answers restored where it exits well",
  () =>
    Effect.gen(function* () {
      const { outcome, commands } = yield* restored(0);
      assert.equal(outcome, RESTORE_OUTCOME.RESTORED);
      assert.deepEqual(
        commands.map((command) => command.ask),
        [
          {
            command: "sh",
            args: ["-c", CHECKOUT_RESTORE_SCRIPT],
            cwd: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
            env: checkoutRestoreEnv(SNAPSHOT),
          },
        ],
      );
    }),
);

it.effect(
  "answers the snapshot missing where the script says so or no sandbox stands for the session, and failed where it exits otherwise",
  () =>
    Effect.gen(function* () {
      assert.equal(
        (yield* restored(CHECKOUT_RESTORE_EXIT.MISSING)).outcome,
        RESTORE_OUTCOME.MISSING,
      );
      assert.equal((yield* restored(0, "another-session")).outcome, RESTORE_OUTCOME.MISSING);
      assert.equal((yield* restored(1)).outcome, RESTORE_OUTCOME.FAILED);
    }),
);
