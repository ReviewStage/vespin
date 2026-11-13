import {
  AVATAR_SIZE,
  Avatar,
  Badge,
  Button,
  GAP,
  LIST_ROW_CURRENT,
  ListMotion,
  STATUS_TONE,
  Stack,
  type StatusTone,
  TRACK_NODE_LOOK,
  TrackList,
  TrackRow,
} from "@repo/ui";
import { useRef, useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * queue-lines.tsx -- a line of things waiting their turn, as a merge queue
 * stands it: a track, a rail with one node per row, a waiting row's hollow
 * and a checking row's pulsing.
 * Merge front takes the front off, and the line glides up under `ListMotion`.
 * Synthetic pull requests throughout.
 */

interface Waiting {
  readonly key: string;
  readonly title: string;
  readonly author: string;
  readonly tone: StatusTone | undefined;
  readonly stage: string;
}

const LINE: readonly Waiting[] = [
  {
    key: "812",
    title: "Expire invitations after seven days",
    author: "ada",
    tone: STATUS_TONE.MERGED,
    stage: "Merging",
  },
  {
    key: "815",
    title: "Rename the billing job",
    author: "grace",
    tone: STATUS_TONE.WORKING,
    stage: "Checking",
  },
  {
    key: "819",
    title: "Retry webhook deliveries with backoff",
    author: "linus",
    tone: undefined,
    stage: "Waiting",
  },
  {
    key: "820",
    title: "Draw the usage chart on the dashboard",
    author: "ada",
    tone: STATUS_TONE.DANGER,
    stage: "Failing",
  },
  {
    key: "823",
    title: "Cache the repository list",
    author: "grace",
    tone: undefined,
    stage: "Waiting",
  },
];

/** The marked pull request, which the track marks. */
const MARKED = "819";

function QueueLines(): React.JSX.Element {
  const [line, setLine] = useState(LINE);
  const root = useRef<HTMLDivElement>(null);

  return (
    <CatalogSection id="track-list" title="A track, its rows on a rail">
      <Stack gap={GAP.CONTROL}>
        <div ref={root}>
          <ListMotion root={root}>
            <TrackList label="acme/relay" moves>
              {line.map((each) => (
                <TrackRow
                  key={each.key}
                  motionKey={each.key}
                  node={{
                    tone: each.tone,
                    look: each.tone === undefined ? TRACK_NODE_LOOK.HOLLOW : TRACK_NODE_LOOK.FILLED,
                    pulse: each.tone === STATUS_TONE.WORKING,
                  }}
                  leading={<Avatar name={each.author} size={AVATAR_SIZE.ROW} decorative />}
                  title={each.title}
                  description={`#${each.key}`}
                  meta={<Badge tone={each.tone ?? STATUS_TONE.NEUTRAL}>{each.stage}</Badge>}
                  current={each.key === MARKED ? LIST_ROW_CURRENT.ITEM : undefined}
                  onPress={() => undefined}
                />
              ))}
            </TrackList>
          </ListMotion>
        </div>
        <div>
          <Button
            disabled={line.length === 0}
            onClick={() => setLine((now) => (now.length === 0 ? LINE : now.slice(1)))}
          >
            Merge front
          </Button>
        </div>
      </Stack>
    </CatalogSection>
  );
}

export const QUEUE_LINES_EXAMPLE: Example = {
  id: "queue-lines",
  title: "Queue lines",
  Render: QueueLines,
};
