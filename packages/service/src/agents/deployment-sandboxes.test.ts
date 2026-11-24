import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { SANDBOX_STATUS, Sandbox } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { Effect, Exit } from "effect";
import { deploymentSandboxLayer } from "./deployment-sandboxes.js";

/**
 * A Preview's sandboxes beside production's in one provider, as Vercel keeps
 * both deployments' in one project: a Preview whose copied store names the
 * sandbox production's runner is at work in never finds it, touches it,
 * writes its firewall, or stops it, and what the Preview opens under the same
 * name is a sandbox of its own, which production's list never finds.
 * Synthetic names and hosts throughout.
 */

const NAME = "agent-sandbox-fixture";
const SESSION_TAG = "session";
const SESSION = "claude-code-fixture";

const PREVIEW = {
  VERCEL_ENV: "preview",
  DATABASE_URL: "postgres://user:secret@ep-branch-fixture.example.test/db",
};

it.effect("a Preview never reaches the sandbox production opened under the same name", () =>
  Effect.gen(function* () {
    const provider = memorySandbox();

    const production = provider.stand({
      name: NAME,
      status: SANDBOX_STATUS.RUNNING,
      tags: { [SESSION_TAG]: SESSION },
    });

    const preview = yield* Effect.provide(Sandbox, deploymentSandboxLayer(provider.layer, PREVIEW));

    assert.equal(yield* preview.get(NAME), undefined);
    assert.deepEqual(yield* preview.listTagged(SESSION_TAG, SESSION), []);

    yield* preview.touch(NAME);

    const policy = yield* Effect.exit(
      preview.updateNetworkPolicy({ name: NAME, running: production.running }, { hosts: {} }),
    );

    yield* Effect.ignore(preview.stop(NAME));

    assert.ok(Exit.isFailure(policy));
    assert.deepEqual(provider.state.touched, []);
    assert.deepEqual(provider.state.policies, []);
    assert.deepEqual(provider.state.stopped, []);
    assert.equal(production.status, SANDBOX_STATUS.RUNNING);

    const opened = yield* preview.getOrCreate({
      name: NAME,
      from: { image: "fixture-image" },
      tags: { [SESSION_TAG]: SESSION },
      env: {},
    });

    assert.equal(opened.name, NAME);
    assert.notEqual(opened.running, production.running);
    assert.deepEqual(
      (yield* preview.listTagged(SESSION_TAG, SESSION)).map((each) => each.running),
      [opened.running],
    );
    assert.deepEqual(
      (yield* provider.service.listTagged(SESSION_TAG, SESSION)).map((each) => each.running),
      [production.running],
    );
  }),
);
