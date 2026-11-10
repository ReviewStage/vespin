import { Schema as EffectSchema } from "effect";

/**
 * presence-wire.ts -- whether a member is at their desk, as the desktop and web clients tell the service: a beat while they use the keyboard or mouse in one, which holds their phone's pushes.
 *
 * A client that sees the member use it, a key or a press or a move of the
 * pointer in its window, sends a beat (`POST /api/account/presence`, an empty
 * body), at most once every `BEAT_EVERY_MS`, and sends nothing while they
 * leave it be. The service stamps when the account was last active and
 * counts the member present while that stamp stands inside `WINDOW_MS`, so a
 * client that closes or goes idle stops counting on its own, with no
 * sign-off. A beat carries no content and no credential beyond the request's
 * own; the stamp is the only thing kept. While the member is present, a
 * phone whose "Notify me" is away holds its alerts
 * (`push-device-wire.ts`'s `PUSH_NOTIFY`).
 */

export const PRESENCE = {
  /** How long after the member's last activity at a client they still count as present. */
  WINDOW_MS: 2 * 60_000,
  /** The least time between two beats of one client, well inside the window so a member at work never lapses. */
  BEAT_EVERY_MS: 30_000,
} as const;

/** What a beat answers once the stamp is kept: nothing a client needs to read. */
export const presenceDoneAnswerSchema = EffectSchema.Struct({
  done: EffectSchema.Literal(true),
});

export type PresenceDoneAnswer = typeof presenceDoneAnswerSchema.Type;
