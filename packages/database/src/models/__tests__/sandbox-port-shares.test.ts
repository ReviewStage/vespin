import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { getTestDB } from "../../testing/index.js";
import { forgetPortShare, listPortShares, recordPortShare } from "../sandbox-port-shares.js";

/**
 * The shared ports the sweep lists, over a real dialect: a session keeps one
 * share, which a share of another port replaces and a close forgets. Every
 * session is minted per test and every read is of its ids, since the shares
 * are the deployment's and not an account's.
 *
 * Synthetic sessions throughout.
 */

const AT = Date.UTC(2026, 10, 8, 12);
const at = (minutes: number) => new Date(AT + minutes * 60_000);

/** The shares listed of the sessions given, as the sweep reads them. */
const listedOf = (sessions: readonly string[]) =>
  Effect.map(listPortShares(), (shares) =>
    shares.filter((share) => sessions.includes(share.sessionId)),
  );

it.layer(getTestDB())("the shared ports", (it) => {
  it.effect(
    "a session keeps one share, replaced by a share of another port and forgotten by a close",
    () =>
      Effect.gen(function* () {
        const first = `wrun_${randomUUID()}`;
        const second = `wrun_${randomUUID()}`;
        yield* recordPortShare(first, 3000, at(0));
        yield* recordPortShare(second, 5173, at(1));
        yield* recordPortShare(first, 8080, at(2));
        const shared = yield* listedOf([first, second]);
        yield* forgetPortShare(first);

        assert.deepEqual(shared, [
          { sessionId: second, port: 5173, sharedAt: at(1) },
          { sessionId: first, port: 8080, sharedAt: at(2) },
        ]);
        assert.deepEqual(yield* listedOf([first, second]), [
          { sessionId: second, port: 5173, sharedAt: at(1) },
        ]);
      }),
  );
});
