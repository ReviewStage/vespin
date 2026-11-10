import {
  AGENT_PERMISSION_MODE,
  type AgentPendingApproval,
  type AgentPermissionMode,
  APPROVAL_ANSWER,
  APPROVAL_BOUNDS,
  APPROVAL_STATUS,
  type ApprovalAnswerRequest,
  type ApprovalStatus,
} from "@repo/features/agent-approval-wire";
import { AGENT_PART, type AgentPart } from "@repo/features/agent-parts";
import { AGENT_CALL_FAILURE, type AgentApprovalAnswerView } from "@repo/features/agent-view";
import { AGENT_RUNTIME, AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { TOOL_STATE } from "@repo/features/tool-call-block";
import {
  APPROVAL_ACTION,
  type ApprovalAction,
  ApprovalActions,
  AskFirstIcon,
  AutoApproveIcon,
  CHIP_LOOK,
  Chip,
  ChipName,
  FullAccessIcon,
  MENU_DETAIL,
  type MenuRow,
  riseAbove,
  riseAboveEnd,
  STATUS_TONE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TOAST_HOLD,
  Tooltip,
  useMenu,
} from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AgentActAnswer, Unreached } from "../act.js";
import { ActionMenu, type MenuAction, type MenuSubmenu } from "../desktop/action-menu.js";
import { failureShown } from "../failure-report.js";
import { showToast } from "../toast.js";
import { OVERFLOW_PRESS, type OverflowOffer } from "./message-box.js";
import type { HeldCall } from "./transcript-blocks.js";

/**
 * agent-approvals.tsx -- how a Claude Code agent's tool calls are answered, as its tab draws it: the mode chip at the composer's foot, a card on each call the agent holds for an answer, and how many wait.
 *
 * The mode chip stands beside the model chip, as Threadbear and T3 Code put
 * it on their composers, naming how the agent's tool calls are answered
 * after the mode's shield: Full access, the default, which runs commands and
 * edits without asking; Ask before edits, which asks before it edits a file
 * or runs a command; and Auto, which leaves each call to Claude, which asks
 * where it is unsure (`AGENT_PERMISSION_MODE`). A press opens the menu of the
 * three over the chip, each with its one-line hint under it and the agent's
 * checked, and a line under them saying a change reaches the agent from its
 * next turn, which a toast says again as a change is made, since a turn under
 * way runs on the mode it started with. The host draws a change on the agent's
 * row at once and takes it back where the service refused it, which the
 * composer says under its bar. Only a Claude Code agent asks, so the chip
 * stands on no other: a Codex agent runs with full access for now. A
 * composer too narrow for the chip's words draws its shield alone, and one
 * narrower still folds it into its ⋯, which offers the three modes in its
 * place, as it does the context ring.
 *
 * A call the agent holds waits on a member's answer (`pendingApprovals`),
 * which the call's own row says, found by the call's id (`toolUseId`): its
 * line reads "Waiting for approval" in the working mark's place, its body
 * says who asks where a subagent does and the CLI's own words for why, and
 * `@repo/ui`'s `ApprovalActions` stand under it, Allow, Always allow, and
 * Deny, as a row's own presses do (`heldCallOf`). One whose row is not
 * drawn, a subagent's, whose calls the transcript does not keep among them,
 * is drawn as a row of its own at the transcript's foot over the working
 * line, from what the ask says of the call (`heldCallPart`). An answer goes
 * to the service at once, its press busy while it is out, and as it lands
 * the presses go and the line says how it came out in a word, "Allowed",
 * "Always allowed", "Denied", or "Expired", the row otherwise reading as
 * the call goes on to read, done or failed. One that stops waiting with no
 * answer of this window's says it was denied where a message the service
 * took went while it waited, expired as its turn ended, or was answered
 * elsewhere. Those words stand for as long as the tab does, since the
 * service keeps no ask once it settles.
 *
 * While a call waits, the working line says so ("Waiting on you · 1
 * approval") rather than counting on, so a paused agent never reads as
 * stuck, and the composer says over its field that a message sent now
 * denies the call waiting, as the service does with it.
 */

