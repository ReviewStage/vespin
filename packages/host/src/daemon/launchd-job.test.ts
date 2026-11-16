/**
 * launchd-job.test.ts -- a launchd job read from `launchctl print` as it prints a job that dies each time it starts, by an exit code or by a signal, and a print that states no run count read as no job.
 *
 * The print is an excerpt of the indented lines `launchctl print
 * gui/<uid>/dev.vespin.host` printed for a crash-looping host, with a
 * synthetic path.
 */

import assert from "node:assert/strict";
import { Option } from "effect";
import { test } from "vitest";
import { keepsQuitting, launchdJobOf } from "./launchd-job.js";

const CRASH_LOOPING = `gui/501/dev.vespin.host = {
	active count = 0
	path = /Applications/Fixture.app/Contents/Library/LaunchAgents/dev.vespin.host.plist
	type = LaunchAgent
	state = not running

	program = /Applications/Fixture.app/Contents/MacOS/vespin-host
	arguments = {
		/Applications/Fixture.app/Contents/MacOS/vespin-host
		run
		--bundled
	}

	runs = 1373
	last exit code = 1
	spawn type = daemon (3)
}
`;

/** The same job where a signal ended each run, which launchd states in place of an exit code. */
const SIGNALED = CRASH_LOOPING.replace(
  "last exit code = 1",
  "last terminating signal = Abort trap: 6",
);

test("a job's run count and how its last run ended are read from its print, a signal as a failure, and a print with no run count is no job", () => {
  assert.deepEqual(
    launchdJobOf(CRASH_LOOPING),
    Option.some({ runs: 1373, lastExit: 1, lastSignal: undefined }),
  );
  const signaled = Option.getOrThrow(launchdJobOf(SIGNALED));
  assert.deepEqual(signaled, { runs: 1373, lastExit: undefined, lastSignal: 6 });
  assert.equal(keepsQuitting({ ...signaled, runs: 1368 }, signaled), true);
  assert.equal(
    Option.isNone(launchdJobOf("Could not find service in domain for user gui: 501\n")),
    true,
  );
});
