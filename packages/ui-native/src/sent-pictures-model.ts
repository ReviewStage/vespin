/**
 * sent-pictures-model.ts -- what a phone holds of each message it sent until the host no longer draws it: the words and the pictures' bytes, by the id its line is drawn under, so a line on its way draws its pictures (`withSending`) and a refused one is sent again or taken back with them.
 *
 * The bytes stay in memory alone, never written anywhere. A line's are let
 * go once it is answered, or let go by Edit or Delete, and the host drew it
 * and then no longer draws it, since a line answered stands until its row
 * lands and draws its pictures from them until then; and all of them on a
 * sign-out. Note that a send may be answered before the host's first drawing
 * of its line reaches the page, so a line never drawn yet is not taken for
 * one whose row landed.
 */

/** The messages a phone sent and holds, by the id each line is drawn under, and the lines it lets go once the host no longer draws them. */
export interface SentPictures<Sent> {
  readonly get: (lineId: string) => Sent | undefined;
  readonly set: (lineId: string, sent: Sent) => void;
  /** Lets one go at once, such as a chat message's, whose line the host draws from its own bytes. */
  readonly delete: (lineId: string) => void;
  /** Lets an agent's line go once the host no longer draws it: answered, or let go by Edit or Delete; `drawn` is what the host draws of the agent's lines now, where the page has read it. */
  readonly letGo: (
    agentId: string,
    lineId: string,
    drawn: readonly { readonly id: string }[] | undefined,
  ) => void;
  /** Tells it what the host draws of an agent's lines now, letting go of each line let go that it no longer draws. */
  readonly drawn: (agentId: string, drawn: readonly { readonly id: string }[]) => void;
  /** Lets every one go, as a sign-out does. */
  readonly clear: () => void;
}

/** An empty hold of the messages a phone sends. */
export function sentPictures<Sent>(): SentPictures<Sent> {
  const held = new Map<string, Sent>();
  // The lines let go, by their id, with their agent's.
  const going = new Map<string, string>();
  // The lines held that the host has drawn.
  const seen = new Set<string>();

  const letGoUndrawn = (agentId: string, drawn: readonly { readonly id: string }[]) => {
    const ids = new Set(drawn.map((line) => line.id));

    for (const lineId of ids) if (held.has(lineId)) seen.add(lineId);

    for (const [lineId, owner] of going) {
      if (owner !== agentId || ids.has(lineId) || !seen.has(lineId)) continue;
      going.delete(lineId);
      seen.delete(lineId);
      held.delete(lineId);
    }
  };

  return {
    get: (lineId) => held.get(lineId),
    set: (lineId, sent) => {
      held.set(lineId, sent);
    },
    delete: (lineId) => {
      held.delete(lineId);
      seen.delete(lineId);
    },
    letGo: (agentId, lineId, drawn) => {
      going.set(lineId, agentId);

      if (drawn !== undefined) letGoUndrawn(agentId, drawn);
    },
    drawn: letGoUndrawn,
    clear: () => {
      held.clear();
      going.clear();
      seen.clear();
    },
  };
}
