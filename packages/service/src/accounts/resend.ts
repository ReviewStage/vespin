/**
 * resend.ts -- the deployment's Resend key and a sender's address, read once for every module that calls Resend.
 *
 * Invitations, the welcome note, and the onboarding events each send with
 * the one key (`RESEND_API_KEY`, the one the feedback form sends with) from
 * the address their own variable names. Each reads the pair here, as the
 * services are built, and calls Resend over its own wait.
 */

import { Config, Effect, Option, Redacted } from "effect";
import { accountCall, fixedBearer } from "../core.js";
import { present } from "../environment.js";

/** Resend's API, as https://resend.com/docs/api-reference names it. */
export const RESEND = {
  BASE_URL: "https://api.resend.com",
  EMAILS_PATH: "/emails",
  /** The deployment's variable the key is read from. */
  API_KEY_ENVIRONMENT: "RESEND_API_KEY",
} as const;

/** The key a sender sends with, and the address it sends from. */
interface ResendSender {
  readonly key: string;
  readonly from: string;
}

/** The Resend key and the address `fromVariable` names, once both are set and neither is blank; none otherwise. */
export function readResendSender(fromVariable: string): Effect.Effect<Option.Option<ResendSender>> {
  return Effect.gen(function* () {
    const read = yield* Config.all({
      key: Config.option(Config.Redacted(RESEND.API_KEY_ENVIRONMENT)),
      from: Config.option(Config.String(fromVariable)),
    }).pipe(Effect.orElseSucceed(() => ({ key: Option.none(), from: Option.none() })));

    const key = present(Option.map(read.key, Redacted.value));
    const from = present(read.from);

    return key === undefined || from === undefined ? Option.none() : Option.some({ key, from });
  });
}

/** A call to Resend on the sender's key, which waits at most `requestTimeoutMs` for an answer. */
export function resendCall(key: string, requestTimeoutMs: number) {
  return accountCall({
    baseUrl: RESEND.BASE_URL,
    credential: fixedBearer(key),
    requestTimeoutMs,
  });
}
