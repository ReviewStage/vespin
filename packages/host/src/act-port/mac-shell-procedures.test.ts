import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import {
  TERMINAL_CONNECTION,
  TERMINAL_FLOW,
  TERMINAL_PORT_MESSAGE,
  type TerminalPortOutbound,
  type TerminalPortTicket,
} from "@repo/features/terminal-acts";
import type { WireBoundaryInput } from "@repo/wire";
import { Duration, Effect } from "effect";
import { ACT_KIND } from "../acts.js";
import type { ActSender } from "./base.js";
import { MAC_SHELL_SIGNAL, type MacShell, macShellProcedures } from "./mac-shell-procedures.js";
import { type TestActPort, testActPort } from "./testing.js";

/**
 * Shells on this Mac as main carries them, over shells and ports that answer
 * from a script: a shell belongs to the window that opened it, which alone
 * attaches to and closes it; it opens at the size the panel asked; its port
 * carries what it printed, its exit, and what the panel typed and resized;
 * output pauses the shell past the tab's acks, and never once the panel
 * closed its port; and a close or the page's end kills it. A local agent's
 * run action runs in its worktree, once however often pressed, attaches
 * read-only from what it printed, outlives its window's page, and stops on
 * TERM, KILL following only where its group outlives the grace. A window is
 * an inert object of its own. Synthetic ids, folders, and bytes throughout.
 */

/** A platform's handle on a window, which the procedures read by identity alone. */
type Window = { readonly window: number };

const ports: TestActPort<Window>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const FOLDER = "/Users/someone/.vespin/mirrors/8c1a6a4f/repository";
const CHECKOUT = "/Users/someone/.vespin/agents/8c1a6a4f/repository";
const ACTION_ID = "3f0b9a52-6c1d-4e7a-9b2f-1d4c8e6a7b30";

let windows = 0;

const panelOf = (): ActSender<Window> => ({ sender: { window: ++windows }, panel: true });

/** One shell the platform started, as the test drives it and watches it. */
interface ScriptedShell {
  readonly folder: string;
  readonly size: string;
  readonly command: string | undefined;
  readonly heard: string[];
  print(text: string): void;
  exit(code: number): void;
  /** Its leader's exit, a process it started left running in its group. */
  exitLeaving(code: number): void;
  /** Whether its process group shrugs off TERM, as a server that traps it does. */
  stubborn: boolean;
}

/** One port posted to a window, as the test watches it. */
interface ScriptedPort {
  readonly sender: Window;
  readonly ticket: TerminalPortTicket;
  readonly posted: TerminalPortOutbound[];
  closed: boolean;
  send(message: WireBoundaryInput): void;
  /** The panel closing its end. */
  hangUp(): void;
}

function fixture() {
  const shells: ScriptedShell[] = [];
  const opened: ScriptedPort[] = [];
  const pageGone = new Map<Window, () => void>();
  let ids = 0;
  const slept: Duration.Duration[] = [];

  const spawn = (
    folder: string,
    cols: number,
    rows: number,
    command?: string,
  ): MacShell | undefined => {
    if (folder !== FOLDER && folder !== CHECKOUT) return undefined;
    const heard: string[] = [];
    let data: ((bytes: Uint8Array) => void) | undefined;
    let exit: ((code: number, signal: number | undefined) => void) | undefined;
    let groupRuns = true;

    const scripted: ScriptedShell = {
      folder,
      size: `${cols}x${rows}`,
      command,
      heard,
      print: (text) => data?.(new TextEncoder().encode(text)),
      exit: (code) => {
        groupRuns = false;
        exit?.(code, undefined);
      },
      exitLeaving: (code) => exit?.(code, undefined),
      stubborn: false,
    };

    shells.push(scripted);

    return {
      onData: (listener) => {
        data = listener;
      },
      onExit: (listener) => {
        exit = listener;
      },
      write: (text) => void heard.push(`write:${text}`),
      resize: (cols, rows) => void heard.push(`resize:${cols}x${rows}`),
      pause: () => void heard.push("pause"),
      resume: () => void heard.push("resume"),
      kill: () => void heard.push("kill"),
      signalGroup: (signal) => {
        heard.push(signal);

        if (signal === MAC_SHELL_SIGNAL.TERM && scripted.stubborn) return;
        groupRuns = false;
        exit?.(0, 15);
      },
      groupRuns: () => groupRuns,
    };
  };

  const actPort = testActPort(
    macShellProcedures<Window>({
      mirror: () => Effect.succeed(undefined),
      checkout: (agentId) => (agentId === AGENT_ID ? CHECKOUT : undefined),
      spawn,
      ports: {
        open: (sender, ticket) => {
          let listener: ((message: WireBoundaryInput) => void) | undefined;
          let hungUp: (() => void) | undefined;

          const port: ScriptedPort = {
            sender,
            ticket,
            posted: [],
            closed: false,
            send: (message) => listener?.(message),
            hangUp: () => hungUp?.(),
          };

          opened.push(port);

          return {
            post: (message) => void port.posted.push(message),
            onMessage: (heard) => {
              listener = heard;
            },
            onClose: (then) => {
              hungUp = then;
            },
            close: () => {
              port.closed = true;
            },
          };
        },
        whenGone: (sender, then) => void pageGone.set(sender, then),
      },
      createId: () => `shell-${++ids}`,
      sleep: (span) => Effect.sync(() => void slept.push(span)),
    }),
  );

  ports.push(actPort);

  return {
    actPort,
    shells,
    opened,
    slept,
    pageGone: (sender: Window) => pageGone.get(sender)?.(),
  };
}

