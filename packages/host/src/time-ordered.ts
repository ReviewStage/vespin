/**
 * time-ordered.ts -- keys ordered by an instant each stands at, read back as those before a given one in work as large as what is read.
 *
 * A binary min-heap indexed by key, so a key moves or leaves in a
 * logarithmic step, and `before` walks only the subtrees whose root stands
 * before the instant asked, which the heap's order lets it prune.
 */

/** One key and the instant it stands at. */
interface Entry {
  readonly key: string;
  readonly at: number;
}

/** Keys each at an instant, read back by how early they stand. */
export interface TimeOrdered {
  /** Stands `key` at `at`, where it stood elsewhere or nowhere. */
  readonly set: (key: string, at: number) => void;
  /** Lets `key` go, where it stood. */
  readonly delete: (key: string) => void;
  /** The keys standing strictly before `at`, in no set order. */
  readonly before: (at: number) => readonly string[];
}

/** An empty set of time-ordered keys. */
export function timeOrdered(): TimeOrdered {
  const heap: Entry[] = [];
  /** Where each key's entry sits in `heap`. */
  const place = new Map<string, number>();

  const put = (at: number, entry: Entry) => {
    heap[at] = entry;
    place.set(entry.key, at);
  };

  /** Moves the entry at `from` toward the root until its parent stands no later, answering where it rests. */
  const up = (from: number): number => {
    let at = from;
    const entry = heap[at];

    if (entry === undefined) return at;

    while (at > 0) {
      const parentAt = (at - 1) >> 1;
      const parent = heap[parentAt];

      if (parent === undefined || parent.at <= entry.at) break;
      put(at, parent);
      at = parentAt;
    }

    put(at, entry);

    return at;
  };

  /** Moves the entry at `from` toward the leaves until neither child stands earlier. */
  const down = (from: number) => {
    let at = from;
    const entry = heap[at];

    if (entry === undefined) return;

    for (;;) {
      const left = 2 * at + 1;
      const right = left + 1;
      let least = at;
      let leastAt = entry.at;
      const leftEntry = heap[left];
      const rightEntry = heap[right];

      if (leftEntry !== undefined && leftEntry.at < leastAt) {
        least = left;
        leastAt = leftEntry.at;
      }

      if (rightEntry !== undefined && rightEntry.at < leastAt) least = right;

      if (least === at) break;
      const child = heap[least];

      if (child === undefined) break;
      put(at, child);
      at = least;
    }

    put(at, entry);
  };

  /** Settles the entry at `at` after its instant moved, either way. */
  const settle = (at: number) => {
    if (up(at) === at) down(at);
  };

  const remove = (key: string) => {
    const at = place.get(key);

    if (at === undefined) return;
    place.delete(key);
    const last = heap.pop();

    if (last === undefined || at === heap.length) return;
    put(at, last);
    settle(at);
  };

  return {
    set: (key, at) => {
      const was = place.get(key);

      if (was === undefined) {
        heap.push({ key, at });
        up(heap.length - 1);

        return;
      }

      if (heap[was]?.at === at) return;
      put(was, { key, at });
      settle(was);
    },
    delete: remove,
    before: (at) => {
      const keys: string[] = [];
      const open = heap.length > 0 ? [0] : [];

      // Note that a child never stands earlier than its parent, so a subtree whose root stands at or past `at` holds no key before it.
      for (let next = open.pop(); next !== undefined; next = open.pop()) {
        const entry = heap[next];

        if (entry === undefined || entry.at >= at) continue;
        keys.push(entry.key);
        open.push(2 * next + 1, 2 * next + 2);
      }

      return keys;
    },
  };
}
