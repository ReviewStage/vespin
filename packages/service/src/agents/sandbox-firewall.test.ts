import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { readFirewallLaunch } from "@repo/database/models/sandbox-firewall-store";
import { createTask } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openTaskAgent, openWorkspace } from "@repo/database/testing";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { memorySandbox } from "@repo/sandbox/testing";
import { Effect, Redacted } from "effect";
import { LOCAL_AGENT_ENVIRONMENT } from "../testing/local-agent.js";
import {
  composePolicy,
  LAUNCH_SWAP,
  placeholderSwap,
  sandboxFirewall,
} from "./sandbox-firewall.js";

/**
 * A sandbox session's firewall as the service writes it, over Vercel's
 * network-policy write answering from a script and a database of the
 * test's own: each write carries what its writer names beside the swaps the
 * session's launch keeps, the kept launch holds no value in the clear, and a
 * placeholder swap matches its header at the placeholder.
 * Synthetic accounts, sessions, agents, and tokens throughout.
 */

const REPOSITORY = "Acme/Relay";
const WRITE_TOKEN = "ghs_write_fixture";
const READ_TOKEN = "ghs_read_fixture";
const BEARER = "Bearer runner-bearer-fixture";
const APP = { kind: GITHUB_ACCESS.APP } as const;
const SERVICE_HOST = "app.service.test";

/** Git's Basic credentials for an installation token, as GitHub takes them. */
const basic = (token: string) =>
  `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;

/** The runner's bearer swapped in on our host for the placeholder its launch holds. */
const BEARER_RULE = {
  headers: { authorization: "Bearer runner-placeholder-fixture" },
  set: { authorization: BEARER },
};

/** The write token on GitHub's two hosts. */
const WRITE_RULE = { set: { authorization: basic(WRITE_TOKEN) } };

/** The clone's read token on the repository's git endpoint alone. */
const CLONE_RULE = {
  path: { startsWith: `/${REPOSITORY}.git/` },
  set: { authorization: basic(READ_TOKEN) },
};

const write = { token: Redacted.make(WRITE_TOKEN), fullName: REPOSITORY, access: APP };
const read = { token: Redacted.make(READ_TOKEN), fullName: REPOSITORY, access: APP };

/** A swap on the host given, its placeholder and value as named. */
const swapOf = (domain: string, placeholder: string, value: string) =>
  placeholderSwap({
    domain,
    header: "authorization",
    placeholder: Redacted.make(placeholder),
    value: Redacted.make(value),
  });

/** A launch of the agent given holding the runner's bearer alone. */
const bearerLaunch = (agentId: string) => ({
  agentId,
  swaps: new Map([
    [LAUNCH_SWAP.RUNNER, swapOf(SERVICE_HOST, "Bearer runner-placeholder-fixture", BEARER)],
  ]),
});

/** A sandbox session of its own, in a sandbox of its own, of an agent of an account of its own. */
const ownSession = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );
  const organizationId = yield* openWorkspace(userId);
  const task = yield* createTask(userId, { organizationId });
  const agentId = yield* openTaskAgent(userId, organizationId, task.id);

  return {
    userId,
    agentId,
    name: `sandbox-${randomUUID()}`,
    sandboxSessionId: `sbs_${randomUUID()}`,
  };
});

/** The sandbox as the scenario has it: the session's sandbox up in its run, each policy kept as it lands, in that order. */
function standing(session: Effect.Success<typeof ownSession>) {
  const sandbox = memorySandbox();
  sandbox.stand({ name: session.name, running: session.sandboxSessionId });

  return {
    firewall: sandboxFirewall(sandbox.service),
    policies: () => sandbox.state.policies.map((each) => each.policy),
  };
}

it.layer(getTestDB())("a sandbox session's firewall", (it) => {
  it.effect(
    "each write carries what its writer names beside the launch's swaps, and the kept launch holds no value in the clear",
    () =>
      Effect.gen(function* () {
        const session = yield* ownSession;
        const { firewall, policies } = standing(session);

        const kept = yield* Effect.gen(function* () {
          yield* firewall.keepLaunch(session, bearerLaunch(session.agentId));
          yield* firewall.write(session, { github: write });
          yield* firewall.write(session, { github: write, clone: read });

          return yield* readFirewallLaunch(session);
        }).pipe(Effect.provide(LOCAL_AGENT_ENVIRONMENT));

        assert.deepEqual(policies(), [
          {
            hosts: {
              "github.com": [WRITE_RULE],
              "api.github.com": [WRITE_RULE],
              [SERVICE_HOST]: [BEARER_RULE],
            },
          },
          {
            hosts: {
              "github.com": [WRITE_RULE, CLONE_RULE],
              "api.github.com": [WRITE_RULE],
              [SERVICE_HOST]: [BEARER_RULE],
            },
          },
        ]);
        assert.ok(kept !== undefined);
        assert.equal(kept.agentId, session.agentId);

        for (const value of [BEARER, "runner-placeholder-fixture"]) {
          assert.equal(kept.sealedEntries.includes(value), false);
        }
      }),
  );
});

it("a placeholder swap is a rule on its domain matching its header at the placeholder, which sets the real value", () => {
  const swap = placeholderSwap({
    domain: "api.provider.test",
    header: "x-api-key",
    placeholder: Redacted.make("placeholder-fixture"),
    value: Redacted.make("secret-fixture"),
  });

  assert.deepEqual(composePolicy({}, new Map([[LAUNCH_SWAP.CLAUDE, swap]])), {
    hosts: {
      "api.provider.test": [
        { headers: { "x-api-key": "placeholder-fixture" }, set: { "x-api-key": "secret-fixture" } },
      ],
    },
  });
});

it("a batch's clones each carry their own read token, on their own repository's git endpoint alone", () => {
  const other = { token: Redacted.make("ghs_other_fixture"), fullName: "Acme/Ledger", access: APP };

  assert.deepEqual(composePolicy({ clones: [read, other] }, new Map()), {
    hosts: {
      "github.com": [
        CLONE_RULE,
        {
          path: { startsWith: "/Acme/Ledger.git/" },
          set: { authorization: basic("ghs_other_fixture") },
        },
      ],
    },
  });
});
