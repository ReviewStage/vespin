import { signedInAccountId } from "@repo/credentials/snapshot";
import { agentDefaultOf } from "@repo/features/account-preferences-live";
import type { ModelChoice } from "@repo/features/models-wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import {
  accountPreferencesQuery,
  accountPreferencesRetryMutation,
  hostsQuery,
  modelsQuery,
  modelsRetryMutation,
} from "./live-reads.js";
import { appStateQuery, selectAccount } from "./use-app-state.js";

/**
 * account-choices.ts -- the account's own choices as every surface draws them: its preferences row, which the host holds for the session, the models it is offered and its devices, which a surface holds while it draws one, and the default a new agent runs on, worked out from both.
 *
 * The host holds the preferences row on a live read, so a default or a
 * chapters model chosen on another device draws here within the service's
 * coalesce window, and a write draws at once. The models are a fetch the
 * host asks again as a window comes forward, as the account's keys move,
 * and as the account's hosts join or leave, so a host set up while a
 * window stands is offered at once. Where the account stored no default, the
 * default drawn is the one the service answers for it
 * (`agentDefaultOf`): the fallback the models mark as paid for.
 */

/** The default a new agent runs on, as a surface draws it, with whether its reads failed and Try again. */
export interface DrawnAgentDefault {
  /** The default; none until both reads it is worked out from have answered, or where the preferences could not be read. */
  readonly choice: ModelChoice | undefined;
  /** Whether the preferences could not be read, so no default can be drawn. */
  readonly failed: boolean;
  /** Try again on both reads, settling once both asks land, whether or not they were refused. */
  readonly retry: () => Promise<void>;
}

/** The account signed in, by the id the host holds its reads under; none while nobody is. */
function useAccountKey(): string | undefined {
  return signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
}

/** The account's preferences row, which the host holds for the session (`accountPreferencesQuery`). */
export function useAccountPreferences() {
  return useQuery(accountPreferencesQuery(useAccountKey()));
}

/** Whether two lists of host ids name the same hosts in the same order. */
function sameHosts(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((id, at) => id === other[at]);
}

/** Asks for the models again whenever the account's hosts that called in, which the models answer offers, change, while `accountId` is held. */
function useModelsFollowHosts(accountId: string | undefined): void {
  const hosts = useQuery(hostsQuery(accountId)).data?.hosts;
  const { mutate: askAgain } = useMutation(modelsRetryMutation());
  const seen = useRef<readonly string[] | undefined>(undefined);
  useEffect(() => {
    if (hosts === undefined) return;
    // Note that the models offer only a host that has called in, so one calling in moves them as one joining does.
    const ids = hosts
      .filter((host) => host.calledIn !== false)
      .map((host) => host.id)
      .sort();
    const before = seen.current;
    seen.current = ids;
    if (before !== undefined && !sameHosts(before, ids)) askAgain();
  }, [hosts, askAgain]);
}

/** The models the account is offered and its devices, held while `drawing`, a surface that draws one (`modelsQuery`), asked again as its hosts join or leave. */
export function useOfferedModels(drawing = true) {
  const accountId = useAccountKey();
  const held = drawing ? accountId : undefined;
  useModelsFollowHosts(held);
  return useQuery(modelsQuery(held));
}

/**
 * The default a new agent runs on: the account's stored one, or where it
 * stored none the fallback the models it is offered mark as paid for, as
 * the service answers it; Anthropic's where the models could not be read.
 * Failed where the preferences could not be read, since a stored choice
 * may stand behind them.
 */
export function useAgentDefault(): DrawnAgentDefault {
  const preferences = useAccountPreferences();
  const models = useOfferedModels();
  const { mutateAsync: retryPreferences } = useMutation(accountPreferencesRetryMutation());
  const { mutateAsync: retryModels } = useMutation(modelsRetryMutation());
  const read = models.isError
    ? { failed: true as const }
    : models.data === undefined
      ? {}
      : { rows: models.data };
  const choice =
    preferences.data === undefined ? undefined : agentDefaultOf(preferences.data.agent, read);
  const retry = useCallback(
    () => Promise.allSettled([retryPreferences(), retryModels()]).then(() => undefined),
    [retryPreferences, retryModels],
  );
  return { choice, failed: preferences.isError, retry };
}
