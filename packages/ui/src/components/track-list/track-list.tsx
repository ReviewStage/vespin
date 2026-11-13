import type { ReactNode } from "react";
import type { StatusTone } from "../../status-tone.js";
import { List, ListRow } from "../list-row/list-row.js";

/**
 * track-list.tsx -- a list whose rows stand on a track: a rail down its leading edge, with one node on it for each row in that row's tone, as the pull requests behind the front of a merge queue stand.
 *
 * It is a `List` of `ListRow`s, read and walked as any list is, its rows
 * moving under a `ListMotion` where it asks to (`moves`); the rail and the
 * nodes are decoration the rows' own words already say. Each node stands
 * before the row's leading mark, on the rail, in its status tone's ink
 * (`tokens/status-tone.css`), or the strong border's where it has none. A
 * hollow node (`TRACK_NODE_LOOK.HOLLOW`) is a ring on the ground, as a
 * thing still waiting its turn is (`track-list.css`).
 */

/** How a node is drawn: filled with its tone's ink, or a ring of it on the ground. */
export const TRACK_NODE_LOOK = {
  FILLED: "filled",
  HOLLOW: "hollow",
} as const;

export type TrackNodeLook = (typeof TRACK_NODE_LOOK)[keyof typeof TRACK_NODE_LOOK];

/** A row's node on the rail: its tone, none for a thing at rest, and how it is drawn. */
export interface TrackNode {
  readonly tone?: StatusTone | undefined;
  readonly look?: TrackNodeLook | undefined;
}

/** The node and the row's own leading mark beside it, the node standing on the rail. */
function NodeAndLead({
  node,
  leading,
}: {
  node: TrackNode;
  leading: ReactNode;
}): React.JSX.Element {
  return (
    <span className="ui-track-row-lead inline-flex items-center gap-icon-gap">
      <span
        className="ui-track-node"
        data-tone={node.tone}
        data-look={node.look ?? TRACK_NODE_LOOK.FILLED}
        aria-hidden="true"
      />
      {leading}
    </span>
  );
}

/** One row on the track: a `ListRow` whose leading mark stands beside its node. */
export function TrackRow({
  node,
  leading,
  ...row
}: Parameters<typeof ListRow>[0] & { node: TrackNode }): React.JSX.Element {
  return <ListRow {...row} leading={<NodeAndLead node={node} leading={leading} />} />;
}

/** A list of `TrackRow`s on a rail, named `label`, its rows moving under a `ListMotion` where it `moves`. */
export function TrackList({
  label,
  moves = false,
  children,
}: {
  label: string;
  moves?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="ui-track-list">
      <List label={label} moves={moves}>
        {children}
      </List>
    </div>
  );
}
