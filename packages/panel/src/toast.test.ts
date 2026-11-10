// @vitest-environment jsdom

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  FAILURE_CONDITION,
  FAILURE_SURFACE,
  type ShownFailureSentry,
  sendShownFailure,
} from "@repo/features/shown-failure";
import { IDLE_TASKS_VIEW, type TasksPinParams, type TasksView } from "@repo/features/tasks-view";
import { STATUS_TONE, TOAST_HOLD } from "@repo/ui";
import { Duration, Effect } from "effect";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { installShownFailureReporter } from "./failure-report.js";
import { copyingInto, fakeAppPlatform } from "./testing/app-platform.js";
import { handState } from "./testing/app-state.js";
import { readAppState, testQueryClientNow, withQueryClient } from "./testing/copy-feedback.js";
import { STANDING_TOAST, standingToastWords } from "./testing/toast.js";
import { ToastHost, type ToastNotice, useToast, useToastsOwner, useWorkingToast } from "./toast.js";
import { forgetUndo, type PressedRows, pressRows, ROW_WRITE, undoLast } from "./undo-stack.js";
import { appStateIn } from "./use-app-state.js";

/**
 * toast.test.ts -- the window's toasts as the window shows them: a toast
 * with an action is dismissed by its × or Escape; work under way settles
 * into its own card in place, a refusal said as an alert; an act's Undo
 * toast takes the act back and stands for the Undo hold, a row write's
 * taken back once, as ⌘Z's entry, which the key then finds gone, and
 * leaving once its entry is pushed off the undo list; another account
 * signing in sends the last one's toasts away; and a failure toast reports
 * what failed to Sentry, which a recording SDK stands in for, and copies
 * the details of that report, but is not shown where the connection already
 * says why. Synthetic throughout.
 */

let root: Root | undefined;
let show: ((notice: ToastNotice) => void) | undefined;
let work: ((words: string) => (notice: ToastNotice) => void) | undefined;

