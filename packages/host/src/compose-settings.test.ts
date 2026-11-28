import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { HOSTED_SERVICE_PATH, NO_CREDENTIAL } from "@repo/features";
import {
  PRODUCT_EVENT,
  PRODUCT_LAUNCHED_IN,
  PRODUCT_PLATFORM,
  type ProductLaunchedIn,
} from "@repo/features/analytics";
import { GATEWAY_EVENT, type GatewayEventKind } from "@repo/gateway";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { THEME } from "@repo/settings";
import { DIFF_LAYOUT } from "@repo/settings/diff-view";
import { isRecord, type WireValue } from "@repo/wire";
import { ConfigProvider, Effect, Layer, Queue, Stream } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { composeSettings } from "./compose-settings.js";
import { HostKernelTag } from "./effect/kernel.js";
import { AppIdentity, Environment, SettingsChangedElsewhere } from "./effect/seams.js";
import { hostKernelOver } from "./host-kernel.js";
import { runModeFor } from "./run-mode.js";
import { fixedAccountSource } from "./testing/fixed-account-source.js";

/**
 * The settings concern's own hosted clients, built before the account is and
 * so linked to its credential late: a call goes out as the linked credential
 * would, which for a cookie session is with no header at all.
 */

const SERVICE_BASE_URL = "https://app.example.test";

/** A settings concern in a run that sends, over a service that answers every request and keeps what each carried; the launch begun where `launchedIn` says, where the platform says. */
const sendingSettings = Effect.fnUntraced(function* (
  packaged: boolean,
  launchedIn?: ProductLaunchedIn,
) {
  const requests: {
    readonly url: string;
    readonly authorization: string | null;
    readonly body: string;
  }[] = [];

  const service: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push({
      url: request.url,
      authorization: request.headers.get("authorization"),
      body: await request.text(),
    });

    return new Response(null, { status: 204 });
  };

  const stateRoot = yield* temporaryDirectoryScoped("settings-sending-");

  const machine = Layer.mergeAll(
    Layer.succeed(
      HostKernelTag,
      hostKernelOver({
        stateRoot,
        // A run that sends, so the counted events leave on a flush.
        runMode: runModeFor({ capture: false, fixture: false }),
        accountBaseUrl: `${SERVICE_BASE_URL}/api/auth`,
        now: () => 0,
        createId: () => "id",
        report: () => undefined,
        emit: () => undefined,
      }),
    ),
    Layer.succeed(Environment, ConfigProvider.fromEnvRecord({})),
    // A version the counted events allowlist reads, so the launch is counted.
    Layer.succeed(AppIdentity, {
      appVersion: "1.0.0",
      packaged,
      platform: PRODUCT_PLATFORM.DESKTOP,
      ...(launchedIn === undefined ? undefined : { launchedIn }),
    }),
    fixedAccountSource(),
    NodeFileSystem.layer,
    NodePath.layer,
  );

  const settings = yield* Effect.provide(composeSettings(), machine).pipe(
    Effect.provideService(FetchHttpClient.Fetch, service),
  );

  yield* settings.link({
    credential: NO_CREDENTIAL,
    readAccountKey: () => Effect.succeed(undefined),
    confirmAccount: () => Effect.void,
  });
  // The lifetime arms the counted events, where usage data is shared, and counts this launch.
  yield* settings.lifetime;

  const sent = () =>
    requests.filter(
      (request) => request.url === `${SERVICE_BASE_URL}${HOSTED_SERVICE_PATH.EVENTS}`,
    );

  return { settings, sent, service };
});

it.effect(
  "a linked credential with no authorization reaches a settings client's request with no header",
  () =>
    Effect.gen(function* () {
      const { settings, sent, service } = yield* sendingSettings(true);

      yield* Effect.provideService(settings.flushProductEvents, FetchHttpClient.Fetch, service);

      assert.ok(sent().length > 0, "the launch's count was sent");

      for (const request of sent()) assert.equal(request.authorization, null);
    }).pipe(Effect.provide([NodeFileSystem.layer, NodePath.layer])),
);

it.effect(
  "a run from source counts nothing until usage data is turned on, and nothing once it is off again",
  () =>
    Effect.gen(function* () {
      const { settings, sent, service } = yield* sendingSettings(false);

      const countAndFlush = Effect.andThen(
        Effect.sync(() => {
          settings.recordProductEvent(PRODUCT_EVENT.APP_LAUNCH, { app_version: "1.0.0" });
        }),
        Effect.provideService(settings.flushProductEvents, FetchHttpClient.Fetch, service),
      );

      yield* countAndFlush;
      assert.equal(sent().length, 0, "a run from source sent a count by default");

      yield* Effect.orDie(settings.acts.SETTING_UPDATE({ field: "usageData", value: true }));
      yield* countAndFlush;
      assert.equal(sent().length, 1, "the count made once usage data was on was not sent");

      yield* Effect.orDie(settings.acts.SETTING_UPDATE({ field: "usageData", value: false }));
      yield* countAndFlush;
      assert.equal(sent().length, 1, "a count was sent after usage data was turned off");
    }).pipe(Effect.provide([NodeFileSystem.layer, NodePath.layer])),
);

