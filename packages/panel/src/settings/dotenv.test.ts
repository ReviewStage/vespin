import assert from "node:assert/strict";
import { test } from "vitest";
import { parseDotenv } from "./dotenv.js";

/**
 * dotenv.test.ts -- a `.env` read as the variables it sets: comments, blank
 * lines, and lines with no name set nothing, and `export` and one pair of
 * quotes are taken off.
 */

test("a .env reads as the pairs it sets, in order", () => {
  const text = [
    "# .env.local",
    "",
    "REDIS_URL=redis://cache:6379",
    'LINEAR_API_KEY="lin_api_example"',
    "export FEATURE_FLAGS = 'new-inbox'",
    "DATABASE_URL=postgres://localhost/acme?a=b#frag",
    "=no-name",
    "just words",
  ].join("\r\n");

  assert.deepEqual(parseDotenv(text), [
    { name: "REDIS_URL", value: "redis://cache:6379" },
    { name: "LINEAR_API_KEY", value: "lin_api_example" },
    { name: "FEATURE_FLAGS", value: "new-inbox" },
    { name: "DATABASE_URL", value: "postgres://localhost/acme?a=b#frag" },
  ]);
});
