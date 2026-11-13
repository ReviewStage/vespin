/**
 * expired-server-toasts.ts -- one toast for each MCP server whose sign-in expired, standing until it is reconnected, with Reconnect on each.
 *
 * Every server the signed-in account holds whose provider's grant stopped
 * working is said in a toast of its own, led by the provider's mark and
 * named by the provider alone, never the account's name, that
 * persists until the server is connected again or the developer dismisses
 * it, so each is reconnected with one press wherever the window is.
 * Reconnect begins the same sign-in Settings' row and the servers popover
 * begin (`integration-grant.ts`): while the browser holds it the toast says
 * the reconnect is under way, and once the server stands connected it
 * leaves. A sign-in given up on brings the server's toast back, and one that
 * could not begin says so in its place, with Retry. One the developer
 * dismissed is not said again until the server has stood otherwise and
 * expires anew. While a surface that reconnects servers in place holds them
 * back (`useHoldExpiredServerToasts`), as setup does, none is said, and
 * those said are withdrawn, so none stands over its presses; each server
 * still expired is said once nothing holds them.
 */

import { type NamedServer, namedServers } from "@repo/features/agent-servers-model";
import { SIGN_IN } from "@repo/features/integration-sign-in";
import { INTEGRATION_NAME, INTEGRATION_STATUS } from "@repo/features/integration-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { VERB } from "@repo/features/words";
import { STATUS_TONE } from "@repo/ui";
import { Store, useSelector } from "@tanstack/react-store";
import { useEffect, useRef } from "react";
import { GRANT_OUTCOME, useIntegrationGrant } from "./integration-grant.js";
import { type IntegrationStatuses, useIntegrationStatuses } from "./integration-statuses.js";
import { useToast, useWithdrawToast } from "./toast.js";

/** Where a server said in a toast stands: its sign-in expired, a reconnect under way, or neither, as once it is connected again. */
const STANDS = {
  EXPIRED: "expired",
  RECONNECTING: "reconnecting",
  CLEAR: "clear",
} as const;

type Stands = (typeof STANDS)[keyof typeof STANDS];

/** What a server's toast says: its sign-in expired, a reconnect beginning or under way, or one that could not begin. */
const SAYS = {
  EXPIRED: "expired",
  BEGINNING: "beginning",
  RECONNECTING: "reconnecting",
  FAILED: "failed",
} as const;

type Says = (typeof SAYS)[keyof typeof SAYS];

/** What a server's toast is pressed by. */
const ACTION = {
  RECONNECT: VERB.RECONNECT,
  RETRY: "Retry",
} as const;

/** A server's toast as it stands: the server, what the toast is about, which withdraws it, and what it says. */
interface Said {
  readonly server: NamedServer;
  readonly subject: string;
  says: Says;
}

/** How many surfaces hold the toasts back now, which say nothing while any does. */
const holds = new Store(0);

/** Where `connection` stands: a sign-in waited on or pending is a reconnect under way, ahead of the read's word. */
function standsOf(statuses: IntegrationStatuses, connection: string): Stands {
  const status = statuses.statusOf(connection);

  if (statuses.signInOf(connection)?.kind === SIGN_IN.WAITING) return STANDS.RECONNECTING;

  if (status === INTEGRATION_STATUS.PENDING) return STANDS.RECONNECTING;

  return status === INTEGRATION_STATUS.EXPIRED ? STANDS.EXPIRED : STANDS.CLEAR;
}

/**
 * Says each expired server in a toast of its own, with Reconnect, until it
 * is connected again. Note that it compares what each server's toast says
 * with where the server stands after every render, and changes only what
 * moved, because a toast outlives the render that showed it.
 */
