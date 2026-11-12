/**
 * inbox-item-parts.tsx -- the pieces that draw an Inbox item as the Inbox does, for every place that lists one: its agent's tile, the glyph of what it asks, its card, and the marks at its row's end.
 *
 * The Inbox's own list draws an item as a row of its agent's tile, its
 * title, the last word in its thread, and at its end the teammate's face
 * whose agent asks it, the Draft pencil, its task's status and how long ago
 * it changed (`InboxItemEnd`), with the item's card
 * hung beside the row (`InboxItemCard`). ⌘K, the person page, the Next row,
 * and a chip of an item draw those same pieces, so an item reads alike
 * wherever it stands; the list itself composes them in `inbox-list.tsx`.
 */

import type { ListedAgent } from "@repo/features/agent-wire";
import { GLYPH_STATE } from "@repo/features/glyph-state";
import {
  INBOX_LINE,
  type InboxHolder,
  type InboxLineKind,
  type InboxListed,
  inboxLineKind,
  inboxSettledStanding,
  NEEDS_YOU,
  needsYou as needsYouOf,
  readersItem,
} from "@repo/features/inbox-list-model";
import { REMIND_WORDS } from "@repo/features/inbox-remind-times";
import {
  INBOX_STATUS,
  type InboxItem,
  type InboxPerson,
  inboxWaitsOn,
} from "@repo/features/inbox-wire";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import type { CatalogModel } from "@repo/features/models-wire";
import { cardTitle } from "@repo/features/plain-words";
import { agentStillWriting } from "@repo/features/task-agents-model";
import { TASK_STATUS_WORDS } from "@repo/features/task-standing-words";
import {
  cn,
  DraftMark,
  HOVER_CARD_ROW_LOOK,
  HoverCard,
  HoverCardHead,
  HoverCardRow,
  HoverCardRule,
  INLINE_REF_LOOK,
  InlineRef,
  TaskStatusMark,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TIME_LOOK,
  Time,
  VisuallyHidden,
} from "@repo/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, actorName, personActor } from "@repo/ui/actor-model";
import { CheckIcon, GLYPH, PenLineIcon, SquareCheckIcon } from "@repo/ui/icons";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useInboxItemDrafted } from "../composer-drafts.js";
import { useMemberDirectory, usePerson } from "../member-directory.js";
import { StateGlyph } from "../state-glyph.js";
import { appStateQuery, selectWorkspaces } from "../use-app-state.js";
import { providerOf } from "./agent-model.js";
import { AgentMarkRef, type AgentSubject, lineSubject } from "./agent-ref.js";
import { TaskChipCard } from "./chip-cards.js";
import { HOME_ROW_META } from "./home-row.js";
import { ReadAgentModel } from "./mentioned-agent-card.js";
import { PlanGlyph } from "./tab-look.js";
import { TASK_CARD_STANDING, TaskKey } from "./task-standing.js";
import { useOpenPlace } from "./use-open-link.js";
import { useTaskAgent } from "./use-task-work.js";

/**
 * An item put away until a reminder says when it comes back in its age's
 * place, after the clock glyph the reminder's acts wear, in the accent's
 * ink, so a row put away reads apart from one that changed, as Mail's
 * Remind Me list does.
 */
const INBOX_ROW_DUE =
  "inbox-row-due inline-flex items-center gap-tight-gap text-accent-ink [&>svg]:size-caption-glyph";

/** What a teammate's open item says to a reader beside their face, which is drawn for the eye alone: it waits on them, not the reader. */
function waitingOn(starter: Actor): string {
  return `Waiting on ${actorName(starter, { sentence: true })}`;
}

/** What a message or a thread its agent addressed to a member by name says of them: "To you", or "To" and their name. */
export function addressedWords(person: Actor): string {
  return `To ${actorName(person, { sentence: true })}`;
}

/**
 * Whom an agent addressed a message or a thread to by name, at the end of
 * its head: "To", their face, and their name, or "you"; nothing where it
 * named nobody, which then waits on its task's assignee or its starter.
 */
export function AddressedTo({ to }: { to: InboxPerson | undefined }): React.JSX.Element | null {
  const person = usePerson(to);

  if (to === undefined) return null;

  return (
    <span className="inbox-addressed-to inline-flex min-w-0 items-center gap-tight-gap">
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        To
      </Text>
      <ActorMark actor={person} size={ACTOR_SIZE.INLINE} />
      <Text variant={TEXT_VARIANT.CAPTION}>{actorName(person, { sentence: true })}</Text>
    </span>
  );
}

