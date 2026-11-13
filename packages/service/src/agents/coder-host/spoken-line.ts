/**
 * spoken-line.ts -- the metadata a line spoken on a call is written with.
 *
 * A client names the voice channel (and the delegation a voice handed the
 * line over in) on a message or a queued one; the service writes the line
 * as the developer's own words on `MESSAGE_CHANNEL.VOICE`, which the turn it
 * opens is told of (`turn-context.ts`). A line naming no channel is typed.
 */

import { MESSAGE_AUTHOR, MESSAGE_CHANNEL, type SpokenAskMetadata } from "@repo/wire";

/** The metadata a request's channel and delegation name, or nothing for a typed line. */
export function spokenLineMetadata(request: {
  readonly channel?: typeof MESSAGE_CHANNEL.VOICE | undefined;
  readonly delegationId?: string | undefined;
}): SpokenAskMetadata | undefined {
  if (request.channel !== MESSAGE_CHANNEL.VOICE) return undefined;

  return {
    author: MESSAGE_AUTHOR.DEVELOPER,
    channel: MESSAGE_CHANNEL.VOICE,
    ...(request.delegationId === undefined ? undefined : { delegation_id: request.delegationId }),
  };
}
