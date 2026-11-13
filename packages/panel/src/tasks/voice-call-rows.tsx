/**
 * voice-call-rows.tsx -- what a call into an agent draws in its transcript: the voice's lines, and the rules each call begins and ends at.
 *
 * A call's lines are the caller's and the voice's, stored as rows of the
 * agent's conversation in the order they were said (`voice-call-lines.ts`).
 * The caller's line is drawn as any line of theirs (`agent-tab.tsx`), and
 * the voice's here as the agent's own reply is: its words on no ground at
 * the column's left, when it was said under them with its Copy, and no
 * mark, label, or tone of its own. A call is marked only by the two rules
 * it stands between: "Call started", or a teammate's chip and "started a
 * call", and the day and time its first line began, before the row its
 * first line stands in; and "Call ended", or the teammate's chip and
 * "ended a call", and how long it ran, to the end of its last line on the
 * call's clock, after the row its last line stands in, but for the call
 * this window still holds, which has not ended. All of it is drawn
 * only while the Voice experiment is on (`useVoiceShown`).
 */

import { messageWords } from "@repo/features/agent-parts";
import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { workingTime } from "@repo/features/time-format";
import type { CallMarks, CallSpan } from "@repo/features/voice-call-lines";
import { EXPERIMENT } from "@repo/settings";
import {
  CALL_MARK_END,
  CallMark,
  MESSAGE_LINE_ALIGN,
  MESSAGE_LINE_INSET,
  MessageLine,
  TIME_LOOK,
  Time,
} from "@repo/ui";
import type { Actor } from "@repo/ui/actor-model";
import { MESSAGE_ROLE } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { ActorRef } from "../actor-ref.js";
import { Message, MessageContent } from "../ai-elements/message.js";
import { appStateQuery, selectExperiment } from "../use-app-state.js";
import { CopyMessageAction } from "./copy-message.js";
import { TranscriptWords } from "./transcript-blocks.js";

/** What a call's rules say. */
const CALL_MARK_WORDS = {
  STARTED: "Call started",
  TEAMMATE_STARTED: "started a call",
  ENDED: "Call ended",
  TEAMMATE_ENDED: "ended a call",
} as const;

/** No call begins or ends among the rows, and no turn is folded under one. */
export const NO_CALL_MARKS: CallMarks = { opens: new Map(), closes: new Map(), folded: new Set() };

/** Whether a call's lines are drawn as a call's: while the account has the Voice experiment on. */
export function useVoiceShown(): boolean {
  return useQuery({ ...appStateQuery, select: selectExperiment(EXPERIMENT.VOICE) }).data === true;
}

/** A line the voice said on a call, drawn as the agent's own reply is: its words, then when it was said and its Copy. */
export function VoiceLineRow({ message }: { message: AgentTranscriptMessage }): React.JSX.Element {
  const words = messageWords(message);

  return (
    <Message from={MESSAGE_ROLE.ASSISTANT} data-message-id={message.id}>
      <MessageContent>
        <TranscriptWords text={words} />
      </MessageContent>
      <MessageLine
        align={MESSAGE_LINE_ALIGN.START}
        inset={MESSAGE_LINE_INSET.FLUSH}
        at={message.sentAt}
        actions={<CopyMessageAction words={words} copyable={words !== ""} messageId={message.id} />}
      />
    </Message>
  );
}

/** How long a call ran (`CallSpan`'s `lengthMs`); none where its rows say no time, or no time passed. */
function callLength(span: CallSpan): string | undefined {
  return span.lengthMs === undefined || span.lengthMs <= 0 ? undefined : workingTime(span.lengthMs);
}

/** The rule each call that begins at a row stands on before it: "Call started", or a teammate's chip and "started a call", and when. */
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
              <Fragment>
                <ActorRef actor={caller} />
                {CALL_MARK_WORDS.TEAMMATE_STARTED}
              </Fragment>
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

/** The rule each call that ends at a row stands on after it: "Call ended", or a teammate's chip and "ended a call", and how long it ran. */
export function CallEnds({
  spans,
  live,
  callerOf,
}: {
  spans: readonly CallSpan[] | undefined;
  /** The call this window holds, still under way, which ends at no row yet; none where it holds none. */
  live: string | undefined;
  /** The teammate whose call it was, by its caller's first line; none for the reader's own. */
  callerOf: (line: AgentTranscriptMessage) => Actor | undefined;
}): React.JSX.Element | null {
  if (spans === undefined) return null;

  return (
    <>
      {spans
        .filter((span) => span.callId !== live)
        .map((span) => {
          const length = callLength(span);
          const caller = span.callerLine === undefined ? undefined : callerOf(span.callerLine);

          return (
            <CallMark key={span.callId} end={CALL_MARK_END.END}>
              {caller === undefined ? (
                CALL_MARK_WORDS.ENDED
              ) : (
                <Fragment>
                  <ActorRef actor={caller} />
                  {CALL_MARK_WORDS.TEAMMATE_ENDED}
                </Fragment>
              )}
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
