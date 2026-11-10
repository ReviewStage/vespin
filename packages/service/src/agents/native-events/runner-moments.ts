import { RUNNER_END, RUNNER_EVENT, type RunnerEnd } from "@repo/agent-runner/protocol";
import { redactCredentials } from "@repo/features/credential-redaction";
import {
  TOOL_CALL_SETTLEMENT,
  type ToolCallSettlement,
  toolCallSettlementOf,
} from "@repo/features/turn-run";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireString,
  type UnparsedWireValue,
  valueFromJsonText,
  type WireValue,
} from "@repo/wire";
import type { UsageLimitAgent, UsageLimitAnswer } from "@repo/wire/ui-messages";
import { Option, Schema } from "effect";
import { NATIVE_ENDING, NATIVE_MOMENT, type NativeMoment } from "./native-moments.js";

/**
 * runner-moments.ts -- what every harness's reader reads alike: the runner's own events, and a tool's answer as the transcript settles its call.
 *
 * The runner posts its own events (`@repo/agent-runner/protocol`) among its
 * harness's messages, the same for Claude Code and Codex: a line we handed
 * the harness, the launch waiting on work in flight, the connection to the
 * model's provider lost and answering again, the agent's turn over
 * with the launch kept warm, and the launch's end. A
 * tool's answer is settled the same way whichever harness ran it: our own
 * tool's as the JSON it answered, any other's as the text the model read.
 */

/** How long the turn's record keeps a failure the harness reported, inside the writer's own bound. */
export const FAILURE_CHARS = 300;

/** How long the turn's record keeps the launch's own words for its end, long enough for a provider's whole JSON error, inside the writer's own bound. */
const END_DETAIL_CHARS = 1000;

/**
 * OpenAI's codes for a refusal of a ChatGPT plan, such as
 * `subscription_sharing_unsupported_capability`, each whole: its own words,
 * never a secret, though a run that long reads as one to `redactCredentials`.
 * Note that a code stands alone only between whitespace or quotes, or a
 * `,` or `;` after it, as a JSON error and a turn's failure words set it,
 * since any other character beside it could be part of a credential's value.
 */
const PLAN_CODE_SPLIT = /((?<![^\s"'])(?:subscription_sharing|chatpass_v2)_[a-z_]+(?![^\s"',;]))/;

/** What a NUL a runner's event carries is kept as, since no Postgres text or jsonb value holds one. */
const NUL_KEPT_AS = "\uFFFD";

/**
 * A value with every NUL in its strings, keys included, kept as the
 * replacement character: a runner's event as it arrives, and our own tool's
 * answer once read as JSON, whose `\u0000` its reading makes a NUL. Note that
 * a NUL is replaced rather than refused, because the store refuses it on every
 * post of its batch, which the runner posts again for as long as it runs, so
 * every event behind it would never land and its turn would stand frozen.
 */
export function withoutNul(value: WireValue): WireValue {
  if (isWireString(value)) return value.replaceAll("\u0000", NUL_KEPT_AS);
  if (Array.isArray(value)) return value.map(withoutNul);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, each]) => [
      key.replaceAll("\u0000", NUL_KEPT_AS),
      withoutNul(each),
    ]),
  );
}

/** What a picture in a tool's answer is kept as: the bytes went to the model once, and a transcript carries every byte it holds into each read. */
export const PICTURE_STAND_IN = "[image]";

const readType = Schema.decodeUnknownOption(Schema.Struct({ type: Schema.String }));
/** The most characters a snapshot's branch name may carry, past which it is no ref git takes. */
const SNAPSHOT_BRANCH_MAX_CHARS = 255;
const readAccepted = Schema.decodeUnknownOption(
  Schema.Struct({ uuid: Schema.String, snapshot: Schema.optionalKey(Schema.Unknown) }),
);
/** A commit as git names it, which the runner checked the snapshot's against before it posted them. */
const CommitSchema = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40,64}$/u));
/**
 * The checkout the runner recorded before the turn, as its ACCEPTED carries
 * it, read apart from the line so one spelled wrong is left out rather than
 * dropping the line: a branch is bounded as git bounds a ref's name.
 */
