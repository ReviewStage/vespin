import assert from "node:assert/strict";
import { RECORDING_FAILURE } from "@repo/features/recording-wire";
import { test } from "vitest";
import {
  locateRecording,
  RECORDER_SOURCE,
  RECORDING_READ_EXIT,
  RECORDING_START_EXIT,
  RECORDING_START_OUTPUT,
  recordingFileOf,
  recordingStartOf,
  recordingStopOf,
  SANDBOX_RECORDING,
  startRecording,
} from "./sandbox-recorder.js";

/**
 * sandbox-recorder.test.ts -- the recording's commands as the sandbox runs
 * them and their runs as the service reads them: a start that started, one
 * left running, and one that failed; a stop's video, its known failures, and
 * anything else read as an encoder that failed. The scripts themselves run
 * only in a sandbox, beside the browser and the encoder.
 */

const run = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: "" });

test("a start runs with the recorder's source, and its run says whether it started one", () => {
  const ask = startRecording(120, 4_000_000);

  assert.ok(ask.args.includes(RECORDER_SOURCE));
  assert.ok(ask.args.includes("120") && ask.args.includes("4000000"));
  assert.deepEqual(recordingStartOf(run(`${RECORDING_START_OUTPUT.STARTED}\n`)), {
    ok: true,
    running: false,
  });
  assert.deepEqual(recordingStartOf(run(`${RECORDING_START_OUTPUT.RUNNING}\n`)), {
    ok: true,
    running: true,
  });
  assert.deepEqual(recordingStartOf(run("", RECORDING_START_EXIT.NO_ENCODER)), {
    ok: false,
    exitCode: RECORDING_START_EXIT.NO_ENCODER,
  });
});

test("a stop's run is the video's length and size, a known failure, or an encoder that failed", () => {
  assert.deepEqual(recordingStopOf(run('{"ok":true,"seconds":8.3,"bytes":22237}\n')), {
    ok: true,
    seconds: 8.3,
    bytes: 22237,
  });
  assert.deepEqual(recordingStopOf(run('{"ok":false,"reason":"too-large","bytes":5000000}')), {
    ok: false,
    reason: RECORDING_FAILURE.TOO_LARGE,
    bytes: 5_000_000,
  });
  assert.deepEqual(recordingStopOf(run('{"ok":false,"reason":"none"}')), {
    ok: false,
    reason: RECORDING_FAILURE.NONE,
  });

  for (const odd of [run("not json"), run('{"ok":false,"reason":"gremlins"}'), run("", 1)]) {
    assert.deepEqual(recordingStopOf(odd), { ok: false, reason: RECORDING_FAILURE.ENCODER });
  }
});

test("a locate prints the video's absolute path, then its size, and its run is the path and the size or nothing", () => {
  const path = `/home/vercel-sandbox/${SANDBOX_RECORDING.VIDEO}`;
  const printed = `${path}\n2048\n`;

  assert.ok(locateRecording().args.includes(SANDBOX_RECORDING.VIDEO));
  assert.deepEqual(recordingFileOf(run(printed), 4_000_000), { path, size: 2048 });
  assert.equal(recordingFileOf(run("", RECORDING_READ_EXIT.NO_VIDEO), 4_000_000), undefined);
  assert.equal(recordingFileOf(run(printed), 2047), undefined, "a video past the bound");
  assert.equal(recordingFileOf(run(`${path}\n0\n`), 4_000_000), undefined, "an empty video");
  assert.equal(
    recordingFileOf(run("2048\n"), 4_000_000),
    undefined,
    "a locate naming no path is no video an agent can post",
  );
});
