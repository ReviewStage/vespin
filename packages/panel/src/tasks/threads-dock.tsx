import { decideButtons, inboxLineKind, inboxPreview } from "@repo/features/inbox-list-model";
import { INBOX_ASK, type InboxItem, knownAsk, openAskOf } from "@repo/features/inbox-wire";
import { BUTTON_SIZE, BUTTON_VARIANT, Button, Inline, LIST_VARIANT, List, ListRow } from "@repo/ui";
import { actorName, personActor } from "@repo/ui/actor-model";
import { InboxIcon } from "@repo/ui/icons";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import type { ReactNode } from "react";
import { WaitingCount } from "../desktop/task-row-parts.js";
import { useMemberDirectory } from "../member-directory.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import { inboxLineGlyph } from "./inbox-item-parts.js";
import { threadsWords } from "./inbox-model.js";

/**
 * threads-dock.tsx -- the line docked over an agent's box while it has posted threads: what waits on the developer, or, quiet, how many there are.
 *
 * The agent's transcript points to its threads rather than drawing them:
 * one row, as the pull request's dock is one, says Inbox and at its end how
 * many wait, in the figure the sidebar's Inbox row, a task's row, and an
 * agent's tab draw (`WaitingCount`); the titles are the threads' own to say.
 * Pressing it opens the agent's threads on the next waiting, the oldest
 * posted, in its card on that thread (`agent-threads.tsx`), or, on a phone, the
 * Inbox narrowed to the task on it. Once none waits it stays, quiet, as the
 * one way into them from the card: muted, counting every thread the agent
 * posted, and opening on the latest changed.
 */

/** The threads an agent posted, those that wait on the developer apart, and the door to one of them. */
export interface AgentThreads {
  /** Those that wait on the developer, the oldest posted first. */
  readonly waiting: readonly InboxItem[];
  /** Every thread the agent posted, waiting or not, the latest changed first. */
  readonly posted: readonly InboxItem[];
  readonly onOpen: (item: InboxItem) => void;
  /** Whether the agent's workspace has Done and follow-ups on, which draws what waits as the bar's Needs you, each ask on a row of its own. */
  readonly turnEnd?: boolean | undefined;
  /** Answers an ask by choosing one of its options, as the Inbox's Send does with that choice and the words drafted on its card. */
  readonly onChoose?: ((item: InboxItem, label: string) => void) | undefined;
  /** The threads whose answer is on its way, whose buttons wait for it. */
  readonly sending?: ReadonlySet<string> | undefined;
}

/** What the bar says while asks of the agent's wait on the developer. */
const NEEDS_YOU_WORDS = "Needs you";

/** The most asks the bar lists under its head; the head counts them all and opens the rest. */
const NEEDS_YOU_ROWS = 3;

/**
 * One ask that waits on the developer, as the bar lists it: its title, and
 * a decide of two short options answered from its row's buttons, as the
 * Inbox answers it; any other ask says what it wants under its title and
 * opens its thread.
 */
function NeedsYouRow({ item, threads }: { item: InboxItem; threads: AgentThreads }): ReactNode {
  const directory = useMemberDirectory();
  const nameOf = (member: Parameters<typeof personActor>[0]) =>
    actorName(personActor(member, directory.members, directory.readerId, directory.former));
  const open = openAskOf(item.thread ?? []);
  const ask = open === undefined ? undefined : knownAsk(open.ask);
  const options = ask?.type === INBOX_ASK.DECIDE && decideButtons(ask) ? ask.options : undefined;
  const chooses = threads.onChoose !== undefined && options !== undefined;
  const sending = threads.sending?.has(item.id) === true;
  const { onChoose } = threads;
  return (
    <ListRow
      leading={inboxLineGlyph(inboxLineKind(item))}
      title={item.title}
      description={chooses ? undefined : inboxPreview(item, nameOf)}
      actions={
        options !== undefined && onChoose !== undefined ? (
          <Inline wrap={false}>
            {options.map((option) => (
              <Button
                key={option.label}
                size={BUTTON_SIZE.COMPACT}
                variant={BUTTON_VARIANT.OUTLINE}
                disabled={sending}
                onClick={() => onChoose(item, option.label)}
              >
                {option.label}
              </Button>
            ))}
          </Inline>
        ) : undefined
      }
      chevron={!chooses}
      onPress={chooses ? undefined : () => threads.onOpen(item)}
    />
  );
}

/** The bar's Needs you: its head as the dock's row, counting what waits, then the oldest asks on rows of their own. */
function NeedsYouBar({ threads, next }: { threads: AgentThreads; next: InboxItem }): ReactNode {
  return (
    <List label={NEEDS_YOU_WORDS} variant={LIST_VARIANT.CARD} fingerTall>
      <ListRow
        leading={<InboxIcon aria-hidden="true" />}
        title={NEEDS_YOU_WORDS}
        meta={<WaitingCount count={threads.waiting.length} />}
        onPress={() => threads.onOpen(next)}
      />
      {threads.waiting.slice(0, NEEDS_YOU_ROWS).map((item) => (
        <NeedsYouRow key={item.id} item={item} threads={threads} />
      ))}
    </List>
  );
}

/** The agent's threads as one row over its box: what waits, else quiet, how many; nothing while it posted none. */
export function ThreadsDock({ threads }: { threads: AgentThreads | undefined }): ReactNode {
  const next = threads?.waiting[0];
  if (threads?.turnEnd === true && next !== undefined) {
    return (
      <div className={`agent-threads-dock ${COMPOSER_DOCK_CLASS}`}>
        <NeedsYouBar threads={threads} next={next} />
      </div>
    );
  }
  const latest = threads?.posted[0];
  if (threads === undefined || latest === undefined) return null;
  const row =
    next === undefined ? (
      <ListRow
        leading={<InboxIcon aria-hidden="true" />}
        title={threadsWords(threads.posted.length)}
        muted
        onPress={() => threads.onOpen(latest)}
      />
    ) : (
      <ListRow
        leading={<InboxIcon aria-hidden="true" />}
        title={TAB_WORDS.INBOX}
        meta={<WaitingCount count={threads.waiting.length} />}
        onPress={() => threads.onOpen(next)}
      />
    );
  return (
    <div className={`agent-threads-dock ${COMPOSER_DOCK_CLASS}`}>
      <List label={TAB_WORDS.INBOX} variant={LIST_VARIANT.CARD} fingerTall>
        {row}
      </List>
    </div>
  );
}
