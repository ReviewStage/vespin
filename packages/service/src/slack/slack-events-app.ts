/**
 * slack-events-app.ts -- our Slack bot's one inbound route: the events Slack sends, and a press of an ask's button in a member's DM, which answers the ask as the member would in the app.
 *
 * Slack sends every request for our own Slack app, events and interactivity
 * alike, to this one path, signed with the app's signing secret
 * (`SLACK_APP_SIGNING_SECRET`): `X-Slack-Signature` is `v0=` and the
 * HMAC-SHA256 of `v0:<timestamp>:<raw body>`, its timestamp the
 * `X-Slack-Request-Timestamp` header, as Slack's "Verifying requests from
 * Slack" lays out. Nothing of a request is read past its bounded bytes
 * before that signature holds, compared in constant time, and its
 * timestamp stands within five minutes of our clock, so a request
 * replayed later is refused; a deployment missing the secret answers
 * unavailable and reads nothing.
 * Interactivity arrives form-encoded, its JSON under `payload`; an event
 * arrives as JSON: Slack's URL check is answered, an uninstall of the app
 * from a team, or a revoke of its bot token there, deletes the installation
 * of every workspace connected to that team, and with it its token and its
 * members' Slack ids, and a message a member addressed to the bot, a mention
 * or a direct message, is acknowledged and acted on once the answer has left
 * (`slack-agent-starts.ts`), as is a member's 👍 or 👎 on a message the bot
 * posted in an agent's thread (`slack-reactions.ts`); every other event is
 * acknowledged unread.
 *
 * A press (`block_actions`) is acknowledged at once with an empty answer, as
 * Slack asks within its three seconds, and acted on once the answer has left,
 * a failure logged by its kind alone. It is read for the option button's
 * value, which names the item, the message whose ask it answers, and the
 * option (`SlackChoice`, `thread-dms.ts`), or a do ask's answer, Mark done
 * ticking every step, or for a Submit's, which names no option and is
 * answered with the checkboxes the press's state holds ticked, each found
 * back by its place among the ask's options; a press with none, the Open
 * button's and a tick of a checkbox among them, is acknowledged and nothing
 * else. The presser is found back as the workspace member the bot's lookups
 * kept under that Slack user, or one whose own Slack account is that user, in
 * the team the item's workspace connected (`SlackWorkspaceBot.memberOf`), and
 * the ask is answered as that member (`answerAsMember`) under the button's
 * action id, so a press Slack sends again is the answer already taken. The
 * answer taken is handed to the agent as its "Thread answer", and the DM is
 * rewritten to say the option chosen; a press on an ask already settled
 * rewrites the DM to say where it stands. Of a request nothing is logged but
 * a fixed line: its kind as it is heard, and a refused signature.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { deleteSlackTeamInstallations } from "@repo/database/models/slack-installation-store";
import { storeWriter } from "@repo/database/models/writer";
import { INBOX_ASK, INBOX_ASK_STATUS, INBOX_REPLY, knownAsk } from "@repo/features/inbox-wire";
import { causeKind } from "@repo/runtime/effect";
import { EXCESS_KEYS, HTTP_METHOD, type UnparsedWireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Clock, Config, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { text } from "../core.js";
import { afterResponse } from "../http/after-response.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  parseJsonBytes,
  readBodyBytesEffect,
} from "../http/http-effect.js";
import { answerAsMember } from "../inbox/inbox-procedures.js";
import { INBOX_ASK_ANSWER, readInboxItem } from "../inbox/inbox-store.js";
import { ANY_METHOD } from "../route.js";
import { actOnSlackEvent } from "./slack-agent-starts.js";
import { SlackBot, type SlackMessage } from "./slack-bot.js";
import { actOnSlackReaction } from "./slack-reactions.js";
import {
  chosenLine,
  doneLine,
  itemWorkspace,
  rewriteThreadDm,
  SLACK_PICKS_ACTION,
  type SlackChoice,
  SlackChoiceSchema,
  settledLine,
} from "./thread-dms.js";

/** The path Slack sends our app's events and interactivity to, under the deployment's origin. */
const SLACK_EVENTS_PATH = "/api/slack/events";

