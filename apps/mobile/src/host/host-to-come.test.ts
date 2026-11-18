// host-to-come.test.ts -- an act pressed while the host starts reaches it once it stands, and is refused where it never does.

import { createORPCClient } from "@orpc/client";
import { ACT_KIND } from "@repo/host/acts";
import type { ActPortClient } from "@repo/host/contract";
import { expect, it } from "vitest";
import { type HostReach, hostToCome } from "./host-to-come.js";

/** A host whose act port notes each act it is sent in `sent` and answers the act's kind. */
function hostNoting(sent: string[]): HostReach {
  const acts = createORPCClient<ActPortClient>({
    call: (path) => {
      const kind = path.join(".");
      sent.push(kind);

      return Promise.resolve(kind);
    },
  });

  return { acts, follow: () => () => undefined, count: () => undefined };
}

it("sends an act pressed while the host starts once it stands, once", async () => {
  const toCome = hostToCome();
  const sent: string[] = [];
  const pressed = toCome.acts[ACT_KIND.AGENTS_MODELS_FOLLOW]();

  toCome.stand(hostNoting(sent));

  await expect(pressed).resolves.toBe(ACT_KIND.AGENTS_MODELS_FOLLOW);
  await expect(toCome.acts[ACT_KIND.AGENTS_MODELS_FOLLOW]()).resolves.toBe(
    ACT_KIND.AGENTS_MODELS_FOLLOW,
  );
  expect(sent).toEqual([ACT_KIND.AGENTS_MODELS_FOLLOW, ACT_KIND.AGENTS_MODELS_FOLLOW]);
});

it("refuses an act pressed while the host starts, and any after, where it never stands", async () => {
  const toCome = hostToCome();
  const cause = new Error("The host could not start.");
  const pressed = toCome.acts[ACT_KIND.AGENTS_MODELS_FOLLOW]();

  toCome.fail(cause);

  await expect(pressed).rejects.toThrow(cause.message);
  await expect(toCome.acts[ACT_KIND.AGENTS_MODELS_FOLLOW]()).rejects.toThrow(cause.message);
});
