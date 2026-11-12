/**
 * chatgpt-usage.ts -- an account's ChatGPT plans' usage windows read from ChatGPT's own usage endpoint, as Codex's `/status` reads them, so a plan's usage is known between its agents' turns.
 *
 * A turn on a plan hears its windows from Codex as it runs
 * (`account/rateLimits/updated`); between turns nothing does, so a read of
 * the account's keys asks ChatGPT for each plan's whose reading, and whose
 * last ask, answered or not, are older than `FRESH_FOR`, so a ChatGPT that
 * refuses is asked once a span rather than on every read of the keys; the
 * plan is claimed for its ask before it is made (`claimPlanUsageAsk`), so
 * two reads at once ask once. It is asked with the plan's own access token (renewed under its
 * lock where due, `refreshChatGptAccess`) and its ChatGPT workspace, at the
 * endpoint Codex's own client calls. The endpoint is undocumented, so an
 * answer that is not what Codex reads, a refusal, or no answer within the
 * time any call to OpenAI is given (`OPENAI_CALL_TIMEOUT`) changes nothing,
 * and the plan keeps what it last heard.
 * Its windows replace all the plan held, beside the rate-limit reset
 * credits it counts and, where it holds any, each available one's id and
 * expiry, read from the list Codex's client reads. The access token goes
 * to ChatGPT alone and is never logged; nothing of an answer is kept but
 * the windows and the credits.
 */

import type { KeyRing } from "@repo/database/models/provider-key-seal";
import {
  claimPlanUsageAsk,
  listProviderKeyRows,
  type ProviderKeyRow,
  setPlanUsageWindows,
} from "@repo/database/models/provider-key-store";
import type {
  StoredResetCredits,
  StoredUsageWindow,
} from "@repo/database/schemas/account-provider-key";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_STATUS } from "@repo/features/provider-key-wire";
import { DateTime, Duration, Effect, Option, Redacted, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import {
  CHATGPT_ACCESS,
  type ChatGptAccess,
  OPENAI_CALL_TIMEOUT,
  refreshChatGptAccess,
} from "./chatgpt-credentials.js";

/** ChatGPT's usage endpoint, where Codex's client reads a plan's limits. */
export const CHATGPT_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

/** Where Codex's client lists a plan's reset credits, each with its id, status, and expiry. */
const RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";

/** The status of a reset credit not yet spent. */
const AVAILABLE = "available";

/** The header that names the ChatGPT workspace a call is for, as Codex's client sends it. */
const ACCOUNT_HEADER = "chatgpt-account-id";

/** How long a plan's reading stands before a read of the keys asks ChatGPT again. */
const FRESH_FOR = Duration.minutes(5);

/** The status ChatGPT answers a read of the plan's usage with. */
const HTTP_OK = 200;

/** The statuses a plan is asked in: connected, whether a turn has run on it or its limit is reached. */
const ASKED_STATUSES: ReadonlySet<string> = new Set([
  PROVIDER_KEY_STATUS.UNVERIFIED,
  PROVIDER_KEY_STATUS.VERIFIED,
  PROVIDER_KEY_STATUS.LIMIT_REACHED,
]);

/** One window as ChatGPT answers it: the share used, its length, and its reset in seconds since the epoch. */
const WindowAnswerSchema = Schema.Struct({
  used_percent: Schema.Number,
  limit_window_seconds: Schema.Number,
  reset_at: Schema.Number,
});

/** What of ChatGPT's answer is read: the plan's primary window, the session, and its secondary, the week. */
const UsageAnswerSchema = Schema.Struct({
  rate_limit: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        primary_window: Schema.optionalKey(Schema.NullOr(WindowAnswerSchema)),
        secondary_window: Schema.optionalKey(Schema.NullOr(WindowAnswerSchema)),
      }),
    ),
  ),
  rate_limit_reset_credits: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ available_count: Schema.Int })),
  ),
});

/** What of the list of a plan's reset credits is read: each one's id, status, and expiry as ISO text, none for one that never expires. */
const ResetCreditsAnswerSchema = Schema.Struct({
  credits: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      status: Schema.String,
      expires_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
});

/** What a read of a plan's usage keeps: its windows, and its reset credits where counted. */
interface PlanUsageRead {
  readonly windows: readonly StoredUsageWindow[];
  readonly resetCredits: StoredResetCredits | null;
}

/** The plan's available credits from ChatGPT's list, soonest to expire first and one that never expires last. */
function availableCredits(
  answer: typeof ResetCreditsAnswerSchema.Type,
): NonNullable<StoredResetCredits["credits"]> {
  return answer.credits
    .filter((credit) => credit.status === AVAILABLE)
    .map((credit) => {
      const expiresAt = credit.expires_at == null ? Number.NaN : Date.parse(credit.expires_at);

      return Number.isNaN(expiresAt) ? { id: credit.id } : { id: credit.id, expiresAt };
    })
    .sort(
      (a, b) =>
        (a.expiresAt ?? Number.POSITIVE_INFINITY) - (b.expiresAt ?? Number.POSITIVE_INFINITY),
    );
}

/** A window as the plan's row keeps it, its length rounded up to whole minutes as Codex rounds it. */
function storedWindow(window: typeof WindowAnswerSchema.Type): StoredUsageWindow {
  return {
    usedPercent: window.used_percent,
    ...(window.limit_window_seconds > 0
      ? { windowMins: Math.ceil(window.limit_window_seconds / 60) }
      : undefined),
    ...(window.reset_at > 0 ? { resetsAt: window.reset_at * 1000 } : undefined),
  };
}

