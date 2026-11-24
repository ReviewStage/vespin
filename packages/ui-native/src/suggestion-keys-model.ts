// suggestion-keys-model.ts -- where a hardware keyboard's ↑ and ↓ move the row chosen in the list a composer floats, as the desktop's picker moves its highlight.

/** The keys the list a composer floats takes from its field, as the native field tells them. */
export const LIST_KEY = { UP: "up", DOWN: "down", PICK: "pick" } as const;

export type ListKey = (typeof LIST_KEY)[keyof typeof LIST_KEY];

/** The key the native field names, or none for a word it does not send. */
export function listKeyOf(told: string): ListKey | undefined {
  return Object.values(LIST_KEY).find((key) => key === told);
}

/**
 * The row chosen once an arrow moves it among `count` rows, from the row
 * chosen before or none: ↓ steps to the next and ↑ to the one before,
 * each wrapping round the list's ends, as the desktop's picker does, and
 * the first arrow from none choosing the first row for ↓ and the last for
 * ↑. None where the list holds no row.
 */
export function movedChoice(
  count: number,
  chosen: number | undefined,
  key: typeof LIST_KEY.UP | typeof LIST_KEY.DOWN,
): number | undefined {
  if (count <= 0) return undefined;
  const down = key === LIST_KEY.DOWN;

  if (chosen === undefined) return down ? 0 : count - 1;

  return (chosen + (down ? 1 : count - 1)) % count;
}
