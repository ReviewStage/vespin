/**
 * client-notices.ts -- the agent notices as a client links them: read from the document, the host, and the host's task list as each drawing moves it, written back into the document, and shown through the doors and the presenter the platform hands in.
 */
import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import type { AgentAccountInboxAnswerView } from "@repo/features/agent-view";
import type { ListedAgent } from "@repo/features/agent-wire";
import type { LinkDestination } from "@repo/features/link-grammar";
import { LIVE_READ } from "@repo/features/live-wire";
import { APP_SETTING_DEFAULTS } from "@repo/settings";
import { Duration, Effect, FiberSet, Queue, type Scope, Stream } from "effect";
import {
  AgentNoticeDoors,
  type AgentNotices,
  type AgentNoticesDependencies,
  createAgentNotices,
  NOTICE_KIND,
} from "../agent-notices.js";
import { type AppTranscripts, OWN_TRANSCRIPT } from "../app-state.js";
import type { HostOperator } from "../host-operator.js";
import type { ListMove } from "../list-moves.js";
import type { TaskListMoved } from "../task-list-moved.js";
import type { AppStateStore } from "./app-state-store.js";

/** Where a notice's click takes the developer, as the platform brings its window forward on it. */
interface NoticePresenter {
  /** Brings the app's window forward, where the prompt for a command stands: a command ask's notification's click. */
  openMachineCommandAsk: () => void;
  /** Brings the app's window forward on a place, an agent's tab or an Inbox item: the click of a notification of news. */
  openPlace: (place: LinkDestination) => void;
}

/** What the notification of a command waiting says: nothing of the command, which the prompt shows. */
/** How long an ask waits unanswered before it is announced, so one answered at once never is. */
const ASK_NOTICE_AFTER = Duration.seconds(10);

const MACHINE_COMMAND_ASK_NOTICE = {
  title: "Run a command on your Mac?",
  body: "An agent is waiting for you to allow or deny a command.",
} as const;

/** The host's methods the notices read and refresh through. */
type NoticeHost = Pick<
  HostOperator,
  | "agentAccountInboxFollow"
  | "agentAccountInboxUnfollow"
  | "onAccountInboxChanged"
  | "onAccountChanged"
  | "workspacesRefresh"
>;

export interface ClientNoticesDependencies {
  /** The document the notices read from and write the unseen agents and the inbox into. */
  state: AppStateStore;
  host: NoticeHost;
  /** The host's task list as each drawing of it moves its tasks and agents, the list as last drawn told whole first (`HostAssembly.taskListMoves`): where the notices read each task's name and every agent on a task. */
  taskList: Effect.Effect<Stream.Stream<TaskListMoved>, never, Scope.Scope>;
  presenter: NoticePresenter;
  /** The panel coming forward or going behind, for as long as the subscription stands. */
  onPanelFocusChanged: AgentNoticesDependencies["onPanelFocusChanged"];
  report: (message: string) => void;
}

/** Whose account this is, as the host keys it, or nobody: what tells another account from the same one renewed. */
function accountKey(account: AccountSnapshot): string | undefined {
  return account.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined;
}

/**
 * What waits across the account, as the host tells it, followed while the
 * stream runs: heard from before the follow is asked, so its first answer is
 * never missed, and let go as the stream ends.
 */
function accountInboxOf(host: NoticeHost): Stream.Stream<AgentAccountInboxAnswerView> {
  return Stream.callback<AgentAccountInboxAnswerView>((queue) =>
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => host.onAccountInboxChanged((answer) => Queue.offerUnsafe(queue, answer))),
        (unsubscribe) => Effect.sync(unsubscribe),
      );
      yield* Effect.acquireRelease(host.agentAccountInboxFollow(), () =>
        host.agentAccountInboxUnfollow(),
      );
    }),
  );
}

/** The agent as the followed list names it: none where it is archived, which the list names no longer. */
function namedOf(agent: ListedAgent | undefined): ListedAgent | undefined {
  return agent?.archivedAt === undefined ? agent : undefined;
}

/** An agent's move as the followed list names it, the archived left out; none where it was named neither before nor now. */
function namedMove({ was, now }: ListMove<ListedAgent>): ListMove<ListedAgent>[] {
  const named = { was: namedOf(was), now: namedOf(now) };

  return named.was === undefined && named.now === undefined ? [] : [named];
}

