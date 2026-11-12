import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS, jsonResponse, recordingHttpClient } from "@repo/wire/testing";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { accountBearer } from "./account-call.js";
import { HOSTED_API_ERROR } from "./service-wire.js";
import { WORKSPACE_CALL_FAILURE } from "./workspace-call.js";
import { HostedWorkspaceClient } from "./workspace-client.js";
import { WORKSPACE_PHOTO_BOUNDS, WORKSPACE_PHOTO_TYPE, WORKSPACE_ROLE } from "./workspace-wire.js";

const PERSONAL = {
  id: "org-personal-1",
  name: "Ada Lovelace",
  slug: "ada-lovelace",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

const ACME = {
  id: "org-acme-1",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme", active: false },
};

const INSTALL_URL = "https://github.com/apps/luke/installations/new?state=opaque-intent";

/** The client over an account holding OAuth token `token-1`. */
function client(): HostedWorkspaceClient {
  const token = {
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    readAccountKey: () => Effect.succeed("ada@example.com"),
  };

  return new HostedWorkspaceClient({
    serviceBaseUrl: "https://vespin.dev",
    credential: accountBearer(token),
  });
}

/** A service that refuses the request with the word given. */
function refusing(route: string, error: string, status: number) {
  return fakeCloudApi({ [route]: { answer: () => ({ error }), status } });
}

it.effect("creates a workspace with its name trimmed, and a blank name never travels", () =>
  Effect.gen(function* () {
    const created = { ...ACME, role: WORKSPACE_ROLE.OWNER, github: null };

    const api = fakeCloudApi({
      "POST /api/workspaces": { answer: () => ({ workspace: created }), status: 201 },
    });

    const answered = yield* Effect.provide(client().create("  Acme  "), api.layer);
    const blank = yield* Effect.provide(client().create("   "), api.layer);

    assert.deepEqual(answered, { ok: true, answer: created });
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), { name: "Acme" });
    assert.deepEqual(blank, { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
    assert.equal(api.requests().length, 1);
  }),
);

it.effect("connects GitHub by answering the install address, and names each refusal", () =>
  Effect.gen(function* () {
    const route = "POST /api/workspaces/github/connect";
    const api = fakeCloudApi({ [route]: { answer: () => ({ url: INSTALL_URL }) } });

    const connected = yield* Effect.provide(client().githubConnect(ACME.id), api.layer);

    const member = yield* Effect.provide(
      client().githubConnect(ACME.id),
      refusing(route, HOSTED_API_ERROR.NOT_PERMITTED, 403).layer,
    );

    const stranger = yield* Effect.provide(
      client().githubConnect(ACME.id),
      refusing(route, HOSTED_API_ERROR.NOT_FOUND, HTTP_STATUS.NOT_FOUND).layer,
    );

    const down = yield* Effect.provide(
      client().githubConnect(ACME.id),
      refusing(route, HOSTED_API_ERROR.UNAVAILABLE, HTTP_STATUS.SERVER_ERROR).layer,
    );

    assert.deepEqual(connected, { ok: true, answer: INSTALL_URL });
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), { workspaceId: ACME.id });
    assert.deepEqual(member, { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
    assert.deepEqual(stranger, { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_FOUND });
    assert.deepEqual(down, { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
  }),
);

it.effect("disconnects GitHub, answering the workspace with no GitHub account", () =>
  Effect.gen(function* () {
    const disconnected = { ...ACME, github: null };

    const api = fakeCloudApi({
      "POST /api/workspaces/github/disconnect": { answer: () => ({ workspace: disconnected }) },
    });

    const answered = yield* Effect.provide(client().githubDisconnect(ACME.id), api.layer);

    assert.deepEqual(answered, { ok: true, answer: disconnected });
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), { workspaceId: ACME.id });
  }),
);

const ADA = { userId: "user-ada", name: "Ada Lovelace", email: "ada@app.test", role: "owner" };

const GRACE = {
  userId: "user-grace",
  name: "Grace Hopper",
  email: "grace@app.test",
  role: "member",
};

it.effect(
  "removes a member and leaves a workspace, answered with those who remain and the workspace left",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/workspaces/members/remove": { answer: () => ({ members: [ADA] }) },
        "POST /api/workspaces/leave": { answer: () => ({ workspaceId: ACME.id }) },
      });

      const workspaces = client();

      const remaining = yield* Effect.provide(
        workspaces.removeMember(ACME.id, GRACE.userId),
        api.layer,
      );

      const left = yield* Effect.provide(workspaces.leave(ACME.id), api.layer);

      assert.deepEqual(remaining, { ok: true, answer: [ADA] });
      assert.deepEqual(left, { ok: true, answer: ACME.id });
      // Both carry the account's OAuth token, as every workspace call does.
      assert.deepEqual(api.credentials(), ["token-1", "token-1"]);
      assert.deepEqual(
        api.requests().map(({ method, pathname, body }) => ({
          route: `${method} ${pathname}`,
          body: body === undefined ? undefined : JSON.parse(body),
        })),
        [
          {
            route: "POST /api/workspaces/members/remove",
            body: { workspaceId: ACME.id, userId: GRACE.userId },
          },
          { route: "POST /api/workspaces/leave", body: { workspaceId: ACME.id } },
        ],
      );
    }),
);