/** The tile of an agent the window names nothing of. */
const UNNAMED_AGENT = {
  kind: ACTOR_KIND.AGENT,
  name: "",
  provider: undefined,
  state: ACTOR_STATE.REST,
} as const;

/** The agent that posted an item as the task's list followed live holds it (`useTaskAgent`); none where it does not hold it. */
function itemSubject(
  listed: ListedAgent | undefined,
  models: readonly CatalogModel[] | undefined,
  readerId: string | undefined,
): AgentSubject | undefined {
  return listed === undefined ? undefined : lineSubject(listed, models, readerId);
}

/**
 * The tile of the agent that posted an item, hanging the agent's card and
 * leaving the press to its row; where the task's list names no such agent,
 * an archived one say, whose items still stand, a bare tile of the harness
 * the task list carries for it (`ReadAgentModel`), and of no known harness
 * until the list carries it and where it never does.
 */
export function ItemMark({
  agentId,
  models,
  readerId,
  plain = false,
}: {
  agentId: string;
  models: readonly CatalogModel[] | undefined;
  readerId: string | undefined;
  /** Whether the tile hangs no card of its own, as a row's leading mark does, the row's own card naming the agent instead. */
  plain?: boolean;
}): React.JSX.Element {
  const subject = itemSubject(useTaskAgent(agentId), models, readerId);

  if (subject === undefined) {
    return (
      <ReadAgentModel agentId={agentId}>
        {(model) => (
          <ActorMark
            actor={{
              ...UNNAMED_AGENT,
              provider: model === undefined ? undefined : providerOf(model),
            }}
          />
        )}
      </ReadAgentModel>
    );
  }

  return plain ? (
    <ActorMark actor={subject.tile} />
  ) : (
    <AgentMarkRef subject={subject} models={models} />
  );
}

/** The glyph saying what an item asks, as its row's second line leads with it: its open ask's kind, a tick where an answer settled it, Resolve's mark where a member resolved it, and none before words alone. */
export function inboxLineGlyph(kind: InboxLineKind): React.JSX.Element | null {
  switch (kind) {
    case INBOX_LINE.DECIDE:
      return <GLYPH.DECIDE />;
    case INBOX_LINE.DO:
      return <SquareCheckIcon aria-hidden="true" />;
    case INBOX_LINE.ANSWER:
      return <PenLineIcon aria-hidden="true" />;
    case INBOX_LINE.SETTLED:
      return <CheckIcon aria-hidden="true" />;
    case INBOX_LINE.RESOLVED:
      return <GLYPH.RESOLVED />;
    case INBOX_LINE.SAID:
      return null;
  }
}

/**
 * An item's own glyph, as its chip wears it:
 * what it asks, as its row's second line leads with it (`inboxLineGlyph`),
 * or the thread's glyph where it asks nothing.
 */
export function inboxItemGlyph(item: InboxItem): React.JSX.Element {
  return inboxLineGlyph(inboxLineKind(item)) ?? <GLYPH.THREAD />;
}

/** Where an item stands, as its row's card says it under its title. */
function standingWords(item: InboxItem, needsYou: boolean, starter: Actor | undefined): string {
  if (needsYou) return NEEDS_YOU.LABEL;

  if (item.status === INBOX_STATUS.OPEN) {
    return starter === undefined ? "Waiting" : waitingOn(starter);
  }

  return inboxSettledStanding(item);
}

/**
 * An Inbox row's card, hung beside the row as a sidebar task's row hangs
 * its task's, so the row's tile hangs none of its own: the card of the
 * thread. It leads with its title, wearing no glyph, where it stands,
 * waiting on the reader, on a teammate, or settled, and when it last
 * moved; then its task, as its key and its chip, which wears its status.
 * Note that it draws no message of the thread, nor the answer that settled
 * it, which the row's own second line already previews, and no open
 * ask's options or steps, because a card takes no press and they would
 * read as controls; the item's box answers. The agent that asked
 * stands at its foot, the loading spinner beside it while it works.
 */
