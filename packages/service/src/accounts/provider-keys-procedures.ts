/**
 * provider-keys-procedures.ts -- the account's own Anthropic and OpenAI API keys and subscription credentials: read what they are, save one, remove one.
 *
 * `GET /api/account/provider-keys` answers the account's keys as hints and
 * statuses; `PUT` saves one, first asking the provider whether it accepts
 * it (`packages/service/src/providers/provider-key-check.ts`), and keeps it sealed
 * (`@repo/database/models/provider-key-seal`) only where it does; `DELETE` with the
 * provider in the query removes one. Every answer is the keys as they then
 * stand and none carries a key: the one body that holds a key is the
 * `PUT`'s own, it is sealed the moment it is read, and neither it nor what
 * the provider said of it is logged.
 *
 * A request may name a kind (`provider-key-wire.ts`'s `PROVIDER_KEY_KIND`);
 * one that names none is an API key's, as every desktop before kinds sends.
 * A subscription credential, a Claude setup-token, is braked and sealed as
 * a key is but not sent to its provider on save: it is kept unverified, and a
 * credential spelled as no credential of its kind is refused as invalid. It
 * reaches Anthropic from here only when the account refreshes the plan's
 * usage by hand (`claude-usage.ts`).
 * An account may keep several API keys of a provider: a save adds one at
 * the bottom of its order, or replaces the one its id names. The answer's
 * `keys` are API keys alone, and the subscriptions stand apart beside them.
 *
 * A ChatGPT plan (`chatgpt_oauth`) is the one credential that is not a
 * pasted key: the service connects it through Codex's device-code login
 * (`chatgpt-device-login.ts`), where a start answers the code the account
 * enters at OpenAI, the panel polls until the login connects or fails, and
 * a cancel drops it. Removing the plan revokes its renewable session at
 * OpenAI first (`chatgpt-credentials.ts`), and the answer says where OpenAI
 * did not confirm that. A plan the retired third-party Sign in with ChatGPT
 * connected can no longer renew, so it is removed as the keys are read and
 * answered as not connected.
 *
 * A key that the deployment's ring can no longer open answers unreadable
 * rather than as its stored status, so the account is told to replace it.
 * A deployment holding no ring, or one it cannot parse, answers every
 * request unavailable, before it reads anything the request carries, and
 * its agents run on our own keys.
 *
 * The rotation's rewrap (`accounts/provider-key-rewrap.ts`) is a group of its
 * own (`provider-keys-app.ts`), asked by hand under the deployment's
 * `CRON_SECRET` rather than any account's bearer.
 *
 * A save is braked per account, ten an hour, because a check is an
 * authenticated call to the provider and an endpoint that answers whether a
 * key is good is worth hammering with keys that are not the caller's.
 *
 * Cursor's keys stand behind the account's Cursor experiment while Cursor is
 * built: a save of one is refused as an invalid request unless the account
 * has it on, as a provider the service does not offer it; that is the
 * refusal every procedure declares, so no client's contract widens for it. Every answer leaves Cursor's keys out for a client built before
 * `HOSTED_API_VERSION` 4, or one that names no version, since such a build
 * cannot decode a key whose provider is `cursor` and would lose the whole
 * answer over it; it is answered the rest, as if Cursor's were not there.
 */