/** How a mode change is sent: the agent and the mode, answered as the view hears it. */
export type PermissionModeWriter = (
  agentId: string,
  permissionMode: AgentPermissionMode,
) => Promise<AgentActAnswer>;

/** An answer to an ask as the view hears it: the host's answer, or one that never arrived. */
export type ApprovalActAnswer = AgentApprovalAnswerView | Unreached<"unanswered">;

/** How an answer is sent: the agent, the ask, and the answer. */
export type ApprovalAnswerWriter = (
  agentId: string,
  approvalId: string,
  request: ApprovalAnswerRequest,
) => Promise<ApprovalActAnswer>;

/** What the chip and its menu call the mode, and what each does. */
export const MODE_WORDS = {
  [AGENT_PERMISSION_MODE.FULL_ACCESS]: {
    label: "Full access",
    hint: "Runs anything without asking, internet included",
  },
  [AGENT_PERMISSION_MODE.ASK]: {
    label: "Ask before edits",
    hint: "Asks before edits and commands",
  },
  [AGENT_PERMISSION_MODE.AUTO]: {
    label: "Auto",
    hint: "Asks only for actions it judges risky",
  },
} as const satisfies Record<AgentPermissionMode, { label: string; hint: string }>;

/** The glyph each mode wears: a warning shield, a hand, a checked shield. */
export const MODE_GLYPH = {
  [AGENT_PERMISSION_MODE.FULL_ACCESS]: FullAccessIcon,
  [AGENT_PERMISSION_MODE.ASK]: AskFirstIcon,
  [AGENT_PERMISSION_MODE.AUTO]: AutoApproveIcon,
} as const satisfies Record<AgentPermissionMode, () => React.JSX.Element>;

/** The modes in the order the menu offers them. */
export const MODES = [
  AGENT_PERMISSION_MODE.FULL_ACCESS,
  AGENT_PERMISSION_MODE.ASK,
  AGENT_PERMISSION_MODE.AUTO,
] as const;

/** The chip's name for a reader, and its menu's. */
const MODE_THING = "Permission mode";

/** What the modes are called where they are offered together beside other things: the model menu's row, the + menu's. */
export const MODE_GROUP = "Permissions";

/** The question the modes answer, heading every menu of them. */
export const MODE_QUESTION = "How should actions be approved?";

/** When a change reaches the agent, said under the menu and on the change's toast. */
export const MODE_APPLIES = "Takes effect from the next turn.";

/** Why a change of mode did not take, said under the composer's bar. */
const MODE_CHANGE_FAILED = "The permission mode could not be changed.";

/** What the composer says over its field while an ask waits. */
export const DENIES_WAITING = "Sending a message denies the waiting approval.";

/** What a held call's line says: that it waits, then how it came out. */
const HELD_WORDS = {
  WAITING: "Waiting for approval",
  ALLOWED: "Allowed",
  ALLOWED_FOR_AGENT: "Always allowed",
  DENIED: "Denied",
  EXPIRED: "Expired",
  ELSEWHERE: "Answered elsewhere",
} as const;

/** Why an answer did not go, said under the card's row: refused as not the reader's to answer or gone, or not heard back, which a press again may mend. */
const ANSWER_FAILED = {
  NOT_PERMITTED: "Only a member who controls this agent can answer it.",
  NOT_FOUND: "This approval is no longer here.",
  UNANSWERED: "The answer did not reach the agent. Try again.",
} as const;

/** Who asks, where a subagent does, said in the row's body. */
const SUBAGENT_ASKS = "Asked by a subagent.";

/** The answer each of the card's presses sends. */
const WIRE_ANSWER = {
  [APPROVAL_ACTION.ALLOW]: APPROVAL_ANSWER.ALLOW,
  [APPROVAL_ACTION.ALLOW_FOR_AGENT]: APPROVAL_ANSWER.ALLOW_FOR_AGENT,
  [APPROVAL_ACTION.DENY]: APPROVAL_ANSWER.DENY,
} as const satisfies Record<ApprovalAction, (typeof APPROVAL_ANSWER)[keyof typeof APPROVAL_ANSWER]>;

