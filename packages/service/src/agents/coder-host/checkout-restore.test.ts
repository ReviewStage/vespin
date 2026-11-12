/**
 * checkout-restore.test.ts -- a coding agent's sandbox checkout put back to a snapshot, and diffed between two, over the memory sandbox: the one script of each run in the checkout with its variables, the sandbox touched as a use, and what each way it ends comes to.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { getTestDB } from "@repo/database/testing";
import {
  CHECKOUT_DIFF_EXIT,
  CHECKOUT_DIFF_SCRIPT,
  checkoutDiffEnv,
} from "@repo/features/checkout-diff";
import {
  CHECKOUT_RESTORE_EXIT,
  CHECKOUT_RESTORE_SCRIPT,
  checkoutRestoreEnv,
} from "@repo/features/checkout-restore";
import { ImageNotReady, SANDBOX_CALL, SANDBOX_STATUS, Sandbox } from "@repo/sandbox";
import { type MemorySandbox, memorySandbox } from "@repo/sandbox/testing";
import { Effect, Layer } from "effect";
import { AfterResponse } from "../../http/after-response.js";
import { AGENT_OWN_DRIVE, agentSandboxName } from "../agent-sandbox-open.js";
import { CHECKOUT_DIFF_OUTCOME, RESTORE_OUTCOME } from "../machine/agent-machine.js";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";
import { agentSandboxLayer } from "../terminal/agent-sandbox.js";
import { AgentImage } from "./agent-image.js";
import { diffCheckout, restoreCheckout } from "./checkout-restore.js";

const SESSION = "session-for-restore";

const SNAPSHOT = {
  commit: "0123456789abcdef0123456789abcdef01234567",
  head: "89abcdef0123456789abcdef0123456789abcdef",
  branch: "feat/invitations",
};

/** The memory's sandboxes, with the Terminal's wake of a stopped one over them on a fixture image. */
const withWake = (memory: MemorySandbox) =>
  Layer.provideMerge(
    agentSandboxLayer,
    Layer.merge(
      memory.layer,
      Layer.succeed(AgentImage, {
        reference: Effect.succeed("agent-image:fixture"),
        runner: Effect.succeed([]),
      }),
    ),
  );

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
    }).pipe(Effect.provide(withWake(memory)));

    return { outcome, state: memory.state };
  });

/** The diff asked of the agent's sandbox, up under its session's name, whose run exits as scripted and prints what it is given. */
const diffed = (exitCode: number, stdout = "", sessionId = SESSION) =>
  Effect.gen(function* () {
    const memory = memorySandbox({ run: () => ({ exitCode, stdout, stderr: "" }) });

    const outcome = yield* Effect.gen(function* () {
      const sandboxes = yield* Sandbox;
      yield* sandboxes.getOrCreate({
        name: agentSandboxName(SESSION),
        from: { image: "agents" },
        tags: { sessionId: SESSION },
        env: {},
      });

      return yield* diffCheckout(sandboxes, {
        sessionId,
        range: { from: SNAPSHOT.commit, to: null },
      });
    }).pipe(Effect.provide(withWake(memory)));

    return { outcome, state: memory.state };
  });

