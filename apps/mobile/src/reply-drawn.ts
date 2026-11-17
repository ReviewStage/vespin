// reply-drawn.ts -- counts how long a reply sent on an Inbox thread took to stand in its thread, once a send, on a rung, as `reply:drawn`.

import {
  PRODUCT_REPLY_KIND,
  PRODUCT_SURFACE_EVENT,
  type ProductReplyKind,
  productDrawnMilliseconds,
} from "@repo/features/analytics";
import type { InboxMessage } from "@repo/features/inbox-wire";
import { useEffect } from "react";
import { AppState } from "react-native";
import { useHostCount } from "./host/host-provider.js";

/** A reply pressed and not yet seen standing: when, on `performance.now`'s clock, and what it carried. */
interface Pressed {
  readonly at: number;
  readonly kind: ProductReplyKind;
}

/** Each reply pressed and not yet counted, by the key it was sent under. */
const pressed = new Map<string, Pressed>();

/** Notes a reply pressed under `key`, the moment its wait to stand in its thread starts. */
export function replyPressed(key: string, pictures: boolean): void {
  pressed.set(key, {
    at: performance.now(),
    kind: pictures ? PRODUCT_REPLY_KIND.PICTURES : PRODUCT_REPLY_KIND.WORDS,
  });
}

/** Lets go of a reply that will not stand, as one the service refused, so it never counts. */
export function replyLetGo(key: string): void {
  pressed.delete(key);
}

/**
 * Counts, once a send, the time from a reply's press to the first frame
 * after the thread first draws it, its own or the service's copy under its
 * key, as `reply:drawn` with that time on a rung of
 * `productDrawnMilliseconds` and whether it carried pictures, and nothing
 * else: never its words, its pictures, or which thread. Note that the frame
 * is waited for, so a thread busy drawing it counts that time too; and that
 * a reply whose thread draws it once the app has left the front counts
 * nothing, since its time would hold a wait nobody sat through.
 */
export function useReplyDrawnCount(thread: readonly InboxMessage[] | undefined): void {
  const count = useHostCount();

  useEffect(() => {
    if (pressed.size === 0 || thread === undefined) return;

    for (const { id, clientKey } of thread) {
      const key = pressed.has(id) ? id : clientKey;
      const reply = key === undefined ? undefined : pressed.get(key);

      if (key === undefined || reply === undefined) continue;
      pressed.delete(key);
      requestAnimationFrame(() => {
        if (AppState.currentState !== "active") return;
        count(PRODUCT_SURFACE_EVENT.REPLY_DRAWN, {
          drawn_ms: productDrawnMilliseconds(performance.now() - reply.at),
          reply_kind: reply.kind,
        });
      });
    }
  }, [count, thread]);
}