/** The word an ask's line settles into by the status it stands at, as this window's answer lands or as an answer finds it settled already. */
const SETTLED_WORD = {
  [APPROVAL_STATUS.PENDING]: undefined,
  [APPROVAL_STATUS.ALLOWED]: HELD_WORDS.ALLOWED,
  [APPROVAL_STATUS.ALLOWED_FOR_AGENT]: HELD_WORDS.ALLOWED_FOR_AGENT,
  [APPROVAL_STATUS.DENIED]: HELD_WORDS.DENIED,
  [APPROVAL_STATUS.EXPIRED]: HELD_WORDS.EXPIRED,
} as const satisfies Record<ApprovalStatus, string | undefined>;

/** The mode an agent runs on: full access where its row names none. */
function modeOf(agent: Pick<AgentSummary, "permissionMode">): AgentPermissionMode {
  return agent.permissionMode ?? AGENT_PERMISSION_MODE.FULL_ACCESS;
}

/** The mode chip's control: the mode it shows, a change, and why the last did not take. */
export interface AgentModeControl {
  readonly mode: AgentPermissionMode;
  /** Changes the agent's mode from its next turn. */
  readonly choose: (mode: AgentPermissionMode) => void;
  /** Why the last change did not take, said under the composer's bar; nothing while none failed. */
  readonly note: string | undefined;
}

/**
 * The mode chip of an agent: none for an agent that never asks, which is
 * every agent but a Claude Code one. Note that the mode is read off the
 * agent's row, which the host draws a change on at once, as the model
 * chip's is.
 */
export function useAgentPermissionMode(input: {
  agent: Pick<AgentSummary, "id" | "runtime" | "permissionMode"> | undefined;
  write: PermissionModeWriter;
}): AgentModeControl | undefined {
  const { agent } = input;
  const [note, setNote] = useState<{ agentId: string; words: string } | undefined>(undefined);
  const latest = useRef(input);
  latest.current = input;
  const writes = useRef(0);
  if (agent === undefined || agent.runtime !== AGENT_RUNTIME.CLAUDE_CODE) return undefined;
  const choose = (mode: AgentPermissionMode) => {
    if (mode === modeOf(agent)) return;
    writes.current += 1;
    const write = writes.current;
    setNote(undefined);
    showToast({
      replayUnmasked: true,
      words: `${MODE_WORDS[mode].label}. ${MODE_APPLIES}`,
      tone: STATUS_TONE.COMPLETE,
      glyph: MODE_GLYPH[mode],
      hold: TOAST_HOLD.DONE,
    });
    latest.current.write(agent.id, mode).then((answer) => {
      if (write !== writes.current || !("failure" in answer)) return;
      setNote({ agentId: agent.id, words: MODE_CHANGE_FAILED });
    });
  };
  return {
    mode: modeOf(agent),
    choose,
    note: note?.agentId === agent.id ? note.words : undefined,
  };
}

/** The menu's rows, the agent's mode checked, each with its hint under it. */
function modeRows(control: AgentModeControl): readonly MenuAction[] {
  return MODES.map((mode) => {
    const Glyph = MODE_GLYPH[mode];
    return {
      key: mode,
      label: MODE_WORDS[mode].label,
      detail: MODE_WORDS[mode].hint,
      detailPlace: MENU_DETAIL.WRAPPED,
      icon: <Glyph />,
      checked: control.mode === mode,
      onSelect: () => control.choose(mode),
    };
  });
}

/** What the composer's ⋯ offers in the chip's place once it folds the chip in: the three modes. */
export function modeOverflow(control: AgentModeControl | undefined): readonly OverflowOffer[] {
  if (control === undefined) return [];
  return [{ press: OVERFLOW_PRESS.MODE, entries: modeRows(control) }];
}

