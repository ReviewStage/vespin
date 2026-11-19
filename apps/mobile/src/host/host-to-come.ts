// host-to-come.ts -- what the screens act, follow, and count through while the host starts, each handed to the host once it stands, so the screens draw from the launch's first frame.

import { type ClientLink, createORPCClient } from "@orpc/client";
import type { AppBridge } from "@repo/host/bridge";
import type { ActPortCallContext, ActPortClient } from "@repo/host/contract";
import { Predicate } from "effect";
import type { HostFollow } from "./mobile-runtime.js";

/** How a screen counts a moment of the panel's surface vocabulary, such as a surface opened, through the host's bridge. */
export type HostCount = AppBridge["recordSurfaceEvent"];

/** What the screens act, follow, and count through on the host once it stands. */
export interface HostReach {
  readonly acts: ActPortClient;
  readonly follow: HostFollow;
  readonly count: HostCount;
}

/** What the screens act, follow, and count through while the host starts, each going to the host once it stands, and the two ends of its start. */
export interface HostToCome {
  readonly acts: ActPortClient;
  readonly follow: HostFollow;
  readonly count: HostCount;
  /** Hands every act, follow, and count to the host, those that waited first, each once. */
  readonly stand: (host: HostReach) => void;
  /** Refuses every act that waited, and any after, with why the host could not start. */
  readonly fail: (cause: unknown) => void;
}

/** A member of `members` by a key known only at run time, as a call's path names an act of the port. */
function memberAt<Member>(
  members: { readonly [key: PropertyKey]: Member },
  key: PropertyKey,
): Member | undefined {
  return members[key];
}

/**
 * The host to come, as `HostToCome` says. Note that its acts are an oRPC
 * client of their own over a link that waits for the host and then calls
 * the same procedure on the host's own client, so a press made while the
 * host starts is sent once it stands, and refused if it never does; a
 * follow opened meanwhile opens then, unless its stop came first; and a
 * count waits beside them.
 */
export function hostToCome(): HostToCome {
  let stood: HostReach | undefined;
  let refused: { readonly cause: unknown } | undefined;
  let waiting: ((host: HostReach) => void)[] = [];
  const failures: ((cause: unknown) => void)[] = [];

  /** Runs `go` on the host once it stands, at once where it stands already, or `refuse` with why where it never will. */
  const whenStood = (go: (host: HostReach) => void, refuse?: (cause: unknown) => void) => {
    if (stood !== undefined) {
      go(stood);

      return;
    }

    if (refused !== undefined) {
      refuse?.(refused.cause);

      return;
    }

    waiting.push(go);

    if (refuse !== undefined) failures.push(refuse);
  };

  // Note that the act port's client is keyed by act kind alone, so a call's path is one kind, which the host's own client answers.
  const link: ClientLink<ActPortCallContext> = {
    call: async (path, input, options) => {
      const host = await new Promise<HostReach>((resolve, reject) => {
        whenStood(resolve, reject);
      });

      const [kind, ...beyond] = path;
      const procedure = kind === undefined ? undefined : memberAt<unknown>(host.acts, kind);

      if (beyond.length > 0 || !Predicate.isFunction(procedure)) {
        throw new Error(`No act at ${path.join(".")}.`);
      }

      return procedure(input, options);
    },
  };

  return {
    acts: createORPCClient<ActPortClient>(link),
    follow: (open, take) => {
      let stop: (() => void) | undefined;
      let stopped = false;
      whenStood((host) => {
        if (!stopped) stop = host.follow(open, take);
      });

      return () => {
        stopped = true;
        stop?.();
      };
    },
    count: (name, properties) => whenStood((host) => host.count(name, properties)),
    stand: (host) => {
      stood = host;
      const handed = waiting;
      waiting = [];
      failures.length = 0;

      for (const go of handed) go(host);
    },
    fail: (cause) => {
      refused = { cause };
      waiting = [];

      for (const refuse of failures.splice(0)) refuse(cause);
    },
  };
}
