/**
 * share-token-account.ts -- the iPhone's account, with its current access token also kept where the share sheet reads it: rewritten as it changes, and removed once the account signs out.
 *
 * The share extension starts a task with the account's access token, which
 * it reads from one Keychain item only it and the app share
 * (`modules/share-token/`). The token changes at a sign-in and at each
 * renewal, both of which the account's session writes through the settings
 * store, and is read back through it on every call; so the store the source
 * is opened over tells the item each token it writes or reads that differs
 * from the last one told, and none once the account is cleared. The refresh
 * token is never told: it rotates on every use, so a second process using it
 * would revoke the account's tokens and sign the phone out.
 */

import type { StoredAccount } from "@repo/credentials";
import { AccountSource, type AccountSourceHost } from "@repo/host/effect";
import { Effect, Layer } from "effect";

/** Keeps the token given where the share sheet reads it, or removes it where none is given. */
export type KeepShareToken = (token: string | undefined) => void;

type AccountStore = AccountSourceHost["store"];

/** `store`, telling `keep` each access token it writes or reads that differs from the last one told, and none once it clears the account. */
function sharingStore(store: AccountStore, keep: KeepShareToken): AccountStore {
  const told: { token?: string | undefined; once: boolean } = { once: false };
  const tell = (token: string | undefined) =>
    Effect.sync(() => {
      if (told.once && told.token === token) return;
      told.once = true;
      told.token = token;
      keep(token);
    });
  return {
    readAccount: () =>
      store
        .readAccount()
        .pipe(Effect.tap((account: StoredAccount | undefined) => tell(account?.accessToken))),
    setAccount: (account: StoredAccount) =>
      store.setAccount(account).pipe(Effect.tap(() => tell(account.accessToken))),
    clearAccount: () => store.clearAccount().pipe(Effect.tap(() => tell(undefined))),
    accountSnapshot: () => store.accountSnapshot(),
    settleSessionAccount: (accountEmail: string) => store.settleSessionAccount(accountEmail),
  };
}

/** `source`, opened over a store that keeps the account's current access token where the share sheet reads it (`keep`). */
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