const open = {
  kind: ACT_KIND.MAC_SHELL_OPEN,
  payload: { agentId: AGENT_ID, folder: FOLDER, cols: 100, rows: 30 },
};

const attach = (terminalId: string) => ({
  kind: ACT_KIND.MAC_SHELL_ATTACH,
  payload: { agentId: AGENT_ID, terminalId, cols: 120, rows: 32 },
});

const shellOf = (terminalId: string) => ({ agentId: AGENT_ID, terminalId });

/** What a port carried, its bytes read as text. */
function carried(port: ScriptedPort | undefined) {
  return port?.posted.map((message) =>
    message.type === TERMINAL_PORT_MESSAGE.OUTPUT
      ? new TextDecoder().decode(message.data)
      : message,
  );
}

it.effect(
  "a shell opens in its folder for the panel that asked, which alone attaches to it, and its port carries what it printed and its exit",
  () =>
    Effect.gen(function* () {
      const { actPort, shells, opened } = fixture();
      const one = panelOf();
      const other = panelOf();

      const elsewhere = yield* actPort.perform(
        { ...open, payload: { agentId: AGENT_ID, folder: "/nowhere" } },
        one,
      );

      const notPanel = yield* actPort.perform(open, { ...one, panel: false });
      const made = yield* actPort.perform(open, one);
      assert.deepEqual(made, { answer: { terminalId: "shell-1" } });
      const stolen = yield* actPort.perform(attach("shell-1"), other);
      yield* actPort.perform(attach("shell-1"), one);
      const [shell] = shells;
      shell?.print("README.md\r\n");
      shell?.exit(3);

      assert.ok("refused" in elsewhere && "refused" in notPanel && "refused" in stolen);
      assert.equal(shells.length, 1);
      assert.equal(
        shells[0]?.size,
        "100x30",
        "the shell opens at the size its screen was fitted to",
      );
      assert.equal(opened.length, 1, "no port is posted to a window that did not open the shell");
      const [port] = opened;
      assert.equal(port?.sender, one.sender);
      assert.deepEqual(port?.ticket, shellOf("shell-1"));
      assert.deepEqual(carried(port), [
        { type: TERMINAL_PORT_MESSAGE.STATE, state: TERMINAL_CONNECTION.ATTACHED },
        "README.md\r\n",
        { type: TERMINAL_PORT_MESSAGE.STATE, state: TERMINAL_CONNECTION.EXITED, code: 3 },
      ]);
    }),
);

it.effect("what the panel types and resizes on the port reaches the shell", () =>
  Effect.gen(function* () {
    const { actPort, shells, opened } = fixture();
    const panel = panelOf();

    yield* actPort.perform(open, panel);
    yield* actPort.perform(attach("shell-1"), panel);
    const [port] = opened;
    port?.send({ type: TERMINAL_PORT_MESSAGE.INPUT, data: "ls\r" });
    port?.send({ type: TERMINAL_PORT_MESSAGE.RESIZE, cols: 80, rows: 24 });
    port?.send({ type: "something else" });

    assert.deepEqual(shells[0]?.heard, ["resize:120x32", "write:ls\r", "resize:80x24"]);
  }),
);

