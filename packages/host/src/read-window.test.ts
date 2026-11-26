import assert from "node:assert/strict";
import { test } from "vitest";
import { readWindow, WINDOW_READ } from "./read-window.js";

test("a window reads as reading until its first answer, then holds its last rows, not settled, while a rebuilt read loads, never dropping back to reading or empty", () => {
  const loading = { enabled: true, ready: false, failed: false, rows: undefined };
  const answered = { enabled: true, ready: true, failed: false, rows: ["a", "b"] };

  // A cold launch: the kept rows have not loaded, so nothing says the list is empty.
  assert.deepEqual(readWindow(loading, undefined), { status: WINDOW_READ.READING });
  assert.deepEqual(readWindow(answered, undefined), {
    status: WINDOW_READ.ROWS,
    rows: ["a", "b"],
    settled: true,
  });

  // A scope switched: the new read loads, and the last read's rows stand meanwhile.
  assert.deepEqual(readWindow(loading, ["a", "b"]), {
    status: WINDOW_READ.ROWS,
    rows: ["a", "b"],
    settled: false,
  });

  // A read that answers no row is settled and empty, and a failed store is said as such.
  assert.deepEqual(readWindow({ ...answered, rows: [] }, ["a"]), {
    status: WINDOW_READ.ROWS,
    rows: [],
    settled: true,
  });
  assert.deepEqual(readWindow({ ...loading, failed: true }, ["a"]), {
    status: WINDOW_READ.FAILED,
  });
});
