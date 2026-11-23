import { memorySandbox } from "@repo/sandbox/testing";
import { expect, it } from "vitest";
import { localRuntimeOverride, overrideLocalRuntime } from "./local-runtime-override.js";

const ON_LOOPBACK = "postgres://luke:luke@127.0.0.1:54329/luke";

const sandbox = memorySandbox().layer;

it.each([
  { beside: "a database on this machine's loopback", variables: {}, honored: true },
  { beside: "a Vercel variable", variables: { VERCEL_ENV: "production" }, honored: false },
])("an override read beside $beside is honored: $honored", ({ variables, honored }) => {
  overrideLocalRuntime({ sandbox });

  expect(localRuntimeOverride({ DATABASE_URL: ON_LOOPBACK, ...variables }).sandbox).toBe(
    honored ? sandbox : undefined,
  );
});
