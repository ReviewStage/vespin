/**
 * machine-ask-live.ts -- the asks the account's machines hold for its answer, as each of its devices follows them over the service's held poll: the read declared, and the asks as a reader draws them.
 *
 * The service answers one statement, every ask a machine of the account's
 * posted and has not taken down (`machine-ask-wire.ts`), with what a device
 * draws of it and the answer that stands on it, where one does. Only the
 * account that owns the machines reads them, never a teammate.
 */

import { Option, Schema } from "effect";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  type LiveRowOf,
  liveRead,
  liveRows,
  ORDER,
  orderedLiveRows,
} from "./live-read.js";
import { LIVE_READ, LIVE_USER_QUERY } from "./live-wire.js";
import {
  type MachineAskDecision,
  type MachineAskSubject,
  machineAskDecisionSchema,
  machineAskSubjectSchema,
} from "./machine-ask-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber } from "./service-wire.js";

/** The asks the account's machines hold: one part, every ask not taken down, the earliest asked first. */
export const MACHINE_ASKS_READ = liveRead({
  name: LIVE_READ.MACHINE_ASKS,
  path: HOSTED_SERVICE_PATH.LIVE_MACHINE_ASKS,
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    asks: liveRows({
      row: Schema.Struct({
        id: Schema.String,
        deviceId: Schema.String,
        agentId: Schema.NullOr(Schema.String),
        subject: Schema.Unknown,
        askedAt: countedNumber,
        expiresAt: countedNumber,
        /** Whether its machine said the window closed with no answer, so an answer now lets the agent try again. */
        lapsed: Schema.Boolean,
        decision: Schema.NullOr(Schema.String),
        note: Schema.NullOr(Schema.String),
      }),
      key: "id",
      order: [
        ["askedAt", ORDER.ASC],
        ["id", ORDER.ASC],
      ],
    }),
  },
});

export type MachineAsksLiveAnswer = LiveReadAnswer<typeof MACHINE_ASKS_READ>;

/** One ask as the statement delivers it. */
export type MachineAskLiveRow = LiveRowOf<typeof MACHINE_ASKS_READ.parts.asks>;

/** The answer that stands on an ask: the decision, and for a denial, the owner's words. */
export interface MachineAskAnswerLine {
  readonly decision: MachineAskDecision;
  readonly note?: string;
}

/**
 * One ask as a device draws it and its machine takes it: its id, the
 * machine and the agent it is for, what it asks, when it was asked and
 * when its window closes, and the answer that stands on it, none while it
 * waits.
 */
export interface MachineAskLine {
  readonly id: string;
  readonly deviceId: string;
  readonly agentId?: string;
  readonly subject: MachineAskSubject;
  readonly askedAt: number;
  readonly expiresAt: number;
  readonly lapsed: boolean;
  readonly answer?: MachineAskAnswerLine;
}

const readDecision = Schema.decodeUnknownOption(machineAskDecisionSchema);

const readSubject = Schema.decodeUnknownOption(machineAskSubjectSchema);

/** The answer a row holds; none while it waits, or for a decision this build does not know. */
function answerOf(row: MachineAskLiveRow): MachineAskAnswerLine | undefined {
  const decision = readDecision(row.decision);

  if (Option.isNone(decision)) return undefined;

  return {
    decision: decision.value,
    ...(row.note === null ? undefined : { note: row.note }),
  };
}

/** The asks as the held read answers them, the earliest asked first, each this build cannot read left out. */
export function machineAsksOfLiveRows(
  rows: readonly MachineAskLiveRow[],
): readonly MachineAskLine[] {
  return orderedLiveRows(MACHINE_ASKS_READ.parts.asks, rows).flatMap((row) => {
    const subject = readSubject(row.subject);
    const answer = answerOf(row);

    if (Option.isNone(subject)) return [];

    return [
      {
        id: row.id,
        deviceId: row.deviceId,
        ...(row.agentId === null ? undefined : { agentId: row.agentId }),
        subject: subject.value,
        askedAt: row.askedAt,
        expiresAt: row.expiresAt,
        lapsed: row.lapsed,
        ...(answer === undefined ? undefined : { answer }),
      },
    ];
  });
}

/** The asks still waiting on an answer, the earliest asked first. */
export function waitingMachineAsks(asks: readonly MachineAskLine[]): readonly MachineAskLine[] {
  return asks.filter((ask) => ask.answer === undefined);
}

/** How many of the asks given need the developer now, by the agent each is for: those whose window has not run out. */
export function machineAsksByAgent(asks: readonly MachineAskLine[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();

  for (const ask of asks) {
    if (ask.lapsed || ask.agentId === undefined) continue;
    counts.set(ask.agentId, (counts.get(ask.agentId) ?? 0) + 1);
  }

  return counts;
}
