// diag-nav.ts -- DIAGNOSTIC ONLY, not for merge: logs every router call with its stack, to find what closes Settings when the Inbox is turned off on an iPad (vjinboxoff11190r2).

import { router } from "expo-router";

const METHODS = ["push", "navigate", "replace", "back", "dismiss", "dismissTo", "dismissAll", "setParams"] as const;

const table = router as unknown as Record<string, (...args: unknown[]) => unknown>;

for (const name of METHODS) {
  const original = table[name];

  if (typeof original === "function") {
    table[name] = (...args: unknown[]) => {
      console.warn(`VESPIN-DIAG router.${name} ${JSON.stringify(args)}\n${new Error().stack ?? ""}`);

      return original.apply(router, args);
    };
  }
}
