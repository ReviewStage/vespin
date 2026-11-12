/**
 * issued-token-account-source.ts -- an account source whose every issued access token is also handed to the shell, with when to stop using it, and taken back once the account signs out: the iPhone's share sheet reads it from there.
 *
 * A token is issued at a sign-in and at each renewal, both of which the
 * account's session writes through the settings store, so the store the
 * source is opened over tells `keep` each token it writes, good for
 * `lifetimeMs` from then, and none once it clears the account or reads none,
 * as a launch after the iPhone app was deleted and installed again does,
 * since the Keychain the shell keeps it in outlives the app. A read of an
 * account tells nothing, since it cannot say how old the token it reads is.
 * A telling `keep` refused is told again at the store's next read, so a
 * sign-out whose removal failed does not leave the token standing. The
 * refresh token is never told: it rotates on every use, so a second process
 * using it would revoke the account's tokens and sign the client out.
 */

import type { StoredAccount } from "@repo/credentials";
import { Clock, Effect, Layer } from "effect";
import type { AccountSourceHost } from "./account-source.js";
import { AccountSource } from "./effect/seams.js";

/** An access token as it is handed on: the token, and when, in epoch milliseconds, it stops being used. */
export interface IssuedToken {
  readonly token: string;
  readonly expiresAt: number;
}

/** Keeps the token given, or removes it where none is given; answers whether it was kept or removed. */
export type KeepIssuedToken = (issued: IssuedToken | undefined) => boolean;

/** Where each issued token goes, and how long after it is issued it is used. */
export interface IssuedTokenSink {
  readonly keep: KeepIssuedToken;
  readonly lifetimeMs: number;
}

type AccountStore = AccountSourceHost["store"];

type Told = { issued?: IssuedToken | undefined; once: boolean; refused: boolean };

/** `store`, telling the sink each access token it writes and none once it clears or reads no account, a refused telling told again at its next read. */
function tellingStore(store: AccountStore, sink: IssuedTokenSink): AccountStore {
  // What was last told and whether it was refused; nothing is told before the first read or write.
  const told: Told = {
    once: false,
    refused: false,
  };

  const tell = (issued: IssuedToken | undefined) =>
    Effect.sync(() => {
      told.once = true;
      told.issued = issued;
      told.refused = !sink.keep(issued);
    });

  // Note that a read of no account removes a token not yet known to be gone, and a refused telling is told again.
  const afterRead = (account: StoredAccount | undefined) => {
    if (account === undefined && (!told.once || told.issued !== undefined)) return tell(undefined);

    return told.refused ? tell(told.issued) : Effect.void;
  };

  const issue = (account: StoredAccount) =>
    Effect.flatMap(Clock.currentTimeMillis, (now) =>
      tell({ token: account.accessToken, expiresAt: now + sink.lifetimeMs }),
    );

  return {
    readAccount: () => store.readAccount().pipe(Effect.tap(afterRead)),
    setAccount: (account: StoredAccount) =>
      store.setAccount(account).pipe(Effect.tap(() => issue(account))),
    clearAccount: () => store.clearAccount().pipe(Effect.tap(() => tell(undefined))),
    accountSnapshot: () => store.accountSnapshot(),
    settleSessionAccount: (accountEmail: string) => store.settleSessionAccount(accountEmail),
  };
}

/** `source`, opened over a store that hands `sink` each access token it is issued. */
export function issuedTokenAccountSourceLayer<E, R>(
  source: Layer.Layer<AccountSource, E, R>,
  sink: IssuedTokenSink,
): Layer.Layer<AccountSource, E, R> {
  return Layer.effect(
    AccountSource,
    Effect.gen(function* () {
      const opened = yield* AccountSource;

      return {
        tokenCipher: opened.tokenCipher,
        open: (host: AccountSourceHost) =>
          opened.open({ ...host, store: tellingStore(host.store, sink) }),
      };
    }),
  ).pipe(Layer.provide(source));
}
