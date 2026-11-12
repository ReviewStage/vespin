import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { AGENT_USER } from "@repo/agent-runner/pins";
import { Database } from "@repo/database/core/query";
import { user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { SANDBOX_STATE } from "@repo/features/terminal-wire";
import {
  type CommandRun,
  OPEN_INTERNET,
  SANDBOX_STATUS,
  type SandboxStatus,
  SandboxUnavailable,
} from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { Duration, Effect, Fiber, Layer, Redacted, Result } from "effect";
import { TestClock } from "effect/testing";
import { LOCAL_AGENT_ENVIRONMENT } from "../../testing/local-agent.js";
import { agentSandboxName } from "../agent-sandbox-open.js";
import { AgentImage } from "../coder-host/agent-image.js";
import { AgentSandbox, agentSandboxLayer, SHELL_REFUSAL } from "./agent-sandbox.js";
import { RUN_ACTION_EXIT, RUN_ACTION_SIGNAL, TMUX_EXIT } from "./tmux.js";

/**
 * A coding agent's sandbox as its Terminal tab reaches it, through `Sandbox`
 * kept in memory, its tmux answering from a script: a stopped sandbox lists no
 * shells and is never woken by a list or a start, a running one's shells are
 * read from tmux in its running session, a shell starts under the id given
 * and is read back, one tmux does not hold is not found, a list tmux could
 * not give is an outage, and only a resume wakes a stopped sandbox, by its
 * name. A GitHub credential is set at the firewall in its shape: an
 * installation's on GitHub's two hosts, a member's own on its repository's
 * paths alone, its record kept in the test's own database under a key ring
 * of the suite's.
 */

const SESSION = "wrun_fixture";
/** The agents' image as a deploy names it, the fixture's. */
const FIXTURE_IMAGE = {
  reference: Effect.succeed("agent-image:fixture"),
  runner: Effect.succeed([]),
};
const SANDBOX = agentSandboxName(SESSION);
const RUNNING_SESSION = "sbs_running";
const SHELL = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";
const REPOSITORY = "Acme/Relay";
const MEMBER_TOKEN = "member-token-fixture";

/** The running session of the fixture's sandbox, under an account of its own, whose firewall a credential is set at. */
const ownSession = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  return { userId, name: SANDBOX, sandboxSessionId: RUNNING_SESSION };
});

/** A command's end as tmux answers it: its exit, and what it printed. */
const ran = (exitCode: number, stdout = ""): CommandRun => ({ exitCode, stdout, stderr: "" });

/**
 * The fixture's sandbox as the memory has it: in the status given, none
 * where none is given; tmux listing the shells given, or exiting the code
 * given; the shell check exiting its own code for a shell tmux does not hold.
 */
function standing(
  status: SandboxStatus | undefined,
  shells: readonly string[] = [],
  listExit = 0,
  shellCheckExit: number = TMUX_EXIT.NO_SESSION,
) {
  const sandbox = memorySandbox({
    run: ({ ask }) => {
      // Every command is `sh -c <script> sh <tmux args>`; the list is the one with none.
      const scriptAt = ask.args.indexOf("-c") + 1;
      const tmuxArgs = ask.args.slice(scriptAt + 2);
      if (tmuxArgs.length === 0) return ran(listExit, shells.join("\n"));
      if (tmuxArgs[0] === "new-session") return ran(0);
      const named = tmuxArgs.some((arg) => arg.startsWith(`=terminal-${SHELL}`));
      // The shell check exits its own code for a session tmux does not hold, or what a tmux that would not start exits.
      if (ask.args[scriptAt]?.includes("has-session")) return ran(named ? 0 : shellCheckExit);
      return ran(named ? 0 : 1);
    },
  });
  if (status !== undefined) {
    sandbox.stand({
      name: SANDBOX,
      status,
      running: RUNNING_SESSION,
      tags: { sessionId: SESSION },
    });
  }
  const layer = Layer.provide(
    agentSandboxLayer,
    Layer.mergeAll(
      LOCAL_AGENT_ENVIRONMENT,
      Layer.succeed(AgentImage, FIXTURE_IMAGE),
      sandbox.layer,
    ),
  );
  return { layer, state: sandbox.state, sandbox };
}