it.effect("a launch that learns late that usage data is on is counted then, and once", () =>
  Effect.gen(function* () {
    // A run from source reads usage data off at launch, as a launch whose settings read failed does.
    const { settings, sent, service } = yield* sendingSettings(false);

    const flush = Effect.provideService(
      settings.flushProductEvents,
      FetchHttpClient.Fetch,
      service,
    );

    const launches = () =>
      sent()
        .flatMap((request) => JSON.parse(request.body).events)
        .filter((event: { name: string }) => event.name === PRODUCT_EVENT.APP_LAUNCH).length;

    yield* flush;
    assert.equal(launches(), 0, "a launch was counted while usage data read off");

    yield* Effect.orDie(settings.acts.SETTING_UPDATE({ field: "usageData", value: true }));
    yield* flush;
    assert.equal(launches(), 1, "the launch was not counted once usage data read on");

    yield* Effect.orDie(settings.acts.SETTING_UPDATE({ field: "usageData", value: false }));
    yield* Effect.orDie(settings.acts.SETTING_UPDATE({ field: "usageData", value: true }));
    yield* flush;
    assert.equal(launches(), 1, "one launch was counted twice");
  }).pipe(Effect.provide([NodeFileSystem.layer, NodePath.layer])),
);

it.effect("a launch the system woke in the background says so on its count", () =>
  Effect.gen(function* () {
    const { settings, sent, service } = yield* sendingSettings(
      true,
      PRODUCT_LAUNCHED_IN.BACKGROUND,
    );

    yield* Effect.provideService(settings.flushProductEvents, FetchHttpClient.Fetch, service);

    const launch = sent()
      .flatMap((request) => JSON.parse(request.body).events)
      .find((event: { name: string }) => event.name === PRODUCT_EVENT.APP_LAUNCH);

    // Note that the key is read as the counted events' wire names it.
    assert.equal(launch?.properties.launched_in, PRODUCT_LAUNCHED_IN.BACKGROUND);
  }).pipe(Effect.provide([NodeFileSystem.layer, NodePath.layer])),
);

/** One browser tab's settings concern over the shared state root, and what it sent its panel. */
const tabOver = Effect.fnUntraced(function* (
  stateRoot: string,
  changedElsewhere: Layer.Layer<never> | Layer.Layer<SettingsChangedElsewhere>,
) {
  const sent = yield* Queue.unbounded<{ kind: GatewayEventKind; payload: WireValue }>();

  const machine = Layer.mergeAll(
    Layer.succeed(
      HostKernelTag,
      hostKernelOver({
        stateRoot,
        // A run that sends nothing, so no count leaves for the service.
        runMode: runModeFor({ capture: false, fixture: true }),
        accountBaseUrl: `${SERVICE_BASE_URL}/api/auth`,
        now: () => 0,
        createId: () => "id",
        report: () => undefined,
        emit: (kind, payload) => {
          Queue.offerUnsafe(sent, { kind, payload });
        },
      }),
    ),
    Layer.succeed(Environment, ConfigProvider.fromEnvRecord({})),
    Layer.succeed(AppIdentity, {
      appVersion: "1.0.0",
      packaged: false,
      platform: PRODUCT_PLATFORM.DESKTOP,
    }),
    fixedAccountSource(),
    changedElsewhere,
    NodeFileSystem.layer,
    NodePath.layer,
  );

  const settings = yield* Effect.provide(composeSettings(), machine);
  yield* settings.link({
    credential: NO_CREDENTIAL,
    readAccountKey: () => Effect.succeed(undefined),
    confirmAccount: () => Effect.void,
  });
  yield* settings.lifetime;

  return { settings, sent };
});

/** A writing tab, and a reading tab whose shell says the file changed each time `signal` is offered. */
const twoTabs = Effect.fnUntraced(function* () {
  const stateRoot = yield* temporaryDirectoryScoped("settings-elsewhere-");
  const signal = yield* Queue.unbounded<void>();
  const writer = yield* tabOver(stateRoot, Layer.empty);

  const reader = yield* tabOver(
    stateRoot,
    Layer.succeed(SettingsChangedElsewhere, Stream.fromQueue(signal)),
  );

  return { writer, reader, signal };
});