import { accountExperimentOn } from "@repo/database/models/account-store";
import { dropChatGptDeviceLogin } from "@repo/database/models/chatgpt-device-login-store";
import {
  type KeyRing,
  openProviderKey,
  sealProviderKey,
} from "@repo/database/models/provider-key-seal";
import {
  listProviderKeyRows,
  type ProviderKeyRow,
  removeProviderKey,
  reorderSubscriptions,
  saveProviderKey,
  setProviderKeyForAgents,
  setSubscriptionLabel,
} from "@repo/database/models/provider-key-store";
import { presentedClient } from "@repo/features/client-identity";
import {
  CHATGPT_DEVICE_FAILURE_MESSAGE,
  CHATGPT_DEVICE_LOGIN,
  type ChatGptDeviceLoginOutcome,
  type ChatGptDevicePollAnswer,
  type PlanUsage,
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeyKind,
  type ProviderKeyProvider,
  type ProviderKeyRejection,
  type ProviderKeySummary,
  planStanding,
  SUBSCRIPTION_KIND_PROVIDER,
  type SubscriptionKeySummary,
} from "@repo/features/provider-key-wire";
import { EXPERIMENT } from "@repo/settings";
import { Clock, DateTime, Duration, Effect, Option, Redacted, Result } from "effect";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { createRateBrake } from "../http/rate-brake.js";
import { accountMiddleware, hosted, keyRingMiddleware } from "../orpc/base.js";
import {
  checkFastAccess,
  checkProviderKey,
  PROVIDER_KEY_CHECK,
  providerKeyHint,
} from "../providers/provider-key-check.js";
import {
  chatGptSigningKeys,
  dropRetiredChatGptCredentials,
  removeChatGptCredentials,
  retiredChatGptRow,
} from "./chatgpt-credentials.js";
import { pollChatGptDeviceLogin, startChatGptDeviceLogin } from "./chatgpt-device-login.js";
import { spentResetCredit } from "./chatgpt-reset-credits.js";
import { readChatGptUsage, rereadPlanUsage } from "./chatgpt-usage.js";
import { rereadClaudeUsage } from "./claude-usage.js";

const SAVE_BRAKE = {
  windowMs: Duration.toMillis(Duration.hours(1)),
  maxRequestsPerWindow: 10,
  maxTrackedUsers: 10_000,
} as const;

/**
 * A device-code login's polls and cancels, per account: the panel polls
 * every few seconds for the fifteen minutes a code stands, so they are
 * braked apart from saves, at what a panel polling as it is told never
 * reaches.
 */
const DEVICE_POLL_BRAKE = {
  windowMs: Duration.toMillis(Duration.minutes(1)),
  maxRequestsPerWindow: 30,
  maxTrackedUsers: 10_000,
} as const;

/**
 * A plan's usage checked by hand, per account: each press is a call to
 * the plan's provider on its token, and a Claude plan's spends a sliver of
 * the plan, so they are braked well past what a developer pressing Refresh
 * usage reaches, and short of a loop spending the plan or hammering the
 * provider.
 */
const USAGE_REFRESH_BRAKE = {
  windowMs: Duration.toMillis(Duration.minutes(1)),
  maxRequestsPerWindow: 10,
  maxTrackedUsers: 10_000,
} as const;

export interface ProviderKeysProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The kinds a subscription credential is, every kind but the API key. */
const SUBSCRIPTION_KINDS = Object.values(PROVIDER_KEY_KIND).filter(
  (kind) => kind !== PROVIDER_KEY_KIND.API_KEY,
);

/** Every Claude setup-token's own prefix, an OAuth token's, which no API key carries. */
const CLAUDE_SETUP_TOKEN_PREFIX = "sk-ant-oat";

/** The first hosted API version whose builds read Cursor as a provider (`client-identity.ts`'s `HOSTED_API_VERSION`). */
const CURSOR_API_VERSION = 4;

/** Whether the build asking can decode a Cursor key in an answer: one that names a hosted API version from Cursor's on. */
function readsCursor(request: Request): boolean {
  const client = presentedClient(request.headers);

  return client !== undefined && client.apiVersion >= CURSOR_API_VERSION;
}

/** A plan's usage windows as last heard, the shortest first and a length's window on every model before one on a model alone, each left out once its reset has passed. */
function usageOf(row: ProviderKeyRow, now: number): readonly PlanUsage[] {
  return (row.usageWindows ?? [])
    .filter((window) => window.resetsAt === undefined || window.resetsAt > now)
    .map((window) => ({
      ...window,
      // Note that a harness may report past the whole window, which reads as all of it.
      usedPercent: Math.min(Math.max(window.usedPercent, 0), 100),
    }))
    .toSorted(
      (a, b) =>
        (a.windowMins ?? Infinity) - (b.windowMins ?? Infinity) ||
        Number(a.model !== undefined) - Number(b.model !== undefined),
    );
}