/**
 * Each task's name as the followed list draws it, kept from one drawing to
 * the next, and every agent on a task, the archived left out, handed to the
 * notices to hold in place of the watch's own reads: the drawing whole where
 * it starts the list anew, and otherwise only the tasks and agents it moved,
 * so a drawing costs what it moved whatever the account's size. A task the
 * list no longer holds takes its agents with it.
 */
function observeList(
  moved: TaskListMoved,
  names: Map<string, string>,
  notices: Pick<AgentNotices, "observeFollowed" | "observeFollowedMoved">,
): void {
  if (moved.whole) {
    const { tasks, taskAgents } = moved.drawn;
    names.clear();

    for (const task of tasks) names.set(task.id, task.name);
    notices.observeFollowed(
      taskAgents.filter((agent) => agent.archivedAt === undefined),
      tasks.map((task) => task.id),
    );

    return;
  }

  for (const { was, now } of moved.tasks) {
    if (now !== undefined) names.set(now.id, now.name);
    else if (was !== undefined) names.delete(was.id);
  }

  notices.observeFollowedMoved(moved.agents.flatMap(namedMove), moved.tasks);
}

/**
 * Each agent's status its own held transcript says, noted for each page read
 * since `noted` last counted its pages, as the notices take every page's,
 * and each agent whose own transcript is no longer held let go of. Note that a transcript laid anew
 * with no page read, as one held again lays what it held, says nothing of
 * the agent now: its status is the last page's, which may be a turn's the
 * agent has since moved past, and a status names no turn.
 */
function observeTranscripts(
  held: AppTranscripts,
  noted: Map<string, number>,
  notices: Pick<AgentNotices, "observeStatus">,
): void {
  for (const agentId of noted.keys()) {
    if (!Object.hasOwn(held, agentId)) noted.delete(agentId);
  }

  for (const [agentId, transcripts] of Object.entries(held)) {
    const rows = transcripts[OWN_TRANSCRIPT]?.rows;

    // Note that an own transcript let go for good is counted from its first page once it is read anew.
    if (rows === undefined) noted.delete(agentId);

    if (rows?.word === undefined || noted.get(agentId) === rows.pages) continue;
    noted.set(agentId, rows.pages);
    notices.observeStatus(agentId, rows.word.status);
  }
}

/**
 * The notices for the client's scope. They write the unseen agents and the
 * waiting inbox items into the document, and a notification's click brings
 * the window forward through the presenter, on the place the news names. Whose inbox is
 * read follows the document's account, which the launch's bootstrap writes as
 * well as every change after it. Two rules stand beside them: the agents with
 * no plan each list read carries are the notices' to hold, and a panel coming
 * forward reads the account's workspaces again.
 *
 * A refresh a callback asks for is forked into a set this scope owns, so it
 * runs on the services the client was built with and ends with the scope, and
 * a defect in one is reported, to Sentry as well as the line, rather than left
 * in a set nobody joins.
 */
