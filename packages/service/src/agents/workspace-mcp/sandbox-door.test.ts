import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { SANDBOX_STATUS, type Sandbox } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { Effect } from "effect";
import { sandboxMachineLayer } from "../machine/sandbox-machine.js";
import type { AdmittedConversation } from "../sessions/admitted-conversation.js";
import { agentSandboxDoors, SANDBOX_DOOR_MAX_BYTES } from "./sandbox-door.js";

/**
 * The door to a native agent's sandbox, through `Sandbox` kept in memory:
 * the sandbox tagged with the agent's session is found, the file is read
 * from its run by a command, a path that is no file is no file, a file past
 * every tool's bound is read only one byte past it, a file is written under
 * its attachments folder, and a conversation that
 * records no session opens no door. The read's command runs in a real bash
 * over a temporary directory standing in for the sandbox's disk.
 */

const SESSION = "claude-code-fixture";

/** A temporary directory standing in for the sandbox's disk, holding the files given by their path under it. */
function disk(files: Readonly<Record<string, Uint8Array>>): string {
  const root = mkdtempSync(join(tmpdir(), "sandbox-door-"));

  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }

  return root;
}

/** The sandboxes tagged with the session, one stopped and one up, each command run in the stand-in disk given. */
function standing(root: string) {
  const sandbox = memorySandbox({
    run: (command) => {
      const ran = spawnSync(command.ask.command, [...command.ask.args], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });

      return { exitCode: ran.status ?? 1, stdout: ran.stdout, stderr: ran.stderr };
    },
  });

  sandbox.stand({
    name: "sbx-stopped",
    tags: { sessionId: SESSION },
    status: SANDBOX_STATUS.STOPPED,
    createdAt: 0,
  });
  const up = sandbox.stand({ name: "sbx-up", tags: { sessionId: SESSION }, createdAt: 1 });

  return { sandbox, up };
}

const ADMITTED: AdmittedConversation = {
  caller: "user-fixture",
  target: { userId: "user-fixture", conversationId: "conversation-fixture" },
  runtimeSessionId: SESSION,
  timeZone: undefined,
};

/** The doors over the layer given, their effects run on this test's own context. */
const doorsOver = (admitted: AdmittedConversation) =>
  Effect.map(Effect.context<Sandbox>(), (context) => {
    const run = <A, E>(effect: Effect.Effect<A, E, Sandbox>) =>
      Effect.runPromiseWith(context)(effect);

    return agentSandboxDoors(run, sandboxMachineLayer({ run }))(admitted);
  });

/** The file door over the layer given. */
const doorOver = (admitted: AdmittedConversation) =>
  Effect.map(doorsOver(admitted), (doors) => doors.files);

/** A stream read whole. */
async function bytesOf(stream: ReadableStream<Uint8Array> | null): Promise<number[] | null> {
  if (stream === null) return null;

  return [...new Uint8Array(await new Response(stream).arrayBuffer())];
}

it.effect(
  "a file is read from the running sandbox tagged with the agent's session, by its path, under the capability drop, and a path that is no file is no file",
  () =>
    Effect.gen(function* () {
      const root = disk({ "repository/shot.png": new Uint8Array([1, 0, 255, 10, 3]) });
      const { sandbox: memory, up } = standing(root);
      const door = yield* doorOver(ADMITTED).pipe(Effect.provide(memory.layer));

      const sandbox = yield* Effect.promise(() => door());

      const readOf = (path: string) =>
        Effect.promise(async () => bytesOf(await sandbox.readFile({ path })));

      const read = yield* readOf(join(root, "repository/shot.png"));
      const missing = yield* readOf(join(root, "repository/none.png"));
      const directory = yield* readOf(join(root, "repository"));

      assert.deepEqual(read, [1, 0, 255, 10, 3]);
      assert.equal(missing, null);
      assert.equal(directory, null);
      assert.ok(memory.state.commands.every((each) => each.running === up.running));
      assert.deepEqual(memory.state.resumed, []);
    }),
);

it.effect("a file past every tool's bound is read only one byte past it", () =>
  Effect.gen(function* () {
    const root = disk({ "big.bin": new Uint8Array(SANDBOX_DOOR_MAX_BYTES + 4096) });
    const { sandbox: memory } = standing(root);
    const door = yield* doorOver(ADMITTED).pipe(Effect.provide(memory.layer));

    const sandbox = yield* Effect.promise(() => door());

    const read = yield* Effect.promise(async () =>
      bytesOf(await sandbox.readFile({ path: join(root, "big.bin") })),
    );

    assert.equal(read?.length, SANDBOX_DOOR_MAX_BYTES + 1);
  }),
);

it.effect(
  "a file is written into the running sandbox tagged with the agent's session, under its attachments folder, readable by the agent, answering its path",
  () =>
    Effect.gen(function* () {
      const { sandbox: memory, up } = standing(tmpdir());
      const door = yield* doorOver(ADMITTED).pipe(Effect.provide(memory.layer));
      const contents = new TextEncoder().encode("%PDF-1.7 the spec");

      const sandbox = yield* Effect.promise(() => door());

      const path = yield* Effect.promise(async () =>
        sandbox.writeFile?.({ name: "description/spec.pdf", contents }),
      );

      assert.equal(path, "/tmp/agent-attachments/description/spec.pdf");
      assert.deepEqual(memory.state.files, [
        { name: up.name, running: up.running, file: { path, contents, mode: 0o644 } },
      ]);
    }),
);

it.effect("a conversation that records no session opens no door", () =>
  Effect.gen(function* () {
    const { sandbox: memory } = standing(tmpdir());

    const door = yield* doorOver({ ...ADMITTED, runtimeSessionId: undefined }).pipe(
      Effect.provide(memory.layer),
    );

    const opened = yield* Effect.promise(() =>
      door().then(
        () => "opened",
        () => "refused",
      ),
    );

    assert.equal(opened, "refused");
    assert.deepEqual(memory.state.commands, []);
  }),
);