it.effect(
  "output past the tab's acks pauses the shell, and an ack that catches up resumes it",
  () =>
    Effect.gen(function* () {
      const { actPort, shells, opened } = fixture();
      const panel = panelOf();

      yield* actPort.perform(open, panel);
      yield* actPort.perform(attach("shell-1"), panel);
      shells[0]?.print("x".repeat(TERMINAL_FLOW.PAUSE_ABOVE_BYTES + 1));
      opened[0]?.send({ type: TERMINAL_PORT_MESSAGE.ACK, bytes: TERMINAL_FLOW.PAUSE_ABOVE_BYTES });

      assert.deepEqual(shells[0]?.heard, ["resize:120x32", "pause", "resume"]);
    }),
);

it.effect(
  "a shell whose port the panel closed is never paused for the acks it no longer sends",
  () =>
    Effect.gen(function* () {
      const { actPort, shells, opened } = fixture();
      const panel = panelOf();

      yield* actPort.perform(open, panel);
      yield* actPort.perform(attach("shell-1"), panel);
      opened[0]?.hangUp();
      shells[0]?.print("x".repeat(TERMINAL_FLOW.PAUSE_ABOVE_BYTES + 1));

      assert.deepEqual(shells[0]?.heard, ["resize:120x32"]);
      assert.equal(
        opened[0]?.posted.length,
        1,
        "nothing is posted past the attach on a port that closed",
      );
    }),
);

it.effect(
  "a close and the page's end, a reload or the window's close, each kill the window's shells",
  () =>
    Effect.gen(function* () {
      const { actPort, shells, pageGone } = fixture();
      const panel = panelOf();

      yield* actPort.perform(open, panel);
      yield* actPort.perform(open, panel);
      yield* actPort.perform(
        { kind: ACT_KIND.MAC_SHELL_CLOSE, payload: shellOf("shell-1") },
        panel,
      );
      const reattached = yield* actPort.perform(attach("shell-1"), panel);
      pageGone(panel.sender);

      assert.ok("refused" in reattached);
      assert.deepEqual(
        shells.map((shell) => shell.heard),
        [["kill"], ["kill"]],
      );
    }),
);

it.effect(
  "a second attach before the panel takes the first port closes the first, whose close leaves the second live",
  () =>
    Effect.gen(function* () {
      const { actPort, shells, opened } = fixture();
      const panel = panelOf();

      yield* actPort.perform(open, panel);
      yield* actPort.perform(attach("shell-1"), panel);
      yield* actPort.perform(attach("shell-1"), panel);
      const [first, second] = opened;
      first?.hangUp();
      shells[0]?.print("ls\r\n");

      assert.equal(first?.closed, true);
      assert.equal(second?.closed, false);
      assert.deepEqual(carried(second), [
        { type: TERMINAL_PORT_MESSAGE.STATE, state: TERMINAL_CONNECTION.ATTACHED },
        "ls\r\n",
      ]);
      assert.ok(!shells[0]?.heard.includes("kill"));
    }),
);

const runAction = {
  kind: ACT_KIND.MAC_SHELL_RUN_ACTION,
  payload: { agentId: AGENT_ID, actionId: ACTION_ID, title: "Dev server", command: "pnpm dev" },
};

const stopAction = {
  kind: ACT_KIND.MAC_SHELL_STOP_ACTION,
  payload: { agentId: AGENT_ID, actionId: ACTION_ID },
};

const actions = { kind: ACT_KIND.MAC_SHELL_ACTIONS, payload: { agentId: AGENT_ID } };