afterEach(() => {
  forgetUndo();
  vi.useRealTimers();
  act(() => root?.unmount());
  root = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** The trace a recording SDK says a report went in. */
const TRACE_FIXTURE = "0af7651916cd43dd8448eb211c80319c";

/** What a recording SDK answers of the trace standing: the scope's, with no span. */
const TRACED: Pick<ShownFailureSentry, "getActiveSpan" | "getCurrentScope"> = {
  getActiveSpan: () => undefined,
  getCurrentScope: () => ({ getPropagationContext: () => ({ traceId: TRACE_FIXTURE }) }),
};

/** An agent's Stop that we never heard back on, the fetch beneath it naming a credential. */
function unheardStop(): ToastNotice {
  // A credential in the cause's code as well as its message, since a code is sent as a tag and grouped by.
  const unreached = Object.assign(new TypeError("fetch failed with token=fixture-secret"), {
    status: 503,
    code: "sk-fixturecode01",
  });
  return {
    words: "The agent could not be stopped.",
    tone: STATUS_TONE.DANGER,
    failure: {
      surface: FAILURE_SURFACE.AGENT_STOP,
      cause: new Error("No answer came back.", { cause: unreached }),
      about: { agentId: "agent-fixture" },
    },
  };
}

/** A message the service refused as too long. */
function refusedStart(): ToastNotice {
  return {
    words: "Messages are limited to 20,000 characters.",
    tone: STATUS_TONE.DANGER,
    failure: {
      surface: FAILURE_SURFACE.AGENT_START,
      cause: { status: "rejected", reason: "Messages are limited to 20,000 characters." },
      about: { agentId: "agent-fixture" },
    },
  };
}

/** Hands the test the window's way of showing a toast, the account signed in held as the window's root holds it. */
function Shower({ account }: { account: string | undefined }): null {
  useToastsOwner(account);
  show = useToast();
  work = useWorkingToast();
  return null;
}

/** The toasts, mounted as the window's root mounts them, with the account signed in; signs another in on each call after. */
function mount(account?: string): (next: string) => void {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const render = (signedIn: string | undefined) =>
    act(() =>
      root?.render(
        withQueryClient(
          createElement(
            Fragment,
            null,
            createElement(Shower, { account: signedIn }),
            createElement(ToastHost),
          ),
        ),
      ),
    );
  render(account);
  return render;
}

/** A toast that stands until it is dismissed, as an agent's end does. */
function persisting(words: string): ToastNotice {
  return {
    words,
    tone: STATUS_TONE.COMPLETE,
    action: { label: "View", onPress: () => undefined },
    persists: true,
  };
}

/** What each toast standing says, oldest first, as the stack shows them up the window from its newest at the bottom. */
function standing(): string[] {
  return standingToastWords();
}

/** Lets `ms` pass on the faked clock the toasts' holds run down on. */
function pass(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** The button a standing toast labels `label`. */
function toastButton(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>(`${STANDING_TOAST} button`)].find(
    (button) => button.textContent === label,
  );
  return found ?? assert.fail(`a toast button named ${label}`);
}

/** The task a pin is pressed on. */
const PINNED_TASK = {
  id: "3f2c8a51-6d0e-4b7a-9c14-2e5f7a9b0d36",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
} as const;

/** A pin of the task pressed as its menu presses it and drawn as the host draws it once kept, each undo it is sent kept in `sent`. */
function pinPressed(sent: TasksPinParams[] = []): PressedRows {
  let drawn: TasksView = { ...IDLE_TASKS_VIEW, tasks: [PINNED_TASK] };
  const sendPin = (payload: TasksPinParams) => {
    sent.push(payload);
    return Promise.resolve(true);
  };
  const pressed = pressRows(
    ROW_WRITE.TASK_PIN,
    { rows: () => ({ tasks: drawn, held: undefined }), send: sendPin },
    [{ id: PINNED_TASK.id, after: { pinned: true, position: null } }],
  );
  drawn = { ...IDLE_TASKS_VIEW, tasks: [{ ...PINNED_TASK, pinnedAt: 3 }] };
  return pressed;
}

test("a toast with an action carries a Dismiss button the keyboard reaches, and its press or Escape from it sends the toast away", () => {
  mount();
  act(() => show?.(persisting("Retry the webhook finished")));
  act(() => show?.(persisting("Nightly upgrade couldn't start")));
  const dismissButtons = () =>
    [...document.querySelectorAll<HTMLButtonElement>(`${STANDING_TOAST} button`)]
      .filter((button) => button.getAttribute("aria-label") === "Dismiss")
      .reverse();

  const [first, second] = dismissButtons();
  assert.ok(first && second);
  act(() => first.click());
  const afterPress = standing();
  act(() => second.focus());
  const focused = document.activeElement === second;
  act(() => {
    second.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });

  assert.deepEqual(afterPress, ["Nightly upgrade couldn't start"]);
  assert.ok(focused, "the Dismiss button takes focus");
  assert.deepEqual(standing(), []);
});

test("two pieces of work under way stand apart, each settles its own card in place, and a refusal is said as an alert", () => {
  mount();
  let first: ((notice: ToastNotice) => void) | undefined;
  let second: ((notice: ToastNotice) => void) | undefined;
  act(() => {
    first = work?.("Saving…");
    second = work?.("Saving…");
  });
  const working = [...document.querySelectorAll(".ui-toast")];

  act(() =>
    second?.({
      words: "Couldn't save",
      tone: STATUS_TONE.DANGER,
      failure: { surface: FAILURE_SURFACE.DESCRIPTION_SAVE, cause: FAILURE_CONDITION.NOT_KEPT },
    }),
  );
  act(() => first?.({ words: "Saved", tone: STATUS_TONE.COMPLETE }));

  assert.deepEqual(standing(), ["Saved", "Couldn't save"]);
  assert.deepEqual([...document.querySelectorAll(".ui-toast")], working, "the same two cards");
  const alerts = [...document.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent);
  assert.ok(alerts.includes("Couldn't save"), "the refusal is said as an alert");
});

test("a failure toast reports what failed: an unexpected one as an error line and an issue grouped by where and what, credentials redacted, and a refusal as a warning line alone", () => {
  mount();
  const issues: { error: Error; hint: unknown }[] = [];
  const lines: { level: string; message: string; attributes: unknown }[] = [];
  const recording: ShownFailureSentry = {
    captureException: (error, hint) => {
      issues.push({ error, hint });
      return "";
    },
    logger: {
      warn: (message, attributes) => lines.push({ level: "warn", message, attributes }),
      error: (message, attributes) => lines.push({ level: "error", message, attributes }),
    },
    ...TRACED,
  };
  const uninstall = installShownFailureReporter(
    (report) => sendShownFailure(recording, report),
    testQueryClientNow(),
  );

  act(() => show?.(unheardStop()));
  act(() => show?.(refusedStart()));
  uninstall();

  // A window whose document is not read yet says it is online and its account unread.
  const unexpected = {
    "failure.surface": "agent.stop",
    "failure.kind": "unexpected",
    "failure.code": "[redacted]",
    "error.name": "Error",
    "error.message": "No answer came back.",
    "error.root.name": "TypeError",
    "error.root.code": "[redacted]",
    "error.root.status": 503,
    "error.root.message": "fetch failed with [redacted]",
    "agent.id": "agent-fixture",
    "app.online": true,
    "app.account": "unread",
  };
  assert.deepEqual(lines, [
    {
      level: "error",
      message: "A failure was shown on agent.stop: [redacted]",
      attributes: unexpected,
    },
    {
      level: "warn",
      message: "A failure was shown on agent.start: rejected",
      attributes: {
        "failure.surface": "agent.start",
        "failure.kind": "refused",
        "failure.code": "rejected",
        "error.code": "rejected",
        "error.message": "Messages are limited to 20,000 characters.",
        "agent.id": "agent-fixture",
        "app.online": true,
        "app.account": "unread",
      },
    },
  ]);
  assert.equal(issues.length, 1, "the refusal opens no issue");
  const [issue] = issues;
  assert.deepEqual(issue?.hint, {
    mechanism: { type: "auto.vespin.shown_failure", handled: true },
    captureContext: {
      level: "error",
      fingerprint: ["shown-failure", "agent.stop", "[redacted]"],
      tags: {
        "failure.surface": "agent.stop",
        "failure.code": "[redacted]",
        "agent.id": "agent-fixture",
      },
      contexts: { shown_failure: unexpected },
    },
  });
  assert.equal(issue?.error.message, "No answer came back.");
  // Sentry reads the causes beneath an issue's error too, so they go redacted, their frames among them.
  const beneath = issue?.error.cause;
  assert.ok(beneath instanceof Error);
  assert.equal(beneath.name, "TypeError");
  assert.equal(beneath.message, "fetch failed with [redacted]");
  assert.ok(!beneath.stack?.includes("fixture-secret"));
});

test("a failure toast for a hosted call that never answered reports what the host kept of it, the trace the service's lines carry unredacted, and copies that trace", async () => {
  const copied: string[] = [];
  fakeAppPlatform(copyingInto(copied));
  mount();
  const lines: { message: string; attributes: unknown }[] = [];
  const recording: ShownFailureSentry = {
    captureException: () => "",
    logger: {
      warn: (message, attributes) => lines.push({ message, attributes }),
      error: (message, attributes) => lines.push({ message, attributes }),
    },
    ...TRACED,
  };
  const uninstall = installShownFailureReporter(
    (report) => sendShownFailure(recording, report),
    testQueryClientNow(),
  );

  act(() =>
    show?.({
      words: "No answer came back.",
      tone: STATUS_TONE.DANGER,
      failure: {
        surface: FAILURE_SURFACE.AGENT_START,
        cause: {
          failure: "unanswered",
          cause: {
            _tag: "HostedUnanswered",
            fault: "network",
            errorName: "TypeError",
            traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          },
        },
      },
    }),
  );
  uninstall();

  assert.deepEqual(lines, [
    {
      message: "A failure was shown on agent.start: unanswered",
      attributes: {
        "failure.surface": "agent.start",
        "failure.kind": "unexpected",
        "failure.code": "unanswered",
        "error.code": "unanswered",
        "error.root.name": "TypeError",
        "error.root.tag": "HostedUnanswered",
        "error.root.fault": "network",
        "hosted.trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
        "app.online": true,
        "app.account": "unread",
      },
    },
  ]);
  const copy = document.querySelector<HTMLButtonElement>(
    `${STANDING_TOAST} button[aria-label="Copy details"]`,
  );
  await act(async () => copy?.click());
  assert.ok(
    copied[0]?.split("\n").includes("hosted.trace_id: 4bf92f3577b34da6a3ce929d0e0e4736"),
    "the copied details carry the trace the service's lines carry",
  );
});

it.effect(
  "while the app does not reach the service, a failure toast nothing named is not shown, and a refusal still is",
  () =>
    Effect.gen(function* () {
      handState({}, { network: { online: true, reachable: false } });
      // Note that we wait on the read itself, because it lands after a fiber's hops a busy runner can stretch past any one tick.
      yield* Effect.promise(readAppState);
      mount();
      // Note that we wait on the test's client, because the subscription reads the document again as it mounts before it writes it there.
      yield* Effect.promise(() =>
        vi.waitFor(() =>
          assert.equal(
            appStateIn(testQueryClientNow())?.network.reachable,
            false,
            "the window read the document",
          ),
        ),
      );
      const uninstall = installShownFailureReporter(() => undefined, testQueryClientNow());

      act(() => show?.(unheardStop()));
      act(() => show?.(refusedStart()));
      uninstall();

      assert.deepEqual(standing(), ["Messages are limited to 20,000 characters."]);
    }),
);

test("an unexpected failure toast's Copy details copies what its report sent, with its issue's event id, and a refusal's toast offers no copy", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T18:20:03.198Z"));
  const copied: string[] = [];
  fakeAppPlatform(copyingInto(copied));
  mount();
  const recording: ShownFailureSentry = {
    captureException: () => "event-fixture",
    logger: { warn: () => undefined, error: () => undefined },
    ...TRACED,
  };
  const uninstall = installShownFailureReporter(
    (report) => sendShownFailure(recording, report),
    testQueryClientNow(),
  );
  act(() => show?.(unheardStop()));
  act(() => show?.(refusedStart()));
  uninstall();

  const copies = [
    ...document.querySelectorAll<HTMLButtonElement>(
      `${STANDING_TOAST} button[aria-label="Copy details"]`,
    ),
  ];
  assert.equal(copies.length, 1, "the refusal's toast offers no copy");
  for (const copy of copies) await act(async () => copy.click());

  assert.deepEqual(copied, [
    [
      "Vespin error details. Include these when you report this problem:",
      "time: 2026-10-29T18:20:03.198Z",
      "failure.surface: agent.stop",
      "failure.kind: unexpected",
      "failure.code: [redacted]",
      "error.name: Error",
      "error.message: No answer came back.",
      "error.root.name: TypeError",
      "error.root.code: [redacted]",
      "error.root.status: 503",
      "error.root.message: fetch failed with [redacted]",
      "agent.id: agent-fixture",
      "app.online: true",
      "app.account: unread",
      "sentry.event_id: event-fixture",
      `sentry.trace_id: ${TRACE_FIXTURE}`,
    ].join("\n"),
  ]);
  assert.deepEqual(standing(), [
    "The agent could not be stopped.",
    "Messages are limited to 20,000 characters.",
  ]);
});

test("another account signing in sends the last one's toasts away", () => {
  const signIn = mount("ada");
  act(() => show?.(persisting("Retry the webhook finished")));
  act(() => show?.(pinPressed().keep("Task pinned") ?? assert.fail("the pin's toast")));

  signIn("grace");

  assert.deepEqual(standing(), []);
});

test("an Undo toast's Undo takes a row write back once and sends the toast away, leaving ⌘Z nothing to take back again", async () => {
  mount();
  const sent: TasksPinParams[] = [];
  const said = pinPressed(sent).keep("Task pinned") ?? assert.fail("the pin's toast");
  act(() => show?.(said));

  act(() => toastButton("Undo").click());
  await vi.waitFor(() => assert.equal(sent.length, 1));
  const again = await undoLast();

  assert.equal(again, undefined);
  assert.deepEqual(sent, [{ taskId: PINNED_TASK.id, pinned: false }]);
  assert.deepEqual(standing(), []);
});

test("an Undo toast whose entry was pushed off the undo list leaves rather than offer an Undo that does nothing", () => {
  mount();
  act(() => show?.(pinPressed().keep("Task pinned") ?? assert.fail("the pin's toast")));

  // Pins a drag keeps for ⌘Z say no toast of their own, so the first pin's toast still stands as they push its entry off.
  act(() => {
    for (let pinned = 0; pinned < 50; pinned += 1) pinPressed().keep("Task pinned");
  });

  assert.deepEqual(standing(), []);
});

test("an Undo toast nobody points at stands for the hold, then leaves without taking the act back", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  mount();
  const hold = Duration.toMillis(TOAST_HOLD);
  const sent: TasksPinParams[] = [];
  act(() => show?.(pinPressed(sent).keep("Task pinned") ?? assert.fail("the pin's toast")));

  pass(hold - 1);
  const justBefore = standing();
  pass(1);

  assert.deepEqual(justBefore, ["Task pinned"]);
  assert.deepEqual(standing(), []);
  assert.deepEqual(sent, []);
});