it.layer(getTestDB())("a cloud agent's checkout restored", (it) => {
  it.effect(
    "runs the restore script in the checkout with the snapshot in its variables, touching the sandbox as a use, and answers restored where it exits well",
    () =>
      Effect.gen(function* () {
        const { outcome, state } = yield* restored(0);
        assert.equal(outcome, RESTORE_OUTCOME.RESTORED);
        assert.deepEqual(
          state.commands.map((command) => command.ask),
          [
            {
              command: "sh",
              args: ["-c", CHECKOUT_RESTORE_SCRIPT],
              cwd: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
              env: checkoutRestoreEnv(SNAPSHOT),
            },
          ],
        );
        assert.deepEqual(
          state.touched.map((touch) => touch.name),
          [agentSandboxName(SESSION)],
        );
      }),
  );

  it.effect(
    "answers the snapshot missing where the script says so, no sandbox stands for the session, or the stopped sandbox's own snapshot is gone, and failed where it exits otherwise",
    () =>
      Effect.gen(function* () {
        assert.equal(
          (yield* restored(CHECKOUT_RESTORE_EXIT.MISSING)).outcome,
          RESTORE_OUTCOME.MISSING,
        );
        assert.equal((yield* restored(0, "another-session")).outcome, RESTORE_OUTCOME.MISSING);
        assert.equal((yield* restored(1)).outcome, RESTORE_OUTCOME.FAILED);

        const memory = memorySandbox();
        memory.stand({
          name: agentSandboxName(SESSION),
          status: SANDBOX_STATUS.STOPPED,
          snapshotId: "snap_expired",
          tags: { sessionId: SESSION },
        });
        memory.state.goneSnapshots.add("snap_expired");

        const outcome = yield* restoreCheckout(memory.service, {
          sessionId: SESSION,
          snapshot: SNAPSHOT,
        }).pipe(Effect.provide(withWake(memory)));

        assert.deepEqual([outcome, memory.state.commands], [RESTORE_OUTCOME.MISSING, []]);
      }),
  );

  it.effect(
    "makes a stopped sandbox, which kept no disk, again from the image on its own drive, and runs the restore there",
    () =>
      Effect.gen(function* () {
        const memory = memorySandbox();

        const outcome = yield* Effect.gen(function* () {
          const sandboxes = yield* Sandbox;

          const first = yield* sandboxes.getOrCreate({
            name: agentSandboxName(SESSION),
            from: { image: "agents" },
            drive: AGENT_OWN_DRIVE,
            tags: { sessionId: SESSION },
            env: {},
          });

          yield* sandboxes.stop(first);

          return yield* restoreCheckout(sandboxes, { sessionId: SESSION, snapshot: SNAPSHOT });
        }).pipe(Effect.provide(withWake(memory)));

        assert.equal(outcome, RESTORE_OUTCOME.RESTORED);
        assert.deepEqual(memory.state.deleted, [agentSandboxName(SESSION)]);
        assert.deepEqual(
          memory.state.commands.map((command) => [command.ask.args, command.running]),
          [
            [
              ["-c", CHECKOUT_RESTORE_SCRIPT],
              memory.state.sandboxes.get(agentSandboxName(SESSION))?.running,
            ],
          ],
        );
      }),
  );
  it.effect(
    "answers failed, never missing, where a stopped sandbox on its own drive is still starting on an image being prepared",
    () =>
      Effect.gen(function* () {
        let imageReady = true;

        const memory = memorySandbox({
          fail: (call) =>
            call === SANDBOX_CALL.GET_OR_CREATE && !imageReady
              ? new ImageNotReady({ call })
              : undefined,
        });

        const outcome = yield* Effect.gen(function* () {
          const sandboxes = yield* Sandbox;

          const first = yield* sandboxes.getOrCreate({
            name: agentSandboxName(SESSION),
            from: { image: "agents" },
            drive: AGENT_OWN_DRIVE,
            tags: { sessionId: SESSION },
            env: {},
          });

          yield* sandboxes.stop(first);
          imageReady = false;

          return yield* restoreCheckout(sandboxes, { sessionId: SESSION, snapshot: SNAPSHOT });
        }).pipe(
          Effect.provide(withWake(memory)),
          // The open the wake hands past the answer is let go of, as the request's answer leaves first.
          Effect.provideService(AfterResponse, { keep: () => Effect.void }),
        );

        assert.deepEqual([outcome, memory.state.commands], [RESTORE_OUTCOME.FAILED, []]);
      }),
  );
});

it.layer(getTestDB())("a cloud agent's checkout diffed", (it) => {
  it.effect(
    "runs the diff script in the checkout with the two sides in its variables, the working tree as an empty second side, touching the sandbox as a use, and answers what git printed",
    () =>
      Effect.gen(function* () {
        const { outcome, state } = yield* diffed(0, "diff --git a/x b/x\n");
        assert.deepEqual(outcome, {
          outcome: CHECKOUT_DIFF_OUTCOME.DIFFED,
          diff: "diff --git a/x b/x\n",
        });
        assert.deepEqual(
          state.commands.map((command) => command.ask),
          [
            {
              command: "sh",
              args: ["-c", CHECKOUT_DIFF_SCRIPT],
              cwd: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
              env: checkoutDiffEnv({ from: SNAPSHOT.commit, to: null }),
            },
          ],
        );
        assert.deepEqual(
          state.touched.map((touch) => touch.name),
          [agentSandboxName(SESSION)],
        );
      }),
  );

  it.effect(
    "answers a side missing where the script says so or no sandbox stands for the session, and failed where it exits otherwise",
    () =>
      Effect.gen(function* () {
        assert.deepEqual((yield* diffed(CHECKOUT_DIFF_EXIT.MISSING)).outcome, {
          outcome: CHECKOUT_DIFF_OUTCOME.MISSING,
        });
        assert.deepEqual((yield* diffed(0, "", "another-session")).outcome, {
          outcome: CHECKOUT_DIFF_OUTCOME.MISSING,
        });
        assert.deepEqual((yield* diffed(1)).outcome, { outcome: CHECKOUT_DIFF_OUTCOME.FAILED });
      }),
  );
});