/** Slack caps an interaction's payload far below this; bounded all the same before anything is read. */
const MAXIMUM_REQUEST_BYTES = 1024 * 1024;

/** The form field interactivity carries its JSON under. */
const INTERACTION_FIELD = "payload";

/** The content type interactivity arrives as. */
const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded";

/** The variable the secret Slack signs our app's requests with is read from. */
const SLACK_APP_ENVIRONMENT = { SIGNING_SECRET: "SLACK_APP_SIGNING_SECRET" } as const;

/** Slack's request signature: its headers, the version it is made under, and how far its timestamp may stand from our clock. */
const SLACK_SIGNATURE = {
  HEADER: "x-slack-signature",
  TIMESTAMP_HEADER: "x-slack-request-timestamp",
  VERSION: "v0",
  FRESH_SECONDS: 5 * 60,
} as const;

/** A timestamp as Slack writes it: whole seconds since the epoch. */
const UNIX_SECONDS = /^\d{1,12}$/u;

/** The kinds of request read: a press of a button, Slack's check of the URL, and an event. */
const SLACK_REQUEST_TYPE = {
  BLOCK_ACTIONS: "block_actions",
  URL_VERIFICATION: "url_verification",
  EVENT_CALLBACK: "event_callback",
} as const;

/** The events that end our app's hold on a team: its uninstall, and a revoke of its tokens there. */
const SLACK_LIFECYCLE_EVENT = {
  APP_UNINSTALLED: "app_uninstalled",
  TOKENS_REVOKED: "tokens_revoked",
} as const;

/** The header Slack marks its retry of an event with, which is dropped, since the first delivery was acted on. */
const SLACK_RETRY_HEADER = "x-slack-retry-num";

/** A press as far as it is read: who pressed, in which team, the DM it was in, the buttons' action ids and values, and the checkboxes ticked in that DM. */
const BlockActionsSchema = Schema.Struct({
  type: Schema.Literal(SLACK_REQUEST_TYPE.BLOCK_ACTIONS),
  user: Schema.Struct({ id: Schema.String, team_id: Schema.optionalKey(Schema.String) }),
  team: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.String }))),
  container: Schema.optionalKey(
    Schema.Struct({
      channel_id: Schema.optionalKey(Schema.String),
      message_ts: Schema.optionalKey(Schema.String),
    }),
  ),
  actions: Schema.Array(
    Schema.Struct({ action_id: Schema.String, value: Schema.optionalKey(Schema.String) }),
  ),
  state: Schema.optionalKey(
    Schema.Struct({
      values: Schema.Record(
        Schema.String,
        Schema.Record(
          Schema.String,
          Schema.Struct({
            selected_options: Schema.optionalKey(
              Schema.Array(Schema.Struct({ value: Schema.String })),
            ),
          }),
        ),
      ),
    }),
  ),
});

type BlockActions = typeof BlockActionsSchema.Type;

/** Slack's check of the URL as far as it is read: the words it wants back. */
const UrlVerificationSchema = Schema.Struct({
  type: Schema.Literal(SLACK_REQUEST_TYPE.URL_VERIFICATION),
  challenge: Schema.String,
});

/**
 * An uninstall or a revoke as far as it is read: the team, when Slack says it
 * happened (whole seconds since the epoch), and for a revoke, the bot users
 * whose tokens went; a revoke of user tokens alone names no bot.
 */
const LifecycleEventSchema = Schema.Struct({
  type: Schema.Literal(SLACK_REQUEST_TYPE.EVENT_CALLBACK),
  team_id: Schema.String,
  event_time: Schema.Number,
  event: Schema.Struct({
    type: Schema.Literals(Object.values(SLACK_LIFECYCLE_EVENT)),
    tokens: Schema.optionalKey(
      Schema.Struct({ bot: Schema.optionalKey(Schema.Array(Schema.String)) }),
    ),
  }),
});