export function InboxItemCard({
  listed,
  now,
  models,
  readerId,
}: {
  listed: InboxListed;
  /** The time its age counts from; the window's minute where none is handed. */
  now?: number | undefined;
  models: readonly CatalogModel[] | undefined;
  /** The signed-in account's id, whose own agents' cards name no starter, and whose own open items alone need them. */
  readerId: string | undefined;
}): React.JSX.Element {
  const { holder, item } = listed;
  const { needsYou, starter } = useInboxStanding(listed, readerId);
  const listedAgent = useTaskAgent(item.agentId);
  const subject = itemSubject(listedAgent, models, readerId);
  // Note that the list followed live names what each of a task's agents is doing.
  const working = listedAgent !== undefined && agentStillWriting(listedAgent.status);

  return (
    <HoverCard data-inbox-item-card="">
      <HoverCardHead
        name={cardTitle(item.title)}
        sub={<span>{standingWords(item, needsYou, starter)}</span>}
        corner={<Time at={item.updatedAt} now={now} hint={false} />}
      />
      <HolderDetail holder={holder} />
      <HoverCardRule />
      <HoverCardRow
        look={HOVER_CARD_ROW_LOOK.DETAIL}
        glyph={<ItemMark agentId={item.agentId} models={models} readerId={readerId} plain />}
        label={subject?.name ?? UNNAMED_AGENT.name}
        end={working ? <StateGlyph state={GLYPH_STATE.WORKING} /> : undefined}
      />
    </HoverCard>
  );
}

/**
 * The task holding an item, as its card says it under the head, a quieter
 * row flush with the name: by its key, as the task's
 * own card says it (`TaskKey`), and by its chip as a mention of it is drawn
 * (`HolderRef`), which wears the task's status as its mark, so the card
 * says no status in words. Note that the row wears no glyph of its own,
 * because the chip already leads with the task's.
 */
function HolderDetail({ holder }: { holder: InboxHolder }): React.JSX.Element {
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data;
  const workspaceName = workspaces?.find((each) => each.id === holder.task.workspaceId)?.name;

  return (
    <HoverCardRow
      look={HOVER_CARD_ROW_LOOK.DETAIL}
      label={
        <span className={cn(TASK_CARD_STANDING, "flex-nowrap")} data-holder-detail="">
          <TaskKey workspaceName={workspaceName} number={holder.task.number} />
          <HolderRef holder={holder} />
        </span>
      }
    />
  );
}

/**
 * The task holding an item, named as a mention of it is
 * (`mention-chip.tsx`): a pill of its glyph and its name, cut at its end
 * where the card is too narrow for it, which hangs the task's card and
 * opens the task, as a mention of the task does.
 */
function HolderRef({ holder }: { holder: InboxHolder }): React.JSX.Element {
  const openPlace = useOpenPlace();
  const glyph = <PlanGlyph status={holder.task.status} />;
  const { task } = holder;
  const head = <HoverCardHead glyph={glyph} name={task.name} />;

  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      glyph={glyph}
      label={task.name}
      card={
        <TaskChipCard taskId={task.id} fallback={<HoverCard data-task-card="">{head}</HoverCard>} />
      }
      onPress={
        openPlace === undefined
          ? undefined
          : () => openPlace({ kind: LINK_DESTINATION.TASK, planId: task.id })
      }
      data-holder-ref=""
    />
  );
}

/**
 * An item's task's status as its row wears it before its time: the
 * status's mark alone, small and quiet, as the task's sidebar row wears
 * it, so a Done task's item reads ✓ and a Canceled one's ×, its words said
 * to a reader and in the row's card (`HolderDetail`). Note that it is drawn
 * whatever the status, an item of a finished task staying listed until it
 * is read or answered, and none for a task from a service before statuses. A row that draws the status elsewhere, on
 * the line naming its task, keeps only its words here (`drawn` off).
 */
function TaskStatusChip({
  holder,
  drawn = true,
}: {
  holder: InboxHolder;
  /** Whether the mark is drawn, or its words alone said to a reader. */
  drawn?: boolean;
}): React.JSX.Element | null {
  if (holder.task.status === undefined) return null;
  const { status } = holder.task;

  return (
    <span className="inbox-row-task-status inline-flex" data-task-status={status}>
      {drawn ? <TaskStatusMark status={status} /> : null}
      <VisuallyHidden>{TASK_STATUS_WORDS[status]}</VisuallyHidden>
    </span>
  );
}