/**
 * The account's credentials of one kind as it is shown them, each one the
 * ring cannot open answered unreadable, and a ChatGPT plan the retired
 * third-party sign-in sealed removed and left out.
 */
const summariesOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  kind: ProviderKeyKind,
  ring: KeyRing,
) {
  const listed = yield* hostedStoreOrUnavailable(listProviderKeyRows(userId, kind));

  const retired =
    kind === PROVIDER_KEY_KIND.CHATGPT_OAUTH &&
    listed.some((row) => retiredChatGptRow(ring, userId, row));

  if (retired) yield* hostedStoreOrUnavailable(dropRetiredChatGptCredentials(userId, ring));
  const rows = retired ? [] : listed;
  const now = yield* Clock.currentTimeMillis;

  return rows.map((row) => {
    const readable = Result.isSuccess(
      openProviderKey(ring, { userId, provider: row.provider, kind }, row),
    );

    // Note that a plan is answered as it stands now, so a limit whose reset has passed reads as lifted.
    const status = readable ? planStanding(row, now) : PROVIDER_KEY_STATUS.UNREADABLE;

    const summary: ProviderKeySummary = {
      provider: row.provider,
      hint: row.hint,
      addedAt: row.createdAt.getTime(),
      status,
      statusAt: row.statusAt.getTime(),
      id: row.id,
      position: row.position,
      ...(row.label === null ? undefined : { label: row.label }),
      ...(status === PROVIDER_KEY_STATUS.LIMIT_REACHED && row.limitResetsAt !== null
        ? { limitResetsAt: row.limitResetsAt.getTime() }
        : undefined),
    };

    return { summary, row, usage: usageOf(row, now) };
  });
});

/** Who the keys are answered to: the account, under its deployment's ring, and the request it asked in, whose build says whether it reads Cursor's keys. */
interface KeysReader {
  readonly userId: string;
  readonly ring: KeyRing;
  readonly request: Request;
}

const keysAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  { userId, ring, request }: KeysReader,
  rejected?: ProviderKeyRejection,
  revocationUnconfirmed = false,
) {
  const cursorRead = readsCursor(request);

  const keys = (yield* summariesOf(userId, PROVIDER_KEY_KIND.API_KEY, ring))
    .map((read) => read.summary)
    .filter((key) => cursorRead || key.provider !== PROVIDER_KEY_PROVIDER.CURSOR);

  const subscriptions: SubscriptionKeySummary[] = [];

  for (const kind of SUBSCRIPTION_KINDS) {
    for (const { summary, row, usage } of yield* summariesOf(userId, kind, ring)) {
      subscriptions.push({
        ...summary,
        kind,
        id: row.id,
        position: row.position,
        forAgents: row.forAgents,
        ...(row.accountEmail === null ? undefined : { email: row.accountEmail }),
        ...(usage.length === 0 ? undefined : { usage: usage[0], usageWindows: usage }),
        ...(row.usageHeardAt === null ? undefined : { usageHeardAt: row.usageHeardAt.getTime() }),
        ...(row.resetCredits === null ? undefined : { resetCredits: row.resetCredits.count }),
        ...(row.resetCredits?.credits === undefined
          ? undefined
          : {
              resetCreditExpiries: row.resetCredits.credits.map(
                (credit) => credit.expiresAt ?? null,
              ),
            }),
      });
    }
  }

  return {
    keys,
    ...(subscriptions.length === 0 ? undefined : { subscriptions }),
    ...(rejected === undefined ? undefined : { rejected }),
    ...(revocationUnconfirmed ? { revocationUnconfirmed: true as const } : undefined),
  };
});