/** The chip naming the agent's mode at the composer's foot, and the menu that changes it. */
export function AgentModeChip({
  control,
  narrow,
}: {
  control: AgentModeControl;
  /** Whether the composer is too narrow for its words, which draws its shield alone. */
  narrow: boolean;
}): React.JSX.Element {
  const menu = useMenu(true);
  const trigger = menu.trigger(riseAboveEnd);
  const Glyph = MODE_GLYPH[control.mode];
  const label = `${MODE_THING}: ${MODE_WORDS[control.mode].label}`;
  return (
    <span className={`${OVERFLOW_PRESS.MODE} flex min-w-0`}>
      <Tooltip label={label}>
        <Chip
          look={CHIP_LOOK.TOOLBAR}
          iconOnly={narrow}
          chevron={!narrow}
          aria-label={label}
          {...trigger}
        >
          <Glyph />
          {narrow ? null : <ChipName>{MODE_WORDS[control.mode].label}</ChipName>}
        </Chip>
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label={MODE_THING}
          menu={menu.drawn}
          heading={<ModeQuestion />}
          groups={[modeRows(control)]}
          footer={
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {MODE_APPLIES}
            </Text>
          }
          onClose={menu.close}
        />
      )}
    </span>
  );
}

/** The question heading a menu of the modes, muted as a menu's heading is. */
function ModeQuestion(): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      {MODE_QUESTION}
    </Text>
  );
}

/** The + menu's entry that opens the modes beside it, wearing the agent's mode's glyph. */
export function modeSubmenu(control: AgentModeControl): MenuSubmenu {
  const Glyph = MODE_GLYPH[control.mode];
  return { label: MODE_GROUP, icon: <Glyph />, items: modeRows(control) };
}

/** The modes as a searchable menu's submenu offers them, each with its hint under its name. */
export function modeMenuRows(): readonly MenuRow[] {
  return MODES.map((mode) => {
    const Glyph = MODE_GLYPH[mode];
    return {
      id: mode,
      label: MODE_WORDS[mode].label,
      icon: <Glyph />,
      detail: MODE_WORDS[mode].hint,
      detailUnder: true,
    };
  });
}

/**
 * The mode as an icon alone beside the composer's +, and the menu that
 * changes it: the prototype's chip (`permission-mode-prototype.ts`), drawn
 * in the warning ink on Full access where `colored` asks.
 */
export function AgentModeIconChip({
  control,
  colored,
}: {
  control: AgentModeControl;
  /** Whether Full access wears the warning ink, as Codex's chip does. */
  colored: boolean;
}): React.JSX.Element {
  const menu = useMenu(true);
  const trigger = menu.trigger(riseAbove);
  const Glyph = MODE_GLYPH[control.mode];
  const label = `${MODE_THING}: ${MODE_WORDS[control.mode].label}`;
  const warns = colored && control.mode === AGENT_PERMISSION_MODE.FULL_ACCESS;
  return (
    <span className="agent-mode-icon flex">
      <Tooltip label={label}>
        <Chip
          look={CHIP_LOOK.TOOLBAR}
          iconOnly
          tone={warns ? STATUS_TONE.ATTENTION : undefined}
          aria-label={label}
          {...trigger}
        >
          <Glyph />
          <ChipName>{MODE_WORDS[control.mode].label}</ChipName>
        </Chip>
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label={MODE_THING}
          menu={menu.drawn}
          heading={<ModeQuestion />}
          groups={[modeRows(control)]}
          footer={
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {MODE_APPLIES}
            </Text>
          }
          onClose={menu.close}
        />
      )}
    </span>
  );
}

/** One ask as this window holds it: the ask, the answer out, how it settled, and why an answer did not go. */
interface HeldAsk {
  readonly approval: AgentPendingApproval;
  readonly answering?: ApprovalAction | undefined;
  /** The word its line settled into; none while it waits. */
  readonly settled?: string | undefined;
  /** Whether it was settled only by leaving the row's waiting asks, which its return to them takes back. */
  readonly vanished?: boolean | undefined;
  /** Whether a message went while it waited, which the service denies it with; a return to the waiting asks clears it. */
  readonly messaged?: boolean | undefined;
  readonly error?: ShownError | undefined;
}

