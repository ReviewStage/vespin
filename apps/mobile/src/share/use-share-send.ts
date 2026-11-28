// use-share-send.ts -- a share sent from the app, each place's write through the host's own act, as the app's composers send theirs.

import { SHARE_SEND_KIND, type ShareSend, type ShareSendTo } from "@repo/features/ios-share-send";
import { ACT_KIND } from "@repo/host/acts";
import { useCallback } from "react";
import { useHostActs } from "../host/host-provider.js";

/**
 * A share's writes sent through the host's acts, each as its kind's
 * composer sends it (`ios-share-send.ts`), all at once; answers the places
 * whose write did not go, a refusal or no answer alike, so the page keeps
 * them ticked for a second press under the same keys.
 */
export function useShareSend(): (sends: readonly ShareSendTo[]) => Promise<readonly string[]> {
  const acts = useHostActs();

  const sent = useCallback(
    (send: ShareSend): Promise<boolean> => {
      // Note that an answer naming a failure says the service did not take the write.
      switch (send.kind) {
        case SHARE_SEND_KIND.MANAGER_CHAT:
          return acts[ACT_KIND.AGENTS_CHAT_SEND](send.params).then(
            (answer) => !("failure" in answer),
          );
        case SHARE_SEND_KIND.AGENT_MESSAGE:
          return acts[ACT_KIND.AGENTS_MESSAGE](send.params).then(
            (answer) => !("failure" in answer),
          );
        case SHARE_SEND_KIND.THREAD_REPLY:
          return acts[ACT_KIND.AGENTS_INBOX_MESSAGE](send.params).then(
            (answer) => !("failure" in answer),
          );
        case SHARE_SEND_KIND.TASK_AGENT:
          return acts[ACT_KIND.AGENTS_START](send.params).then((answer) => !("failure" in answer));
        case SHARE_SEND_KIND.NEW_TASK:
          return acts[ACT_KIND.TASKS_START](send.params).then((answer) => !("failure" in answer));
      }
    },
    [acts],
  );

  return useCallback(
    async (sends) => {
      const answers = await Promise.all(
        sends.map(({ to, send }) =>
          sent(send).then(
            (gone) => (gone ? undefined : to),
            (cause: unknown) => {
              console.error("A share's write did not go.", cause);

              return to;
            },
          ),
        ),
      );

      return answers.filter((to) => to !== undefined);
    },
    [sent],
  );
}
