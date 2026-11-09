/**
 * app-state-reads.ts -- what a window reads of the host's document over its bridge: the one rule a delivery is adopted by, the following of the document from its first whole read, the selects a surface reads one slice through, and the Inbox's rows read from it.
 *
 * The panel reads these through `@repo/panel`'s `use-app-state.ts`, which
 * writes each reading into its Query client, and the Expo app through a
 * Query client of its own (`apps/mobile/src/host/app-state-query.ts`), so
 * what the document means to a reader is said once here, beneath both, and
 * neither carries the other's React.
 */

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { INBOX_SCOPE_KIND } from "@repo/features/agent-view";
import { INBOX_ASK, type InboxMessage, recommendedLabels } from "@repo/features/inbox-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  type AccountExperiment,
  type AccountExperimentChoices,
  accountExperimentChoices,
  type ExperimentChoices,
  experimentOn,
  type HostCapability,
  NO_EXPERIMENTS,
} from "@repo/settings";
import { type AppSettingsView, appSettingsView } from "@repo/settings/wire";
import { type AppStateDelivery, type AppStateSnapshot, withAppStateDelivery } from "./app-state.js";

/**
 * The one rule a window adopts a delivery by. A delivery older than the one
 * held is dropped and nothing else is: the version rises with the document,
 * and a delivery that repeats it is this window's own facts having moved — its
 * mode, or the display under it — which the document does not number.
 *
 * What is adopted keeps the identity of every part of the held document a
 * delivery did not move (`withAppStateDelivery`): an entry it does not name
 * is the very object held, and one it names keeps every part of it that
 * said nothing new. A delivery crossed into this window as text, so without
 * that every memo and comparison keyed on what it carried would miss, and
 * every reader redraw, whatever moved.
 */
function adoptAppStateDelivery(
  held: AppStateSnapshot,
  delivery: AppStateDelivery,
): AppStateSnapshot {
  return delivery.version < held.version ? held : withAppStateDelivery(held, delivery);
}

/** The bridge's two reads of the document: the whole of it on request, and what moved on every change. */
export interface AppStateBridgeReads {
  readonly requestAppState: () => Promise<AppStateSnapshot>;
  readonly onAppState: (listener: (delivery: AppStateDelivery) => void) => () => void;
}

/** A window's following of the document: its first whole read written, what it holds now, and how it stops. */
export interface FollowedAppState {
  /** Settles once the first whole read is written, and fails where the bridge refused it. */
  readonly written: Promise<void>;
  /** The document as last adopted, for a reader that writes it again; none before the first read answers. */
  readonly held: () => AppStateSnapshot | undefined;
  readonly stop: () => void;
}

/**
 * Follows the document over `bridge` into `write`, from the moment it is
 * called until it is stopped: the first whole read, then each delivery laid
 * over what is held.
 *
 * A delivery is what moved since the last one sent, not the whole document,
 * and names no version it was built on, so it is laid only over a whole
 * read asked after subscribing: one heard before that read answers waits
 * for it and is laid over it then (`adoptAppStateDelivery`). A refused read
 * leaves the deliveries waiting, and the next one heard asks for the whole
 * document again, rather than lay them over a document they were not built
 * on, such as an older read or another account's; the refusal is said
 * through `report`. Note that the read is asked after the subscription
 * stands, so a delivery sent while it is in flight is heard.
 */
export function followAppStateOver(
  bridge: AppStateBridgeReads,
  write: (state: AppStateSnapshot) => Promise<void> | undefined,
  report: (message: string, cause: unknown) => void,
): FollowedAppState {
  let following = true;
  let held: AppStateSnapshot | undefined;
  let early: AppStateDelivery[] = [];
  let reading = false;
  const readWhole = (): Promise<void> => {
    reading = true;
    return bridge.requestAppState().then(
      (read) => {
        reading = false;
        if (!following) return undefined;
        held = early.reduce(adoptAppStateDelivery, read);
        early = [];
        return write(held);
      },
      (cause: unknown) => {
        reading = false;
        throw cause;
      },
    );
  };
  const stopHearing = bridge.onAppState((delivered) => {
    if (held === undefined) {
      early.push(delivered);
      if (!reading) {
        readWhole().catch((cause: unknown) => {
          report("The window's state could not be read; the next delivery asks again.", cause);
        });
      }
      return;
    }
    const next = adoptAppStateDelivery(held, delivered);
    if (next === held) return;
    held = next;
    write(next);
  });
  const written = readWhole();
  return {
    written,
    held: () => held,
    stop: () => {
      following = false;
      stopHearing();
    },
  };
}

/**
 * What a surface reads of the document, each a `select` for
 * `useQuery({ ...appStateQuery, select })`: one top-level slice, or one
 * answer made from one. Each is a module-level function, so its reference
 * stands still from render to render and Query runs it again only when the
 * document moves, as the docs' Render Optimizations guide asks of `select`.
 */
export const selectRun = (state: AppStateSnapshot) => state.run;
export const selectAccount = (state: AppStateSnapshot) => state.account;

/** Who is signed in, by the id and the address main's document names; none while none is. */
export interface SignedInAccount {
  readonly id: string | undefined;
  readonly email: string;
}