export function useExpiredServerToasts(): void {
  const held = useSelector(holds, (count) => count > 0);
  const statuses = useIntegrationStatuses();
  const grant = useIntegrationGrant(statuses);
  const toast = useToast();
  const withdraw = useWithdrawToast();
  const said = useRef(new Map<string, Said>());
  const dismissed = useRef(new Set<string>());
  const latest = useRef({ grant, toast, withdraw, held });
  latest.current = { grant, toast, withdraw, held };

  useEffect(() => {
    // Note that a dismissal ends once its server stands clear, held or not, so one reconnected while held is said when it expires anew.
    for (const connection of dismissed.current) {
      if (standsOf(statuses, connection) === STANDS.CLEAR) dismissed.current.delete(connection);
    }

    // Note that what was said is withdrawn rather than left standing, so each server still expired is said anew once released.
    if (held) {
      for (const entry of said.current.values()) latest.current.withdraw(entry.subject);
      said.current.clear();

      return;
    }

    /** The server's toast turned to say `says`, shown by `show` under a subject of its own, in place of what it said. */
    const say = (server: NamedServer, says: Says, show: (subject: string) => void) => {
      const was = said.current.get(server.connection);

      if (was !== undefined) latest.current.withdraw(was.subject);
      const subject = crypto.randomUUID();
      said.current.set(server.connection, { server, subject, says });
      show(subject);
    };

    /** Begins the server's reconnect, saying in its toast where it could not begin. */
    const reconnect = (server: NamedServer) => {
      // Note that pressing a toast's action dismisses it first, which is no dismissal of the server.
      dismissed.current.delete(server.connection);
      const entry = said.current.get(server.connection);

      if (entry !== undefined) entry.says = SAYS.BEGINNING;
      void latest.current.grant.begin(server.connection).then((outcome) => {
        // Note that a reconnect begun before a hold says nothing once held, since the server is said anew on release.
        if (outcome === GRANT_OUTCOME.BEGUN || latest.current.held) return;
        say(server, SAYS.FAILED, (subject) =>
          latest.current.toast({
            words:
              outcome === GRANT_OUTCOME.NOT_OPENED
                ? `Your browser could not be opened to reconnect ${INTEGRATION_NAME[server.provider]}.`
                : `${INTEGRATION_NAME[server.provider]} could not be reconnected.`,
            tone: STATUS_TONE.DANGER,
            mark: server.provider,
            subject,
            persists: true,
            action: { label: ACTION.RETRY, onPress: () => reconnect(server), replayUnmasked: true },
            onDismiss: () => dismissed.current.add(server.connection),
            failure: {
              surface: FAILURE_SURFACE.INTEGRATION_RECONNECT,
              cause: outcome,
              refused: true,
            },
          }),
        );
      });
    };

    /** Says the server's sign-in expired, with Reconnect, unless the developer dismissed it. */
    const sayExpired = (server: NamedServer) => {
      if (dismissed.current.has(server.connection)) {
        const was = said.current.get(server.connection);

        if (was !== undefined) latest.current.withdraw(was.subject);
        said.current.set(server.connection, {
          server,
          subject: crypto.randomUUID(),
          says: SAYS.EXPIRED,
        });

        return;
      }

      say(server, SAYS.EXPIRED, (subject) =>
        latest.current.toast({
          words: `${INTEGRATION_NAME[server.provider]}'s sign-in expired`,
          tone: STATUS_TONE.ATTENTION,
          mark: server.provider,
          subject,
          persists: true,
          action: {
            label: ACTION.RECONNECT,
            onPress: () => reconnect(server),
            replayUnmasked: true,
          },
          onDismiss: () => dismissed.current.add(server.connection),
        }),
      );
    };

    const expired = namedServers({
      statusOf: statuses.statusOf,
      accountsOf: statuses.accountsOf,
      standing: (status) => status === INTEGRATION_STATUS.EXPIRED,
    });

    for (const server of expired) {
      if (said.current.has(server.connection)) continue;

      if (standsOf(statuses, server.connection) === STANDS.EXPIRED) sayExpired(server);
    }

    for (const [connection, entry] of said.current) {
      const stands = standsOf(statuses, connection);

      if (stands === STANDS.CLEAR) {
        latest.current.withdraw(entry.subject);
        said.current.delete(connection);
        dismissed.current.delete(connection);
      } else if (stands === STANDS.RECONNECTING && entry.says !== SAYS.RECONNECTING) {
        say(entry.server, SAYS.RECONNECTING, (subject) =>
          latest.current.toast({
            words: `Reconnecting ${INTEGRATION_NAME[entry.server.provider]}…`,
            tone: STATUS_TONE.WORKING,
            subject,
          }),
        );
      } else if (stands === STANDS.EXPIRED && entry.says === SAYS.RECONNECTING) {
        // A sign-in given up on, or past its wait: the server is offered again.
        sayExpired(entry.server);
      }
    }
  });

  // Note that the toasts leave with the window that said them, as when the account signs out.
  useEffect(
    () => () => {
      for (const entry of said.current.values()) latest.current.withdraw(entry.subject);
      said.current.clear();
    },
    [],
  );
}

/**
 * Holds the expired servers' toasts back while the caller stands, as setup
 * does, whose steps reconnect a server in place; each server still expired
 * is said once nothing holds them.
 */
export function useHoldExpiredServerToasts(): void {
  useEffect(() => {
    holds.setState((count) => count + 1);

    return () => holds.setState((count) => count - 1);
  }, []);
}
