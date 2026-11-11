/**
 * share-token-account.ts -- the iPhone's account, with each access token it is issued also kept where the share sheet reads it, with when to stop sending it, and removed once the account signs out.
 *
 * The share extension starts a task with the account's access token, which
 * it reads from one Keychain item only it and the app share
 * (`modules/share-token/`). A token is issued at a sign-in and at each
 * renewal, both of which the account's session writes through the settings
 * store, so the store the source is opened over tells the item each token it
 * writes, good until a little before the service lets it lapse, and none
 * once it clears the account or reads none, as a launch after the app was
 * deleted and installed again does, since the Keychain outlives the app. A
 * read of an account tells nothing, since it cannot say how old the token it
 * reads is; an app updated onto this keeps no token until its next renewal,
 * within the hour, and the sheet keeps drafts until then.
 * A write the Keychain refused is tried again at the store's next read, so a
 * sign-out whose delete failed does not leave the token standing. The
 * refresh token is never told: it rotates on every use, so a second process
 * using it would revoke the account's tokens and sign the phone out.
 */

import type { StoredAccount } from "@repo/credentials";
import { AccountSource, type AccountSourceHost } from "@repo/host/effect";
import { Clock, Effect, Layer } from "effect";

/**
 * How long the share sheet sends a token after it is issued: ten minutes
 * short of the hour the service's access tokens last (`accessTokenExpiresIn`
 * in `packages/service/src/auth/auth.ts`), so one nearly lapsed is not sent.
 */
const SHARE_TOKEN_LIFETIME_MS = 50 * 60 * 1000;

/** An access token as the share sheet keeps it: the token, and when, in epoch milliseconds, it stops sending it. */
export interface SharedToken {
  readonly token: string;
  readonly expiresAt: number;
}

/** Keeps the token given where the share sheet reads it, or removes it where none is given; answers whether the Keychain took it. */
export type KeepShareToken = (shared: SharedToken | undefined) => boolean;

type AccountStore = AccountSourceHost["store"];

/** `store`, telling `keep` each access token it writes and none once it clears or reads no account, a refused telling tried again at its next read. */
function sharingStore(store: AccountStore, keep: KeepShareToken): AccountStore {
  // What was last told and whether the Keychain refused it; nothing is told before the first read or write.
  const told: { shared?: SharedToken | undefined; once: boolean; refused: boolean } = {
    once: false,
    refused: false,
  };
  const tell = (shared: SharedToken | undefined) =>
    Effect.sync(() => {
      told.once = true;
      told.shared = shared;
      told.refused = !keep(shared);
    });
  // Note that a read of no account removes a token not yet known to be gone, and a refused telling is told again.
  const afterRead = (account: StoredAccount | undefined) => {
    if (account === undefined && (!told.once || told.shared !== undefined)) return tell(undefined);
    return told.refused ? tell(told.shared) : Effect.void;
  };
  const issued = (account: StoredAccount) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      tell({ token: account.accessToken, expiresAt: now + SHARE_TOKEN_LIFETIME_MS }),
    );
  return {
    readAccount: () => store.readAccount().pipe(Effect.tap(afterRead)),
    setAccount: (account: StoredAccount) =>
      store.setAccount(account).pipe(Effect.tap(() => issued(account))),
    clearAccount: () => store.clearAccount().pipe(Effect.tap(() => tell(undefined))),
    accountSnapshot: () => store.accountSnapshot(),
    settleSessionAccount: (accountEmail: string) => store.settleSessionAccount(accountEmail),
  };
}

/** `source`, opened over a store that keeps each access token it is issued where the share sheet reads it (`keep`). */
export function sharingAccountSourceLayer<E, R>(
  source: Layer.Layer<AccountSource, E, R>,
  keep: KeepShareToken,
): Layer.Layer<AccountSource, E, R> {
  return Layer.effect(
    AccountSource,
    Effect.gen(function* () {
      const opened = yield* AccountSource;
      return {
        tokenCipher: opened.tokenCipher,
        open: (host: AccountSourceHost) =>
          opened.open({ ...host, store: sharingStore(host.store, keep) }),
      };
    }),
  ).pipe(Layer.provide(source));
}
