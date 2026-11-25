import { type ReactNode, useRef } from "react";
import { ListMotion, useLeaving } from "../list-motion/list-motion.js";
import { List } from "../list-row/list-row.js";

/**
 * landing-motion.tsx -- a scene's list moving as the app's lists move: a row arriving or leaving stands or goes at once, and the rows it moved glide.
 *
 * A scene's story adds and takes rows away, as an Inbox's question arrives
 * and is resolved, and its list plays the app's own motion for it
 * (`ListMotion`), so what the landing shows moves as the app does. Each row
 * is drawn by the scene and wears its key (`ListRow`'s `motionKey`), which
 * the motion follows it by.
 */

/** The list's rows, held while one leaves so the motion reads its going; a component of their own, because `useLeaving` reads the motion it stands under. */
function MovingRows<T>({
  label,
  items,
  keyOf,
  row,
}: {
  label: string;
  items: readonly T[];
  keyOf: (item: T) => string;
  row: (item: T) => ReactNode;
}): React.JSX.Element {
  const drawn = useLeaving(items, keyOf);

  return (
    <List label={label} moves>
      {drawn.map(({ value }) => row(value))}
    </List>
  );
}

/** `items` drawn by `row` as a list named `label`, moving as the app's lists move when the story adds or takes rows away. */
export function MovingList<T>({
  label,
  items,
  keyOf,
  row,
}: {
  label: string;
  items: readonly T[];
  keyOf: (item: T) => string;
  row: (item: T) => ReactNode;
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null);

  return (
    <div ref={root} className="ui-landing-moving">
      <ListMotion root={root}>
        <MovingRows label={label} items={items} keyOf={keyOf} row={row} />
      </ListMotion>
    </div>
  );
}
