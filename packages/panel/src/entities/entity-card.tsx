import { shortCommit } from "@repo/features/code-ref-words";
import {
  ENTITY_KIND,
  type Entity,
  type EntityKind,
  type EntityOf,
} from "@repo/features/entity-kind";
import type { MentionLines } from "@repo/features/mention-link";
import { HoverCardSkeleton } from "@repo/ui";
import type { ReactNode } from "react";
import { AppCard } from "../actor-ref.js";
import { tabCard } from "../desktop/tab-card.js";
import {
  AutomationChipCard,
  PageChipCard,
  PersonChipCard,
  SectionChipCard,
  UnreadPageCard,
  VersionChipCard,
} from "../tasks/chip-cards.js";
import { FileCard } from "../tasks/file-ref.js";
import { InboxItemChipCard } from "../tasks/inbox-item-chip.js";
import {
  AgentPullRequestChipCard,
  MentionedAgentCard,
  PullRequestChipCard,
} from "../tasks/mentioned-agent-card.js";
import { ServerCard } from "../tasks/server-card.js";
import { TAB_KIND } from "../tasks/tab-look.js";

/**
 * entity-card.tsx -- the card a chip hangs for each kind of entity it names, one entry per kind (`@repo/features/entity-kind`).
 *
 * A mention's chip and an app link's chip both hang their entity's card
 * through `entityCard`, so a plan's chip hangs the plan's card whichever way
 * it was written. The table is keyed by every `ENTITY_KIND` and typed over
 * each kind's own `Entity`, so a kind added there fails to compile until it
 * says what card it hangs. A kind with no card of its own yet hangs the
 * chip's own, its glyph and name, and says so by name, `OWN_CARD`. A plan
 * hangs the card its own tab hangs (`tabCard`), and an agent and a pull
 * request the cards theirs hang, read as they are first hung
 * (`mentioned-agent-card.tsx`), wherever the chip stands. A card that reads what it shows
 * as it is hung waits in one way whatever its kind (`HoverCardSkeleton`),
 * and stands in with the chip's own only where the read answers nothing.
 */

/** What a chip hands its entity's card: the card it draws of its own, and where it stands. */
export interface EntityCardAt {
  /** The chip's own card, its glyph and its name, which a kind with none of its own hangs, and any card stands in with where the window holds nothing. */
  readonly own: ReactNode;
  /** The chip's glyph, which a card waiting on its read wears. */
  readonly glyph: ReactNode;
  /** The name the chip calls it by. */
  readonly name: string;
  /** The slug of the workspace the link was written under. */
  readonly workspace: string;
  /** The workspace the words are of, by its id. */
  readonly wordsWorkspaceId: string | undefined;
  /** The repository the place names, `owner/name`, which a file is read in. */
  readonly repository: string | undefined;
  /** What a section's card says of it where the description no longer holds it; none while it does. */
  readonly gone: string | undefined;
}

/** The card a kind hangs. */
type EntityCard<T> = (entity: T, at: EntityCardAt) => ReactNode;

/** The cards, one entry per kind. */
type EntityCards = { readonly [K in EntityKind]: EntityCard<EntityOf<K>> };

/** Where a file or a folder no lines pin is read: the head of its repository's default branch, as its link names it. */
const DEFAULT_BRANCH_WORDS = "On the default branch";

/** A kind with no card of its own, which hangs the chip's own: its glyph and its name. */
const OWN_CARD: EntityCard<Entity> = (_entity, at) => at.own;

/** What a file's card says of the lines a mention pins: where they run, and the commit they were read at. */
function linesNote(lines: MentionLines | undefined): string | undefined {
  if (lines === undefined) return undefined;

  const span =
    lines.startLine === lines.endLine
      ? `Line ${lines.startLine}`
      : `Lines ${lines.startLine}–${lines.endLine}`;

  return `${span} at ${shortCommit(lines.commit)}`;
}

/** A card's one waiting state while what it shows is read: the chip's glyph and name over a line standing in for the rest. */
function reading(at: EntityCardAt): ReactNode {
  return <HoverCardSkeleton glyph={at.glyph} name={at.name} />;
}

/** An MCP server's card, or one of its tools': its server's row as the MCP popover draws it. */
const SERVER_CARD: EntityCard<EntityOf<typeof ENTITY_KIND.SERVER | typeof ENTITY_KIND.TOOL>> = (
  server,
) => <ServerCard provider={server.provider} connection={server.connection} />;

/** An automation's card, or one of its runs': the automation's, read in the workspace its link names. */
const AUTOMATION_CARD: EntityCard<
  EntityOf<typeof ENTITY_KIND.AUTOMATION | typeof ENTITY_KIND.AUTOMATION_RUN>
> = (automation, at) => (
  <AutomationChipCard
    automationId={automation.automationId}
    workspace={at.workspace}
    wordsWorkspaceId={at.wordsWorkspaceId}
    reading={reading(at)}
    fallback={at.own}
  />
);