/** The account signed in, read for a `select` or from the document as it stands; none while none is. */
export const selectSignedIn = (state: AppStateSnapshot | undefined): SignedInAccount | undefined =>
  state?.account.status === ACCOUNT_STATUS.SIGNED_IN
    ? { id: state.account.id, email: state.account.email }
    : undefined;

/**
 * Whether two readings name one account: by id where both name one, else by
 * address. Note that an account signed in before its id is read names only
 * its address, so a refresh that brings the id is still that account.
 */
export function sameAccount(
  one: SignedInAccount | undefined,
  other: SignedInAccount | undefined,
): boolean {
  if (one === undefined || other === undefined) return one === other;
  return one.id !== undefined && other.id !== undefined
    ? one.id === other.id
    : one.email === other.email;
}
export const selectAccess = (state: AppStateSnapshot) => state.access;
export const selectAudio = (state: AppStateSnapshot) => state.audio;
export const selectTasks = (state: AppStateSnapshot) => state.tasks;
export const selectInbox = (state: AppStateSnapshot) => state.inbox;
export const selectInboxWaiting = (state: AppStateSnapshot) => state.inbox.waiting;
export const selectInboxTasks = (state: AppStateSnapshot) => state.inbox.tasks;
export const selectInboxTaskless = (state: AppStateSnapshot) => state.inbox.taskless;
export const selectInboxAgents = (state: AppStateSnapshot) => state.inbox.agents;
export const selectFailedRuns = (state: AppStateSnapshot) => state.inbox.failedRuns;
export const selectPullRequestPublished = (state: AppStateSnapshot) =>
  state[LIVE_READ.PULL_REQUEST_PUBLISHED];
export const selectMacCommands = (state: AppStateSnapshot) => state.macCommands;
export const selectNotifications = (state: AppStateSnapshot) => state.notifications;
export const selectNetwork = (state: AppStateSnapshot) => state.network;
export const selectSessionReplay = (state: AppStateSnapshot) => state.sessionReplay;
export const selectPortForwarding = (state: AppStateSnapshot) => state.portForwarding;
export const selectMirrors = (state: AppStateSnapshot) => state.mirrors;

/** The account's workspaces, which tell their readers only as the list moves, not as the tasks beside it do. */
export const selectWorkspaces = (state: AppStateSnapshot) => state.tasks.workspaces;

/**
 * Whether the first read has answered with settings: nothing is drawn over
 * a document without them, and the window reports itself painted on the
 * first that holds them.
 */
export const selectSettingsHeld = (state: AppStateSnapshot): boolean =>
  state.settings !== undefined;

/** The settings as the panel draws them. */
export const selectAppSettingsView = (state: AppStateSnapshot): AppSettingsView | undefined =>
  state.settings === undefined ? undefined : appSettingsView(state.settings);

/** Every experiment the account chose as its store holds them, a workspace experiment's old choice among them; signed out, every one is off. Read only to combine with a workspace's (`workspace-experiments.ts`). */
export const selectStoredExperimentChoices = (state: AppStateSnapshot): ExperimentChoices =>
  state.settings?.experiments ?? NO_EXPERIMENTS;

/** Every experiment of its own the account chose; signed out, every one is off. A workspace experiment is the workspace's, read through `workspace-experiments.ts`. */
const selectExperimentChoices = memoizedSelect(
  (state: AppStateSnapshot) => [selectStoredExperimentChoices(state)],
  (choices: ExperimentChoices): AccountExperimentChoices => accountExperimentChoices(choices),
);

/** Whether the signed-in account is an admin; signed out, or where the host's read of it failed, none is. */
export const selectAdminAccess = (state: AppStateSnapshot): boolean => state.access.admin === true;

/** Whether the account's access is still being read, as it is for a moment after a sign-in or a launch. */
export const selectAdminAccessPending = (state: AppStateSnapshot): boolean =>
  state.access.pending === true;

const experimentSelects = new Map<AccountExperiment, (state: AppStateSnapshot) => boolean>();

/**
 * Whether the signed-in account has one of its own experiments on: the one
 * way an account experiment's row, command, and place ask. A workspace
 * experiment is asked of the workspace (`useWorkspaceExperiment`), so this
 * takes none. One function per experiment, made once and kept, so the
 * `select` a surface hands Query stands still from render to render. Signed
 * out, every experiment is off.
 */
export function selectExperiment(
  experiment: AccountExperiment,
): (state: AppStateSnapshot) => boolean {
  const held = experimentSelects.get(experiment);
  if (held !== undefined) return held;
  const select = (state: AppStateSnapshot): boolean =>
    experimentOn(selectExperimentChoices(state), experiment);
  experimentSelects.set(experiment, select);
  return select;
}

const capabilitySelects = new Map<HostCapability, (state: AppStateSnapshot) => boolean>();

/**
 * Whether the platform this window runs on offers one capability: the one
 * way a platform feature's tab, command, or button asks whether to stand at
 * all. One function per capability, made once and kept, as
 * `selectExperiment`'s are.
 */
