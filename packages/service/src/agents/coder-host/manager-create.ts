/**
 * manager-create.ts -- `create_manager`: a Manager a Manager makes for the member who asked it for one, on the app's own New Manager path.
 *
 * The Manager is made by `startManager`, the one function the app's
 * `createManager` runs, so it is refused and kept as one made at New
 * Manager is: in the calling Manager's own workspace, as the member who
 * asked for the turn under way (`askingMember`, its owner standing in only
 * where no member asked), who owns it and pays for it, in the cloud, under
 * the call's own key, so a call run again makes one. Its model and effort
 * are the ones named or else that member's own default, as New Manager
 * draws it (`acceptedAgentChoice`), and its repositories the ones named or
 * else the calling Manager's own. A first message, where one is given, is
 * handed to it as `message_agent` hands one, from the calling Manager, and
 * opens its first turn. The answer names the new Manager by its id and its
 * mention link.
 */

import { readAgentRepositories } from "@repo/database/models/agent-repositories";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_KIND, AGENT_MACHINE } from "@repo/features/agent-wire";
import { githubRepositoryFullNameSchema } from "@repo/features/github-repositories-wire";
import { managerFacePickSchema } from "@repo/features/manager-face";
import { MANAGER_BOUNDS, managerCreateRequestSchema } from "@repo/features/manager-wire";
import { MENTION_KIND } from "@repo/features/mention-link";
import { type ModelChoice, modelChoiceSchema } from "@repo/features/models-wire";
import type { WireRecord } from "@repo/wire";
import { describeWire } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import { ACTION_RESULT_STATUS, HOSTED_API_ERROR, type UnparsedWireValue } from "../../core.js";
import type { HostedRefusal } from "../../http/http-effect.js";
import { ModelChoiceRefused } from "../../providers/model-catalog.js";
import {
  AGENT_TOOL_REFUSAL,
  type AgentCall,
  type AgentToolServices,
  agentToolRejected,
  askingMember,
  callerAgent,
  callerUserId,
  callerWorkspace,
  choiceRefusal,
  orStoreRefusal,
  startRefusalWords,
} from "../agent-tools.js";
import { workspaceAgent } from "../workspace-agents.js";
import { workspaceStepOf, writtenMention } from "../written-mentions.js";
import {
  MAX_MESSAGE_WORDS_CHARS,
  messageRefusalWords,
  steerAgentMessage,
} from "./agent-message.js";
import { startManager } from "./manager-start.js";
import { acceptedAgentChoice } from "./start.js";

/** Why `create_manager` made nothing, in words the model can act on. */
const CREATE_MANAGER_REFUSAL = {
  UNREADABLE:
    "Not made: pass a name, and optionally a face, repositories as owner/name, a model with its " +
    "effort, and a message; nothing else is read.",
  NOT_MANAGER: "Not made: only a Manager makes another Manager.",
  NO_REPOSITORY: "Not made: you work in no repository to hand it, so name its repositories.",
  NO_DEFAULT: `Not made: the default model of the member who asked is not offered to them; name a model and effort ${AGENT_TOOL.LIST_MODELS} lists.`,
  OFF: "Not made: Managers are off in your workspace.",
} as const;

const CREATE_MANAGER_INPUT = Schema.Struct({
  name: describeWire(
    managerCreateRequestSchema.fields.name,
    "The new Manager's name, its title from the start.",
  ),
  face: Schema.optionalKey(
    describeWire(
      managerFacePickSchema,
      "The face it wears: a character and a color, and one emoji in the character's place if you like; left out, one is picked.",
    ),
  ),
  repositories: Schema.optionalKey(
    describeWire(
      Schema.Array(githubRepositoryFullNameSchema).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(MANAGER_BOUNDS.MAX_REPOSITORIES),
        Schema.isUnique(),
      ),
      "The GitHub repositories it works in, as owner/name, the first its checkout; left out, your own.",
    ),
  ),
  model: Schema.optionalKey(
    describeWire(
      modelChoiceSchema.fields.model,
      `The model it runs on, by its catalog id, as ${AGENT_TOOL.LIST_MODELS} lists it; left out with effort, the asking member's default.`,
    ),
  ),
  effort: Schema.optionalKey(
    describeWire(
      modelChoiceSchema.fields.effort,
      "The reasoning effort, as the model lists it; given with the model or not at all.",
    ),
  ),
  message: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(MAX_MESSAGE_WORDS_CHARS)),
      "A first message handed to it from you, which opens its first turn; left out, it waits for the member's first words.",
    ),
  ),
});

const readCreate = Schema.decodeUnknownResult(CREATE_MANAGER_INPUT);

