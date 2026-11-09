import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { AUTH_SESSION_END } from "@repo/credentials";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { LIVE_READ } from "@repo/features/live-wire";
import { ACT_KIND } from "@repo/host/acts";
import { RUN_PROFILE, type RunProfile } from "@repo/host/app-state";
import { inboxRowsOf } from "@repo/host/app-state-reads";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { THEME } from "@repo/settings";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { Context, Effect, Layer } from "effect";
import { expect, vi } from "vitest";
import { composeMobile, type DeviceSeams, MobileHostTag } from "./compose-mobile.js";
import { STUB_ACCOUNT, stubAuthFetch, stubAuthSession } from "./stub-auth-server.js";

/**
 * compose-mobile.test.ts -- the shared host as the Expo app composes it,
 * over seams a test answers on Node: a fixture run's document lists the
 * Inbox profile's threads, which the Inbox draws, and an act the screens
 * send rides the in-process channel to the host and back, its settings
 * kept in the host's folder for the next launch.
 */

/** A thread the Inbox profile stages, by its title (`@repo/host/fixture-inbox`). */
const STAGED_THREAD = "Who can withdraw an invite?";

/** The device as a test answers it: Node's files, no address opened, no socket reached, the app always in front, a cipher that seals in the clear, and a sign-in sheet closed at once. */
const testDevice: DeviceSeams = {
  fileSystem: NodeFileSystem.layer,
  createId: () => crypto.randomUUID(),
  openExternal: () => Promise.resolve(),
  openSocket: () => Effect.succeed({ unreachable: true }),
  onAppActiveChanged: () => () => undefined,
  cipher: {
    isAvailable: () => true,
    encrypt: (plainText) => new TextEncoder().encode(plainText),
    decrypt: (cipherText) => new TextDecoder().decode(cipherText),
  },
  authSession: {
    open: () => Promise.resolve({ end: AUTH_SESSION_END.CLOSED }),
    dismiss: () => undefined,
  },
};

/** The device a flow signs in on against the stubbed account service: its sheet granting at once. */
const stubDevice: DeviceSeams = { ...testDevice, authSession: stubAuthSession };

/** The host stood up in a scope of its own over `stateRoot`, reaching no network, its counts run on the test's own services. */
const standingHost = (
  stateRoot: string,
  fixture: RunProfile | undefined,
  device: DeviceSeams = testDevice,
) =>
  Effect.gen(function* () {
    const services = yield* Effect.context<never>();
    const built = yield* Layer.build(
      composeMobile({
        httpClient: noNetwork,
        fork: (effect) => {
          Effect.runForkWith(services)(effect);
        },
        fixture,
        appVersion: "0.1.0",
        stateRoot,
        device,
      }),
    );
    return Context.get(built, MobileHostTag);
  });

/** A folder of this test's own for the host's files, gone with the scope. */
const ownFolder = Effect.provide(temporaryDirectoryScoped("mobile-host-"), NodeFileSystem.layer);

it.effect(
  "a fixture run's document lists the Inbox profile's threads, signed in as its account",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* ownFolder;
        const { bridge } = yield* standingHost(root, RUN_PROFILE.INBOX);

        const state = yield* Effect.promise(() => bridge.requestAppState());

        expect(state.account.status).toBe(ACCOUNT_STATUS.SIGNED_IN);
        const rows = inboxRowsOf(state.inbox, state[LIVE_READ.INBOX_ITEMS]);
        expect(rows.map(({ title }) => title)).toContain(STAGED_THREAD);
      }),
    ),
);

it.effect(
  "a setting written over the act port in one launch is read back by the next, from the host's folder",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* ownFolder;
        const written = yield* Effect.scoped(
          Effect.gen(function* () {
            const { acts } = yield* standingHost(root, undefined);
            return yield* Effect.promise(() =>
              acts[ACT_KIND.SETTING_UPDATE]({ field: "theme", value: THEME.DARK }),
            );
          }),
        );
        expect(written.status).toBe(ACTION_RESULT_STATUS.ACCEPTED);

        const { bridge } = yield* standingHost(root, undefined);
        const reread = yield* Effect.promise(() => bridge.requestAppState());

        expect(reread.settings?.stored.theme).toBe(THEME.DARK);
      }),
    ),
);

it.effect(
  "signs in against the stubbed account service as the ios client, stands signed in at the next launch, and signs out revoking its token",
  () => {
    // Each OAuth form the host posted, by the endpoint it went to and the client it named.
    const posted: (readonly [string, string | null])[] = [];
    const recording: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const endpoint = new URL(request.url).pathname.split("/oauth2/")[1];
      if (endpoint !== undefined && request.method === "POST") {
        const form = new URLSearchParams(await request.clone().text());
        posted.push([endpoint, form.get("client_id")]);
      }
      return stubAuthFetch(request);
    };
    return Effect.scoped(
      Effect.gen(function* () {
        // Note that the stub stands as the global `fetch`, as the app stands it, because the session's launch renewal reads the global.
        vi.spyOn(globalThis, "fetch").mockImplementation(recording);
        const root = yield* ownFolder;
        const answer = yield* Effect.scoped(
          Effect.gen(function* () {
            const { acts } = yield* standingHost(root, undefined, stubDevice);
            return yield* Effect.promise(() =>
              acts[ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]({ provider: ACCOUNT_PROVIDER.GITHUB }),
            );
          }),
        );
        expect(answer).toMatchObject({
          account: { status: ACCOUNT_STATUS.SIGNED_IN, email: STUB_ACCOUNT.email },
        });

        const { acts, bridge } = yield* standingHost(root, undefined, stubDevice);
        const relaunched = yield* Effect.promise(() => bridge.requestAppState());
        expect(relaunched.account.status).toBe(ACCOUNT_STATUS.SIGNED_IN);

        const signedOut = yield* Effect.promise(() => acts[ACT_KIND.ACCOUNT_SIGN_OUT]());
        expect(signedOut.status).toBe(ACCOUNT_STATUS.SIGNED_OUT);
        expect(posted).toEqual([
          ["token", "ios"],
          ["revoke", "ios"],
        ]);
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => vi.restoreAllMocks())));
  },
);
