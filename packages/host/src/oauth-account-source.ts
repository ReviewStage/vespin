import { AccountClient, AccountSessionManager, type StoredAccount } from "@repo/credentials";
import { ACCOUNT_STATUS, type AccountSnapshot } from "@repo/credentials/snapshot";
import {
  AccountRefreshFailed,
  type AccountToken,
  accountBearer,
  sessionBearer,
} from "@repo/features";
import { FIRST_PARTY_OAUTH_CLIENT_ID } from "@repo/features/oauth-client-ids";
import { Effect, Layer } from "effect";
import type { AccountSession, AccountSourceHost } from "./account-source.js";
import {
  AccountSource,
  SecretCipher,
  SignInConsent,
  type SignInConsentSeam,
} from "./effect/seams.js";

/**
 * Which first-party client an OAuth account signs in as, and what its
 * session-only calls ride: the Mac's own Better Auth session, handed off
 * through the browser, or, on the iPhone, the OAuth bearer itself, which the
 * service takes on every v1 write and the live socket for the `ios` client,
 * so the iPhone asks no hand-off.
 */
export interface OAuthAccountClient {
  readonly clientId: string;
  readonly sessionHandOff: boolean;
}

export const OAUTH_ACCOUNT_CLIENT = {
  DESKTOP: { clientId: FIRST_PARTY_OAUTH_CLIENT_ID.DESKTOP, sessionHandOff: true },
  IOS: { clientId: FIRST_PARTY_OAUTH_CLIENT_ID.IOS, sessionHandOff: false },
} as const satisfies Record<string, OAuthAccountClient>;

/**
 * An account signed in through OAuth as `client`, whose consent the shell
 * stands up (`SignInConsent`), with the tokens it lands sealed in the
 * settings file by the shell's cipher (`SecretCipher`): the Mac's browser and
 * Keychain, or the iPhone's authentication session and Keychain. These two
 * seams are this source's alone, so a host assembled over another source is
 * handed neither.
 */
export const oauthAccountSourceLayerFor = (
  client: OAuthAccountClient,
): Layer.Layer<AccountSource, never, SecretCipher | SignInConsent> =>
  Layer.effect(
    AccountSource,
    Effect.gen(function* () {
      const cipher = yield* SecretCipher;
      const consent = yield* SignInConsent;

      return {
        tokenCipher: cipher,
        open: (host: AccountSourceHost) => openOAuthSession(host, consent.open, client),
      };
    }),
  );

/** The desktop's account: an OAuth sign-in through the developer's browser, as the `desktop` client. */
export const oauthAccountSourceLayer: Layer.Layer<
  AccountSource,
  never,
  SecretCipher | SignInConsent
> = oauthAccountSourceLayerFor(OAUTH_ACCOUNT_CLIENT.DESKTOP);

const openOAuthSession = /* @__PURE__ */ Effect.fnUntraced(function* (
  host: AccountSourceHost,
  openConsent: SignInConsentSeam["open"],
  oauthClient: OAuthAccountClient,
): Effect.fn.Return<AccountSession> {
  const { store, runMode } = host;

  const client = new AccountClient({
    baseUrl: host.accountBaseUrl,
    clientId: oauthClient.clientId,
  });

  const session = yield* AccountSessionManager.make({
    client,
    // The store's own effects, with an I/O failure read as the defect the
    // rejected promise behind each of these already was. The capability pair
    // is awaited rather than read, because a link read at construction would
    // be read before the host has linked it.
    store: {
      readAccount: () => Effect.orDie(store.readAccount()),
      setAccount: (stored) => Effect.orDie(store.setAccount(stored)),
      clearAccount: () => Effect.orDie(store.clearAccount()),
    },
    hostedServiceBaseUrl: host.hostedServiceBaseUrl,
    requiresAccount: runMode.requiresAccount,
    openExternal: host.openExternal,
    openConsent,
    report: host.report,
    startCapabilities: host.startCapabilities,
    stopCapabilities: host.stopCapabilities,
  });

  /**
   * One account read: a store that could not be read is an account this
   * attempt cannot name, exactly as a rejected read already was here.
   */
  const readStoredAccount = (): Effect.Effect<StoredAccount | undefined> =>
    store.readAccount().pipe(Effect.orElseSucceed(() => undefined));

  // The holder is the account's own address, so a call's one retry after a
  // 401 can tell a renewed token from a different person's: a sign-out and
  // sign-in between the attempt and its retry reads as the caller's account
  // gone, never as a fresh bearer to carry the old account's payload under.
  const token: AccountToken = {
    readAccessToken: () =>
      runMode.sendsNetwork
        ? Effect.map(readStoredAccount(), (account) => account?.accessToken)
        : Effect.succeed(undefined),
    refreshAccount: session.renewOnce,
    readAccountKey: () => Effect.map(readStoredAccount(), (account) => account?.email),
  };

  const credential = accountBearer(token);

  // Note that a hand-off that did not land is no failure of the call that
  // asked for it: the call retries on whatever session stands, and its
  // second refusal is what gets reported. A client with no hand-off makes
  // every session-only call under its bearer.
  const sessionCredential = oauthClient.sessionHandOff
    ? sessionBearer({
        ...token,
        readSessionToken: () =>
          runMode.sendsNetwork
            ? Effect.map(readStoredAccount(), (account) => account?.sessionToken)
            : Effect.succeed(undefined),
        obtainSession: () =>
          session.obtainSession().pipe(
            Effect.asVoid,
            Effect.mapError((failed) => new AccountRefreshFailed({ message: failed.message })),
          ),
      })
    : credential;

  return {
    snapshot: () => session.snapshot,
    changes: session.changes,
    initialize: Effect.gen(function* () {
      const initial: AccountSnapshot = runMode.requiresAccount
        ? yield* Effect.orDie(store.accountSnapshot())
        : { status: ACCOUNT_STATUS.SIGNED_OUT };

      session.initialize(initial);

      return initial;
    }),
    beginSignIn: (provider) => session.beginSignIn(provider),
    signInAgain: (provider) => session.signInAgain(provider),
    cancelSignIn: () => session.cancelSignIn(),
    signOut: (options) => session.signOut(options),
    deleteEverywhere: () => session.deleteEverywhere(),
    refreshOnce: session.refreshOnce,
    token,
    credential,
    sessionCredential,
  };
});
