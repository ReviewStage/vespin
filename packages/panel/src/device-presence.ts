import { signedInAccountId } from "@repo/credentials/snapshot";
import { DEVICE_STANDING, type DeviceStanding } from "@repo/features/agent-wire";
import type { HostLine } from "@repo/features/host-live";
import { hostStanding } from "@repo/features/machines-settings-words";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { hostsQuery } from "./live-reads.js";
import { appStateQuery, selectAccount } from "./use-app-state.js";

/**
 * device-presence.ts -- the one source of where each of the account's hosts stands, which every surface that says whether a host takes an agent reads.
 *
 * Every surface reads the account's hosts (`LIVE_READ.HOSTS`), which the
 * service pushes as a host's setup, update, or presence moves: a host's beat
 * moves nothing on its own, but the scheduled sweep marks a host away once
 * its beat goes past fresh, and its next beat clears the mark, so no window
 * keeps a clock or asks on a timer. A host is setting up while it joins,
 * fetches its agents' tools, or updates; failed where its setup failed or it
 * never called in within ten minutes of joining; offline while it
 * is marked away; and online otherwise. A device the read does not name is
 * not the account's own (a teammate's, say), and `presenceStanding` says
 * nothing of it; where the read failed, it cannot be checked.
 */

/** Where the hosts read stands: the account's hosts by id, whether it has answered, and whether it failed. */
export interface PresenceBook {
  readonly hosts: ReadonlyMap<string, HostLine>;
  readonly settled: boolean;
  readonly failed: boolean;
}

/** Nothing known yet: before the first read lands. */
const NO_BOOK: PresenceBook = { hosts: new Map(), settled: false, failed: false };

/** The read failed before it ever answered. */
const FAILED_BOOK: PresenceBook = { hosts: new Map(), settled: true, failed: true };

/**
 * Where `deviceId` stands now: checking before the first read lands, by its
 * setup and then whether it is away for a host the read names, unknown for
 * one it does not where the read failed, and none otherwise, which a surface
 * says nothing of.
 */
export function presenceStanding(
  book: PresenceBook,
  deviceId: string | undefined,
): DeviceStanding | undefined {
  if (!book.settled) return DEVICE_STANDING.CHECKING;

  if (deviceId === undefined) return undefined;
  const host = book.hosts.get(deviceId);

  if (host === undefined) return book.failed ? DEVICE_STANDING.UNKNOWN : undefined;

  return hostStanding(host, Date.now());
}

/** The book the hosts read stands at: nothing known before it answers, and failed where it never could. */
function bookOf(hosts: readonly HostLine[] | undefined, failed: boolean): PresenceBook {
  if (hosts === undefined) return failed ? FAILED_BOOK : NO_BOOK;

  return { hosts: new Map(hosts.map((host) => [host.id, host])), settled: true, failed };
}

/** The account's hosts while `drawing`, a surface that shows a host's standing; the nothing-known book while it does not, or before the first read lands. */
export function useDevicePresence(drawing: boolean): PresenceBook {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const { data, isError } = useQuery(hostsQuery(drawing ? accountId : undefined));
  const hosts = data?.hosts;

  return useMemo(() => bookOf(hosts, isError), [hosts, isError]);
}