/** Where an item stands for the reader, as its row, its card, and its end marks all say it. */
interface InboxStanding {
  /** Whether the item is an open one the reader's own agent asks, which needs their answer. */
  readonly needsYou: boolean;
  /** The teammate whose agent's open item waits on them; none for the reader's own. */
  readonly starter: Actor | undefined;
  /** A member's name as the window says it, the reader's own as You. */
  readonly nameOf: (member: Parameters<typeof personActor>[0]) => string;
}

/** An item's standing for the reader, read as the member directory around the row knows its people. */
export function useInboxStanding(listed: InboxListed, readerId: string | undefined): InboxStanding {
  const { item } = listed;
  const directory = useMemberDirectory();
  const reader = directory.readerId ?? readerId;

  const starter = readersItem(item, reader)
    ? undefined
    : personActor(inboxWaitsOn(item), directory.members, reader, directory.former);

  return {
    needsYou: needsYouOf(listed, reader),
    starter,
    nameOf: (member) => actorName(personActor(member, directory.members, reader, directory.former)),
  };
}

/** An item row's meta, its context, marks, and time in one line at the title's right. */
function InboxRowMeta({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className={HOME_ROW_META}>{children}</span>;
}

/** What an item row's end is handed: the item, and how it stands on its row. */
interface InboxItemEndProps {
  listed: InboxListed;
  /** The time its age counts from; the window's minute where none is handed. */
  now?: number | undefined;
  readerId: string | undefined;
  /** Whether the item's box stands beside the list, so its draft is in sight and unmarked. */
  open?: boolean;
  /** Whether a teammate's item wears their face, which a person's group header says instead. */
  face?: boolean;
  /** Whether the end draws the task's status, which a row saying it elsewhere leaves to a reader's ears. */
  standing?: boolean;
  /** Whether a reader hears Needs you where the item needs them, which a row under a name already saying it leaves out. */
  needsYouSaid?: boolean;
  before?: ReactNode;
  /** What stands after the time, as a shortcut does. */
  after?: ReactNode;
}

/**
 * The marks at an item row's end, in the Inbox's own order: the face of the
 * teammate whose agent asks it, the Draft pencil where an answer or message
 * waits unsent in its box and that box is not the one open beside the list,
 * its task's status, and how long ago it changed; where it needs the reader,
 * a reader hears Needs you, the eye reading it from the list's Open scope
 * and the counts that lead there rather than from a mark on every row. `before` stands ahead of them, as the row's context does, and `after` behind, as a shortcut does.
 * A row that says where its item stands on a line of its own (`standing`
 * off), the Inbox's own, draws no status at its end, a reader still hearing
 * it there.
 */
export function InboxItemEnd(props: InboxItemEndProps): React.JSX.Element {
  return <InboxItemMarks {...props} drafted={useInboxItemDrafted(props.listed.item)} />;
}

/**
 * An item row's end (`InboxItemEnd`) where its list reads every row's
 * draft at once (`useInboxRowDrafts`), handed whether the item's box holds
 * one rather than reading it row by row.
 */
export function InboxItemMarks({
  listed,
  now,
  readerId,
  open = false,
  face = true,
  standing = true,
  needsYouSaid = true,
  drafted,
  before,
  after,
}: InboxItemEndProps & {
  /** Whether the item's box holds a draft as the item now stands (`rowDrafted`), marked where that box is not the one open. */
  drafted: boolean;
}): React.JSX.Element {
  const { holder, item } = listed;
  const { needsYou, starter } = useInboxStanding(listed, readerId);

  return (
    <InboxRowMeta>
      {before}
      {starter === undefined || !face ? null : <ActorMark actor={starter} size={ACTOR_SIZE.MARK} />}
      {starter === undefined || item.status !== INBOX_STATUS.OPEN ? null : (
        <VisuallyHidden>{waitingOn(starter)}</VisuallyHidden>
      )}
      {drafted && !open ? <DraftMark /> : null}
      {needsYou && needsYouSaid ? <VisuallyHidden>{NEEDS_YOU.LABEL}</VisuallyHidden> : null}
      <TaskStatusChip holder={holder} drawn={standing} />
      {item.remindAt === undefined ? (
        <Time at={item.updatedAt} now={now} hint={false} />
      ) : (
        <span className={INBOX_ROW_DUE}>
          <GLYPH.TIME />
          <VisuallyHidden>{REMIND_WORDS.DUE}</VisuallyHidden>
          <Time at={item.remindAt} look={TIME_LOOK.DUE} now={now} hint={false} />
        </span>
      )}
      {after}
    </InboxRowMeta>
  );
}