type LifecycleEvent = typeof LifecycleEventSchema.Type;

/** A request read against the few fields it is read for; every other key Slack sends is dropped unread. */
function readRequest<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  payload: UnparsedWireValue,
) {
  return readEither(schema, { excess: EXCESS_KEYS.DROP })(payload);
}

/**
 * Whether Slack's signature on the request holds: made under its version,
 * over the timestamp and the raw body, with the secret, and the timestamp
 * within five minutes of now either way. The secret is revealed here
 * alone, into the HMAC the compare reads.
 */
function signatureHolds(
  secret: Redacted.Redacted,
  timestamp: string | undefined,
  signature: string | undefined,
  body: Uint8Array,
  nowMillis: number,
): boolean {
  if (timestamp === undefined || signature === undefined || !UNIX_SECONDS.test(timestamp)) {
    return false;
  }

  if (Math.abs(nowMillis / 1000 - Number(timestamp)) > SLACK_SIGNATURE.FRESH_SECONDS) return false;
  const prefix = `${SLACK_SIGNATURE.VERSION}=`;

  if (!signature.startsWith(prefix)) return false;
  const offered = Buffer.from(signature.slice(prefix.length), "hex");

  const wanted = createHmac("sha256", Redacted.value(secret))
    .update(`${SLACK_SIGNATURE.VERSION}:${timestamp}:`)
    .update(body)
    .digest();

  return offered.length === wanted.length && timingSafeEqual(offered, wanted);
}

/** The signing secret as the deployment's environment holds it, trimmed; none where it is unset or blank. */
const signingSecret = Effect.map(
  Config.option(Config.Redacted(SLACK_APP_ENVIRONMENT.SIGNING_SECRET)),
  (read) => {
    const named = text(Option.getOrUndefined(Option.map(read, Redacted.value)));

    return named === undefined ? undefined : Redacted.make(named);
  },
).pipe(Effect.orElseSucceed(() => undefined));

/**
 * Whether the event ends our app's hold on its team: an uninstall always,
 * a revoke only where a bot's token went, since the app keeps no user's.
 */
function endsInstallation(lifecycle: LifecycleEvent): boolean {
  const { event } = lifecycle;

  if (event.type === SLACK_LIFECYCLE_EVENT.APP_UNINSTALLED) return true;

  return (event.tokens?.bot ?? []).length > 0;
}

/**
 * Deletes the installation of every workspace connected to the team that
 * stood when the event happened, its bot token and its members' Slack ids
 * going with it, in one statement. Note that one linked after it is the
 * team's install again and stands, because Slack may deliver an event
 * late or more than once (its retries run up to minutes later).
 */
const forgetTeam = /* @__PURE__ */ Effect.fnUntraced(function* (lifecycle: LifecycleEvent) {
  // Note that the event's whole second is taken as its end, so an install made in that second is gone with it.
  const happened = new Date((lifecycle.event_time + 1) * 1000);
  yield* hostedStoreOrUnavailable(deleteSlackTeamInstallations(lifecycle.team_id, happened));
});

/** The request's JSON: interactivity's under its form field, an event's as the body is. */
function requestPayload(
  contentType: string | undefined,
  body: Uint8Array,
): Effect.Effect<UnparsedWireValue, HostedRefusal> {
  if (!(contentType ?? "").startsWith(FORM_CONTENT_TYPE)) return parseJsonBytes(body);
  const field = new URLSearchParams(new TextDecoder().decode(body)).get(INTERACTION_FIELD);

  if (field === null) return Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);

  return parseJsonBytes(new TextEncoder().encode(field));
}

/** The first option a press names, with the action id it was pressed under; nothing for a press of any other button. */
function pressedChoice(
  press: BlockActions,
): { readonly choice: SlackChoice; readonly actionId: string } | undefined {
  for (const action of press.actions) {
    if (action.value === undefined) continue;
    const choice = Schema.decodeUnknownOption(SlackChoiceSchema)(action.value);

    if (Option.isSome(choice)) return { choice: choice.value, actionId: action.action_id };
  }

  return undefined;
}