/** One ask as its call's row draws it. */
export interface ApprovalView {
  readonly approval: AgentPendingApproval;
  readonly answering: ApprovalAction | undefined;
  readonly settled: string | undefined;
  readonly error: ShownError | undefined;
  readonly onAnswer: (answer: ApprovalAction, message?: string) => void;
}

/** The asks of an agent as its tab draws them. */
export interface AgentApprovalsControl {
  /** Each ask this tab has seen, waiting or settled, the oldest first. */
  readonly asks: readonly ApprovalView[];
  /** How many still wait on an answer. */
  readonly waiting: number;
  /** Says a message went while asks waited, which the service denies them with once it takes the message; a refused send takes that back. */
  readonly messageSent: (sent: Promise<AgentActAnswer>) => void;
}

/** The line an ask that stopped waiting with no answer of this window's settles into. */
function vanishedLine(byMessage: boolean, running: boolean): string {
  if (byMessage) return HELD_WORDS.DENIED;
  return running ? HELD_WORDS.ELSEWHERE : HELD_WORDS.EXPIRED;
}

/**
 * The asks held with the agent's row laid over them: each waiting one taken
 * in, and each that stopped waiting with no answer of this window's settled.
 * Note that one settled only by leaving the waiting asks opens again as it
 * comes back to them, its last failure kept, because a write that left it
 * may still let it go, and an answer that did not reach the agent is the
 * reader's to send again.
 */
function heldWith(
  held: ReadonlyMap<string, HeldAsk>,
  pending: readonly AgentPendingApproval[],
  running: boolean,
): ReadonlyMap<string, HeldAsk> {
  const waiting = new Set(pending.map((each) => each.id));
  const next = new Map(held);
  for (const approval of pending) {
    const was = next.get(approval.id);
    if (was === undefined) next.set(approval.id, { approval });
    else if (was.vanished === true) next.set(approval.id, { approval, error: was.error });
  }
  for (const [id, ask] of next) {
    if (waiting.has(id) || ask.settled !== undefined || ask.answering !== undefined) continue;
    next.set(id, { ...ask, settled: vanishedLine(ask.messaged === true, running), vanished: true });
  }
  return next;
}

/** Whether two holdings hold the same asks as they stand. */
function sameHeld(a: ReadonlyMap<string, HeldAsk>, b: ReadonlyMap<string, HeldAsk>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, ask] of a) if (b.get(id) !== ask) return false;
  return true;
}

/**
 * The asks of an agent: those its row holds waiting, and those this tab
 * saw settle, each with its answer's press. Note that the asks are held
 * per agent, from the first render that sees each, so a tab moved to
 * another agent starts from none.
 */