export function selectCapability(capability: HostCapability): (state: AppStateSnapshot) => boolean {
  const held = capabilitySelects.get(capability);
  if (held !== undefined) return held;
  const select = (state: AppStateSnapshot): boolean => state.run.capabilities.includes(capability);
  capabilitySelects.set(capability, select);
  return select;
}

/**
 * A `select` whose answer is made once per change to the parts of the
 * document it reads, for every reader: `inputs` names those parts, and
 * `derive` is run again only when one of them is a new object. Note that
 * the last answer is kept rather than one per reader, because every reader
 * of a window reads the one document, so a delivery that moved none of the
 * parts hands each the same object. For an answer Query's structural
 * sharing cannot keep, such as a `Map` or a `Set`, which would otherwise be
 * made anew, and redraw its reader, on every delivery to any slice.
 */
export function memoizedSelect<Inputs extends unknown[], A>(
  inputs: (state: AppStateSnapshot) => [...Inputs],
  derive: (...inputs: Inputs) => A,
): (state: AppStateSnapshot) => A {
  let held: { readonly inputs: Inputs; readonly answer: A } | undefined;
  return (state) => {
    const next = inputs(state);
    if (held !== undefined && next.every((input, at) => input === held?.inputs[at])) {
      return held.answer;
    }
    held = { inputs: next, answer: derive(...next) };
    return held.answer;
  };
}

/** The line a row's last message is: an ask's own kind, or words said with nothing asked. */
export const INBOX_ROW_LINE = {
  ...INBOX_ASK,
  SAID: "said",
} as const;

export type InboxRowLine = (typeof INBOX_ROW_LINE)[keyof typeof INBOX_ROW_LINE];

/** One option of a decide ask as a row's detail offers it: its label, and the trade-off where the agent wrote one. */
export type InboxRowChoice = { readonly label: string; readonly detail?: string };

/** A decide ask as a row's detail draws it: its question, its options, and the labels the agent recommends. */
export type InboxRowAsk = {
  readonly question: string;
  readonly choices: readonly InboxRowChoice[];
  readonly recommended: readonly string[];
};

/** One Inbox row: a thread waiting on the developer, as a list and its detail draw it. */
export type InboxRow = {
  readonly id: string;
  readonly title: string;
  /** The thread's last line, or what kind of thread it is where it holds no words yet. */
  readonly summary: string;
  /** When the thread last changed, in epoch milliseconds. */
  readonly at: number;
  readonly unread?: boolean;
  readonly line: InboxRowLine;
  readonly ask?: InboxRowAsk;
};

/** What a row says under its title where its thread holds no words. */
const INBOX_ROW_WORDS = {
  ASKING: "An agent is waiting on your answer.",
  NOTICE: "An agent posted a notice.",
} as const;

/** The first line of a message's words, or none where it holds no words. */
function firstLine(text: string): string | undefined {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
}

/** The kind an ask is, where this build knows it; none for a kind from a newer service. */
function askKindOf(message: InboxMessage | undefined): InboxRowLine | undefined {
  const type = message?.ask?.type;
  return Object.values(INBOX_ASK).find((kind) => kind === type);
}

/** A decide ask on a message, as a row's detail draws it; none for any other message. Note that the ask is told by its options, since a kind from a newer service shares no literal to tell it by. */
function rowAskOf(message: InboxMessage | undefined): InboxRowAsk | undefined {
  const ask = message?.ask;
  if (message === undefined || ask === undefined || !("options" in ask)) return undefined;
  return {
    question: firstLine(message.text) ?? "",
    choices: ask.options.map(({ label, detail }) => ({
      label,
      ...(detail === undefined ? {} : { detail }),
    })),
    recommended: recommendedLabels(ask),
  };
}

/**
 * The Inbox's rows from the document: every item waiting on the developer
 * (`inbox.waiting`), in the order the host lists them, each read whole from
 * the account's feed where the feed holds its task, so its last message
 * says what it asks. Note that an item from a service before `asking` was
 * said counts as asking, as the host counts it.
 */
export function inboxRowsOf(
  inbox: AppStateSnapshot["inbox"],
  feed: AppStateSnapshot[typeof LIVE_READ.INBOX_ITEMS],
): readonly InboxRow[] {
  return inbox.waiting.flatMap(({ taskId, items }) =>
    items.map((waiting): InboxRow => {
      const held = feed.rows?.[INBOX_SCOPE_KIND.PLAN][taskId]?.find(({ id }) => id === waiting.id);
      const latest = held?.thread?.at(-1);
      const asking = waiting.asking !== false;
      const ask = rowAskOf(latest);
      return {
        id: waiting.id,
        title: waiting.title,
        summary:
          (latest === undefined ? undefined : firstLine(latest.text)) ??
          (asking ? INBOX_ROW_WORDS.ASKING : INBOX_ROW_WORDS.NOTICE),
        at: held?.updatedAt ?? waiting.postedAt,
        ...(held?.unread === undefined ? {} : { unread: held.unread }),
        line: askKindOf(latest) ?? INBOX_ROW_LINE.SAID,
        ...(ask === undefined ? {} : { ask }),
      };
    }),
  );
}
