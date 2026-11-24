import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { AUTH_SESSION_END } from "@repo/credentials";
import { ACCOUNT_PROVIDER, ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { AGENT_ATTACHMENT_TYPE, QUEUE_CHANGE } from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { READ_MARK } from "@repo/features/read-mark";
import { TASKS_READ } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { OWN_TRANSCRIPT, RUN_PROFILE, type RunProfile } from "@repo/host/app-state";
import { inboxGroupsIn, selectExperiment, selectInboxHoldings } from "@repo/host/app-state-reads";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { EXPERIMENT, THEME } from "@repo/settings";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { QueryClient } from "@tanstack/react-query";
import { Context, Effect, Layer } from "effect";
import { expect, vi } from "vitest";
import { followAppStateInto } from "./app-state-query.js";
import { composeMobile, type DeviceSeams, MobileHostTag } from "./compose-mobile.js";
import { STUB_ACCOUNT, stubAuthFetch, stubAuthSession } from "./stub-auth-server.js";

/**
 * compose-mobile.test.ts -- the shared host as the Expo app composes it,
 * over seams a test answers on Node: a fixture run's document lists the
 * Inbox profile's threads, which the Inbox draws, with the Skills
 * experiment on that its composers' `/` offers stand behind, and an act the screens
 * send rides the in-process channel to the host and back, its settings
 * kept in the host's folder for the next launch.
 */

/** A thread the Inbox profile stages, by its title (`@repo/host/fixture-inbox`). */
const STAGED_THREAD = "Who can withdraw an invite?";

/** The question the Inbox profile's Manager stages, which stands on no task. */
const MANAGER_THREAD = "Cut the release?";

/** A notice the Inbox profile stages, which asks nothing, so a reply to it answers no ask. */
const NOTICE = "acceptInvite can add a member twice";

/** A picture's bytes as a reply carries them: a PNG's signature alone, which no reader here draws. */
const PICTURE = "iVBORw0KGgo=";

/** The device as a test answers it: Node's files, no address opened, no socket reached, the app always in front, a Keychain that keeps no tokens, a sign-in sheet closed at once, and no share token kept. */
const testDevice: DeviceSeams = {
  fileSystem: NodeFileSystem.layer,
  createId: () => crypto.randomUUID(),
  openExternal: () => Promise.resolve(),
  openSheet: () => Promise.resolve(),
  openSocket: () => Effect.succeed({ unreachable: true }),
  onAppActiveChanged: () => () => undefined,
  tokenVault: { read: Effect.succeed(undefined), write: () => Effect.void, clear: Effect.void },
  authSession: {
    open: () => Promise.resolve({ end: AUTH_SESSION_END.CLOSED }),
    dismiss: () => undefined,
  },
  keepShareToken: () => true,
};

/** The device a flow signs in on against the stubbed account service: its sheet granting at once. */
const stubDevice: DeviceSeams = { ...testDevice, authSession: stubAuthSession };

/**
 * The document's version once the host has had many turns to stage the
 * fixture again. Note that each change the store announces stages the
 * fixture again, so a stage that always hands the store something new never
 * lets the version stand.
 */
const settledVersion = (bridge: {
  readonly requestAppState: () => Promise<{ readonly version: number }>;
}) =>
  Effect.gen(function* () {
    yield* Effect.forEach(Array.from({ length: 50 }), () => Effect.yieldNow, { discard: true });

    return (yield* Effect.promise(() => bridge.requestAppState())).version;
  });

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

/** Every holder of Inbox items in the host's document, grouped over the task list as a screen's collections follow it, once its first read is written. */
const inboxGroupsOver = (bridge: Parameters<typeof followAppStateInto>[0]) =>
  Effect.gen(function* () {
    const following = yield* Effect.acquireRelease(
      Effect.sync(() => followAppStateInto(bridge, new QueryClient())),
      (followed) => Effect.sync(() => followed.stop()),
    );

    yield* Effect.promise(() => following.written);
    const state = following.held();
    expect(state).toBeDefined();

    return state === undefined
      ? []
      : inboxGroupsIn(
          selectInboxHoldings(state),
          following.taskList.tasks.toArray,
          undefined,
          following.taskList.agents.toArray,
        );
  });

/** A folder of this test's own for the host's files, gone with the scope. */
const ownFolder = Effect.provide(temporaryDirectoryScoped("mobile-host-"), NodeFileSystem.layer);

it.effect(
  "a fixture run's document lists the Inbox profile's threads, signed in as its account with Skills on and its task list read",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* ownFolder;
        const { bridge } = yield* standingHost(root, RUN_PROFILE.INBOX);

        const state = yield* Effect.promise(() => bridge.requestAppState());

        expect(state.account.status).toBe(ACCOUNT_STATUS.SIGNED_IN);

        const titles = (yield* inboxGroupsOver(bridge)).flatMap(({ items }) =>
          items.map(({ title }) => title),
        );

        expect(titles).toContain(STAGED_THREAD);
        expect(titles).toContain(MANAGER_THREAD);
        // Note that a `/` in any of the app's composers offers skills only while the account has Skills on (`use-skill-offer.ts`).
        expect(selectExperiment(EXPERIMENT.SKILLS)(state)).toBe(true);
        // Note that Search says nothing matched only once the task list stands read (`use-search.ts`), so a staged list that stood unread kept a miss reading for good.
        expect(state.tasks.listStatus).toBe(TASKS_READ.READY);
      }),
    ),
);

