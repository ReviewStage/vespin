import {
  answerFailedOf,
  HELD_WORDS,
  type HeldAsk as HeldAskOf,
  heldAbout,
  heldWith,
  markedAsk as markedAskOf,
  SETTLED_WORD,
  sameHeld,
} from "@repo/features/agent-approval-model";
import {
  AGENT_PERMISSION_MODE,
  type AgentPendingApproval,
  type AgentPermissionMode,
  APPROVAL_ANSWER,
  APPROVAL_BOUNDS,
  type ApprovalAnswerRequest,
} from "@repo/features/agent-approval-wire";
import { AGENT_PART, type AgentPart } from "@repo/features/agent-parts";
import type { AgentApprovalAnswerView } from "@repo/features/agent-view";
import { AGENT_RUNTIME, AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { allowedCommandWords } from "@repo/features/allowed-command-model";
import { providerOf } from "@repo/features/model-label";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { TOOL_STATE } from "@repo/features/tool-call-block";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  PERMISSION_MODE_HINT,
  PERMISSION_MODE_LABEL,
  PERMISSION_MODE_LIST,
  PERMISSION_MODE_WORDS,
} from "@repo/settings";
import {
  APPROVAL_ACTION,
  type ApprovalAction,
  ApprovalActions,
  AskFirstIcon,
  AutoApproveIcon,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  COMPOSER_LOOK,
  COMPOSER_SEND_TONE,
  DENY_NOTE_WORDS,
  type DenyNoteDoors,
  FullAccessIcon,
  type MenuRow,
  STATUS_TONE,
} from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useQuery } from "@tanstack/react-query";
import { Predicate } from "effect";
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
import { failureShown } from "../failure-report.js";
import { showToast } from "../toast.js";
import { appStateQuery, selectAppSettingsView } from "../use-app-state.js";
import { MessageBox, useMessageBox } from "./message-box.js";
import type { HeldCall } from "./transcript-blocks.js";

/**
 * agent-approvals.tsx -- how a Claude Code agent's tool calls are answered, as its tab draws it: the permission mode the model chip's menu offers, a card on each call the agent holds for an answer, and how many wait.
 *
 * The mode is offered as the Codex app offers its own, in the model chip's
 * menu (`model-menu.tsx`): a Permissions row naming the agent's mode opens
 * the three under the question "How should actions be approved?", each with
 * its glyph, its one-line hint under its name, and the agent's checked, in
 * Codex's order and words: Ask for approval, a hand, which always asks to
 * edit external files and use the internet; Approve for me, a shield round
 * a prompt, which asks only for actions the CLI's classifier finds unsafe;
 * and Full access, the default, a shield round a "!" in the attention ink,
 * which runs every call unasked (`AGENT_PERMISSION_MODE`). A line under them
 * says a change reaches the agent from its next turn, which a toast says
 * again as a change is made, since a turn under way runs on the mode it
 * started with. Off Full access the model chip wears the mode's glyph
 * before the model's name, so a mode that asks is seen at rest. The host
 * draws a change on the agent's row at once and takes it back where the
 * service refused it, which the composer says under its bar. A new
 * agent's menu offers the same row before it starts, on New task's box and
 * a draft agent's, a fork's and a continue's among them
 * (`useNewAgentPermissionMode`): it opens on the member's Default
 * permissions, a pick goes with the Start, so the first launch already runs
 * on it, and it writes no setting, since it is the new agent's alone; its
 * submenu says nothing of a next turn. Claude Code
 * and Codex agents each ask in their own harness's terms, which these words
 * and hints, Codex's own, fit both; an agent on neither asks nothing, so no
 * other is offered a mode.
 *
 * A call the agent holds waits on a member's answer (`pendingApprovals`),
 * which the call's own row says, found by the call's id (`toolUseId`): its
 * line reads "Waiting for approval" in the working mark's place, its body
 * says who asks where a subagent does and the CLI's own words for why, and
 * `@repo/ui`'s `ApprovalActions` stand under it, Allow, Always allow, and
 * Deny, as a row's own presses do (`heldCallOf`), Always allow naming the
 * command's first words where the harness proposed them
 * (`commandPrefix`), since then it lasts for every agent of the member's. One whose row is not
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

/** The glyph each mode wears: a hand, a shield round a prompt, a shield round a "!". */
export const MODE_GLYPH = {
  [AGENT_PERMISSION_MODE.ASK]: AskFirstIcon,
  [AGENT_PERMISSION_MODE.AUTO]: AutoApproveIcon,
  [AGENT_PERMISSION_MODE.FULL_ACCESS]: FullAccessIcon,
} as const satisfies Record<AgentPermissionMode, () => React.JSX.Element>;