/** One field as the list prints it: what tmux printed, newline and all, in base64. */
const field = (value: string) => Buffer.from(`${value}\n`).toString("base64");

const listedShell = (id: string, title: string, command: string) =>
  [`terminal-${id}`, "100", field(title), field(command), field("/workspace/repository")].join(" ");

const ACTION = "5b7c1e1a-3f0d-4c55-9a52-0d7f2b9e6a01";
const ACTION_RUN = { actionId: ACTION, label: "Dev server", command: "pnpm dev", environment: {} };

/**
 * A running sandbox whose tmux holds at most the one run action's session,
 * as tmux would: started by `new-session`, run again by `respawn-pane` only
 * once its process has exited (`exit`), and its process group living through
 * as many probes after a signal as given, forever where none is.
 */
function actionTmux(probesLived?: number) {
  let started: string | undefined;
  let pane = "0  ";
  let probes = 0;
  const sent: string[] = [];
  const sandbox = memorySandbox({
    run: ({ ask }) => {
      const scriptAt = ask.args.indexOf("-c") + 1;
      const rest = ask.args.slice(scriptAt + 2);
      // Note that the list has no arguments, and a signal names its shell and the signal.
      if (rest.length === 2 && ask.args[scriptAt]?.includes("kill -")) {
        if (started === undefined) return ran(RUN_ACTION_EXIT.NO_SESSION);
        sent.push(rest[1] ?? "");
        if (rest[1] === RUN_ACTION_SIGNAL.KILL) return ran(RUN_ACTION_EXIT.ENDED);
        if (rest[1] === RUN_ACTION_SIGNAL.PROBE) probes += 1;
        return ran(probesLived !== undefined && probes >= probesLived ? RUN_ACTION_EXIT.ENDED : 0);
      }
      if (rest.length === 0) {
        if (started === undefined) return ran(0);
        const line = [`terminal-${started}`, "100", field("Dev server"), field("bash")];
        return ran(
          0,
          [...line, field("/workspace/repository"), field(ACTION), field(pane)].join(" "),
        );
      }
      if (rest[0] === "new-session") {
        started = (rest[rest.indexOf("-s") + 1] ?? "").replace("terminal-", "");
      }
      if (rest[0] === "respawn-pane") {
        if (pane.startsWith("0")) return ran(1);
        pane = "0  ";
      }
      return ran(0);
    },
  });
  sandbox.stand({
    name: SANDBOX,
    status: SANDBOX_STATUS.RUNNING,
    running: RUNNING_SESSION,
    tags: { sessionId: SESSION },
  });
  const layer = Layer.provide(
    agentSandboxLayer,
    Layer.mergeAll(
      LOCAL_AGENT_ENVIRONMENT,
      Layer.succeed(AgentImage, FIXTURE_IMAGE),
      sandbox.layer,
    ),
  );
  return {
    layer,
    /** The process exits, its pane standing dead with the dead flag, status, and signal given. */
    exit: (dead: string) => {
      pane = dead;
    },
    /** The args of each tmux command of the kind asked so far. */
    asked: (kind: string) =>
      sandbox.state.commands.flatMap((command) =>
        command.ask.args.includes(kind) ? [command.ask.args] : [],
      ),
    /** The signals sent to the action's group, in order. */
    signals: () => [...sent],
  };
}

