/**
 * inbox-list.tsx -- the Inbox as every design opens on it: the agent's two
 * threads and a teammate's item below them, and the frame's two layouts, a
 * phone's one place at a time and a desktop's list beside what it opened.
 *
 * The row is `@repo/ui`'s `ListRow` as the panel lays it, its task and agent
 * above the title and its age at the title's end; the panel's own marks
 * after the age (an actor's face, a task's status) are approximated by a
 * `Badge` for the ask.
 */

import {
  Badge,
  EmptyState,
  LIST_ROW_CURRENT,
  LIST_ROW_CURRENT_LOOK,
  LIST_ROW_INK,
  LIST_ROW_LEAD,
  LIST_ROW_META,
  List,
  ListRow,
  STATUS_TONE,
  TOOLBAR_LOOK,
  Toolbar,
  UnreadMark,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import type { ReactNode } from "react";
import { AGENT, ageOf, THREADS, type ThreadId } from "./data";
import type { World } from "./world";

/** The frame a design is drawn in. */
export const FRAME = {
  PHONE: "phone",
  DESKTOP: "desktop",
} as const;

export type Frame = (typeof FRAME)[keyof typeof FRAME];

/** The Inbox's own head: a phone's centered title, or the desktop column's. */
function InboxHead({ frame }: { frame: Frame }): React.JSX.Element {
  return (
    <Toolbar
      look={frame === FRAME.PHONE ? TOOLBAR_LOOK.PHONE : TOOLBAR_LOOK.WINDOW}
      title="Inbox"
    />
  );
}

/** The Inbox's rows: the agent's threads, newest first, and a teammate's item, already done with. */
export function InboxList({
  frame,
  world,
  current,
  onOpen,
}: {
  frame: Frame;
  world: World;
  current: ThreadId | undefined;
  onOpen: (id: ThreadId) => void;
}): React.JSX.Element {
  const threads = [...THREADS].sort((a, b) => b.openedAt - a.openedAt);
  return (
    <div className="inbox-proto-column">
      <InboxHead frame={frame} />
      <div className="inbox-proto-scroll">
        <List label="Inbox">
          {threads.map((base) => {
            const thread = world.thread(base.id);
            const last = thread.messages.at(-1);
            const unread = !world.seen.has(thread.id);
            const asking = thread.ask !== undefined && world.decided(thread.id) === undefined;
            return (
              <ListRow
                key={thread.id}
                ink={LIST_ROW_INK.SIDEBAR}
                currentLook={LIST_ROW_CURRENT_LOOK.TINT}
                leading={<UnreadMark unread={unread} />}
                title={thread.title}
                description={last?.text}
                lead={{ icon: <GLYPH.AGENT />, label: `${AGENT.task} · ${AGENT.name}` }}
                leadAt={LIST_ROW_LEAD.ABOVE}
                meta={
                  asking ? (
                    <Badge tone={STATUS_TONE.ATTENTION}>Decide</Badge>
                  ) : (
                    ageOf(last?.at ?? thread.openedAt)
                  )
                }
                metaAt={LIST_ROW_META.TITLE}
                unread={unread}
                current={current === thread.id ? LIST_ROW_CURRENT.PAGE : undefined}
                more={false}
                onPress={() => onOpen(thread.id)}
              />
            );
          })}
          <ListRow
            ink={LIST_ROW_INK.SIDEBAR}
            currentLook={LIST_ROW_CURRENT_LOOK.TINT}
            leading={<UnreadMark unread={false} />}
            title="Rotate the Sentry DSN?"
            description="Done: rotated it and updated the Vercel env."
            lead={{ icon: <GLYPH.AGENT />, label: "Observability · Audit secrets" }}
            leadAt={LIST_ROW_LEAD.ABOVE}
            meta="4 days ago"
            metaAt={LIST_ROW_META.TITLE}
            muted
            more={false}
          />
        </List>
      </div>
    </div>
  );
}

/** What the desktop draws beside the list while nothing is open. */
export function NothingOpen(): React.JSX.Element {
  return (
    <div className="inbox-proto-column" data-centered="">
      <EmptyState icon={<GLYPH.INBOX />} title="Choose an item" />
    </div>
  );
}

/**
 * A design's places laid out in its frame: on a phone the one open, the
 * list or what it opened; on a desktop the list beside it.
 */
export function FrameLayout({
  frame,
  list,
  detail,
}: {
  frame: Frame;
  list: ReactNode;
  /** What is open, or nothing while the Inbox is all there is. */
  detail: ReactNode;
}): React.JSX.Element {
  if (frame === FRAME.PHONE) return <div className="inbox-proto-screen">{detail ?? list}</div>;
  return (
    <div className="inbox-proto-screen" data-frame="desktop">
      <div className="inbox-proto-rail">{list}</div>
      <div className="inbox-proto-detail">{detail ?? <NothingOpen />}</div>
    </div>
  );
}