const readSnapshot = Schema.decodeUnknownOption(
  Schema.Struct({
    commit: CommitSchema,
    head: Schema.optionalKey(CommitSchema),
    branch: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(SNAPSHOT_BRANCH_MAX_CHARS))),
  }),
);
const readConnectionLost = Schema.decodeUnknownOption(Schema.Struct({ host: Schema.String }));
const readConnectionRestored = Schema.decodeUnknownOption(
  Schema.Struct({ host: Schema.String, carryOn: Schema.Boolean }),
);
/**
 * The end a runner posted where it let a wait on wakeups go so its sandbox
 * could stop, read as a turn that ended, the wakeups it named dropped. A
 * host bundles its own runner, so this is read until the host version floor
 * (`HOST_VERSION.FLOOR`) reaches 0.25.0, the first release whose runner
 * holds such a wait rather than ending on it.
 */
const LEGACY_RELEASED = "released";

const readEnd = Schema.decodeUnknownOption(
  Schema.Struct({
    reason: Schema.Literals([...Object.values(RUNNER_END), LEGACY_RELEASED]),
    detail: Schema.optionalKey(Schema.String),
  }),
);

/** How each of the runner's endings reads on the turn. */
const ENDING_OF_RUNNER_END = {
  [RUNNER_END.TURN_ENDED]: NATIVE_ENDING.DONE,
  [RUNNER_END.STOPPED]: NATIVE_ENDING.STOPPED,
  [RUNNER_END.INPUT_CLOSED]: NATIVE_ENDING.FAILED,
  [RUNNER_END.FAILED]: NATIVE_ENDING.FAILED,
  // A warm launch's turn already ended at its IDLE, so this end finds none to settle.
  [RUNNER_END.IDLED]: NATIVE_ENDING.DONE,
} as const satisfies Record<RunnerEnd, (typeof NATIVE_ENDING)[keyof typeof NATIVE_ENDING]>;

/** The ends that are no failure, which carry no detail. */
const QUIET_ENDS: ReadonlySet<RunnerEnd> = new Set([
  RUNNER_END.TURN_ENDED,
  RUNNER_END.STOPPED,
  RUNNER_END.IDLED,
]);

function endMoments(message: WireValue): readonly NativeMoment[] {
  const read = readEnd(message);
  if (Option.isNone(read)) return [];
  const { detail } = read.value;
  const reason = read.value.reason === LEGACY_RELEASED ? RUNNER_END.TURN_ENDED : read.value.reason;
  const said = detail === undefined ? reason : `${reason} ${detail}`;
  return [
    {
      kind: NATIVE_MOMENT.ENDED,
      ending: ENDING_OF_RUNNER_END[reason],
      ...(QUIET_ENDS.has(reason)
        ? undefined
        : { detail: redactKeepingPlanCodes(said).slice(0, END_DETAIL_CHARS) }),
      ...(reason === RUNNER_END.FAILED ? { launchFailed: true } : undefined),
    },
  ];
}

/**
 * Text as a failed turn's record and its report keep it: every
 * credential-shaped run replaced (`redactCredentials`), but OpenAI's plan
 * codes word for word, so what refused a plan stays readable. Note that a
 * code is set apart only where nothing a credential is spelled with touches
 * it, so no credential's head or tail is left unredacted beside one.
 */
export function redactKeepingPlanCodes(text: string): string {
  // Note that `split` puts each code its group caught at an odd index.
  return text
    .split(PLAN_CODE_SPLIT)
    .map((part, index) => (index % 2 === 1 ? part : redactCredentials(part)))
    .join("");
}

/**
 * One of the runner's own events as the moments of the run, or nothing
 * where the message is no event of the runner's, so the harness's reader
 * reads it.
 */