/** The modes in the order the menu offers them: the most asking first, Full access last, as Codex orders its own. */
export const MODES = PERMISSION_MODE_LIST;

/** What the modes are called as a row among the model menu's. */
export const MODE_GROUP = PERMISSION_MODE_WORDS.GROUP;

/** The question the modes answer, heading their submenu. */
export const MODE_QUESTION = PERMISSION_MODE_WORDS.QUESTION;

/** When a change reaches the agent, said under the menu and on the change's toast. */
export const MODE_APPLIES = PERMISSION_MODE_WORDS.APPLIES;

/** Why a change of mode did not take, said under the composer's bar. */
const MODE_CHANGE_FAILED = PERMISSION_MODE_WORDS.CHANGE_FAILED;

/** The answer each of the card's presses sends. */
const WIRE_ANSWER = {
  [APPROVAL_ACTION.ALLOW]: APPROVAL_ANSWER.ALLOW,
  [APPROVAL_ACTION.ALLOW_FOR_AGENT]: APPROVAL_ANSWER.ALLOW_FOR_AGENT,
  [APPROVAL_ACTION.DENY]: APPROVAL_ANSWER.DENY,
} as const satisfies Record<ApprovalAction, (typeof APPROVAL_ANSWER)[keyof typeof APPROVAL_ANSWER]>;

/** The mode an agent runs on: full access where its row names none. */
function modeOf(agent: Pick<AgentSummary, "permissionMode">): AgentPermissionMode {
  return agent.permissionMode ?? AGENT_PERMISSION_MODE.FULL_ACCESS;
}

/** The mode chip's control: the mode it shows, a change, when a change reaches the agent, and why the last did not take. */
export interface AgentModeControl {
  readonly mode: AgentPermissionMode;
  /** Changes the agent's mode: from its next turn for a running agent, from its first for a new one. */
  readonly choose: (mode: AgentPermissionMode) => void;
  /** When a change reaches the agent, said under the Permissions submenu: from its next turn for a running agent; nothing for a new one, whose first launch runs on it. */
  readonly applies: string | undefined;
  /** Why the last change did not take, said under the composer's bar; nothing while none failed. */
  readonly note: string | undefined;
}

/**
 * The mode chip of an agent: none for an agent that never asks, which is
 * every agent on neither Claude Code nor Codex. Note that the mode is read off the
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

  if (
    agent === undefined ||
    (agent.runtime !== AGENT_RUNTIME.CLAUDE_CODE && agent.runtime !== AGENT_RUNTIME.CODEX)
  ) {
    return undefined;
  }

  const choose = (mode: AgentPermissionMode) => {
    if (mode === modeOf(agent)) return;
    writes.current += 1;
    const write = writes.current;
    setNote(undefined);
    showToast({
      replayUnmasked: true,
      words: `${PERMISSION_MODE_LABEL[mode]}. ${MODE_APPLIES}`,
      tone: STATUS_TONE.COMPLETE,
      glyph: MODE_GLYPH[mode],
    });
    latest.current.write(agent.id, mode).then((answer) => {
      if (write !== writes.current || !("failure" in answer)) return;
      setNote({ agentId: agent.id, words: MODE_CHANGE_FAILED });
    });
  };

  return {
    mode: modeOf(agent),
    choose,
    applies: MODE_APPLIES,
    note: note?.agentId === agent.id ? note.words : undefined,
  };
}

/** The member's Default permissions, which a new agent starts on where its menu picks none: full access until the settings are read, as the service's own default is. */
const selectDefaultMode = (state: AppStateSnapshot): AgentPermissionMode =>
  selectAppSettingsView(state)?.agentPermissionMode ?? AGENT_PERMISSION_MODE.FULL_ACCESS;

/**
 * The Permissions row of a new agent's menu: the mode picked on it, else
 * the member's Default permissions, for a model whose harness takes a mode,
 * a Claude model's Claude Code or a GPT model's Codex; none before a model
 * is chosen, or for one on neither. Note that a pick is the new agent's
 * alone, sent with its Start, and writes no setting.
 */
export function useNewAgentPermissionMode(input: {
  /** The catalog id of the model the agent would start on; none before one is chosen. */
  model: string | undefined;
  /** The mode picked on the row; none while the agent would start on the member's default. */
  picked: AgentPermissionMode | undefined;
  choose: (mode: AgentPermissionMode) => void;
}): AgentModeControl | undefined {
  const fallback =
    useQuery({ ...appStateQuery, select: selectDefaultMode }).data ??
    AGENT_PERMISSION_MODE.FULL_ACCESS;

  if (input.model === undefined || providerOf(input.model) === undefined) return undefined;

  return {
    mode: input.picked ?? fallback,
    choose: input.choose,
    applies: undefined,
    note: undefined,
  };
}

