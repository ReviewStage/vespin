/**
 * time-zone-wire.ts -- the member's own time zone, as their desktop, web, and iOS clients tell the service: the IANA zone the device reads its clock in.
 *
 * A client names its device's zone (`PUT /api/account/time-zone`) as it
 * launches and again whenever the zone it reads moves, so a member who
 * travels is read in the zone they are in. The service keeps the last one
 * named on the account, and an agent's turn reads the developer's day in it
 * where the turn's own request names no zone. The zone is checked as
 * `timeZoneSchema` checks one, so only a zone that stands is kept.
 */

import { Schema as EffectSchema } from "effect";
import { timeZoneSchema } from "./date-mention.js";

/** The zone the device reads its clock in, as `readerZone()` names it. */
export const timeZoneWriteSchema = EffectSchema.Struct({
  timeZone: timeZoneSchema,
});

/** What a write answers once the zone is kept: nothing a client needs to read. */
export const timeZoneDoneAnswerSchema = EffectSchema.Struct({
  done: EffectSchema.Literal(true),
});

export type TimeZoneDoneAnswer = typeof timeZoneDoneAnswerSchema.Type;