/** `create_manager` as a Manager is offered it: its name, its words, and its input. */
export const CREATE_MANAGER_TOOL = {
  name: AGENT_TOOL.CREATE_MANAGER,
  description:
    "Make a new Manager in your workspace, owned by the member who asked this turn, only when a member asks you for one. " +
    "It answers the new Manager's id and mention link.",
  inputSchema: CREATE_MANAGER_INPUT,
} as const;

/** A refusal of the Manager's make in the model's words: a workspace with Managers off, or any Start's refusal. */
function madeRefusalWords(refusal: HostedRefusal): string {
  return refusal.error === HOSTED_API_ERROR.NOT_PERMITTED
    ? CREATE_MANAGER_REFUSAL.OFF
    : startRefusalWords(refusal);
}

/**
 * The choice the Manager runs on, read as the asking member's: the one
 * named, or their own default, either checked against the models they are
 * offered; or why it is refused, with every model offered where the
 * catalog refused it.
 */
const acceptedAgentChoiceOf = (asker: string, named: ModelChoice | undefined) =>
  acceptedAgentChoice(asker, named).pipe(
    Effect.map((choice) => Result.succeed(choice)),
    Effect.catch((refusal) =>
      Effect.succeed(
        Result.fail(
          !(refusal instanceof ModelChoiceRefused)
            ? startRefusalWords(refusal)
            : named === undefined
              ? CREATE_MANAGER_REFUSAL.NO_DEFAULT
              : choiceRefusal(named, refusal.offered, "Not made"),
        ),
      ),
    ),
  );

/** One call of `create_manager`: a Manager made in the caller's workspace as the member who asked, handed the first message where one is given, or why nothing was made. */
export function runCreateManager(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readCreate(input);

  // A choice is one thing: a model without its effort, or the reverse, names nothing to run on.
  if (
    Result.isFailure(asked) ||
    (asked.success.model === undefined) !== (asked.success.effort === undefined)
  ) {
    return Effect.succeed(agentToolRejected(CREATE_MANAGER_REFUSAL.UNREADABLE));
  }

  const made = asked.success;
  const calling = callerAgent(call.caller);

  if (calling?.kind !== AGENT_KIND.MANAGER) {
    return Effect.succeed(agentToolRejected(CREATE_MANAGER_REFUSAL.NOT_MANAGER));
  }

  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(call.caller);

      if (Option.isNone(workspace)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);

      // The Manager is the asking member's, as one they made at New Manager would be.
      const asker = yield* askingMember(call.caller);

      const [first, ...rest] =
        made.repositories ??
        (yield* readAgentRepositories(calling.userId, calling.id)).map((each) => each.repository);

      if (first === undefined) return agentToolRejected(CREATE_MANAGER_REFUSAL.NO_REPOSITORY);

      const named =
        made.model === undefined || made.effort === undefined
          ? undefined
          : { model: made.model, effort: made.effort };

      // Note that the choice is read as the asker's, so one left out is their own default, as New Manager draws it.
      const choice = yield* acceptedAgentChoiceOf(asker, named);

      if (Result.isFailure(choice)) return agentToolRejected(choice.failure);

      const started = yield* startManager(Effect.succeed(call.agentSessionsAs(asker)), asker, {
        idempotencyKey: call.clientKey,
        workspaceId: workspace.value,
        name: made.name,
        repositories: [first, ...rest],
        runsOn: { machine: AGENT_MACHINE.VERCEL },
        model: choice.success.model,
        effort: choice.success.effort,
        ...(made.face === undefined ? undefined : { face: made.face }),
      }).pipe(Effect.result);

      if (Result.isFailure(started)) return agentToolRejected(madeRefusalWords(started.failure));
      const { id } = started.success.agent;
      const step = yield* workspaceStepOf(asker, workspace.value);

      const manager = {
        id,
        title: made.name,
        mention: writtenMention({ kind: MENTION_KIND.AGENT, agentId: id }, made.name, step),
      };

      if (made.message === undefined) {
        return { status: ACTION_RESULT_STATUS.ACCEPTED, agent: manager };
      }

      const target = yield* workspaceAgent(
        callerUserId(call.caller),
        workspace.value,
        id,
        calling.id,
      );

      const sent = Option.isNone(target)
        ? Result.fail(AGENT_TOOL_REFUSAL.NO_AGENT)
        : Result.mapError(
            yield* steerAgentMessage(call, calling, target.value, workspace.value, made.message),
            messageRefusalWords,
          );

      return Result.isSuccess(sent)
        ? { status: ACTION_RESULT_STATUS.ACCEPTED, agent: manager, delivery: sent.success }
        : {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            agent: manager,
            note: `Made, but your message was not sent: ${sent.failure} Send it with ${AGENT_TOOL.MESSAGE_AGENT}.`,
          };
    }),
  );
}