export function useAgentApprovals(input: {
  agent: Pick<AgentSummary, "id" | "status" | "pendingApprovals">;
  write: ApprovalAnswerWriter;
}): AgentApprovalsControl {
  const { agent } = input;
  const pending = agent.pendingApprovals ?? NO_ASKS;
  const running = agent.status === AGENT_STATUS.RUNNING;
  const [state, setState] = useState<{
    agentId: string;
    held: ReadonlyMap<string, HeldAsk>;
  }>(() => ({ agentId: agent.id, held: new Map() }));
  const fresh =
    state.agentId === agent.id ? state : { agentId: agent.id, held: new Map<string, HeldAsk>() };
  const held = heldWith(fresh.held, pending, running);
  if (fresh !== state || !sameHeld(held, state.held)) setState({ ...fresh, held });
  const latest = useRef(input);
  latest.current = input;

  const settle = useCallback(
    (agentId: string, id: string, change: (ask: HeldAsk) => HeldAsk) =>
      setState((was) => {
        const ask = was.held.get(id);
        if (was.agentId !== agentId || ask === undefined) return was;
        return { ...was, held: new Map(was.held).set(id, change(ask)) };
      }),
    [],
  );

  const answer = useCallback(
    (agentId: string, id: string, card: ApprovalAction, message?: string) => {
      settle(agentId, id, (ask) => ({ ...ask, answering: card, error: undefined }));
      const request: ApprovalAnswerRequest =
        message === undefined
          ? { answer: WIRE_ANSWER[card] }
          : { answer: WIRE_ANSWER[card], message };
      latest.current
        .write(agentId, id, request)
        .then((answered) => settle(agentId, id, (ask) => answeredAsk(ask, answered, agentId)));
    },
    [settle],
  );

  // Note that the asks are marked as the message goes, since the service may take them off before it answers, and a refused send takes the mark back, its line too where the mark had said it.
  const messageSent = useCallback((sent: Promise<AgentActAnswer>) => {
    const { agent: sentTo } = latest.current;
    const waitingIds = (sentTo.pendingApprovals ?? NO_ASKS).map((each) => each.id);
    if (waitingIds.length === 0) return;
    const mark = (messaged: boolean) =>
      setState((was) => {
        if (was.agentId !== sentTo.id) return was;
        const next = new Map(was.held);
        for (const id of waitingIds) {
          const ask = next.get(id);
          if (ask !== undefined) next.set(id, markedAsk(ask, messaged, latest.current.agent));
        }
        return { ...was, held: next };
      });
    mark(true);
    sent.then((answer) => {
      if ("failure" in answer) mark(false);
    });
  }, []);

  const asks = useMemo(
    () =>
      [...held.values()]
        .toSorted((a, b) => a.approval.askedAt - b.approval.askedAt)
        .map(
          (ask): ApprovalView => ({
            approval: ask.approval,
            answering: ask.answering,
            settled: ask.settled,
            error: ask.error,
            onAnswer: (card, message) => answer(agent.id, ask.approval.id, card, message),
          }),
        ),
    [held, answer, agent.id],
  );
  return {
    asks,
    waiting: asks.filter((ask) => ask.settled === undefined).length,
    messageSent,
  };
}

/** An ask marked as a message's to deny, or the mark taken back, its line said again where it was settled by leaving the waiting asks. */
function markedAsk(ask: HeldAsk, messaged: boolean, agent: Pick<AgentSummary, "status">): HeldAsk {
  if (messaged) return ask.settled === undefined ? { ...ask, messaged: true } : ask;
  if (ask.messaged !== true) return ask;
  const running = agent.status === AGENT_STATUS.RUNNING;
  return ask.vanished === true
    ? { ...ask, messaged: false, settled: vanishedLine(false, running) }
    : { ...ask, messaged: false };
}

/** An ask once its answer came back: settled as the answer says, or offered again with why it did not go. */
function answeredAsk(ask: HeldAsk, answered: ApprovalActAnswer, agentId: string): HeldAsk {
  if ("approval" in answered) {
    return { ...ask, answering: undefined, settled: SETTLED_WORD[answered.approval.status] };
  }
  if ("approvalStatus" in answered && answered.approvalStatus !== undefined) {
    return { ...ask, answering: undefined, settled: SETTLED_WORD[answered.approvalStatus] };
  }
  // Note that a refusal names why, and only an answer not heard back asks for another press.
  const refused =
    answered.failure === AGENT_CALL_FAILURE.NOT_PERMITTED ||
    answered.failure === AGENT_CALL_FAILURE.NOT_FOUND;
  return {
    ...ask,
    answering: undefined,
    error: {
      words:
        answered.failure === AGENT_CALL_FAILURE.NOT_PERMITTED
          ? ANSWER_FAILED.NOT_PERMITTED
          : answered.failure === AGENT_CALL_FAILURE.NOT_FOUND
            ? ANSWER_FAILED.NOT_FOUND
            : ANSWER_FAILED.UNANSWERED,
      failure: failureShown({
        surface: FAILURE_SURFACE.AGENT_APPROVAL,
        cause: "cause" in answered && answered.cause !== undefined ? answered.cause : answered,
        about: { agentId },
        ...(refused ? { refused: true } : undefined),
      }),
    },
  };
}