/** The mode an agent's chip names beside its model: none on Full access, the default, so a chip at rest reads as it always has. */
export function modeShown(control: AgentModeControl | undefined): AgentPermissionMode | undefined {
  return control === undefined || control.mode === AGENT_PERMISSION_MODE.FULL_ACCESS
    ? undefined
    : control.mode;
}

/** The modes as the model menu's Permissions submenu offers them, each with its hint under its name. */
export function modeMenuRows(): readonly MenuRow[] {
  return MODES.map((mode) => {
    const Glyph = MODE_GLYPH[mode];

    return {
      id: mode,
      label: PERMISSION_MODE_LABEL[mode],
      icon: <Glyph />,
      detail: PERMISSION_MODE_HINT[mode],
      detailUnder: true,
    };
  });
}

/** One ask as this window holds it: the ask, the answer out, how it settled, and why an answer did not go. */
type HeldAsk = HeldAskOf<ApprovalAction, ShownError>;

/** An ask marked as a message's to deny, or the mark taken back, by where the agent stands. */
function markedAsk(ask: HeldAsk, messaged: boolean, agent: Pick<AgentSummary, "status">): HeldAsk {
  return markedAskOf(ask, messaged, agent.status === AGENT_STATUS.RUNNING);
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

/** An ask once its answer came back: settled as the answer says, or offered again with why it did not go. */
function answeredAsk(ask: HeldAsk, answered: ApprovalActAnswer, agentId: string): HeldAsk {
  if ("approval" in answered) {
    return { ...ask, answering: undefined, settled: SETTLED_WORD[answered.approval.status] };
  }

  if ("approvalStatus" in answered && answered.approvalStatus !== undefined) {
    return { ...ask, answering: undefined, settled: SETTLED_WORD[answered.approvalStatus] };
  }

  // Note that a refusal names why, and only an answer not heard back asks for another press.
  const { words, refused } = answerFailedOf(answered.failure);

  return {
    ...ask,
    answering: undefined,
    error: {
      words,
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

/**
 * The words that tell the agent why its call was denied, written in the
 * composer's own box (`MessageBox`) as every message to it is, its `@` list
 * the task's: under them a quiet Cancel, which offers the answers again, as
 * Esc does, and Deny in the danger ink, which Enter presses too, with the
 * words or without them, since they are optional.
 */
function DenyNoteBox({ busy, maxLength, onDeny, onCancel }: DenyNoteDoors): React.JSX.Element {
  const [words, setWords] = useState("");

  const deny = () => {
    if (busy) return;
    const message = words.trim();
    onDeny(message === "" ? undefined : message);
  };

  const box = useMessageBox({
    draft: words,
    setDraft: setWords,
    placeholder: DENY_NOTE_WORDS.PLACEHOLDER,
    label: DENY_NOTE_WORDS.LABEL,
    maxLength: maxLength ?? APPROVAL_BOUNDS.MAX_MESSAGE_CHARS,
    onSubmit: deny,
    onLeave: busy ? undefined : onCancel,
    held: busy,
    takesFiles: false,
    focus: true,
  });

  return (
    <MessageBox
      box={box}
      look={COMPOSER_LOOK.CARD}
      className="comment-field approval-deny-note"
      beforeSend={
        <Button
          variant={BUTTON_VARIANT.QUIET}
          size={BUTTON_SIZE.COMPACT}
          disabled={busy}
          onClick={onCancel}
        >
          <ReplayUnmask>{DENY_NOTE_WORDS.CANCEL}</ReplayUnmask>
        </Button>
      }
      send={{
        label: DENY_NOTE_WORDS.DENY,
        inWords: true,
        tone: COMPOSER_SEND_TONE.DANGER,
        empty: false,
        busy,
        busyLabel: DENY_NOTE_WORDS.DENYING,
      }}
    />
  );
}

/** A held call as its row draws it: where it stands in words, who asks and why, and the presses while it waits. */
export function heldCallOf(ask: ApprovalView): HeldCall {
  return {
    status: ask.settled ?? HELD_WORDS.WAITING,
    waiting: ask.settled === undefined,
    about: heldAbout(ask.approval),
    actions:
      ask.settled === undefined ? (
        <ApprovalActions
          answering={ask.answering}
          error={ask.error}
          noteMaxLength={APPROVAL_BOUNDS.MAX_MESSAGE_CHARS}
          note={(doors) => <DenyNoteBox {...doors} />}
          command={
            ask.approval.commandPrefix === undefined
              ? undefined
              : allowedCommandWords(ask.approval.commandPrefix)
          }
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
      if (!Predicate.isObjectOrArray(part) || !("toolCallId" in part)) continue;

      if (Predicate.isString(part.toolCallId)) ids.add(part.toolCallId);
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