it.effect(
  "a fixture run on the large Inbox lists as many threads as a busy real account, so a timing run measures that size",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* ownFolder;
        const { bridge } = yield* standingHost(root, RUN_PROFILE.INBOX_LARGE);

        const threads = (yield* inboxGroupsOver(bridge)).flatMap(({ items }) => items);

        expect(threads.length).toBeGreaterThan(600);
      }),
    ),
);

it.effect(
  "a fixture run settles once a task is marked read, rather than staging its list again forever",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* ownFolder;
        const { acts, bridge } = yield* standingHost(root, RUN_PROFILE.INBOX);

        const following = yield* Effect.acquireRelease(
          Effect.sync(() => followAppStateInto(bridge, new QueryClient())),
          (followed) => Effect.sync(() => followed.stop()),
        );

        yield* Effect.promise(() => following.written);

        const task = following.taskList.tasks.toArray.find(
          ({ name }) => name === "Weekly digest email",
        );

        expect(task).toBeDefined();

        yield* Effect.promise(() =>
          acts[ACT_KIND.TASKS_MARK_READ]({ taskId: task?.id ?? "", readMark: READ_MARK.READ }),
        );

        const first = yield* settledVersion(bridge);
        const second = yield* settledVersion(bridge);

        expect(second).toBe(first);
      }),
    ),
);

it.effect(
  "a fixture run moves its agent's queued messages as a reorder asks, and settles once it has",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* ownFolder;
        const { acts, bridge } = yield* standingHost(root, RUN_PROFILE.INBOX);

        const queued = (state: Awaited<ReturnType<typeof bridge.requestAppState>>) =>
          Object.entries(state[LIVE_READ.TRANSCRIPT]).flatMap(([agentId, held]) => {
            const queue = held?.[OWN_TRANSCRIPT]?.rows?.word?.queue;

            return queue === undefined
              ? []
              : [{ agentId, ids: queue.messages.map(({ id }) => id) }];
          });

        const [staged] = queued(yield* Effect.promise(() => bridge.requestAppState()));
        const [firstId, secondId] = staged?.ids ?? [];

        expect(staged?.ids).toHaveLength(2);

        yield* Effect.promise(() =>
          acts[ACT_KIND.AGENTS_QUEUE]({
            agentId: staged?.agentId ?? "",
            change: { change: QUEUE_CHANGE.REORDER, order: [secondId ?? "", firstId ?? ""] },
          }),
        );

        const first = yield* settledVersion(bridge);
        const second = yield* settledVersion(bridge);
        const [moved] = queued(yield* Effect.promise(() => bridge.requestAppState()));

        expect(moved?.ids).toEqual([secondId, firstId]);
        expect(second).toBe(first);
      }),
    ),
);

