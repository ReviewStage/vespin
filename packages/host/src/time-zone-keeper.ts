/**
 * time-zone-keeper.ts -- the device's own time zone named to the service for the account signed in, as the host launches and whenever it moves.
 *
 * The desktop, the web, and the iOS app each run this one host, so each
 * names its device's zone the same way (`time-zone-wire.ts`): at launch, on
 * every window coming forward, and on a slow tick for a window left open,
 * each time sending only where the zone or the account signed in moved
 * since the last one the service kept. A member who travels is read in the
 * zone they are in once any of their clients sees it. A write that fails is
 * named again at the next check, and a check with no account signed in
 * sends nothing.
 */

import { Duration, Effect, type Scope, Stream } from "effect";

/** How often a window left open reads its zone again, so a trip with the app open is seen without a window coming forward. */
const ZONE_CHECK_EVERY = Duration.minutes(5);

/** What the keeper reads and writes through: the device's zone, the account signed in, the service's write, and the windows coming forward. */
export interface TimeZoneKeeper<R> {
  /** The IANA zone the device reads its clock in now. */
  readonly zone: () => string;
  /** The account signed in now, by its id; none while signed out. */
  readonly account: () => string | undefined;
  /** The zone named to the service for the account signed in: whether it was kept. */
  readonly write: (zone: string) => Effect.Effect<boolean, never, R>;
  /** Each window coming forward from now until the caller's scope closes. */
  readonly focused: Effect.Effect<Stream.Stream<void>, never, Scope.Scope>;
}

/** The zone named for each account as it moves, for as long as the caller's scope stands. */
export function keepTimeZone<R>(
  keeper: TimeZoneKeeper<R>,
): Effect.Effect<void, never, R | Scope.Scope> {
  return Effect.gen(function* () {
    let kept: { readonly account: string; readonly zone: string } | undefined;

    const check = Effect.gen(function* () {
      const account = keeper.account();
      const zone = keeper.zone();

      if (account === undefined || (kept?.account === account && kept.zone === zone)) return;

      if (yield* keeper.write(zone)) kept = { account, zone };
    });

    const focused = yield* keeper.focused;

    yield* Stream.runForEach(Stream.merge(Stream.tick(ZONE_CHECK_EVERY), focused), () => check);
  });
}
