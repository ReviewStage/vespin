/**
 * welcome-mail.ts -- a founder's note emailed to a new account as it signs up, through Resend.
 *
 * An account the auth route signed up (`auth-app.ts`) is sent one short note
 * from Charles, one of the founders, the way a person writes one: plain
 * words, no card, button, or brand, so it reads as a letter and a reply
 * reaches him. Its words are not here: they are Resend's published template
 * `founder-welcome`, which Charles edits in Resend without a deploy, and the
 * service fills in its one variable, the greeting, by the first word of the
 * account's name, or with no name where it has none. One POST to Resend's
 * `/emails` (https://resend.com/docs/api-reference/emails/send-email), to
 * the new account's address alone. Resend holds it for an hour
 * (`scheduled_at`) before it goes out, so it lands as a note written after
 * they have had a look around rather than an instant receipt of the sign-up.
 *
 * The deployment holds the Resend key (`RESEND_API_KEY`, the one invitations
 * and the feedback form send with) and the sender (`WELCOME_FROM`, such as
 * `Charles Pan <charles@…>` on a domain Resend has verified), which replies
 * go to. Without either nothing is mailed; the build says so once, by the
 * variables' names. A send Resend refuses or never answers, an unpublished
 * template among them, leaves the sign-up standing and is logged by its
 * status alone, since the letter carries the new account's address.
 */

import { HTTP_METHOD } from "@repo/wire";
import { Clock, Context, Effect, Layer, Option } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { callAnswered } from "../core.js";
import { RESEND, readResendSender, resendCall } from "./resend.js";

/** The deployment's variables the sender is read from: the Resend key invitations send with, and the address the note comes from. */
export const WELCOME_MAIL_ENVIRONMENT = {
  RESEND_API_KEY: RESEND.API_KEY_ENVIRONMENT,
  FROM: "WELCOME_FROM",
} as const;

/** Short, since the sign-up's answer waits on it. */
const REQUEST_TIMEOUT_MS = 3_000;

/** How long after the sign-up Resend sends the note. */
const SEND_DELAY_MS = 60 * 60 * 1_000;

/** What the build says once where a variable is unset, by the variables' names alone. */
const MAIL_UNSET = `${WELCOME_MAIL_ENVIRONMENT.RESEND_API_KEY} or ${WELCOME_MAIL_ENVIRONMENT.FROM} is not set, so new accounts are not sent a welcome email.`;

/** Resend's template the note is written in, by its alias, and the one variable it takes. */
const WELCOME_TEMPLATE = {
  ALIAS: "founder-welcome",
  GREETING: "GREETING",
} as const;

/** One new account as its note addresses it. */
interface WelcomeLetter {
  /** The new account's address, the email's one recipient. */
  readonly email: string;
  /** The account's name as its sign-in gave it; empty where it has none. */
  readonly name: string;
}

interface WelcomeMailValues {
  /** Emails one new account its note; never fails, since the sign-up stands either way. */
  readonly send: (letter: WelcomeLetter) => Effect.Effect<void>;
}

/** The deployment's sender of welcome emails. Read optionally, so a runtime without one emails nothing. */
export class WelcomeMail extends Context.Service<WelcomeMail, WelcomeMailValues>()("WelcomeMail") {}

/**
 * "Hey Ada," for an account named "Ada Lovelace", and "Hey," for one with no
 * name; the onboarding emails greet by it too (`onboarding-events.ts`).
 */
export function greetingOf(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first === "" ? "Hey," : `Hey ${first},`;
}

/**
 * The sender over Resend, once the deployment names both its key and its
 * address, read as the services are built; one that sends nothing otherwise.
 */
export const welcomeMailFromEnvironment: Layer.Layer<WelcomeMail, never, HttpClient.HttpClient> =
  Layer.effect(
    WelcomeMail,
    Effect.gen(function* () {
      const sender = yield* readResendSender(WELCOME_MAIL_ENVIRONMENT.FROM);
      if (Option.isNone(sender)) {
        yield* Effect.logWarning(MAIL_UNSET);
        return { send: () => Effect.void };
      }
      const { key, from } = sender.value;
      const client = yield* HttpClient.HttpClient;
      const call = resendCall(key, REQUEST_TIMEOUT_MS);
      return {
        send: (letter: WelcomeLetter) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const scheduledAt = new Date(now + SEND_DELAY_MS).toISOString();
            const answer = yield* call.send({
              method: HTTP_METHOD.POST,
              path: RESEND.EMAILS_PATH,
              body: JSON.stringify({
                from,
                to: [letter.email],
                scheduled_at: scheduledAt,
                template: {
                  id: WELCOME_TEMPLATE.ALIAS,
                  variables: { [WELCOME_TEMPLATE.GREETING]: greetingOf(letter.name) },
                },
              }),
            });
            if (callAnswered(answer) && answer.response.ok) return;
            // Note that the status alone is logged, because the letter carries the new account's address.
            yield* Effect.logWarning(
              callAnswered(answer)
                ? `Welcome email refused with status ${answer.response.status}`
                : "Welcome email did not reach Resend",
            );
          }).pipe(Effect.provideService(HttpClient.HttpClient, client)),
      };
    }),
  );