it.layer(getTestDB())("a coding agent's sandbox", (it) => {
  it.effect(
    "a stopped sandbox lists no shells and no ports, and is never woken by a list or a start",
    () =>
      Effect.gen(function* () {
        const api = standing(SANDBOX_STATUS.STOPPED);

        const { listed, ports, started } = yield* Effect.gen(function* () {
          const sandbox = yield* AgentSandbox;
          return {
            listed: yield* sandbox.terminals(SESSION),
            ports: yield* sandbox.listeningPorts(SESSION),
            started: yield* sandbox.start(SESSION, SHELL, undefined),
          };
        }).pipe(Effect.provide(api.layer));

        assert.deepEqual(listed, { sandbox: SANDBOX_STATE.STOPPED, terminals: [] });
        assert.deepEqual(ports, { running: false, ports: [], labels: [] });
        assert.deepEqual(
          started,
          Result.fail({ kind: SHELL_REFUSAL.NOT_RUNNING, sandbox: SANDBOX_STATE.STOPPED }),
        );
        assert.deepEqual(api.state.resumed, []);
        assert.deepEqual(api.state.commands, []);
      }),
  );

  it.effect(
    "a running sandbox's shells are read from tmux in its running session, and one never opened is starting",
    () =>
      Effect.gen(function* () {
        const api = standing(SANDBOX_STATUS.RUNNING, [listedShell(SHELL, "dev server", "node")]);

        const listed = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
          sandbox.terminals(SESSION),
        ).pipe(Effect.provide(api.layer));
        const never = standing(undefined);
        const unopened = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
          sandbox.terminals(SESSION),
        ).pipe(Effect.provide(never.layer));

        assert.deepEqual(listed, {
          sandbox: SANDBOX_STATE.RUNNING,
          terminals: [
            {
              id: SHELL,
              title: "dev server",
              command: "node",
              cwd: "/workspace/repository",
              running: true,
            },
          ],
        });
        assert.equal(api.state.commands[0]?.running, RUNNING_SESSION);
        assert.deepEqual(unopened, { sandbox: SANDBOX_STATE.STARTING, terminals: [] });
      }),
  );

  it.effect(
    "a running sandbox's ports are the ones its servers listen on, each once, never root's or the browser's, each with what serves it, and tables it could not read are an outage",
    () =>
      Effect.gen(function* () {
        // The kernel's tables as `cat` prints them, by hand: the sandbox's init on 23456 as root,
        // the browser's DevTools on 9333, a dev server on 3000 over both families with a connection
        // to it, and a server on 5173.
        const tables = [
          "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
          "   0: 00000000:5BA0 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 3107 1",
          "   1: 0100007F:2475 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1002        0 4100 1",
          "   2: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1002        0 4200 1",
          "   3: 0100007F:A2D2 0100007F:0BB8 01 00000000:00000000 00:00000000 00000000  1002        0 4300 1",
          "  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
          "   0: 00000000000000000000000000000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1002        0 4500 1",
          "   1: 00000000000000000000000000000000:1435 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 4600 1",
        ];
        // Then the listeners the script printed as root: both servers started by one `pnpm dev`, as a
        // monorepo's are, so each is named by what listens on it, and a line it could not have printed.
        const listeners = [
          "vespin-listeners",
          JSON.stringify({
            inode: "4200",
            command: ["pnpm", "dev"],
            listener: ["node", "/w/node_modules/next/dist/bin/next", "dev"],
          }),
          JSON.stringify({
            inode: "4600",
            command: ["pnpm", "dev"],
            listener: ["/w/node_modules/.bin/vite", "--port", "5173"],
          }),
          "not a listener",
        ];
        const api = standing(SANDBOX_STATUS.RUNNING, [...tables, ...listeners]);
        const unread = standing(SANDBOX_STATUS.RUNNING, [], 1);

        const ports = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
          sandbox.listeningPorts(SESSION),
        ).pipe(Effect.provide(api.layer));
        const outage = yield* Effect.flip(
          Effect.flatMap(AgentSandbox, (sandbox) => sandbox.listeningPorts(SESSION)).pipe(
            Effect.provide(unread.layer),
          ),
        );

        assert.deepEqual(ports, {
          running: true,
          ports: [3000, 5173],
          labels: [
            { port: 3000, label: "next dev" },
            { port: 5173, label: "vite" },
          ],
        });
        assert.equal(api.state.commands[0]?.running, RUNNING_SESSION);
        assert.ok(outage instanceof SandboxUnavailable);
      }),
  );

  it.effect(
    "a shell starts in the running sandbox under the id given and is read back, and one tmux does not hold is not found",
    () =>
      Effect.gen(function* () {
        const api = standing(SANDBOX_STATUS.RUNNING, [listedShell(SHELL, "", "bash")]);
        const other = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";

        const { started, renamedOther } = yield* Effect.gen(function* () {
          const sandbox = yield* AgentSandbox;
          return {
            started: yield* sandbox.start(SESSION, SHELL, undefined),
            renamedOther: yield* sandbox.rename(SESSION, other, "tests"),
          };
        }).pipe(Effect.provide(api.layer));

        assert.deepEqual(
          started,
          Result.succeed({
            id: SHELL,
            title: "bash",
            command: "bash",
            cwd: "/workspace/repository",
            running: false,
          }),
        );
        assert.deepEqual(renamedOther, Result.fail({ kind: SHELL_REFUSAL.NOT_FOUND }));
      }),
  );

  it.effect(
    "a run action starts one process, a second press while it runs starts nothing, and one whose process exited runs again in its own pane; a stopped sandbox is refused, never woken",
    () =>
      Effect.gen(function* () {
        const tmux = actionTmux();
        const stopped = standing(SANDBOX_STATUS.STOPPED);
        const other = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";
        const press = (terminalId: string) =>
          Effect.flatMap(AgentSandbox, (agentSandbox) =>
            agentSandbox.run(SESSION, terminalId, ACTION_RUN),
          ).pipe(Effect.provide(tmux.layer));

        const first = yield* press(SHELL);
        const again = yield* press(other);
        // The action's process exits 1, its pane kept, as tmux's `remain-on-exit` leaves it.
        tmux.exit("1 1 ");
        const exited = yield* press(other);
        const refused = yield* Effect.flatMap(AgentSandbox, (agentSandbox) =>
          agentSandbox.run(SESSION, SHELL, ACTION_RUN),
        ).pipe(Effect.provide(stopped.layer));

        const runningShell = {
          id: SHELL,
          title: "Dev server",
          command: "bash",
          cwd: "/workspace/repository",
          running: true,
          runAction: ACTION,
        };
        assert.deepEqual(first, Result.succeed(runningShell));
        assert.deepEqual(again, first);
        assert.deepEqual(exited, first);
        assert.deepEqual(tmux.asked("new-session").length, 1);
        const respawned = tmux.asked("respawn-pane");
        assert.equal(respawned.length, 1);
        assert.ok(respawned[0]?.includes(`=terminal-${SHELL}:`));
        assert.ok(respawned[0]?.includes("pnpm dev"));
        assert.deepEqual(
          refused,
          Result.fail({ kind: SHELL_REFUSAL.NOT_RUNNING, sandbox: SANDBOX_STATE.STOPPED }),
        );
        assert.deepEqual(stopped.state.resumed, []);
      }),
  );

  it.effect(
    "a stop sends TERM to the action's process group, and KILL only once it outlives five seconds",
    () =>
      Effect.gen(function* () {
        const stubborn = actionTmux();
        const stop = (tmux: ReturnType<typeof actionTmux>) =>
          Effect.flatMap(AgentSandbox, (agentSandbox) => agentSandbox.stop(SESSION, ACTION)).pipe(
            Effect.provide(tmux.layer),
          );
        yield* Effect.flatMap(AgentSandbox, (agentSandbox) =>
          agentSandbox.run(SESSION, SHELL, ACTION_RUN),
        ).pipe(Effect.provide(stubborn.layer));

        const stopping = yield* Effect.forkChild(stop(stubborn));
        yield* TestClock.adjust(Duration.millis(4_900));
        const killedEarly = stubborn.signals().includes(RUN_ACTION_SIGNAL.KILL);
        yield* TestClock.adjust(Duration.millis(100));
        const stopped = yield* Fiber.join(stopping);

        // A group that ends on TERM, after the first wait, is never killed.
        const willing = actionTmux(1);
        yield* Effect.flatMap(AgentSandbox, (agentSandbox) =>
          agentSandbox.run(SESSION, SHELL, ACTION_RUN),
        ).pipe(Effect.provide(willing.layer));
        const ending = yield* Effect.forkChild(stop(willing));
        yield* TestClock.adjust(Duration.seconds(5));
        const ended = yield* Fiber.join(ending);

        assert.equal(killedEarly, false);
        assert.deepEqual(stopped, Result.succeed(undefined));
        assert.equal(stubborn.signals()[0], RUN_ACTION_SIGNAL.TERM);
        assert.equal(stubborn.signals().at(-1), RUN_ACTION_SIGNAL.KILL);
        assert.deepEqual(ended, Result.succeed(undefined));
        assert.ok(!willing.signals().includes(RUN_ACTION_SIGNAL.KILL));
      }),
  );

  it.effect(
    "a run action pressed twice at once answers the one shell the first press started, its session the action's own",
    () =>
      Effect.gen(function* () {
        const action = "5b7c1e1a-3f0d-4c55-9a52-0d7f2b9e6a01";
        const run = { actionId: action, label: "Dev server", command: "pnpm dev", environment: {} };
        // tmux as two presses at once leave it: both list no shell, the other press's start lands first, and this one's start is refused, its name taken.
        let shells: string[] = [];
        const sandbox = memorySandbox({
          run: ({ ask }) => {
            const scriptAt = ask.args.indexOf("-c") + 1;
            const tmuxArgs = ask.args.slice(scriptAt + 2);
            if (tmuxArgs.length === 0) return ran(0, shells.join("\n"));
            if (tmuxArgs[0] !== "new-session") return ran(0);
            shells = [
              [
                `terminal-${action}`,
                "100",
                field("Dev server"),
                field("node"),
                field("/workspace/repository"),
                field(action),
              ].join(" "),
            ];
            return ran(1);
          },
        });
        sandbox.stand({
          name: SANDBOX,
          status: SANDBOX_STATUS.RUNNING,
          running: RUNNING_SESSION,
          tags: { sessionId: SESSION },
        });
        const layer = Layer.provide(
          agentSandboxLayer,
          Layer.mergeAll(
            LOCAL_AGENT_ENVIRONMENT,
            Layer.succeed(AgentImage, FIXTURE_IMAGE),
            sandbox.layer,
          ),
        );

        const raced = yield* Effect.flatMap(AgentSandbox, (agentSandbox) =>
          agentSandbox.run(SESSION, action, run),
        ).pipe(Effect.provide(layer));

        assert.deepEqual(
          raced,
          Result.succeed({
            id: action,
            title: "Dev server",
            command: "node",
            cwd: "/workspace/repository",
            running: true,
            runAction: action,
          }),
        );
      }),
  );

  it.effect("a list tmux could not give is an outage, never a sandbox with no shells", () =>
    Effect.gen(function* () {
      const api = standing(SANDBOX_STATUS.RUNNING, [], 1);

      const listed = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
        sandbox.terminals(SESSION),
      ).pipe(Effect.provide(api.layer), Effect.flip);

      assert.ok(listed instanceof SandboxUnavailable);
    }),
  );

  it.effect("a resume wakes the stopped sandbox by its name and answers it running", () =>
    Effect.gen(function* () {
      const api = standing(SANDBOX_STATUS.STOPPED);

      const resumed = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
        sandbox.resume(SESSION),
      ).pipe(Effect.provide(api.layer));

      assert.equal(resumed, SANDBOX_STATE.RUNNING);
      assert.deepEqual(
        api.state.resumed.map((each) => each.name),
        [SANDBOX],
      );
    }),
  );

  it.effect(
    "a resume of a sandbox under its session's name whose snapshot is gone makes it again under that name, with its tags, the agent's user in it, and answers it running",
    () =>
      Effect.gen(function* () {
        const api = standing(undefined);
        const tags = { sessionId: SESSION, agentId: "agent-fixture" };
        const expired = api.sandbox.stand({
          name: agentSandboxName(SESSION),
          status: SANDBOX_STATUS.STOPPED,
          snapshotId: "snap_expired",
          tags,
        });
        api.state.goneSnapshots.add("snap_expired");

        const resumed = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
          sandbox.resume(SESSION),
        ).pipe(Effect.provide(api.layer));

        assert.equal(resumed, SANDBOX_STATE.RUNNING);
        const remade = api.state.sandboxes.get(expired.name);
        assert.ok(remade !== undefined && remade !== expired);
        assert.deepEqual(
          [api.state.deleted, remade.tags, remade.user?.name],
          [[expired.name], tags, AGENT_USER],
        );
      }),
  );

  it.effect("an attach mints the running session's PTY and never wakes a stopped sandbox", () =>
    Effect.gen(function* () {
      const running = standing(SANDBOX_STATUS.RUNNING);
      const stopped = standing(SANDBOX_STATUS.STOPPED);

      const attached = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
        sandbox.attach(SESSION, SHELL),
      ).pipe(Effect.provide(running.layer));
      const refused = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
        sandbox.attach(SESSION, SHELL),
      ).pipe(Effect.provide(stopped.layer));

      assert.equal(attached.state, SANDBOX_STATE.RUNNING);
      assert.ok("shell" in attached);
      assert.deepEqual(running.state.interactive, [{ name: SANDBOX, running: RUNNING_SESSION }]);
      assert.deepEqual(refused, { state: SANDBOX_STATE.STOPPED });
      assert.deepEqual(stopped.state.resumed, []);
      assert.deepEqual(stopped.state.interactive, []);
    }),
  );

  it.effect("an attach to a shell tmux does not hold is gone, and no PTY is minted for it", () =>
    Effect.gen(function* () {
      const api = standing(SANDBOX_STATUS.RUNNING);
      const unknown = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";

      const attached = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
        sandbox.attach(SESSION, unknown),
      ).pipe(Effect.provide(api.layer));

      assert.deepEqual(attached, { state: SANDBOX_STATE.RUNNING, gone: true });
      assert.deepEqual(api.state.interactive, []);
    }),
  );

  it.effect(
    "a tmux that could not be asked is an outage the tab may retry, never a shell gone",
    () =>
      Effect.gen(function* () {
        const api = standing(SANDBOX_STATUS.RUNNING, [], 0, 1);
        const unknown = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";

        const attached = yield* Effect.flatMap(AgentSandbox, (sandbox) =>
          sandbox.attach(SESSION, unknown),
        ).pipe(Effect.provide(api.layer), Effect.flip);

        assert.ok(attached instanceof SandboxUnavailable);
      }),
  );

  it.effect(
    "an installation's token is set at the firewall on GitHub's two hosts alone, every other host left open",
    () =>
      Effect.gen(function* () {
        const api = standing(SANDBOX_STATUS.RUNNING);
        const session = yield* ownSession;

        yield* Effect.flatMap(AgentSandbox, (sandbox) =>
          sandbox.setCredential(session, {
            token: Redacted.make("ghs_fixture"),
            fullName: REPOSITORY,
            access: { kind: GITHUB_ACCESS.APP },
          }),
        ).pipe(Effect.provide(api.layer));

        const authorization = `Basic ${Buffer.from("x-access-token:ghs_fixture").toString("base64")}`;
        const injected = [{ set: { authorization } }];
        assert.deepEqual(
          api.state.policies.map((each) => each.policy),
          [{ hosts: { "github.com": injected, "api.github.com": injected } }],
        );
        assert.notDeepEqual(api.state.policies[0]?.policy, OPEN_INTERNET);
      }),
  );

  it.effect(
    "a member's own token is set on the repository's git paths as Basic under their login and on its REST paths as a bearer, and nowhere else",
    () =>
      Effect.gen(function* () {
        const api = standing(SANDBOX_STATUS.RUNNING);
        const session = yield* ownSession;

        yield* Effect.flatMap(AgentSandbox, (sandbox) =>
          sandbox.setCredential(session, {
            token: Redacted.make(MEMBER_TOKEN),
            fullName: REPOSITORY,
            access: {
              kind: GITHUB_ACCESS.TOKEN,
              githubLogin: "octo-member",
              githubUserId: "4242",
              markInvalid: Effect.void,
            },
          }),
        ).pipe(Effect.provide(api.layer));

        const basic = `Basic ${Buffer.from(`octo-member:${MEMBER_TOKEN}`).toString("base64")}`;
        const bearer = `Bearer ${MEMBER_TOKEN}`;
        assert.deepEqual(
          api.state.policies.map((each) => each.policy),
          [
            {
              hosts: {
                "github.com": [
                  {
                    path: { startsWith: `/${REPOSITORY}.git/` },
                    set: { authorization: basic },
                  },
                ],
                "api.github.com": [
                  { path: { exact: `/repos/${REPOSITORY}` }, set: { authorization: bearer } },
                  { path: { startsWith: `/repos/${REPOSITORY}/` }, set: { authorization: bearer } },
                ],
              },
            },
          ],
        );
      }),
  );
});