/** A device-code login's outcome as the wire answers it, a failure with its fixed sentence. */
function deviceAnswerOf(outcome: ChatGptDeviceLoginOutcome): ChatGptDevicePollAnswer {
  switch (outcome) {
    case CHATGPT_DEVICE_LOGIN.PENDING:
    case CHATGPT_DEVICE_LOGIN.CONNECTED:
      return { outcome };
    default:
      return { outcome, message: CHATGPT_DEVICE_FAILURE_MESSAGE[outcome] };
  }
}

/** Whether a subscription credential is saved for the provider its kind belongs to and spelled as one of its kind; nothing is asked of the provider. */
function subscriptionRefusalOf(
  provider: ProviderKeyProvider,
  kind: Exclude<ProviderKeyKind, typeof PROVIDER_KEY_KIND.API_KEY>,
  key: Redacted.Redacted<string>,
): ProviderKeyRejection | undefined {
  if (SUBSCRIPTION_KIND_PROVIDER[kind] !== provider) return PROVIDER_KEY_REJECTION.WRONG_PROVIDER;

  switch (kind) {
    case PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN:
      return Redacted.value(key).startsWith(CLAUDE_SETUP_TOKEN_PREFIX)
        ? undefined
        : PROVIDER_KEY_REJECTION.INVALID;
    case PROVIDER_KEY_KIND.CHATGPT_OAUTH:
      // A ChatGPT plan is connected through its device-code login, never pasted as a key.
      return PROVIDER_KEY_REJECTION.INVALID;
  }
}

