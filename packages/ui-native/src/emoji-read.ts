// emoji-read.ts -- every emoji a picker offers, by category, read the first time a picker needs them and shared by every picker after.

import { type EmojiGroup, emojiGroups } from "@repo/features/emoji-model";
import { useEffect, useState } from "react";

/** Every emoji by category, read once, the first time a picker asks. */
let emojiRead: Promise<readonly EmojiGroup[]> | undefined;

/**
 * Every emoji by category, `@repo/features/emoji-data`'s, read the first time a
 * picker shows its Emoji tab or a search is typed. Note that the data is
 * imported only then, because it is some 220 KB of data that would otherwise
 * be evaluated in every launch before the first frame; a read that fails is
 * forgotten, so the next one tries again.
 */
function readEmoji(): Promise<readonly EmojiGroup[]> {
  if (emojiRead !== undefined) return emojiRead;

  const read = import("@repo/features/emoji-data").then((module) => emojiGroups(module.EMOJI_DATA));

  read.catch(() => {
    emojiRead = undefined;
  });
  emojiRead = read;

  return read;
}

/** Every emoji by category once `wanted` and read; none before. */
export function useEmoji(wanted: boolean): readonly EmojiGroup[] | undefined {
  const [emoji, setEmoji] = useState<readonly EmojiGroup[] | undefined>(undefined);

  useEffect(() => {
    if (!wanted || emoji !== undefined) return;
    let standing = true;

    readEmoji().then(
      (read) => {
        if (standing) setEmoji(read);
      },
      () => undefined,
    );

    return () => {
      standing = false;
    };
  }, [wanted, emoji]);

  return emoji;
}
