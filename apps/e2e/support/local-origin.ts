// local-origin.ts -- which addresses the suite may reach: this machine's loopback, and nothing else.

/**
 * The hostnames that name this machine's loopback, as `URL` spells them
 * (an IPv6 host keeps its brackets). The suite's servers all stand there:
 * the local server and the Vite it serves the pages through, on 127.0.0.1,
 * and Postgres, which speaks no HTTP and so never reaches either guard.
 */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Whether an address is on this machine's loopback, so a guard lets it through. */
export function isLocalAddress(url: URL): boolean {
  return LOOPBACK_HOSTNAMES.has(url.hostname) || url.hostname.endsWith(".localhost");
}
