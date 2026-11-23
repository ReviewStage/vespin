// member.ts -- the suite's `test`, whose `member` fixture gives each test a fresh account of its own in the suite's database, with its personal workspace and, where the test asks, a task and a model credential.

import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { sqlClientOverUrl } from "@repo/database/core/sql-client";
import { PROVIDER_KEY_KIND } from "@repo/features/provider-key-wire";
import { demoDatabaseUrl } from "@repo/service/demo/demo-database";
import { type DemoMemberSeeded, seedDemoMember } from "@repo/service/demo/demo-member";
import { demoAuth } from "@repo/service/demo/demo-seed";
import { drizzle } from "drizzle-orm/node-postgres";
import { Effect, Redacted, Result } from "effect";
import { Pool } from "pg";
import { DATABASE_URL_PATH, RUN_SECRETS } from "./run-secrets.js";
import { test as base } from "./test.js";

/** What a test asks of its member's world, through `test.use({ memberAsk })`; an account and its workspace alone by default. */
interface MemberAsk {
  /** The name of a task to make in the member's workspace, assigned to them. */
  readonly taskName?: string;
  /** Whether to save a placeholder API key as the member's, so a Start of an agent is not refused for want of one. */
  readonly credential?: boolean;
}

/**
 * A placeholder Anthropic API key, sealed under the run's ring: random, made
 * per member, shaped like no provider's credential, and good for nothing
 * but passing a Start's check that one is saved. It never reaches Anthropic,
 * since the suite's server runs its agents on a scripted session.
 */
function placeholderCredential() {
  return {
    kind: PROVIDER_KEY_KIND.API_KEY,
    key: Redacted.make(`journey-placeholder-${randomBytes(16).toString("hex")}`),
    ring: Redacted.make(RUN_SECRETS.PROVIDER_KEY_ENCRYPTION_KEYS),
  };
}

/** The suite's database, read from the file its Postgres wrote, and refused unless it is on loopback. */
function suiteDatabaseUrl(): string {
  const url = demoDatabaseUrl(readFileSync(DATABASE_URL_PATH, "utf8").trim());

  if (Result.isFailure(url)) throw new Error(`The suite's database is refused (${url.failure})`);

  return url.success;
}

/**
 * A fresh member seeded into the suite's database, every id new. Note that
 * Better Auth writes through a pool of its own, as the deployment's does,
 * ended with the seed.
 */
function seedMember(ask: MemberAsk): Promise<DemoMemberSeeded> {
  const url = suiteDatabaseUrl();

  const seeded = Effect.gen(function* () {
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() => new Pool({ connectionString: url })),
      (opened) => Effect.promise(() => opened.end()),
    );

    const auth = demoAuth(drizzle({ client: pool }), () => randomUUID());

    return yield* seedDemoMember(auth, {
      ...(ask.taskName === undefined ? undefined : { taskName: ask.taskName }),
      ...(ask.credential === true ? { credential: placeholderCredential() } : undefined),
    }).pipe(Effect.provide(sqlClientOverUrl(url)));
  });

  return Effect.runPromise(Effect.scoped(seeded));
}

/**
 * The suite's `test` (`test.ts`, its browser held to loopback) with a
 * member of each test's own: `memberAsk`, an option a
 * file or a describe sets with `test.use`, and `member`, seeded fresh for
 * each test that names it, so no two tests share an account, a workspace,
 * or a task. Nothing is deleted after: the database is the run's alone and
 * is thrown away with it.
 */
export const test = base.extend<{ memberAsk: MemberAsk; member: DemoMemberSeeded }>({
  memberAsk: [{}, { option: true }],
  member: async ({ memberAsk }, use) => {
    await use(await seedMember(memberAsk));
  },
});

export { expect } from "./test.js";
