/**
 * use-integration-statuses.ts -- where each of the account's integrations stands on the phone, and the sign-ins its Settings waits on: the panel's book (`@repo/panel`'s `integration-statuses.ts`) for the one screen that draws them.
 *
 * The account's integrations are followed while the screen stands
 * (`INTEGRATIONS_FOLLOW`), and a sign-in pressed for is waited on as the
 * panel waits on one (`@repo/features/integration-sign-in`): ended once a
 * read finds it connected, failed where a read says so, and given up on as
 * unfinished past its own deadline, three minutes after the press. A
 * Cancel ends it at the service too.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import { serverStandings } from "@repo/features/agent-servers-model";
import type { IntegrationStatusesAnswer } from "@repo/features/integration-live";
import {
  nextSignInDeadline,
  type ServerStanding,
  type SignIn,
  type SignIns,
  serverAccounts,
  serverStatus,
  signInBegun,
  signInByGitHub,
  signInsAfterRead,
} from "@repo/features/integration-sign-in";
import {
  INTEGRATION_STATUS,
  type IntegrationAccount,
  type IntegrationProvider,
  type IntegrationStatus,
  integrationConnectionOf,
} from "@repo/features/integration-wire";
import { ACT_KIND } from "@repo/host/acts";
import { selectAccount, selectIntegrations } from "@repo/host/app-state-reads";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";

/** No sign-in waited on. */
const NO_SIGN_INS: SignIns = new Map();

const NO_ACCOUNTS: readonly IntegrationAccount[] = [];

const NO_PROVIDERS: readonly IntegrationProvider[] = [];

/** Where the account's integrations stand, and the sign-ins the screen waits on. */
export interface IntegrationStatuses {
  /** The host's read, or none until it first answers. */
  readonly answer: IntegrationStatusesAnswer | undefined;
  /** Whether the read failed before it ever answered. */
  readonly readFailed: boolean;
  readonly statusOf: (server: string) => IntegrationStatus | undefined;
  readonly accountsOf: (provider: IntegrationProvider) => readonly IntegrationAccount[];
  readonly canAdd: (provider: IntegrationProvider) => boolean;
  readonly signIns: SignIns;
  /** A sign-in begun: the server stands pending and the screen waits on it, unless a connection already stands. */
  readonly signInBegun: (server: string) => void;
  /** Ends a sign-in waited on, at the service too; answers whether the service answered. */
  readonly cancelSignIn: (server: string) => Promise<boolean>;
}

/** The sign-ins with `server`'s set to `next`, or let go where none. */
function withSignIn(signIns: SignIns, server: string, next: SignIn | undefined): SignIns {
  const changed = new Map(signIns);

  if (next === undefined) changed.delete(server);
  else changed.set(server, next);

  return changed;
}

/** The account's integrations, followed while the screen that reads them stands, and the sign-ins it waits on. */
export function useIntegrationStatuses(): IntegrationStatuses {
  const acts = useHostActs();
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  useLiveFollow(signedInAccountId(account), () => acts[ACT_KIND.INTEGRATIONS_FOLLOW]());
  const held = useQuery({ ...appStateQuery, select: selectIntegrations }).data;
  const answer = held?.rows;
  const [signIns, setSignIns] = useState<SignIns>(NO_SIGN_INS);
  // Note that the marks and the read last told are kept apart from the drawing, as the panel's ledger is, so each read is told once.
  const marks = useRef(0);

  const told = useRef<{ answer: IntegrationStatusesAnswer; standing: ServerStanding } | undefined>(
    undefined,
  );

  /** The sign-ins told where the read stands: of what moved in it, or of every server where a deadline asks. */
  const tell = useCallback((latest: IntegrationStatusesAnswer, deadline: boolean) => {
    const before = told.current?.standing;

    const standing =
      told.current?.answer === latest && before !== undefined ? before : serverStandings(latest);

    told.current = { answer: latest, standing };
    marks.current += 1;

    const read = { mark: marks.current, at: Date.now() };
    const failures = deadline ? [] : (latest.signInFailures ?? []);
    setSignIns((now) =>
      signInsAfterRead(now, standing, failures, deadline ? undefined : before, read),
    );
  }, []);

  useEffect(() => {
    if (answer !== undefined && told.current?.answer !== answer) tell(answer, false);
  }, [answer, tell]);

  // The earliest deadline of a sign-in waited on: past it, the read as it stands gives up on one still pending.
  const deadline = nextSignInDeadline(signIns);
  useEffect(() => {
    if (deadline === undefined) return;

    const wait = setTimeout(
      () => {
        const latest = told.current?.answer;

        if (latest !== undefined) tell(latest, true);
      },
      Math.max(0, deadline - Date.now()),
    );

    return () => clearTimeout(wait);
  }, [deadline, tell]);

  const standing = answer === undefined ? undefined : serverStandings(answer);
  const statusOf = (server: string) => serverStatus(standing, signIns, server);

  return {
    answer,
    readFailed: held?.failed === true,
    statusOf,
    accountsOf: (provider) =>
      serverAccounts(provider, answer?.accounts ?? NO_ACCOUNTS, signIns, statusOf),
    canAdd: (provider) => (answer?.addable ?? NO_PROVIDERS).includes(provider),
    signIns,
    signInBegun: (server) => {
      if (told.current?.standing.get(server) === INTEGRATION_STATUS.CONNECTED) return;
      marks.current += 1;
      const begun = signInBegun(marks.current, Date.now(), !signInByGitHub(server));
      setSignIns((now) => withSignIn(now, server, begun));
    },
    cancelSignIn: async (server) => {
      const provider = integrationConnectionOf(server)?.provider;

      if (provider === undefined) return false;
      const waited = signIns.get(server);
      setSignIns((now) => withSignIn(now, server, undefined));

      const canceled = await acts[ACT_KIND.INTEGRATIONS_CANCEL]({
        provider,
        ...(server === provider ? undefined : { connection: server }),
      }).catch(() => undefined);

      if (canceled === undefined || "failure" in canceled) {
        // Note that the sign-in is put back where the service did not answer, unless one was begun meanwhile.
        if (waited !== undefined) {
          setSignIns((now) => (now.has(server) ? now : withSignIn(now, server, waited)));
        }

        return false;
      }

      // A sign-in begun again while the Cancel was out still stands, and is waited on for its own whole wait.
      if (canceled.status === INTEGRATION_STATUS.PENDING) {
        marks.current += 1;
        const begun = signInBegun(marks.current, Date.now(), true);
        setSignIns((now) => withSignIn(now, server, begun));
      }

      return true;
    },
  };
}