const NO_ASKS: readonly AgentPendingApproval[] = [];

/** What the row's body says of who asks and why: the subagent where one does, and the CLI's own words where it gave some. */
function aboutOf(approval: AgentPendingApproval): string | undefined {
  const asker = approval.subagentId === undefined ? undefined : SUBAGENT_ASKS;
  // Note that the CLI's words are left out where they are the call's own description, which the row's line says already.
  const why =
    approval.description === approval.input.description ? undefined : approval.description;
  const words = [asker, why].filter((each) => each !== undefined);
  return words.length === 0 ? undefined : words.join(" ");
}

/** A held call as its row draws it: where it stands in words, who asks and why, and the presses while it waits. */
export function heldCallOf(ask: ApprovalView): HeldCall {
  return {
    status: ask.settled ?? HELD_WORDS.WAITING,
    waiting: ask.settled === undefined,
    about: aboutOf(ask.approval),
    actions:
      ask.settled === undefined ? (
        <ApprovalActions
          answering={ask.answering}
          error={ask.error}
          noteMaxLength={APPROVAL_BOUNDS.MAX_MESSAGE_CHARS}
          onAnswer={ask.onAnswer}
        />
      ) : undefined,
  };
}

/** The asks a transcript's rows find theirs among. */
interface TranscriptAsks {
  readonly asks: readonly ApprovalView[];
}

const ApprovalsContext = createContext<TranscriptAsks | undefined>(undefined);

/** Hands the transcript's rows the agent's asks, so a held call's row says it waits and offers the answers. */
export function ApprovalsProvider({
  asks,
  children,
}: {
  asks: readonly ApprovalView[];
  children: ReactNode;
}): React.JSX.Element {
  const value = useMemo(() => ({ asks }), [asks]);
  return <ApprovalsContext.Provider value={value}>{children}</ApprovalsContext.Provider>;
}

/** The ask the agent holds on the call `callId`, as its row draws it; none where none is. */
export function useCallHeld(callId: string): HeldCall | undefined {
  const asks = useContext(ApprovalsContext)?.asks;
  const ask = asks?.find(
    (each) => each.approval.toolUseId === callId && each.approval.subagentId === undefined,
  );
  return ask === undefined ? undefined : heldCallOf(ask);
}

/** The ids of the tool calls a transcript's messages hold. */
export function transcriptCallIds(
  messages: readonly { readonly parts: readonly unknown[] }[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (typeof part !== "object" || part === null || !("toolCallId" in part)) continue;
      if (typeof part.toolCallId === "string") ids.add(part.toolCallId);
    }
  }
  return ids;
}

/** The asks no drawn call holds, a subagent's among them, which stand at the transcript's foot as rows of their own. */
export function looseApprovals(
  asks: readonly ApprovalView[],
  callIds: ReadonlySet<string>,
): readonly ApprovalView[] {
  return asks.filter(
    (ask) => ask.approval.subagentId !== undefined || !callIds.has(ask.approval.toolUseId),
  );
}

/** The call an ask no drawn row holds stands for, as its row is drawn from it: the tool, its input, under way while the ask waits. */
export function heldCallPart(
  approval: AgentPendingApproval,
): Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }> {
  return {
    kind: AGENT_PART.TOOL,
    tool: approval.toolName,
    callId: approval.toolUseId,
    state: TOOL_STATE.INPUT_AVAILABLE,
    input: approval.input,
    output: undefined,
    errorText: undefined,
  };
}

/** What the working line says while asks wait: that the agent waits on the reader, and on how many. */
export function waitingOnYouWords(waiting: number): string {
  return `Waiting on you · ${waiting} ${waiting === 1 ? "approval" : "approvals"}`;
}