it.effect(
  "changes a member's role and hands the workspace over, answered with the members, sends an owner's role nowhere, and names a refusal",
  () =>
    Effect.gen(function* () {
      const promoted = { ...GRACE, role: "admin" };

      const handedOver = [
        { ...GRACE, role: "owner" },
        { ...ADA, role: "admin" },
      ];

      const api = fakeCloudApi({
        "POST /api/workspaces/members/role": { answer: () => ({ members: [ADA, promoted] }) },
        "POST /api/workspaces/transfer": { answer: () => ({ members: handedOver }) },
      });

      const forbidden = {
        answer: () => ({ error: HOSTED_API_ERROR.NOT_PERMITTED }),
        status: HTTP_STATUS.FORBIDDEN,
      };

      const refusing = fakeCloudApi({
        "POST /api/workspaces/members/role": forbidden,
        "POST /api/workspaces/transfer": forbidden,
      });

      const workspaces = client();

      const changed = yield* Effect.provide(
        workspaces.changeRole(ACME.id, GRACE.userId, WORKSPACE_ROLE.ADMIN),
        api.layer,
      );

      const toOwner = yield* Effect.provide(
        workspaces.changeRole(ACME.id, GRACE.userId, WORKSPACE_ROLE.OWNER),
        api.layer,
      );

      const transferred = yield* Effect.provide(
        workspaces.transfer(ACME.id, GRACE.userId),
        api.layer,
      );

      const refused = yield* Effect.provide(
        Effect.all([
          workspaces.changeRole(ACME.id, GRACE.userId, WORKSPACE_ROLE.MEMBER),
          workspaces.transfer(ACME.id, GRACE.userId),
        ]),
        refusing.layer,
      );

      assert.deepEqual(changed, { ok: true, answer: [ADA, promoted] });
      assert.deepEqual(toOwner, { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(transferred, { ok: true, answer: handedOver });
      const notPermitted = { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED };
      assert.deepEqual(refused, [notPermitted, notPermitted]);
      // Both carry the account's OAuth token, as every workspace call does.
      assert.deepEqual(api.credentials(), ["token-1", "token-1"]);
      assert.deepEqual(
        api.requests().map(({ method, pathname, body }) => ({
          route: `${method} ${pathname}`,
          body: body === undefined ? undefined : JSON.parse(body),
        })),
        [
          {
            route: "POST /api/workspaces/members/role",
            body: { workspaceId: ACME.id, userId: GRACE.userId, role: WORKSPACE_ROLE.ADMIN },
          },
          {
            route: "POST /api/workspaces/transfer",
            body: { workspaceId: ACME.id, userId: GRACE.userId },
          },
        ],
      );
    }),
);

it.effect(
  "renames a workspace with its name trimmed, sends a blank name nowhere, and names a refusal",
  () =>
    Effect.gen(function* () {
      const renamed = { ...ACME, name: "Acme Labs" };

      const api = fakeCloudApi({
        "POST /api/workspaces/rename": { answer: () => ({ workspace: renamed }) },
      });

      const refusing = fakeCloudApi({
        "POST /api/workspaces/rename": {
          answer: () => ({ error: HOSTED_API_ERROR.NOT_PERMITTED }),
          status: HTTP_STATUS.FORBIDDEN,
        },
      });

      const workspaces = client();

      const answered = yield* Effect.provide(workspaces.rename(ACME.id, "  Acme Labs "), api.layer);
      const blank = yield* Effect.provide(workspaces.rename(ACME.id, "   "), api.layer);

      const refused = yield* Effect.provide(
        workspaces.rename(ACME.id, "Acme Labs"),
        refusing.layer,
      );

      assert.deepEqual(answered, { ok: true, answer: renamed });
      assert.deepEqual(blank, { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(refused, { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
      assert.deepEqual(api.credentials(), ["token-1"]);
      assert.deepEqual(
        api.requests().map(({ method, pathname, body }) => ({
          route: `${method} ${pathname}`,
          body: body === undefined ? undefined : JSON.parse(body),
        })),
        [
          {
            route: "POST /api/workspaces/rename",
            body: { workspaceId: ACME.id, name: "Acme Labs" },
          },
        ],
      );
    }),
);

it.effect(
  "sets a workspace's photo or removes it, sends an SVG or one past the bound nowhere, and names a refusal",
  () =>
    Effect.gen(function* () {
      const photo = "data:image/webp;base64,UklGRgAAAABXRUJQ";
      const photographed = { ...ACME, photoVersion: "0123456789abcdef" };

      const api = fakeCloudApi({
        "POST /api/workspaces/photo/set": {
          answer: (request) =>
            request.body?.includes(photo) ? { workspace: photographed } : { workspace: ACME },
        },
      });

      const refusing = fakeCloudApi({
        "POST /api/workspaces/photo/set": {
          answer: () => ({ error: HOSTED_API_ERROR.NOT_PERMITTED }),
          status: HTTP_STATUS.FORBIDDEN,
        },
      });

      const workspaces = client();
      const tooLarge = `data:image/png;base64,${btoa("x".repeat(WORKSPACE_PHOTO_BOUNDS.MAX_BYTES + 1))}`;

      const set = yield* Effect.provide(workspaces.setPhoto(ACME.id, photo), api.layer);
      const removed = yield* Effect.provide(workspaces.setPhoto(ACME.id, null), api.layer);

      const svg = yield* Effect.provide(
        workspaces.setPhoto(ACME.id, "data:image/svg+xml;base64,PHN2Zy8+"),
        api.layer,
      );

      const large = yield* Effect.provide(workspaces.setPhoto(ACME.id, tooLarge), api.layer);
      const refused = yield* Effect.provide(workspaces.setPhoto(ACME.id, null), refusing.layer);

      assert.deepEqual(set, { ok: true, answer: photographed });
      assert.deepEqual(removed, { ok: true, answer: ACME });
      assert.deepEqual(svg, { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(large, { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(refused, { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
      assert.deepEqual(api.credentials(), ["token-1", "token-1"]);
      assert.deepEqual(
        api.requests().map(({ method, pathname, body }) => ({
          route: `${method} ${pathname}`,
          body: body === undefined ? undefined : JSON.parse(body),
        })),
        [
          { route: "POST /api/workspaces/photo/set", body: { workspaceId: ACME.id, photo } },
          { route: "POST /api/workspaces/photo/set", body: { workspaceId: ACME.id, photo: null } },
        ],
      );
    }),
);

it.effect(
  "names a removal or a leave the service refused, and reads a malformed answer as none",
  () =>
    Effect.gen(function* () {
      const refusal = (error: string, status: number) => ({ answer: () => ({ error }), status });
      const forbidden = refusal(HOSTED_API_ERROR.NOT_PERMITTED, HTTP_STATUS.FORBIDDEN);

      const notPermitted = fakeCloudApi({
        "POST /api/workspaces/members/remove": forbidden,
        "POST /api/workspaces/leave": forbidden,
      });

      const missing = refusal(HOSTED_API_ERROR.NOT_FOUND, HTTP_STATUS.NOT_FOUND);

      const notFound = fakeCloudApi({
        "POST /api/workspaces/members/remove": missing,
        "POST /api/workspaces/leave": missing,
      });

      const elsewhere = fakeCloudApi({
        "POST /api/workspaces/members/remove": {
          answer: () => ({ members: [{ ...ADA, role: "guest" }] }),
        },
        "POST /api/workspaces/leave": { answer: () => ({ workspaceId: PERSONAL.id }) },
      });

      const workspaces = client();

      const both = (layer: typeof notPermitted.layer) =>
        Effect.provide(
          Effect.all([workspaces.removeMember(ACME.id, GRACE.userId), workspaces.leave(ACME.id)]),
          layer,
        );

      const refused = { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED };
      const outside = { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_FOUND };
      const unanswered = { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED };
      assert.deepEqual(yield* both(notPermitted.layer), [refused, refused]);
      assert.deepEqual(yield* both(notFound.layer), [outside, outside]);
      assert.deepEqual(yield* both(elsewhere.layer), [unanswered, unanswered]);
    }),
);

const INVITATION = {
  id: "inv-1",
  email: "alan@example.com",
  role: WORKSPACE_ROLE.MEMBER,
  expiresAt: "2026-10-16T12:00:00.000Z",
  acceptUrl: "https://vespin.dev/accept-invitation.html?id=inv-1&email=alan%40example.com",
};

it.effect("invites and cancels an invitation, every call", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "POST /api/workspaces/invitations": {
        answer: () => ({ invitation: INVITATION }),
        status: 201,
      },
      "POST /api/workspaces/invitations/cancel": { answer: () => ({ invitations: [] }) },
    });

    const workspaces = client();

    const made = yield* Effect.provide(
      workspaces.invite(ACME.id, " alan@example.com ", WORKSPACE_ROLE.MEMBER),
      api.layer,
    );

    const left = yield* Effect.provide(
      workspaces.cancelInvitation(ACME.id, INVITATION.id),
      api.layer,
    );

    assert.deepEqual(made, { ok: true, answer: INVITATION });
    assert.deepEqual(left, { ok: true, answer: [] });
    assert.deepEqual(api.credentials(), ["token-1", "token-1"]);
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), {
      workspaceId: ACME.id,
      email: "alan@example.com",
      role: WORKSPACE_ROLE.MEMBER,
    });
  }),
);

it.effect(
  "an address already in or invited is named, and an address or role the service would refuse never travels",
  () =>
    Effect.gen(function* () {
      const api = refusing(
        "POST /api/workspaces/invitations",
        HOSTED_API_ERROR.ALREADY_INVITED,
        HTTP_STATUS.CONFLICT,
      );

      const workspaces = client();

      const again = yield* Effect.provide(
        workspaces.invite(ACME.id, "alan@example.com", WORKSPACE_ROLE.MEMBER),
        api.layer,
      );

      const notAnAddress = yield* Effect.provide(
        workspaces.invite(ACME.id, "alan", WORKSPACE_ROLE.MEMBER),
        api.layer,
      );

      const asOwner = yield* Effect.provide(
        workspaces.invite(ACME.id, "alan@example.com", WORKSPACE_ROLE.OWNER),
        api.layer,
      );

      assert.deepEqual(again, { ok: false, failure: WORKSPACE_CALL_FAILURE.ALREADY_INVITED });
      assert.deepEqual(notAnAddress, { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(asOwner, { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
      assert.equal(api.requests().length, 1);
    }),
);

/** The photo of `org-acme-1` read against a service answering `response`, and the paths it asked. */
const photoAgainst = (response: () => Response) =>
  Effect.gen(function* () {
    const service = recordingHttpClient(response);
    const photo = yield* Effect.provide(client().photo(ACME.id), service.layer);

    return { photo, paths: service.requests.map((request) => request.pathname) };
  });

it.effect("reads a workspace's photo as its bytes in base64 under the type it was served as", () =>
  Effect.gen(function* () {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const { photo, paths } = yield* photoAgainst(
      () => new Response(png, { headers: { "content-type": WORKSPACE_PHOTO_TYPE.PNG } }),
    );

    assert.deepEqual(photo, {
      ok: true,
      answer: { contentType: WORKSPACE_PHOTO_TYPE.PNG, base64: "iVBORw0KGgo=" },
    });
    assert.deepEqual(paths, [`/api/workspaces/${ACME.id}/photo`]);
  }),
);

it.effect(
  "reads a photo the service did not find as not found, and one of another type as unanswered",
  () =>
    Effect.gen(function* () {
      const missing = yield* photoAgainst(() =>
        jsonResponse({ error: HOSTED_API_ERROR.NOT_FOUND }, HTTP_STATUS.NOT_FOUND),
      );

      const otherType = yield* photoAgainst(
        () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }),
      );

      assert.deepEqual(missing.photo, { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(otherType.photo, { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
    }),
);

it.effect("checks a Conductor key in its body, answering what Conductor saw or refused", () =>
  Effect.gen(function* () {
    const route = "POST /api/workspaces/conductor-import/check";
    const seen = { workspaces: 3, unreachedRepositories: ["acme/search"] };
    const api = fakeCloudApi({ [route]: { answer: () => seen } });

    const answered = yield* Effect.provide(
      client().checkConductorImport(ACME.id, "cdk_live_key"),
      api.layer,
    );

    const refused = yield* Effect.provide(
      client().checkConductorImport(ACME.id, "cdk_bad_key"),
      fakeCloudApi({ [route]: { answer: () => ({ refused: "bad-key" }) } }).layer,
    );

    assert.deepEqual(answered, { ok: true, answer: seen });
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), {
      workspaceId: ACME.id,
      apiKey: "cdk_live_key",
    });
    assert.deepEqual(refused, { ok: true, answer: { refused: "bad-key" } });
  }),
);

it.effect(
  "a Conductor key's check outlasts the usual deadline, since it lists every workspace the key sees and asks GitHub of each repository",
  () =>
    Effect.gen(function* () {
      const seen = { workspaces: 170, unreachedRepositories: [] };
      let answer: (response: Response) => void = () => undefined;

      const slow = recordingHttpClient(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      );

      const asked = yield* Effect.forkChild(
        Effect.provide(client().checkConductorImport(ACME.id, "cdk_live_key"), slow.layer),
      );

      yield* TestClock.adjust("30 seconds");
      answer(jsonResponse(seen));

      assert.deepEqual(yield* Fiber.join(asked), { ok: true, answer: seen });
    }),
);
