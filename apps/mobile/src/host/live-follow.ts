// live-follow.ts -- a live read held followed on the host for as long as a screen holds its key, as the panel holds one while its query is active.

import { useEffect, useEffectEvent, useRef } from "react";

/** A follow as the act port answers it: a stream that carries nothing until it is let go. */
type OpenedFollow = AsyncIteratorObject<unknown, unknown, unknown>;

/** Says on the console an act the host refused, which the next delivery of the document corrects. */
function refused(what: string): (cause: unknown) => void {
  return (error) => console.error(`${what} did not go.`, error);
}

/**
 * Opens the follow `open` answers and holds it until the release it answers
 * is called, which lets it go, whether it opened by then or opens after.
 */
function holdFollow(open: () => Promise<OpenedFollow>): () => void {
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

  open().then(drain).catch(refused("Following a live read"));

  return () => {
    held = false;
    stream?.return?.().catch(refused("Letting a live read go"));
  };
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

    return holdFollow(() => opening(key));
  }, [key]);
}

/**
 * Holds a follow for each of `keys` for as long as the screen holds it, as
 * the panel holds one query per server: a key that joins opens its follow,
 * and one that leaves lets its follow go, the others held throughout. Every
 * follow is let go as the screen leaves.
 */
export function useLiveFollows(
  keys: readonly string[],
  open: (key: string) => Promise<OpenedFollow>,
) {
  const opening = useEffectEvent(open);
  // The follows held, by their key, kept apart from the drawing so a draw that keeps the same keys moves none.
  const held = useRef(new Map<string, () => void>());
  useEffect(() => {
    const now = held.current;

    for (const [key, release] of now) {
      if (keys.includes(key)) continue;
      release();
      now.delete(key);
    }

    for (const key of keys) {
      if (!now.has(key))
        now.set(
          key,
          holdFollow(() => opening(key)),
        );
    }
  });
  useEffect(() => {
    const now = held.current;

    return () => {
      for (const release of now.values()) release();
      now.clear();
    };
  }, []);
}