/** The provider keys' procedures, braked per instance, each to a signed-in caller on a deployment that holds a ring. */
export function providerKeysProcedures(seams: ProviderKeysProcedureSeams) {
  const brake = createRateBrake(SAVE_BRAKE);
  const pollBrake = createRateBrake(DEVICE_POLL_BRAKE);
  const refreshBrake = createRateBrake(USAGE_REFRESH_BRAKE);
  const signingKeys = chatGptSigningKeys();
  const keyed = hosted.account.use(accountMiddleware(seams.resolveUserId)).use(keyRingMiddleware);

  return {
    /** The account's keys, its ChatGPT plans' usage read afresh first where due (`readChatGptUsage`). */
    providerKeys: keyed.providerKeys.effect(function* ({ context }) {
      yield* readChatGptUsage(context.userId, context.ring);

      return yield* keysAnswer(context);
    }),

    /** A save: braked, checked with the provider, and kept sealed only where the provider accepts it. */
    saveProviderKey: keyed.saveProviderKey.effect(function* ({ context, input }) {
      const { userId, ring } = context;
      const { provider } = input;
      const kind = input.kind ?? PROVIDER_KEY_KIND.API_KEY;
      const key = Redacted.make(input.key);

      // Note that a Cursor key is kept only for an account trying Cursor, since a build that cannot read one would lose its keys' answer over it.
      if (
        provider === PROVIDER_KEY_PROVIDER.CURSOR &&
        !(yield* hostedStoreOrUnavailable(accountExperimentOn(userId, EXPERIMENT.CURSOR)))
      ) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }

      if (!(yield* brake.check(userId))) {
        return yield* keysAnswer(context, PROVIDER_KEY_REJECTION.TOO_MANY_TRIES);
      }

      if (kind !== PROVIDER_KEY_KIND.API_KEY) {
        const refused = subscriptionRefusalOf(provider, kind, key);

        if (refused !== undefined) return yield* keysAnswer(context, refused);
        const now = yield* DateTime.nowAsDate;
        const sealed = sealProviderKey(ring, { userId, provider, kind }, key);

        const placement = {
          ...(input.subscriptionId === undefined
            ? undefined
            : { subscriptionId: input.subscriptionId }),
          ...(input.add === undefined ? undefined : { add: input.add }),
        };

        yield* hostedStoreOrUnavailable(
          saveProviderKey(
            userId,
            provider,
            kind,
            sealed,
            providerKeyHint(key),
            null,
            now,
            null,
            placement,
          ),
        );
        yield* recordServerEvent(SERVER_EVENT.PROVIDER_KEY_CREATE, { userId }, { provider });

        return yield* keysAnswer(context);
      }

      // An Anthropic key is asked about fast mode beside the check, which the catalog offers by; OpenAI has none we run.
      const [checked, fastAccess] = yield* Effect.all(
        [
          checkProviderKey(provider, key),
          provider === PROVIDER_KEY_PROVIDER.ANTHROPIC
            ? checkFastAccess(key)
            : Effect.succeed(undefined),
        ],
        { concurrency: "unbounded" },
      );

      // Note that a refusal's wording is never logged or answered, because it may quote the key.
      if (checked !== PROVIDER_KEY_CHECK.ACCEPTED) return yield* keysAnswer(context, checked);
      const sealed = sealProviderKey(ring, { userId, provider, kind }, key);
      const now = yield* DateTime.nowAsDate;
      // Note that a key is added at the bottom of the order unless the save names the one it replaces.
      yield* hostedStoreOrUnavailable(
        saveProviderKey(
          userId,
          provider,
          kind,
          sealed,
          providerKeyHint(key),
          fastAccess ?? null,
          now,
          null,
          input.subscriptionId === undefined ? {} : { subscriptionId: input.subscriptionId },
        ),
      );
      yield* recordServerEvent(SERVER_EVENT.PROVIDER_KEY_CREATE, { userId }, { provider });

      return yield* keysAnswer(context);
    }),

    /** One provider's credential removed, by the provider, the kind, and the subscription the query names; an API key where it names no kind, the first of its kind where it names no subscription. A ChatGPT plan is revoked at OpenAI first. */
    removeProviderKey: keyed.removeProviderKey.effect(function* ({ context, input }) {
      const { userId, ring } = context;
      const kind = input.query.kind ?? PROVIDER_KEY_KIND.API_KEY;
      const { subscriptionId } = input.query;

      if (
        kind === PROVIDER_KEY_KIND.CHATGPT_OAUTH &&
        input.query.provider === SUBSCRIPTION_KIND_PROVIDER[kind]
      ) {
        const confirmed = yield* hostedStoreOrUnavailable(
          removeChatGptCredentials(userId, ring, subscriptionId),
        );

        return yield* keysAnswer(context, undefined, !confirmed);
      }

      yield* hostedStoreOrUnavailable(
        removeProviderKey(userId, input.query.provider, kind, subscriptionId),
      );

      return yield* keysAnswer(context);
    }),

    /** A connected plan's default for the account's coding agents turned on or off; a plan the account does not hold changes nothing. */
    setProviderKeyForAgents: keyed.setProviderKeyForAgents.effect(function* ({ context, input }) {
      const { userId } = context;
      yield* hostedStoreOrUnavailable(
        setProviderKeyForAgents(
          userId,
          input.provider,
          input.kind,
          input.forAgents,
          input.subscriptionId,
        ),
      );

      return yield* keysAnswer(context);
    }),

    /** One of the account's ChatGPT plan's reset credits spent under the press's key, answering the keys as they then stand and how the spend went. */
    useResetCredit: keyed.useResetCredit.effect(function* ({ context, input }) {
      const { userId, ring } = context;

      const outcome = yield* spentResetCredit(
        userId,
        ring,
        input.subscriptionId,
        input.idempotencyKey,
      );

      const keys = yield* keysAnswer(context);

      return Option.isNone(outcome) ? keys : { ...keys, resetCredit: outcome.value };
    }),

    /** One of the account's plans' usage checked again now, however fresh its reading: a Codex plan's asked of its usage endpoint, a Claude plan's read from the headers of a one-token quota check (`claude-usage.ts`). Answers the keys as they then stand; a plan it does not hold, a press past the brake, or one whose provider answered nothing keeps what it held. */
    refreshPlanUsage: keyed.refreshPlanUsage.effect(function* ({ context, input }) {
      const { userId, ring } = context;

      if (yield* refreshBrake.check(userId)) {
        const [codex, claude] = yield* hostedStoreOrUnavailable(
          Effect.all([
            listProviderKeyRows(userId, PROVIDER_KEY_KIND.CHATGPT_OAUTH),
            listProviderKeyRows(userId, PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN),
          ]),
        );

        const mine = (row: ProviderKeyRow) => row.id === input.subscriptionId;
        const codexPlan = codex.find(mine);
        const claudePlan = claude.find(mine);

        if (codexPlan !== undefined) yield* rereadPlanUsage(userId, ring, codexPlan);

        if (claudePlan !== undefined) yield* rereadClaudeUsage(userId, ring, claudePlan);
      }

      return yield* keysAnswer(context);
    }),

    /** One of the account's subscriptions or API keys named, or its name cleared; one it does not hold changes nothing. */
    renameSubscription: keyed.renameSubscription.effect(function* ({ context, input }) {
      const { userId } = context;
      // Note that a name is kept as typed but for its ends, and one left empty is the default's.
      const label = input.label?.trim() ?? "";
      yield* hostedStoreOrUnavailable(
        setSubscriptionLabel(
          userId,
          input.provider,
          input.kind,
          input.subscriptionId,
          label === "" ? null : label,
        ),
      );

      return yield* keysAnswer(context);
    }),

    /** The account's credentials of the provider, its plans and its API key, put in the order named, the first paying first. */
    reorderSubscriptions: keyed.reorderSubscriptions.effect(function* ({ context, input }) {
      const { userId } = context;
      yield* hostedStoreOrUnavailable(
        reorderSubscriptions(userId, input.provider, input.subscriptionIds),
      );

      return yield* keysAnswer(context);
    }),

    /** A ChatGPT plan's connection through Codex's device-code login begun, braked with saves: the code to enter and the login to poll; what claims the sign-in stays sealed on the service. A start that adds keeps the plan it connects at the bottom of the account's order. */
    startChatGptDeviceLogin: keyed.startChatGptDeviceLogin.effect(function* ({ context, input }) {
      const { userId, ring } = context;

      if (!(yield* brake.check(userId))) return yield* Effect.fail(HOSTED_REFUSAL.QUOTA_EXHAUSTED);

      const started = yield* hostedStoreOrUnavailable(
        startChatGptDeviceLogin(userId, ring, input?.add === true),
      );

      if (Option.isNone(started)) return yield* Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR);

      return started.value;
    }),

    /** One check of the account's device-code login against OpenAI, braked; once connected, the answer carries the account's keys as they then stand. */
    pollChatGptDeviceLogin: keyed.pollChatGptDeviceLogin.effect(function* ({ context, input }) {
      const { userId, ring } = context;

      if (!(yield* pollBrake.check(userId))) {
        return yield* Effect.fail(HOSTED_REFUSAL.QUOTA_EXHAUSTED);
      }

      const polled = yield* hostedStoreOrUnavailable(
        pollChatGptDeviceLogin({ userId, loginId: input.loginId }, ring, signingKeys),
      );

      if (polled.connectedNow) {
        yield* recordServerEvent(
          SERVER_EVENT.PROVIDER_KEY_CREATE,
          { userId },
          { provider: PROVIDER_KEY_PROVIDER.OPENAI },
        );
      }

      const answered = deviceAnswerOf(polled.outcome);

      if (polled.outcome !== CHATGPT_DEVICE_LOGIN.CONNECTED) return answered;

      return { ...answered, keys: yield* keysAnswer(context) };
    }),

    /** The account's device-code login dropped, braked with its polls; a plan it already connected stands. */
    cancelChatGptDeviceLogin: keyed.cancelChatGptDeviceLogin.effect(function* ({ context, input }) {
      const { userId } = context;

      if (!(yield* pollBrake.check(userId))) {
        return yield* Effect.fail(HOSTED_REFUSAL.QUOTA_EXHAUSTED);
      }

      yield* hostedStoreOrUnavailable(dropChatGptDeviceLogin({ userId, loginId: input.loginId }));

      return deviceAnswerOf(CHATGPT_DEVICE_LOGIN.CANCELED);
    }),
  };
}