/** The places among the ask's options of the checkboxes ticked when the press was made; none where the DM holds none. */
function tickedPlaces(press: BlockActions): readonly number[] {
  for (const block of Object.values(press.state?.values ?? {})) {
    const ticked = block[SLACK_PICKS_ACTION]?.selected_options;

    if (ticked !== undefined) return ticked.map(({ value }) => Number(value));
  }

  return [];
}

/** The ask a press answers, as the member reads it; none where the item, the message, or its ask is not found. */
const pressedAsk = /* @__PURE__ */ Effect.fnUntraced(function* (
  member: string,
  choice: SlackChoice,
) {
  const stored = yield* hostedStoreOrUnavailable(readInboxItem(member, choice.item));

  if (Option.isNone(stored)) return undefined;
  const message = (stored.value.item.thread ?? []).find((each) => each.id === choice.ask);

  return message?.ask === undefined ? undefined : knownAsk(message.ask);
});

/**
 * The answer a press gives, with the line its DM says once taken: a do
 * ask's Mark done, every step ticked, or Couldn't do it, none ticked; the
 * option its button names; or for a Submit, the ticked checkboxes' options
 * as the member reads the ask, none where the ask is not found or takes no
 * options, which the ask's own check refuses.
 */
const pressedAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  member: string,
  choice: SlackChoice,
  press: BlockActions,
) {
  const { reply } = choice;

  if (reply !== undefined) {
    const ask = yield* pressedAsk(member, choice);
    const steps = ask?.type === INBOX_ASK.DO ? ask.steps : [];
    const ticked = reply === INBOX_REPLY.DONE ? steps.map((_, at) => at) : [];

    return { answers: { ask: choice.ask, reply, steps: ticked }, line: doneLine(reply) };
  }

  if (choice.choice !== undefined) {
    const choices = [choice.choice];
    const answers = { ask: choice.ask, reply: INBOX_REPLY.CHOSE, choices };

    return { answers, line: chosenLine(choices) };
  }

  const ask = yield* pressedAsk(member, choice);
  const options = ask?.type === INBOX_ASK.DECIDE ? ask.options : [];

  const choices = tickedPlaces(press).flatMap((place) => {
    const option = options[place];

    return option === undefined ? [] : [option.label];
  });

  return {
    answers: { ask: choice.ask, reply: INBOX_REPLY.CHOSE, choices },
    line: chosenLine(choices),
  };
});

/** The DM a press was made in, where Slack named it. */
function pressedDm(press: BlockActions): SlackMessage | undefined {
  const channel = press.container?.channel_id;
  const ts = press.container?.message_ts;

  return channel === undefined || ts === undefined ? undefined : { channel, ts };
}

/**
 * A press of an option, a do ask's button, or a Submit of the options ticked,
 * answered as the member who pressed it, and the pressed DM rewritten past
 * the answer: an answer taken now or before says what was answered, and an
 * ask no longer open says where it stands. Only the DM pressed is rewritten,
 * since the bot writes no new thread DMs and rewrites none on its own.
 * Nothing where the item, the member, or the option is not found.
 */
