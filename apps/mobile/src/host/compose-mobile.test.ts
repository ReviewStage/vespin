import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { ACT_KIND } from "@repo/host/acts";
import { RUN_PROFILE, type RunProfile } from "@repo/host/app-state";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { THEME } from "@repo/settings";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { Context, Effect, Layer } from "effect";
import { expect } from "vitest";
import { composeMobile, type DeviceSeams, MobileHostTag } from "./compose-mobile.js";
import { selectInboxCollection } from "./inbox-rows.js";

/**
 * compose-mobile.test.ts -- the shared host as the Expo app composes it,
 * over seams a test answers on Node: a fixture run's document lists the
 * Inbox profile's threads, which the Inbox draws, and an act the screens
 * send rides the in-process channel to the host and back, its settings
 * kept in the host's folder for the next launch.
 */

/** A thread the Inbox profile stages, by its title (`@repo/host/fixture-inbox`). */
const STAGED_THREAD = "Who can withdraw an invite?";

/** The device as a test answers it: Node's files, no address opened, no socket reached, the app always in front. */
const testDevice: DeviceSeams = {
  fileSystem: NodeFileSystem.layer,
  createId: () => crypto.randomUUID(),
  openExternal: () => Promise.resolve(),
  openSocket: () => Effect.succeed({ unreachable: true }),
  onAppActiveChanged: () => () => undefined,
};

/** The host stood up in a scope of its own over `stateRoot`, reaching no network, its counts run on the test's own services. */
const standingHost = (stateRoot: string, fixture: RunProfile | undefined) =>
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
        device: testDevice,
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
        expect(selectInboxCollection(state).items.map(({ title }) => title)).toContain(
          STAGED_THREAD,
        );
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