/** A request to ChatGPT's backend as Codex's client sends it for a plan: its access token, and the ChatGPT workspace it pays from, where it names one. */
export function asPlan(
  request: HttpClientRequest.HttpClientRequest,
  access: Extract<ChatGptAccess, { readonly outcome: typeof CHATGPT_ACCESS.READY }>,
): HttpClientRequest.HttpClientRequest {
  const { chatgptAccountId } = access.plan;

  return request.pipe(
    HttpClientRequest.setHeader("accept", "application/json"),
    HttpClientRequest.bearerToken(Redacted.value(access.accessToken)),
    chatgptAccountId === undefined
      ? (same) => same
      : HttpClientRequest.setHeader(ACCOUNT_HEADER, chatgptAccountId),
  );
}

/** Whether the plan's reading and its last ask are old enough, or absent, that ChatGPT may be asked. */
function due(row: ProviderKeyRow, since: Date): boolean {
  if (!ASKED_STATUSES.has(row.status)) return false;

  return [row.usageHeardAt, row.usageAskedAt].every(
    (at) => at === null || at.getTime() <= since.getTime(),
  );
}

/** What ChatGPT answers a GET for the plan, decoded; none where it answered nothing that decodes. */
const askPlan = /* @__PURE__ */ Effect.fnUntraced(function* <A>(
  url: string,
  access: Extract<ChatGptAccess, { readonly outcome: typeof CHATGPT_ACCESS.READY }>,
  schema: Schema.Codec<A, unknown>,
) {
  const client = yield* HttpClient.HttpClient;

  // A request that failed or timed out is no answer, and its cause is dropped unread, since it may quote the token.
  const answered = yield* client.execute(asPlan(HttpClientRequest.get(url), access)).pipe(
    Effect.flatMap((response) =>
      response.status === HTTP_OK
        ? Effect.map(response.json, Option.some)
        : Effect.succeed(Option.none()),
    ),
    Effect.scoped,
    Effect.timeout(OPENAI_CALL_TIMEOUT),
    Effect.orElseSucceed(() => Option.none<unknown>()),
  );

  return Option.flatMap(answered, Schema.decodeUnknownOption(schema));
});

/** The plan's windows and reset credits as ChatGPT answers them now; none where it answered nothing Codex would read. */
const askUsage = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  row: ProviderKeyRow,
) {
  const access = yield* refreshChatGptAccess(userId, ring, undefined, row.id, true);

  if (access.outcome !== CHATGPT_ACCESS.READY) return Option.none<PlanUsageRead>();
  const usage = yield* askPlan(CHATGPT_USAGE_URL, access, UsageAnswerSchema);

  if (Option.isNone(usage)) return Option.none<PlanUsageRead>();
  const { rate_limit, rate_limit_reset_credits } = usage.value;

  const windows = [rate_limit?.primary_window, rate_limit?.secondary_window].flatMap((window) =>
    window == null ? [] : [storedWindow(window)],
  );

  const count = rate_limit_reset_credits?.available_count;

  if (count === undefined) return Option.some<PlanUsageRead>({ windows, resetCredits: null });

  // Note that the list is asked only for a plan that holds a credit, and a plan whose list goes unanswered keeps its count alone.
  const listed =
    count === 0
      ? Option.none()
      : yield* askPlan(RESET_CREDITS_URL, access, ResetCreditsAnswerSchema);

  return Option.some<PlanUsageRead>({
    windows,
    resetCredits: Option.match(listed, {
      onNone: () => ({ count }),
      onSome: (answer) => ({ count, credits: availableCredits(answer) }),
    }),
  });
});

/** Asks ChatGPT for the plan's usage now and keeps what it answered. */
const askAndKeep = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  row: ProviderKeyRow,
  now: Date,
) {
  const read = yield* askUsage(userId, ring, row);

  if (Option.isNone(read) || read.value.windows.length === 0) return;
  yield* setPlanUsageWindows(userId, row.id, read.value.windows, now, read.value.resetCredits);
});

/** Asks ChatGPT for the usage of each of the account's ChatGPT plans whose reading is due, all at once, and keeps what each answered. */
const askDue = /* @__PURE__ */ Effect.fnUntraced(function* (userId: string, ring: KeyRing) {
  const rows = yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.CHATGPT_OAUTH);
  const now = yield* DateTime.nowAsDate;
  const since = new Date(now.getTime() - Duration.toMillis(FRESH_FOR));
  yield* Effect.forEach(
    rows.filter((row) => due(row, since)),
    (row) =>
      Effect.gen(function* () {
        // Note that the ask is claimed before it is made, so it counts though ChatGPT never answers it.
        if (!(yield* claimPlanUsageAsk(userId, row.id, now, since))) return;
        yield* askAndKeep(userId, ring, row, now);
      }),
    { concurrency: "unbounded", discard: true },
  );
});

/**
 * The account's ChatGPT plans' usage, asked of ChatGPT where due and kept;
 * a plan ChatGPT answered nothing for keeps what it held. Never fails, so a
 * read of the keys answers whatever ChatGPT and the store did.
 */
export function readChatGptUsage(userId: string, ring: KeyRing) {
  return Effect.ignore(askDue(userId, ring));
}

/** The plan's usage asked of ChatGPT now, however fresh its reading, as a reset credit spent on it moves it; never fails. */
export function rereadPlanUsage(userId: string, ring: KeyRing, row: ProviderKeyRow) {
  return Effect.ignore(
    Effect.flatMap(DateTime.nowAsDate, (now) => askAndKeep(userId, ring, row, now)),
  );
}