const answerPress = /* @__PURE__ */ Effect.fnUntraced(function* (press: BlockActions) {
  const pressed = pressedChoice(press);

  if (pressed === undefined) return;
  const { choice, actionId } = pressed;
  const organizationId = yield* hostedStoreOrUnavailable(itemWorkspace(choice.item));

  if (Option.isNone(organizationId)) return;
  const teamId = press.team?.id ?? press.user.team_id;

  if (teamId === undefined) return;

  const bot = yield* (yield* SlackBot).forWorkspace(organizationId.value);
  const member = yield* hostedStoreOrUnavailable(bot.memberOf(teamId, press.user.id));

  if (Option.isNone(member)) return;
  const { answers, line } = yield* pressedAnswer(member.value, choice, press);

  const answered = yield* answerAsMember(
    storeWriter({ tools: CODER_TOOL_SET }),
    member.value,
    choice.item,
    {
      text: "",
      clientKey: actionId,
      attachments: [],
      answers,
    },
  ).pipe(
    Effect.map(Option.some),
    Effect.catchIf(
      (refusal) => refusal.error === HOSTED_REFUSAL.NOT_FOUND.error,
      () => Effect.succeedNone,
    ),
  );

  const dm = pressedDm(press);

  if (Option.isNone(answered) || dm === undefined) return;
  const { item, outcome } = answered.value;

  const message = (item.thread ?? []).find((each) => each.id === choice.ask);

  // Note that an ask the read thread no longer holds leaves its DM as it stands, because its words are not at hand to draw again.
  if (message === undefined) return;
  const status = message.ask?.status;

  // A refused answer to an ask still open leaves the DM's buttons standing.
  if (outcome === INBOX_ASK_ANSWER.REFUSED && status === INBOX_ASK_STATUS.OPEN) return;

  const said =
    outcome === INBOX_ASK_ANSWER.TAKEN || outcome === INBOX_ASK_ANSWER.REPEATED
      ? line
      : settledLine(status);

  yield* rewriteThreadDm(
    dm,
    choice.item,
    { id: choice.ask, text: message.text, ask: message.ask },
    said,
  );
});

/** POST: one request Slack sent, its signature confirmed before anything of it is read. */
const eventsEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;

  if (request.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }

  const secret = yield* signingSecret;

  if (secret === undefined) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const body = yield* readBodyBytesEffect(MAXIMUM_REQUEST_BYTES);
  const now = yield* Clock.currentTimeMillis;
  const timestamp = request.headers[SLACK_SIGNATURE.TIMESTAMP_HEADER];
  const signature = request.headers[SLACK_SIGNATURE.HEADER];

  if (!signatureHolds(secret, timestamp, signature, body, now)) {
    yield* Effect.logWarning("A Slack request was refused: its signature did not hold");

    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  }

  const payload = yield* requestPayload(request.headers["content-type"], body);
  const check = readRequest(UrlVerificationSchema, payload);

  if (Result.isSuccess(check)) {
    yield* Effect.logInfo("A Slack request was heard", {
      kind: SLACK_REQUEST_TYPE.URL_VERIFICATION,
    });

    return hostedJsonResponse(200, { challenge: check.success.challenge });
  }

  const lifecycle = readRequest(LifecycleEventSchema, payload);

  if (Result.isSuccess(lifecycle)) {
    yield* Effect.logInfo("A Slack request was heard", { kind: lifecycle.success.event.type });

    // Note that a retry is acted on too, since the delete takes only what stood when the event happened.
    if (endsInstallation(lifecycle.success)) yield* forgetTeam(lifecycle.success);

    return hostedJsonResponse(200, {});
  }

  const press = readRequest(BlockActionsSchema, payload);

  if (Result.isSuccess(press)) {
    yield* Effect.logInfo("A Slack request was heard", {
      kind: SLACK_REQUEST_TYPE.BLOCK_ACTIONS,
    });
    // Slack is answered before the press is acted on, so the press never waits on the agent or on Slack.
    yield* afterResponse(
      "a Slack press",
      answerPress(press.success).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("a Slack press was not acted on", { failure: causeKind(cause) }),
        ),
      ),
    );
  } else {
    const retried = request.headers[SLACK_RETRY_HEADER] !== undefined;
    yield* actOnSlackReaction(payload, retried) ?? actOnSlackEvent(payload, retried);
  }

  return hostedJsonResponse(200, {});
});

/** The group: the one path Slack sends to, and the hosted vocabulary's own refusal for any other. */
export const slackEventsApp = Layer.mergeAll(
  HttpRouter.add(ANY_METHOD, SLACK_EVENTS_PATH, hostedRefusing(eventsEndpoint)),
  hostedNotFoundRoute,
);
