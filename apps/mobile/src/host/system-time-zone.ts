/**
 * system-time-zone.ts -- the zone the device's clock reads in, as Hermes's own `Intl` names it, read before `polyfills.ts` replaces `Intl.DateTimeFormat`.
 *
 * Note that this module must load before FormatJS's `Intl.DateTimeFormat`
 * does, since the replacement knows no zone of its own and starts in UTC; it
 * is `polyfills.ts`'s first import for that reason, and imports nothing.
 */

/** The device's zone as Hermes reads it from `NSTimeZone`: an IANA name, or `GMT` and `GMT+0100` for a clock set to an offset. */
export const SYSTEM_TIME_ZONE: string = new Intl.DateTimeFormat().resolvedOptions().timeZone;
