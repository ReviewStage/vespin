/**
 * sentry-usage-data.ts -- a client's Sentry sends only while its device shares usage data: the offline transport's own send and store hooks, over the device's "Share usage data" switch.
 *
 * Settings › Account › "Share usage data" turns off every optional telemetry
 * a client sends, its Sentry among them (`@repo/host/app-state`'s
 * `sharesUsageData`). The desktop's main process, which sends every window's
 * envelopes as its own, and the web tab both send through Sentry's offline
 * transport, and gate it by the two hooks that transport offers for this:
 * `shouldSend`, asked before each envelope leaves, and `shouldStore`, asked
 * whether one that did not leave is kept to be tried again. So the switch
 * covers everything the SDK would send (an error, a crash, a log line, a
 * span, a profile, the SDK's own client reports), and takes effect on the
 * next envelope, with no relaunch.
 *
 * - Shared: each envelope is sent, and one that fails to leave is kept, as
 *   the transport keeps it anyway.
 * - Not shared: nothing is sent and nothing is kept, and an envelope already
 *   kept from before is dropped as the transport next tries it.
 * - Not known yet, before the host has read the device's settings: nothing is
 *   sent, and everything is kept, so a crash at launch is sent once the device
 *   is known to share, or dropped once it is known not to.
 *
 * It names no SDK: each caller hands the answers to its own offline transport.
 */

/** The offline transport's hooks, as its options take them. */
interface UsageDataTransportOptions {
  /** Whether an envelope leaves now. */
  readonly shouldSend: () => boolean;
  /** Whether an envelope that did not leave is kept to be tried again. */
  readonly shouldStore: () => boolean;
}

/** The transport's hooks over the device's switch, read as each envelope leaves; undefined is a device not known yet. */
export function usageDataTransportOptions(
  sharesUsageData: () => boolean | undefined,
): UsageDataTransportOptions {
  return {
    shouldSend: () => sharesUsageData() === true,
    shouldStore: () => sharesUsageData() !== false,
  };
}
