// live-follow.ts -- a live read held followed on the host for as long as a screen holds its key, as the panel holds one while its query is active.

import { useEffect, useEffectEvent } from "react";

/** A follow as the act port answers it: a stream that carries nothing until it is let go. */
type OpenedFollow = AsyncIteratorObject<unknown, unknown, unknown>;

/** Says on the console an act the host refused, which the next delivery of the document corrects. */
function refused(what: string): (error: unknown) => void {
  return (error) => console.error(`${what} did not go.`, error);
}

/**
 * Holds the follow `open` opens for as long as the screen holds `key`, as
 * the panel holds a live read while its query is active
 * (`@repo/panel`'s `live-reads.ts`): the host follows the read and writes
 * it into the document, which the screen reads. Nothing while `key` is none.
 */
export function useLiveFollow(
  key: string | undefined,
  open: (key: string) => Promise<OpenedFollow>,
) {
  // Note that only the key moves the follow, `open` being read as it stands when the follow opens.
  const opening = useEffectEvent(open);
  useEffect(() => {
    if (key === undefined) return;
    let held = true;
    let stream: OpenedFollow | undefined;

    const drain = async (opened: OpenedFollow) => {
      stream = opened;

      if (!held) {
        await opened.return?.();

        return;
      }

      for await (const _ of opened) {
        if (!held) break;
      }
    };

    opening(key).then(drain).catch(refused("Following a live read"));

    return () => {
      held = false;
      stream?.return?.().catch(refused("Letting a live read go"));
    };
  }, [key]);
}