export function runnerMoments(message: WireValue): Option.Option<readonly NativeMoment[]> {
  const type = Option.map(readType(message), (read) => read.type);
  if (Option.isNone(type)) return Option.none();
  switch (type.value) {
    case RUNNER_EVENT.ACCEPTED:
      return Option.some(
        Option.match(readAccepted(message), {
          onSome: ({ uuid, snapshot }): readonly NativeMoment[] => [
            {
              kind: NATIVE_MOMENT.LINE_ACCEPTED,
              clientId: uuid,
              ...Option.match(readSnapshot(snapshot), {
                onSome: (read) => ({ snapshot: read }),
                onNone: () => undefined,
              }),
            },
          ],
          onNone: () => [],
        }),
      );
    case RUNNER_EVENT.WAITING:
      return Option.some([{ kind: NATIVE_MOMENT.WAITING }]);
    case RUNNER_EVENT.CONNECTION_LOST:
      return Option.some(
        Option.match(readConnectionLost(message), {
          onSome: ({ host }): readonly NativeMoment[] => [
            { kind: NATIVE_MOMENT.CONNECTION_LOST, host },
          ],
          onNone: () => [],
        }),
      );
    case RUNNER_EVENT.CONNECTION_RESTORED:
      return Option.some(
        Option.match(readConnectionRestored(message), {
          onSome: ({ host, carryOn }): readonly NativeMoment[] => [
            { kind: NATIVE_MOMENT.CONNECTION_RESTORED, host, carryOn },
          ],
          onNone: () => [],
        }),
      );
    // The agent's turn is over, as a `turn_ended` END says, though the launch stays warm.
    case RUNNER_EVENT.IDLE:
      return Option.some([{ kind: NATIVE_MOMENT.ENDED, ending: NATIVE_ENDING.DONE, warm: true }]);
    case RUNNER_EVENT.END:
      return Option.some(endMoments(message));
    // An ask and its settle are no moment of the run: the events route lands them apart (`runner-approvals.ts`).
    case RUNNER_EVENT.APPROVAL_REQUESTED:
    case RUNNER_EVENT.APPROVAL_RESOLVED:
      return Option.some([]);
    default:
      return Option.none();
  }
}

/**
 * A tool's answer as the transcript settles its call: an error the harness
 * flagged is a refusal carrying the text, and any other answer is available.
 * Our own tool's answer is read as the JSON it answers, so its status word
 * counts as the retired runtime's relay counted it; any other tool's is kept as `output`,
 * the text the model read or what the harness reported of the call.
 */
export function toolAnswerSettlement(
  answer:
    | { readonly workspaceTool: true; readonly text: string }
    | { readonly workspaceTool: false; readonly text: string; readonly output: UnparsedWireValue },
  isError: boolean,
): ToolCallSettlement {
  const output: UnparsedWireValue = answer.workspaceTool
    ? withoutNul(valueFromJsonText(answer.text))
    : answer.output;
  if (isError) {
    return {
      state: TOOL_CALL_SETTLEMENT.OUTPUT_ERROR,
      output,
      errorText: answer.text,
      status: ACTION_RESULT_STATUS.REJECTED,
    };
  }
  if (!answer.workspaceTool) return toolCallSettlementOf(JSON.stringify(answer.output), undefined);
  const status = isRecord(output) && isWireString(output.status) ? output.status : undefined;
  // Note that the settlement is handed the answer as read, since it reads its JSON again and would make its NUL anew.
  return toolCallSettlementOf(JSON.stringify(output), status);
}

/**
 * A worker's call its plan's usage limit ended, as the transcript settles
 * it: answered with the limit's notice, which its row draws in its answer's
 * place, rather than the harness's error, whose raw text the developer never
 * reads. The plan's limit itself is the turn's to read from the harness's
 * own report of it.
 */
export function usageLimitSettlement(agent: UsageLimitAgent): ToolCallSettlement {
  const answer: UsageLimitAnswer = { usageLimit: { agent, resetsAt: null } };
  return toolCallSettlementOf(JSON.stringify(answer), undefined);
}
