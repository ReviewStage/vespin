/**
 * claude-usage.ts -- a Claude plan's usage windows read afresh by hand, from the rate-limit headers Anthropic answers a one-token request on its setup-token with, as Claude Code's own quota check reads them.
 *
 * A turn on a Claude plan hears its windows from Claude Code as it runs
 * (`rate_limit_event`); between turns nothing does, and a setup-token
 * cannot read Claude's usage endpoint, which wants a scope
 * (`user:profile`) the token is never granted, so the Agent SDK's own
 * usage read answers no limits for it either. What every answer on the
 * plan carries is its unified rate-limit headers, so a refresh sends the
 * request Claude Code sends to check its quota: the smallest model, one
 * output token, the word "quota", which spends a sliver of the plan. Its
 * 5-hour and 7-day windows are read from the headers whatever the status,
 * since a plan at its limit answers 429 with them, and each replaces the
 * window of its length the plan held, the per-model windows a turn heard
 * kept. An answer that went through also says the plan has room now, so
 * a limit a turn wrote earlier is lifted at once (`setPlanStatus`) rather
 * than standing until the reset it named, which a plan upgraded since, or
 * one whose limit lifted early, never reaches; a launch then chooses it
 * again (`turnPayerOf`). A request that fails, times out, or carries no
 * such header changes nothing. The token goes to Anthropic alone and is
 * never logged; nothing of the answer is read but its status and headers.
 */

import type { KeyRing } from "@repo/database/models/provider-key-seal";
import { openProviderKey } from "@repo/database/models/provider-key-seal";
import {
  type ProviderKeyRow,
  setPlanStatus,
  setPlanUsage,
} from "@repo/database/models/provider-key-store";
import type { StoredUsageWindow } from "@repo/database/schemas/account-provider-key";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@repo/features/provider-key-wire";
import { DateTime, Duration, Effect, Option, Redacted, Result } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

/** The one request a refresh sends, as Claude Code's quota check sends it on a plan's token. */
const CLAUDE_QUOTA_CHECK = {
  URL: "https://api.anthropic.com/v1/messages",
  VERSION: "2023-06-01",
  BETA: "oauth-2025-04-20",
  BODY: {
    model: "claude-haiku-5-5",
    max_tokens: 1,
    system: "You are Claude Code, Anthropic's official CLI for Claude.",
    messages: [{ role: "user", content: "quota" }],
  },
} as const;

/** The statuses of an answer that went through, which only a plan with room is given. */
const ANSWERED = { FROM: 200, TO: 299 } as const;

/** How long Anthropic is given to answer before the plan keeps what it held. */
const CHECK_TIMEOUT = Duration.seconds(10);

/** The unified windows a refresh reads, by the name their headers carry and their length in minutes. */
const WINDOWS = [
  { name: "5h", windowMins: 5 * 60 },
  { name: "7d", windowMins: 7 * 24 * 60 },
] as const;

/** Whose sealed token a Claude plan's row holds. */
const OWNER_KIND = {
  provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
  kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
} as const;

/** A header's number, none where it is absent or not one. */
function numberOf(headers: Readonly<Record<string, string>>, name: string): number | undefined {
  const value = headers[name];

  if (value === undefined || value === "") return undefined;
  const read = Number(value);

  return Number.isFinite(read) ? read : undefined;
}

/** The windows the answer's headers name, each as the plan's row keeps it; utilization is a share of one, kept in percent, and a reset is in epoch seconds. */
function claudeUsageWindows(
  headers: Readonly<Record<string, string>>,
): readonly StoredUsageWindow[] {
  return WINDOWS.flatMap(({ name, windowMins }) => {
    const utilization = numberOf(headers, `anthropic-ratelimit-unified-${name}-utilization`);

    if (utilization === undefined) return [];
    const reset = numberOf(headers, `anthropic-ratelimit-unified-${name}-reset`);

    return [
      {
        usedPercent: utilization * 100,
        windowMins,
        ...(reset !== undefined && reset > 0 ? { resetsAt: reset * 1000 } : undefined),
      },
    ];
  });
}

/** What of the quota check's answer is read: its status and its headers. */
interface QuotaAnswer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

/** The quota check on the token, its answer's status and headers; none where it failed or timed out. */
const askQuota = /* @__PURE__ */ Effect.fnUntraced(function* (token: Redacted.Redacted<string>) {
  const client = yield* HttpClient.HttpClient;

  const request = HttpClientRequest.post(CLAUDE_QUOTA_CHECK.URL).pipe(
    // The token is revealed here alone, into the one header Anthropic reads it from.
    HttpClientRequest.bearerToken(Redacted.value(token)),
    HttpClientRequest.setHeaders({
      "anthropic-version": CLAUDE_QUOTA_CHECK.VERSION,
      "anthropic-beta": CLAUDE_QUOTA_CHECK.BETA,
    }),
    HttpClientRequest.bodyJsonUnsafe(CLAUDE_QUOTA_CHECK.BODY),
  );

  // Note that a failure's cause is dropped unread, since it may quote the token, and the body is never read.
  return yield* client.execute(request).pipe(
    Effect.map((response) =>
      Option.some<QuotaAnswer>({ status: response.status, headers: response.headers }),
    ),
    Effect.scoped,
    Effect.timeout(CHECK_TIMEOUT),
    Effect.orElseSucceed(() => Option.none<QuotaAnswer>()),
  );
});

/** Asks Anthropic for the Claude plan's usage now and keeps each window it answered; never fails. */
export function rereadClaudeUsage(userId: string, ring: KeyRing, row: ProviderKeyRow) {
  return Effect.ignore(
    Effect.gen(function* () {
      const token = openProviderKey(ring, { userId, ...OWNER_KIND }, row);

      if (Result.isFailure(token)) return;
      const asked = yield* DateTime.nowAsDate;
      const answer = yield* askQuota(token.success);

      if (Option.isNone(answer)) return;
      const { status, headers } = answer.value;
      const heard = yield* DateTime.nowAsDate;
      yield* Effect.forEach(
        claudeUsageWindows(headers),
        (window) =>
          setPlanUsage(userId, OWNER_KIND.provider, OWNER_KIND.kind, window, heard, asked, row.id),
        { discard: true },
      );

      // Note that only an answer that went through lifts a limit; a 429 or any refusal leaves the status a turn wrote.
      if (status < ANSWERED.FROM || status > ANSWERED.TO) return;
      yield* setPlanStatus(
        userId,
        OWNER_KIND.provider,
        OWNER_KIND.kind,
        PROVIDER_KEY_STATUS.VERIFIED,
        undefined,
        asked,
        heard,
        row.id,
      );
    }),
  );
}