it.effect(
  "another tab's settings write reaches this tab's panel when the shell says the file changed",
  () =>
    Effect.gen(function* () {
      const { writer, reader, signal } = yield* twoTabs();
      // The reader has read the file before the writer changes it.
      assert.equal((yield* reader.settings.store.snapshot()).stored.theme, undefined);

      yield* writer.settings.store.set("theme", THEME.DARK);
      Queue.offerUnsafe(signal, undefined);

      const event = yield* Queue.take(reader.sent);
      assert.equal(event.kind, GATEWAY_EVENT.SETTINGS_CHANGED);
      const { payload } = event;

      const sentTheme =
        isRecord(payload) && isRecord(payload.settings) && isRecord(payload.settings.stored)
          ? payload.settings.stored.theme
          : undefined;

      assert.equal(sentTheme, THEME.DARK);
      assert.equal((yield* reader.settings.store.snapshot()).stored.theme, THEME.DARK);
    }).pipe(
      Effect.provideService(FetchHttpClient.Fetch, async () => new Response(null, { status: 204 })),
      Effect.provide([NodeFileSystem.layer, NodePath.layer]),
    ),
);

/** The address every sync of this file's account reads and writes, as the session names it. */
const SYNCED_ACCOUNT = "ada@app.test";

it.effect(
  "a diff choice made after the first sync's write failed is still written, though an earlier build's baseline read it as unchanged",
  () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped("settings-first-sync-");
      // A Mac on Split with wrap off, its baseline kept by a build before the diff display joined the account.
      yield* Effect.promise(() =>
        fs.writeFile(
          path.join(stateRoot, "settings.json"),
          JSON.stringify({
            version: 2,
            diffLayout: DIFF_LAYOUT.SPLIT,
            wordWrap: false,
            accountPreferencesSync: { accountEmail: SYNCED_ACCOUNT, preferences: {} },
          }),
        ),
      );

      const writes = yield* Queue.unbounded<string>();
      let written = 0;

      // The account already holds Unified from another device; the first write fails, and every one after lands.
      const service: typeof globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);

        if (request.url !== `${SERVICE_BASE_URL}${HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES}`) {
          return new Response(null, { status: 204 });
        }

        const json = (body: WireValue, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          });

        if (request.method === "GET") {
          return json({ preferences: {}, diffLayout: DIFF_LAYOUT.UNIFIED });
        }

        const body = await request.text();
        Queue.offerUnsafe(writes, body);
        written += 1;

        return written === 1
          ? json({ error: "unavailable" }, 503)
          : json({ preferences: {}, ...JSON.parse(body) });
      };

      const machine = Layer.mergeAll(
        Layer.succeed(
          HostKernelTag,
          hostKernelOver({
            stateRoot,
            runMode: runModeFor({ capture: false, fixture: true }),
            accountBaseUrl: `${SERVICE_BASE_URL}/api/auth`,
            now: () => 0,
            createId: () => "id",
            report: () => undefined,
            emit: () => undefined,
          }),
        ),
        Layer.succeed(Environment, ConfigProvider.fromEnvRecord({})),
        Layer.succeed(AppIdentity, {
          appVersion: "1.0.0",
          packaged: false,
          platform: PRODUCT_PLATFORM.DESKTOP,
        }),
        fixedAccountSource(),
        NodeFileSystem.layer,
        NodePath.layer,
      );

      const settings = yield* Effect.provide(composeSettings(), machine).pipe(
        Effect.provideService(FetchHttpClient.Fetch, service),
      );

      yield* settings.link({
        credential: NO_CREDENTIAL,
        readAccountKey: () => Effect.succeed(SYNCED_ACCOUNT),
        confirmAccount: () => Effect.void,
      });
      // Note that the syncs drain on the lifetime's fiber, so it is handed the service they reach.
      yield* Effect.provideService(settings.lifetime, FetchHttpClient.Fetch, service);

      yield* settings.reconcileAccountPreferences();
      yield* Queue.take(writes);
      // The first sync took the account's Unified; the member picks Split again.
      yield* Effect.orDie(
        settings.acts.SETTING_UPDATE({ field: "diffLayout", value: DIFF_LAYOUT.SPLIT }),
      );
      const pushed = yield* Queue.take(writes);

      assert.equal(JSON.parse(pushed).diffLayout, DIFF_LAYOUT.SPLIT);
    }).pipe(
      Effect.provideService(FetchHttpClient.Fetch, async () => new Response(null, { status: 204 })),
      Effect.provide([NodeFileSystem.layer, NodePath.layer]),
    ),
);
