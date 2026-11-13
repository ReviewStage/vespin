/**
 * voice-call-rows.tsx -- what a call into an agent draws in its transcript: the voice's lines, and the rules each call begins and ends at.
 *
 * A call's lines are the caller's and the voice's, stored as rows of the
 * agent's conversation in the order they were said (`voice-call-lines.ts`).
 * The caller's line is drawn as any line of theirs, led by the spoken mark
 * (`agent-tab.tsx`); the voice's is drawn here, at the column's left under
 * "Voice", in the muted ink, never as the agent's words. Neither says its
 * day and time, which its call's start says once; each says when into the
 * call it began on hover alone (`SpokenOffset`), as the call's clock reads
 * it, where its row keeps it. Each call stands between two rules: "Call
 * started" and the day and time its first line began, naming a teammate
 * whose call it was, before the row its first line stands in; and "Call
 * ended" and how long it ran, to the end of its last line on the call's
 * clock, after the row its last line stands in. All of it is drawn only
 * while the Voice experiment is on (`useVoiceShown`).
 */

import { messageWords } from "@repo/features/agent-parts";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { workingTime } from "@repo/features/time-format";
import {
  type CallMarks,
  type CallSpan,
  callClock,
  type SpokenLine,
  spokenLineOf,
} from "@repo/features/voice-call-lines";
import { EXPERIMENT } from "@repo/settings";
import {
  CALL_MARK_END,
  CallMark,
  CallOffset,
  MESSAGE_LINE_ALIGN,
  MESSAGE_LINE_INSET,
  MessageLine,
  TIME_LOOK,
  Time,
  VoiceSpeaker,
  VoiceWords,
} from "@repo/ui";
import type { Actor } from "@repo/ui/actor-model";
import { MESSAGE_ROLE } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { ActorRef } from "../actor-ref.js";
import { Message } from "../ai-elements/message.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import { CopyMessageAction } from "./copy-message.js";

/** What a call's rules say. */
const CALL_MARK_WORDS = {
  STARTED: "Call started",
  TEAMMATE_STARTED: " call started",
  ENDED: "Call ended",
} as const;

/** No call begins or ends among the rows. */
export const NO_CALL_MARKS: CallMarks = { opens: new Map(), closes: new Map(), folded: new Set() };

/** Whether a call's lines are drawn as a call's: while the account has the Voice experiment on. */
export function useVoiceShown(): boolean {
  return useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.VOICE) }).data === true;
}

/** A line the voice said on a call: "Voice" over its words in the muted ink, at the column's left, when it began and its Copy under it. */
export function VoiceLineRow({ message }: { message: AgentTranscriptMessage }): React.JSX.Element {
  const words = messageWords(message);
  const spoken = spokenLineOf(message);

  return (
    <Message from={MESSAGE_ROLE.ASSISTANT} data-message-id={message.id} data-voice-line="">
      <VoiceSpeaker />
      <VoiceWords>{words}</VoiceWords>
      <MessageLine
        align={MESSAGE_LINE_ALIGN.START}
        inset={MESSAGE_LINE_INSET.FLUSH}
        actions={
          <CopyMessageAction
            words={words}
            copyable={words !== ""}
            messageId={message.id}
            lead={spoken === undefined ? undefined : <SpokenOffset line={spoken} />}
          />
        }
      />
    </Message>
  );
}

/** When into its call a line began, shown on hover among its actions; nothing where its row keeps no such time. */
export function SpokenOffset({ line }: { line: SpokenLine }): React.JSX.Element | null {
  return line.fromMs === undefined ? null : <CallOffset clock={callClock(line.fromMs)} />;
}

/** How long a call ran (`CallSpan`'s `lengthMs`); none where its rows say no time, or no time passed. */
function callLength(span: CallSpan): string | undefined {
  return span.lengthMs === undefined || span.lengthMs <= 0 ? undefined : workingTime(span.lengthMs);
}

/** The rule each call that begins at a row stands on before it: "Call started", or a teammate's call by name, and when. */
export function CallStarts({
  spans,
  callerOf,
}: {
  spans: readonly CallSpan[] | undefined;
  /** The teammate whose call it was, by its caller's first line; none for the reader's own. */
  callerOf: (line: AgentTranscriptMessage) => Actor | undefined;
}): React.JSX.Element | null {
  if (spans === undefined) return null;

  return (
    <>
      {spans.map((span) => {
        const caller = span.callerLine === undefined ? undefined : callerOf(span.callerLine);

        return (
          <CallMark key={span.callId} end={CALL_MARK_END.START}>
            {caller === undefined ? (
              CALL_MARK_WORDS.STARTED
            ) : (
              <span className="whitespace-pre">
                <ActorRef actor={caller} possessive nameOnly />
                {CALL_MARK_WORDS.TEAMMATE_STARTED}
              </span>
            )}
            {span.startedAt === undefined ? null : (
              <Fragment>
                <span aria-hidden="true">·</span>
                <Time at={span.startedAt} look={TIME_LOOK.DAY} />
              </Fragment>
            )}
          </CallMark>
        );
      })}
    </>
  );
}

/** The rule each call that ends at a row stands on after it: "Call ended", and how long it ran. */
export function CallEnds({
  spans,
}: {
  spans: readonly CallSpan[] | undefined;
}): React.JSX.Element | null {
  if (spans === undefined) return null;

  return (
    <>
      {spans.map((span) => {
        const length = callLength(span);

        return (
          <CallMark key={span.callId} end={CALL_MARK_END.END}>
            {CALL_MARK_WORDS.ENDED}
            {length === undefined ? null : (
              <Fragment>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{length}</span>
              </Fragment>
            )}
          </CallMark>
        );
      })}
    </>
  );
}
