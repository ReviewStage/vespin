import assert from "node:assert/strict";
import { TERMINAL_RELAY } from "@repo/features/terminal-wire";
import { test } from "vitest";
import { RELAY_UPGRADE_STATUS } from "../http/relay-upgrade.js";
import { admitRelayUpgrade } from "./service.js";

/**
 * Which upgrades the terminal relay takes, before any socket stands: only
 * its own path; under a bearer, whatever origin the handshake names or
 * none, since no page can set one, as the desktop and the iPhone send
 * theirs; from a page, only from one of the deployment's own origins and
 * under its session cookie, read alone, so another site's page carrying the
 * member's cookie is refused; and only one naming an agent, a shell, and a
 * size it can read.
 */

const AGENT = "8b3c7a1e-2f4d-4c6b-9e0a-1d2f3a4b5c6d";
const SHELL = "0f9e8d7c-6b5a-4f3e-8d2c-1b0a9f8e7d6c";
const OWN_ORIGIN = "https://app.example.test";
const OWN = new Set([OWN_ORIGIN]);
/** An origin React Native's socket may name on the iPhone's handshake, which is no page's. */
const IOS_ORIGIN = "http://localhost";
const BEARER = { authorization: "Bearer token-1" };
const COOKIE = "__Secure-better-auth.session_token=session-1";
const PAGE = { origin: OWN_ORIGIN, cookie: COOKIE };

function address(query: Record<string, string>, path: string = TERMINAL_RELAY.PATH): string {
  return `${path}?${new URLSearchParams(query).toString()}`;
}

const ASKED = { agent: AGENT, terminal: SHELL, cols: "120", rows: "32" };
const ASK = { agentId: AGENT, terminalId: SHELL, cols: 120, rows: 32 };

test("a bearer is taken whatever origin stands beside it, since no page can set one", () => {
  const taken = { credential: { bearer: "Bearer token-1" }, ask: ASK };
  assert.deepEqual(
    admitRelayUpgrade(address(ASKED), BEARER, OWN),
    taken,
    "the desktop's, no origin",
  );
  assert.deepEqual(
    admitRelayUpgrade(address(ASKED), BEARER, new Set()),
    taken,
    "a deployment that owns no origin still takes the desktop",
  );
  for (const origin of [IOS_ORIGIN, OWN_ORIGIN, "https://evil.test", "null"]) {
    assert.deepEqual(admitRelayUpgrade(address(ASKED), { ...BEARER, origin }, OWN), taken, origin);
    assert.deepEqual(
      admitRelayUpgrade(address(ASKED), { ...PAGE, ...BEARER, origin }, OWN),
      taken,
      `a cookie beside the bearer is never read, from ${origin}`,
    );
  }
});

test("a page of the deployment's own origin is taken by its session cookie alone", () => {
  const admitted = admitRelayUpgrade(address(ASKED), PAGE, OWN);
  assert.ok("credential" in admitted && "page" in admitted.credential);
  assert.deepEqual(
    [...admitted.credential.page.entries()],
    [["cookie", COOKIE]],
    "nothing but the cookie names the page's account",
  );
  assert.deepEqual(admitted.ask, ASK);
});

test("another site's page carrying only its cookie is refused before any socket stands", () => {
  for (const headers of [
    { ...PAGE, origin: "https://evil.test" },
    { ...PAGE, origin: IOS_ORIGIN },
    { ...PAGE, origin: "null" },
    { ...PAGE, origin: "http://app.example.test" },
    { ...PAGE, origin: "https://app.example.test.evil.test" },
  ]) {
    assert.deepEqual(
      admitRelayUpgrade(address(ASKED), headers, OWN),
      { status: RELAY_UPGRADE_STATUS.FORBIDDEN },
      headers.origin,
    );
  }
  assert.deepEqual(
    admitRelayUpgrade(address(ASKED), PAGE, new Set()),
    { status: RELAY_UPGRADE_STATUS.FORBIDDEN },
    "a deployment that owns no origin takes no page's socket",
  );
});

test("a page with no cookie, a cookie with no page's origin, and a missing, blank, or non-bearer Authorization are refused", () => {
  const refused = (headers: Record<string, string>) =>
    admitRelayUpgrade(address(ASKED), headers, OWN);
  assert.deepEqual(refused({}), { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED });
  assert.deepEqual(refused({ authorization: "Bearer " }), {
    status: RELAY_UPGRADE_STATUS.UNAUTHORIZED,
  });
  assert.deepEqual(
    refused({ ...PAGE, authorization: "Basic dXNlcjpwYXNz" }),
    { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED },
    "an Authorization that is no bearer names nobody, and the cookie beside it is never read",
  );
  assert.deepEqual(
    refused({ cookie: COOKIE }),
    { status: RELAY_UPGRADE_STATUS.UNAUTHORIZED },
    "a cookie with no page's origin is no desktop's credential",
  );
  assert.deepEqual(refused({ origin: OWN_ORIGIN, cookie: "  " }), {
    status: RELAY_UPGRADE_STATUS.UNAUTHORIZED,
  });
});

test("another path and an unreadable ask are refused before any socket stands", () => {
  assert.deepEqual(admitRelayUpgrade(address(ASKED, "/api/voice/sessions"), BEARER, OWN), {
    status: RELAY_UPGRADE_STATUS.NOT_FOUND,
  });
  for (const unreadable of [
    { ...ASKED, agent: "not-an-id" },
    { ...ASKED, cols: "0" },
    { ...ASKED, rows: "100000" },
    { agent: AGENT, terminal: SHELL },
  ]) {
    for (const headers of [BEARER, PAGE]) {
      assert.deepEqual(admitRelayUpgrade(address(unreadable), headers, OWN), {
        status: RELAY_UPGRADE_STATUS.BAD_REQUEST,
      });
    }
  }
});