export const linkClientNotices = /* @__PURE__ */ Effect.fn("client/linkClientNotices")(function* (
  dependencies: ClientNoticesDependencies,
): Effect.fn.Return<AgentNotices, never, Scope.Scope | AgentNoticeDoors> {
  const { state, host, taskList, presenter, onPanelFocusChanged, report } = dependencies;
  const doors = yield* AgentNoticeDoors;
  const fork = yield* FiberSet.makeRuntime();
  let focused = false;
  /** Each task's name as the followed list last drew it, by task id. */
  const names = new Map<string, string>();

  // Note that a defect is reported here, because nothing joins the set a refresh is forked into.
  const forkReported = (refresh: Effect.Effect<void>, what: string): void => {
    fork(
      Effect.catchDefect(Effect.withErrorReporting(refresh, { defectsOnly: true }), (defect) =>
        Effect.sync(() =>
          report(`${what} failed: ${defect instanceof Error ? defect.message : String(defect)}`),
        ),
      ),
    );
  };

  const notices = yield* createAgentNotices({
    onUnseenChanged: (unseen) => state.update({ agents: { unseen } }),
    onPanelFocusChanged,
    signedInAs: () => accountKey(state.snapshot().account),
    accountId: () => {
      const { account } = state.snapshot();

      return account.status === ACCOUNT_STATUS.SIGNED_IN ? account.id : undefined;
    },
    onAccountChanged: (listener) =>
      host.onAccountChanged((account) => listener(accountKey(account))),
    followAccountInbox: () => accountInboxOf(host),
    accounts: Stream.map(state.changes, (document) => accountKey(document.account)),
    onInboxChanged: (inbox) => state.update({ inbox }),
    sound: () => {
      const stored = state.snapshot().settings?.stored;

      return {
        when: stored?.soundWhen ?? APP_SETTING_DEFAULTS.soundWhen,
        sound: stored?.completionSound ?? APP_SETTING_DEFAULTS.completionSound,
        askSound: stored?.askSound ?? APP_SETTING_DEFAULTS.askSound,
      };
    },
    notify: () =>
      state.snapshot().settings?.stored.turnNotifications ?? APP_SETTING_DEFAULTS.turnNotifications,
    taskName: (taskId) => names.get(taskId),
    open: presenter.openPlace,
    report,
  });

  yield* Effect.forkScoped(
    Stream.runForEach(yield* taskList, (moved) =>
      Effect.catchDefect(
        Effect.sync(() => observeList(moved, names, notices)),
        (defect) =>
          Effect.sync(() =>
            report(
              `the agents on tasks could not be noted: ${defect instanceof Error ? defect.message : String(defect)}`,
            ),
          ),
      ),
    ),
  );
  // An agent's own transcript a window holds says where the agent stands as
  // each page is read, which the notices hold so an end the panel is not
  // looking at is still announced; a worker's says where the worker stands,
  // which is no word on the agent.
  const noted = new Map<string, number>();
  yield* Effect.forkScoped(
    Stream.runForEach(
      Stream.changes(Stream.map(state.changes, (document) => document[LIVE_READ.TRANSCRIPT])),
      (held) =>
        Effect.catchDefect(
          Effect.sync(() => observeTranscripts(held, noted, notices)),
          (defect) =>
            Effect.sync(() =>
              report(
                `the agents' transcripts could not be noted: ${defect instanceof Error ? defect.message : String(defect)}`,
              ),
            ),
        ),
    ),
  );
  // A command asked while the window is behind would otherwise wait unseen
  // until its timeout denies it, so each new ask still waiting after a few
  // seconds is announced once, whatever the account's notifications switch,
  // since Ask every time is the developer's own ask to be asked; one answered
  // by then, here or on another device, is not. The window in front shows the
  // prompt itself. Each is news the notices chime for as well, where the
  // account turned a sound on.
  const told = new Set<string>();

  const announced = (askId: string) =>
    Effect.sync(() => {
      if (!state.snapshot().machineCommands.asks.some((ask) => ask.id === askId)) return;
      const subject = { kind: NOTICE_KIND.MACHINE_COMMAND_ASK, askId } as const;
      notices.heard(subject);

      if (focused) return;
      doors.post({
        ...MACHINE_COMMAND_ASK_NOTICE,
        subject,
        onClick: presenter.openMachineCommandAsk,
      });
    });

  yield* Effect.forkScoped(
    Stream.runForEach(
      Stream.changes(Stream.map(state.changes, (document) => document.machineCommands.asks)),
      (asks) =>
        Effect.sync(() => {
          const waiting = new Set(asks.map((ask) => ask.id));

          for (const askId of told) if (!waiting.has(askId)) told.delete(askId);

          for (const ask of asks) {
            if (told.has(ask.id)) continue;
            told.add(ask.id);
            fork(Effect.andThen(Effect.sleep(ASK_NOTICE_AFTER), announced(ask.id)));
          }
        }),
    ),
  );
  // A teammate's change or an installation made on GitHub may have moved the
  // workspaces; the host reads them no oftener than once a minute.
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      onPanelFocusChanged((next) => {
        focused = next;

        if (focused) forkReported(host.workspacesRefresh(), "the workspaces refresh");
      }),
    ),
    (unsubscribe) => Effect.sync(unsubscribe),
  );

  return notices;
});