/** The card each kind hangs, as the window hangs it wherever it names the entity; the chip's own standing in where the window holds none. */
const ENTITY_CARD: EntityCards = {
  [ENTITY_KIND.PLAN]: (plan, at) =>
    tabCard({ kind: TAB_KIND.PLAN, taskId: plan.taskId, name: at.name }),
  [ENTITY_KIND.SECTION]: (section, at) => (
    <SectionChipCard
      taskId={section.taskId}
      anchor={section.anchor}
      name={at.name}
      gone={at.gone}
      fallback={at.own}
    />
  ),
  [ENTITY_KIND.VERSION]: (version, at) => (
    <VersionChipCard taskId={version.planId} revision={version.revision} fallback={at.own} />
  ),
  [ENTITY_KIND.COMMENT]: OWN_CARD,
  // Note that an older link's page an agent showed on itself names no task to read it through, so it hangs the card of a page not read.
  [ENTITY_KIND.PAGE]: (page, at) =>
    "taskId" in page ? (
      <PageChipCard
        place={{ taskId: page.taskId }}
        pageId={page.pageId}
        reading={reading(at)}
        fallback={<UnreadPageCard glyph={at.glyph} name={at.name} />}
      />
    ) : (
      <UnreadPageCard glyph={at.glyph} name={at.name} />
    ),
  [ENTITY_KIND.AGENT]: (agent, at) => (
    <MentionedAgentCard agentId={agent.agentId} reading={reading(at)} fallback={at.own} />
  ),
  [ENTITY_KIND.WORKER]: OWN_CARD,
  [ENTITY_KIND.APP]: () => <AppCard />,
  [ENTITY_KIND.CHANGES]: (changes, at) => (
    <AgentPullRequestChipCard
      agentId={changes.agentId}
      taskId={changes.planId}
      reading={reading(at)}
      fallback={at.own}
    />
  ),
  [ENTITY_KIND.PULL_REQUEST]: (pullRequest, at) => (
    <PullRequestChipCard url={pullRequest.url} reading={reading(at)} fallback={at.own} />
  ),
  [ENTITY_KIND.PULL_REQUEST_THREAD]: OWN_CARD,
  [ENTITY_KIND.ISSUE]: OWN_CARD,
  [ENTITY_KIND.LINK]: OWN_CARD,
  [ENTITY_KIND.MESSAGE]: OWN_CARD,
  [ENTITY_KIND.HOME]: OWN_CARD,
  [ENTITY_KIND.BOARD]: OWN_CARD,
  [ENTITY_KIND.INBOX]: OWN_CARD,
  [ENTITY_KIND.INBOX_ITEM]: (item, at) => <InboxItemChipCard place={item} fallback={at.own} />,
  [ENTITY_KIND.AUTOMATIONS]: OWN_CARD,
  [ENTITY_KIND.AUTOMATION]: AUTOMATION_CARD,
  [ENTITY_KIND.AUTOMATION_RUN]: AUTOMATION_CARD,
  [ENTITY_KIND.SETTINGS]: OWN_CARD,
  // A person hangs their card as the members of the workspace their link names draw them.
  [ENTITY_KIND.PERSON]: (person, at) => (
    <PersonChipCard
      userId={person.userId}
      workspace={at.workspace}
      reading={reading(at)}
      fallback={at.own}
    />
  ),
  [ENTITY_KIND.ADMIN]: OWN_CARD,
  [ENTITY_KIND.FILE]: (file, at) => (
    <FileCard
      path={file.path}
      repository={at.repository}
      note={linesNote(file.lines) ?? branchNote(at.repository)}
    />
  ),
  [ENTITY_KIND.FOLDER]: OWN_CARD,
  [ENTITY_KIND.SERVER]: SERVER_CARD,
  [ENTITY_KIND.TOOL]: SERVER_CARD,
  [ENTITY_KIND.SKILL]: OWN_CARD,
  [ENTITY_KIND.REPOSITORY]: OWN_CARD,
  [ENTITY_KIND.WORKSPACE]: OWN_CARD,
  [ENTITY_KIND.DATE]: OWN_CARD,
};

/** An entity's card drawn through its kind's own entry. */
function cardOf<K extends EntityKind>(kind: K, entity: EntityOf<K>, at: EntityCardAt): ReactNode {
  return ENTITY_CARD[kind](entity, at);
}

/** What a file's or a folder's card says of where it is read with no lines pinned: the repository's default branch, where a repository names it. */
export function branchNote(repository: string | undefined): string | undefined {
  return repository === undefined ? undefined : DEFAULT_BRANCH_WORDS;
}

/** The card an entity hangs, by its kind's entry. */
export function entityCard(entity: Entity, at: EntityCardAt): ReactNode {
  return cardOf(entity.kind, entity, at);
}
