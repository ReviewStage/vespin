/**
 * place-params.ts -- the params an address's routes read, every match's together, as the place module reads them.
 */

/** The params an address's routes read, every match's together. */
export type PlaceParams = Readonly<Record<string, string | undefined>>;

/** What reading the params takes of a match: the params it was matched with. */
interface MatchParams {
  readonly params: PlaceParams;
}

/** The params every match of an address reads, together. */
export function placeParamsOf(matches: readonly MatchParams[]): PlaceParams {
  return Object.assign({}, ...matches.map((match) => match.params));
}