it.effect(
  "a fixture run's thread carries back a reply's picture, which reads back by its attachment",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* ownFolder;
        const { acts, bridge } = yield* standingHost(root, RUN_PROFILE.INBOX);
        const groups = yield* inboxGroupsOver(bridge);
        const notice = groups.flatMap(({ items }) => items).find(({ title }) => title === NOTICE);

        expect(notice).toBeDefined();
        const itemId = notice?.id ?? "";
        const clientKey = crypto.randomUUID();

        yield* Effect.promise(() =>
          acts[ACT_KIND.AGENTS_INBOX_MESSAGE]({
            itemId,
            text: "",
            attachments: [
              { name: "Picture 1", mediaType: AGENT_ATTACHMENT_TYPE.PNG, data: PICTURE },
            ],
            clientKey,
          }),
        );

        yield* settledVersion(bridge);

        const read = (yield* inboxGroupsOver(bridge))
          .flatMap(({ items }) => items)
          .find(({ id }) => id === itemId);

        const reply = read?.thread?.find((message) => message.clientKey === clientKey);
        const [file] = reply?.files ?? [];

        expect(file?.name).toBe("Picture 1");

        const bytes = yield* Effect.promise(() =>
          acts[ACT_KIND.AGENTS_INBOX_ATTACHMENT]({
            itemId,
            attachmentId: file?.attachmentId ?? "",
          }),
        );

        expect(bytes).toEqual({ contentType: AGENT_ATTACHMENT_TYPE.PNG, base64: PICTURE });
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
  "signs in against the stubbed account service as the ios client, keeps its tokens in the Keychain's vault, stands signed in at the next launch, and signs out revoking its token and the share sheet's",
  () => {
    // Each token the share sheet was handed, none standing for its removal.
    const shared: (string | undefined)[] = [];
    // The tokens' text the Keychain keeps, as `keychain-tokens.ts` keeps it.
    let vaulted: string | undefined;

    const device: DeviceSeams = {
      ...stubDevice,
      keepShareToken: (kept) => {
        shared.push(kept?.token);

        return true;
      },
      tokenVault: {
        read: Effect.sync(() => vaulted),
        write: (tokens) =>
          Effect.sync(() => {
            vaulted = tokens;
          }),
        clear: Effect.sync(() => {
          vaulted = undefined;
        }),
      },
    };

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
            const { acts } = yield* standingHost(root, undefined, device);

            return yield* Effect.promise(() =>
              acts[ACT_KIND.ACCOUNT_BEGIN_SIGN_IN]({ provider: ACCOUNT_PROVIDER.GITHUB }),
            );
          }),
        );

        expect(answer).toMatchObject({
          account: { status: ACCOUNT_STATUS.SIGNED_IN, email: STUB_ACCOUNT.email },
        });

        expect(vaulted).toContain("stub-access");

        const { acts, bridge } = yield* standingHost(root, undefined, device);
        const relaunched = yield* Effect.promise(() => bridge.requestAppState());
        expect(relaunched.account.status).toBe(ACCOUNT_STATUS.SIGNED_IN);

        const signedOut = yield* Effect.promise(() => acts[ACT_KIND.ACCOUNT_SIGN_OUT]());
        expect(signedOut.status).toBe(ACCOUNT_STATUS.SIGNED_OUT);
        expect(vaulted).toBeUndefined();
        expect(posted).toEqual([
          ["token", "ios"],
          ["revoke", "ios"],
        ]);
        // The share sheet held the access token while signed in, never the refresh token, and holds nothing once signed out.
        expect(shared).toContain("stub-access");
        expect(shared).not.toContain("stub-refresh");
        expect(shared.at(-1)).toBeUndefined();
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => vi.restoreAllMocks())));
  },
);