// Regression: a run action started twice by a second press, a late tab missing what it printed, a key reaching the action, or a reload killing it.
it.effect(
  "a run action runs once in its agent's worktree however often pressed, its tab attaches read-only from what it printed, and it runs on past its window's page",
  () =>
    Effect.gen(function* () {
      const { actPort, shells, opened, pageGone } = fixture();
      const panel = panelOf();
      const later = panelOf();

      const elsewhere = yield* actPort.perform(
        { ...runAction, payload: { ...runAction.payload, agentId: ACTION_ID } },
        panel,
      );

      const first = yield* actPort.perform(runAction, panel);
      shells[0]?.print("ready on :3000\r\n");
      const second = yield* actPort.perform(runAction, panel);
      pageGone(panel.sender);
      yield* actPort.perform(attach("shell-1"), later);
      opened[0]?.send({ type: TERMINAL_PORT_MESSAGE.INPUT, data: "q" });

      assert.ok("refused" in elsewhere);
      const running = { id: "shell-1", title: "Dev server", runAction: ACTION_ID, running: true };
      assert.deepEqual(first, { answer: { terminal: running } });
      assert.deepEqual(second, first);
      assert.deepEqual(
        shells.map((shell) => [shell.folder, shell.command]),
        [[CHECKOUT, "pnpm dev"]],
      );
      assert.deepEqual(carried(opened[0]), [
        { type: TERMINAL_PORT_MESSAGE.STATE, state: TERMINAL_CONNECTION.ATTACHED },
        "ready on :3000\r\n",
      ]);
      assert.deepEqual(shells[0]?.heard, ["resize:120x32"], "nothing typed reaches the action");
      assert.deepEqual(yield* actPort.perform(actions, later), {
        answer: { terminals: [running] },
      });
    }),
);

it.effect(
  "a run action that ended is said to have, and runs anew under the same id when pressed",
  () =>
    Effect.gen(function* () {
      const { actPort, shells } = fixture();
      const panel = panelOf();

      yield* actPort.perform(runAction, panel);
      shells[0]?.exit(1);
      const ended = yield* actPort.perform(actions, panel);
      const again = yield* actPort.perform(runAction, panel);

      assert.deepEqual(ended, {
        answer: {
          terminals: [
            {
              id: "shell-1",
              title: "Dev server",
              runAction: ACTION_ID,
              running: false,
              exited: { code: 1 },
            },
          ],
        },
      });
      assert.deepEqual(again, {
        answer: {
          terminal: { id: "shell-1", title: "Dev server", runAction: ACTION_ID, running: true },
        },
      });
      assert.equal(shells.length, 2);
    }),
);

// Regression: a run whose leader ended taken for ended while what it started still runs, so a press starts it twice beside it.
it.effect(
  "a run action whose leader ended still runs while a process it started does, so a press starts nothing until a stop ends it",
  () =>
    Effect.gen(function* () {
      const { actPort, shells } = fixture();
      const panel = panelOf();

      yield* actPort.perform(runAction, panel);
      shells[0]?.exitLeaving(0);
      const pressed = yield* actPort.perform(runAction, panel);
      yield* actPort.perform(stopAction, panel);
      const again = yield* actPort.perform(runAction, panel);

      assert.ok("answer" in pressed && "answer" in again);
      assert.deepEqual(
        [pressed.answer, again.answer],
        [
          {
            terminal: {
              id: "shell-1",
              title: "Dev server",
              runAction: ACTION_ID,
              running: true,
              exited: { code: 0 },
            },
          },
          {
            terminal: { id: "shell-1", title: "Dev server", runAction: ACTION_ID, running: true },
          },
        ],
      );
      assert.deepEqual(shells[0]?.heard, [MAC_SHELL_SIGNAL.TERM]);
      assert.equal(shells.length, 2, "it runs anew only once the stop ended what was left");
    }),
);

// Regression: a stop that only interrupts, leaving a server that traps TERM running, or one that kills at once without a grace.
it.effect(
  "a stop sends TERM to the action's process group, and KILL only once the group outlives the grace",
  () =>
    Effect.gen(function* () {
      const { actPort, shells, slept } = fixture();
      const panel = panelOf();

      yield* actPort.perform(runAction, panel);
      yield* actPort.perform(stopAction, panel);
      const politeSlept = slept.length;
      yield* actPort.perform(runAction, panel);
      const stubborn = shells[1];

      if (stubborn !== undefined) stubborn.stubborn = true;
      yield* actPort.perform(stopAction, panel);

      assert.deepEqual(shells[0]?.heard, [MAC_SHELL_SIGNAL.TERM]);
      assert.equal(politeSlept, 0, "a group that went on TERM is not waited on");
      assert.deepEqual(stubborn?.heard, [MAC_SHELL_SIGNAL.TERM, MAC_SHELL_SIGNAL.KILL]);
      assert.equal(
        Duration.toMillis(slept.reduce((sum, span) => Duration.sum(sum, span), Duration.zero)),
        5_000,
      );
    }),
);
