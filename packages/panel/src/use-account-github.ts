/**
 * use-account-github.ts -- the account's own GitHub as the window reads it, and the presses that connect and disconnect it.
 *
 * Settings › Integrations › GitHub draws what this answers, handed down on
 * `github-connect.tsx`'s context. A fixture run draws its synthetic
 * connection and connects nothing.
 */

import type { GitHubConnection } from "@repo/features/github-connection-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { STATUS_TONE } from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { actMutation } from "./act-mutations.js";
import type { GitHubConnectControl } from "./github-connect.js";
import { useToast } from "./toast.js";
import { appStateQuery, selectFixtureStaged, selectListedTasks } from "./use-app-state.js";

/** The account's GitHub on the task list the window lists from; absent before the first read lands. */
const selectListedGitHub = (state: AppStateSnapshot): GitHubConnection | undefined =>
  selectListedTasks(state).github;

/**
 * The account's GitHub and its two presses. Connecting opens the service's
 * page, and the connection arrives on the view once the panel comes forward
 * again; disconnecting asks the service under the Mac's session, and the
 * view takes the answer at once. A refusal of either says why in a toast.
 */
export function useAccountGitHub(): GitHubConnectControl {
  const connection = useQuery({ ...appStateQuery, select: selectListedGitHub }).data;
  // A fixture's GitHub is connected nowhere.
  const staged = useQuery({ ...appStateQuery, select: selectFixtureStaged }).data === true;
  const { mutateAsync: sendConnect } = useMutation(actMutation(ACT_KIND.GITHUB_CONNECT));
  const { mutateAsync: sendDisconnect } = useMutation(actMutation(ACT_KIND.GITHUB_DISCONNECT));
  const toast = useToast();

  return useMemo(() => {
    const ask = (
      kind: typeof ACT_KIND.GITHUB_CONNECT | typeof ACT_KIND.GITHUB_DISCONNECT,
    ): Promise<boolean> => {
      if (staged) return Promise.resolve(false);
      const send = kind === ACT_KIND.GITHUB_CONNECT ? sendConnect : sendDisconnect;

      return send().then(
        () => true,
        (refused: Error) => {
          toast({
            words: refused.message,
            tone: STATUS_TONE.DANGER,
            failure: { surface: FAILURE_SURFACE.GITHUB_ACCOUNT, act: kind, cause: refused },
          });

          return false;
        },
      );
    };

    return {
      connection,
      connect: () => ask(ACT_KIND.GITHUB_CONNECT),
      disconnect: () => ask(ACT_KIND.GITHUB_DISCONNECT),
    };
  }, [connection, staged, sendConnect, sendDisconnect, toast]);
}
