// held-turn.ts -- the signed-in `test` with `heldTurn`: the member's task's scripted turns held at their `hold` step until the journey lets them go on.

import { HELD_TURN_LOCK_SEED } from "@repo/service/testing/scripted-agent-sessions";
import { Client } from "pg";
import { suiteDatabaseUrl } from "./member.js";
import { expect, test as signedInTest } from "./signed-in.js";

/** A held turn's gate: letting go lets the turn the journey watched run on to its end. */
interface HeldTurn {
  readonly letGo: () => Promise<void>;
}

/**
 * The signed-in `test` (`signed-in.ts`) with `heldTurn`: before the journey
 * runs, the advisory lock a scripted turn's `hold` step waits on
 * (`HELD_TURN_LOCK_SEED`, `scripted-agent-sessions.ts`) is taken for the
 * member's task, on a connection of the fixture's own, so a turn the journey
 * starts there stops at its hold for as long as the journey watches it
 * running, however slow the run. `letGo` lets the turn go on; the
 * connection ends with the test, which lets it go wherever the journey did
 * not.
 */
export const test = signedInTest.extend<{ heldTurn: HeldTurn }>({
  heldTurn: async ({ signedIn }, use) => {
    expect(signedIn.taskId).toBeDefined();
    const client = new Client({ connectionString: suiteDatabaseUrl() });
    await client.connect();

    try {
      await client.query("select pg_advisory_lock(hashtextextended($1, $2))", [
        signedIn.taskId,
        HELD_TURN_LOCK_SEED,
      ]);

      await use({
        letGo: async () => {
          await client.query("select pg_advisory_unlock_all()");
        },
      });
    } finally {
      await client.end();
    }
  },
});

export { expect };
