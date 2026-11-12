import {
  issueAddressOf,
  LINK_DESTINATION,
  type LinkDestination,
  type LinkDestinationKind,
  type NumberedAddress,
  pullRequestAddressOf,
} from "./link-grammar.js";
import { MENTION_KIND, type Mention } from "./mention-link.js";
import { PRODUCT_NAME } from "./product-name.js";
import { titlesNothing } from "./task-wire.js";
import { TERM } from "./words.js";

/**
 * entity-kind.ts -- every kind of entity the app names, and what the window calls each by now.
 *
 * An entity is named in words in two ways: a mention (`mention-link.ts`), a
 * plan, a file, an agent, a pull request's page, and a link to a destination
 * in the app (`link-grammar.ts`), an Inbox item, an automation, a version of a
 * description. Both name some of the same entities, a plan, a section, a page, an
 * agent, a person, so `ENTITY_KIND` is the one list of them all, and a
 * mention or a destination is read as the `Entity` it names (`entityOfMention`,
 * `entityOfDestination`) before anything draws it.
 *
 * What draws a kind is a table keyed by `ENTITY_KIND` and typed over each
 * kind's own `Entity`, never a switch with a default: a kind added here
 * fails to compile until every table says how it is drawn, so no kind
 * falls through to a fallback nobody chose. Where a kind has nothing of
 * its own to draw yet, its entry says so by name (`NO_LIVE_NAME` here,
 * `OWN_CARD` beside the cards in the panel), so what is left to fill in
 * is a list one search finds. This one holds the live name: the name the
 * window holds for an entity now, which a chip calls it by over, or after,
 * the words it was written with.
 *
 * A pull request's and a GitHub issue's page are mentioned as links, so a
 * link is read as one of them where its address is one, and as a page of
 * an integration's or a site's otherwise. A skill, a repository, and a
 * workspace are kinds no mention or link names yet; their rows will.
 */

/** The kinds no mention or link has a kind of its own for. */
const OWN_KIND = {
  PULL_REQUEST: "pull-request",
  ISSUE: "issue",
  SKILL: "skill",
  REPOSITORY: "repository",
  WORKSPACE: "workspace",
} as const;

/** Every kind of entity the app names; a mention's and a destination's kinds spelled as their own, which `Entity` holds them to. */
export const ENTITY_KIND = {
  PLAN: MENTION_KIND.TASK,
  SECTION: MENTION_KIND.SECTION,
  VERSION: LINK_DESTINATION.VERSION,
  COMMENT: LINK_DESTINATION.COMMENT,
  PAGE: MENTION_KIND.PAGE,
  AGENT: MENTION_KIND.AGENT,
  WORKER: LINK_DESTINATION.WORKER,
  APP: MENTION_KIND.APP,
  CHANGES: LINK_DESTINATION.CHANGES,
  PULL_REQUEST: OWN_KIND.PULL_REQUEST,
  PULL_REQUEST_THREAD: LINK_DESTINATION.PULL_REQUEST_THREAD,
  ISSUE: OWN_KIND.ISSUE,
  /** A page of an integration's, a Linear issue say, or of a well-known site. */
  LINK: MENTION_KIND.LINK,
  MESSAGE: LINK_DESTINATION.MESSAGE,
  HOME: LINK_DESTINATION.HOME,
  /** The workspace's Board, which the sidebar names Tasks. */
  BOARD: LINK_DESTINATION.BOARD,
  INBOX: LINK_DESTINATION.INBOX,
  INBOX_ITEM: LINK_DESTINATION.INBOX_ITEM,
  AUTOMATIONS: LINK_DESTINATION.AUTOMATIONS,
  AUTOMATION: LINK_DESTINATION.AUTOMATION,
  AUTOMATION_RUN: LINK_DESTINATION.AUTOMATION_RUN,
  SETTINGS: LINK_DESTINATION.SETTINGS,
  PERSON: MENTION_KIND.PERSON,
  ADMIN: LINK_DESTINATION.ADMIN,
  FILE: MENTION_KIND.FILE,
  FOLDER: MENTION_KIND.FOLDER,
  /** An MCP server. */
  SERVER: MENTION_KIND.SERVER,
  /** One of an MCP server's tools. */
  TOOL: MENTION_KIND.TOOL,
  SKILL: OWN_KIND.SKILL,
  REPOSITORY: OWN_KIND.REPOSITORY,
  WORKSPACE: OWN_KIND.WORKSPACE,
  DATE: MENTION_KIND.DATE,
} as const satisfies Record<string, Entity["kind"]>;

export type EntityKind = (typeof ENTITY_KIND)[keyof typeof ENTITY_KIND];

/** The destinations a mention names too, which are read as the mention's entity. */
type SharedDestinationKind =
  | typeof LINK_DESTINATION.TASK
  | typeof LINK_DESTINATION.SECTION
  | typeof LINK_DESTINATION.PAGE
  | typeof LINK_DESTINATION.AGENT
  | typeof LINK_DESTINATION.PERSON;

/**
 * An entity, by the ids that name it and nothing of its words: as a mention
 * names it, where one does, and as a link to its destination does otherwise.
 */
export type Entity =
  | Exclude<Mention, { readonly kind: typeof MENTION_KIND.LINK }>
  | Extract<Mention, { readonly kind: typeof MENTION_KIND.LINK }>
  | { readonly kind: typeof OWN_KIND.PULL_REQUEST; readonly url: string }
  | { readonly kind: typeof OWN_KIND.ISSUE; readonly url: string }
  | Exclude<LinkDestination, { readonly kind: SharedDestinationKind }>
  /** A skill, by the name an agent runs it by. */
  | { readonly kind: typeof OWN_KIND.SKILL; readonly name: string }
  /** A repository, `owner/name`. */
  | { readonly kind: typeof OWN_KIND.REPOSITORY; readonly repository: string }
  /** A workspace, by its slug. */
  | { readonly kind: typeof OWN_KIND.WORKSPACE; readonly workspace: string };

/** An entity of the kind given. */
export type EntityOf<K extends EntityKind> = Extract<Entity, { readonly kind: K }>;

/** A destination of the kind given. */
type DestinationOf<K extends LinkDestinationKind> = Extract<LinkDestination, { readonly kind: K }>;

/** The names the window holds, each by the id the service minted it under. */
export interface KnownNames {
  readonly tasks: ReadonlyMap<string, string>;
  readonly agents: ReadonlyMap<string, string>;
  /** The catalog id of the model each agent the window holds runs on, which its harness's mark is read off; titled or not. */
  readonly agentModels: ReadonlyMap<string, string>;
  /** The pages of the one task the window holds them for, `pagesTaskId`. */
  readonly pages: ReadonlyMap<string, string>;
  /** The task whose pages `pages` names, the window's open one; none where it holds no task's pages. */
  readonly pagesTaskId: string | undefined;
  readonly inboxItems: ReadonlyMap<string, string>;
  readonly people: ReadonlyMap<string, string>;
  readonly automations: ReadonlyMap<string, string>;
}

/** What names an entity beyond the names the window holds: the heading its anchor names in the description open, the key and title its provider answered for its page, and the repository, `owner/name`, of the place the entity is named in, which a pull request's or an issue's key leaves out where it is the same. */
export interface EntitySaid {
  readonly heading: string | undefined;
  readonly answered: { readonly key: string; readonly title: string } | undefined;
  readonly repository: string | null;
}

/** What an entity is called now, where the window holds it, and whether that wins over the words it was written with. */
interface EntityName<T> {
  /**
   * Whether the name held wins over the words the entity was written with,
   * which name it as it was then; otherwise the words win, and the name
   * held stands in only where it was written bare.
   */
  readonly live: boolean;
  readonly held: (entity: T, known: KnownNames, said: EntitySaid) => string | undefined;
  /** Whether a name held is a placeholder that names nothing, which gives way to the words as a name not live does. */
  readonly blank?: (held: string) => boolean;
}

/** The live names, one entry per kind. */
type EntityNames = { readonly [K in EntityKind]: EntityName<EntityOf<K>> };

/** What an entity's name held answers: the name, where there is one, and whether it wins over the words. */
export interface EntityNameHeld {
  readonly live: boolean;
  readonly held: string | undefined;
}

/** Nothing said of an entity beyond the names the window holds. */
export const NOTHING_SAID: EntitySaid = {
  heading: undefined,
  answered: undefined,
  repository: null,
};

/** A kind the window holds no name of, which is called by the words it was written with. */
const NO_LIVE_NAME: EntityName<Entity> = { live: false, held: () => undefined };

/** A provider's page, called by the key and title its provider answered, where it was written bare. */
const ANSWERED_NAME: EntityName<Entity> = {
  live: false,
  held: (_entity, _known, { answered }) =>
    answered === undefined ? undefined : `${answered.key} ${answered.title}`,
};

/**
 * What a pull request or an issue is called by its number: `#42` in the
 * repository the place stands on, compared whatever its case as GitHub reads
 * it, and `relay#42` in another.
 */
function numberedKey(address: NumberedAddress, repository: string | null): string {
  if (repository !== null && address.repository.toLowerCase() === repository.toLowerCase()) {
    return `#${address.number}`;
  }

  return `${address.repository.split("/")[1] ?? address.repository}#${address.number}`;
}

/**
 * A pull request's or an issue's page, called by the key and title its
 * provider answered where it was written bare, and by its key alone, as the
 * address says it, until then or where it never does: a refusal, no GitHub
 * App on the repository, a workspace without GitHub.
 */
function numberedName(
  addressOf: (url: string) => NumberedAddress | undefined,
): EntityName<{ readonly url: string }> {
  return {
    live: false,
    held: ({ url }, _known, { answered, repository }) => {
      if (answered !== undefined) return `${answered.key} ${answered.title}`;
      const address = addressOf(url);

      return address === undefined ? undefined : numberedKey(address, repository);
    },
  };
}

/** An agent's name held, said with the words given before it: "Changes by Ada". */
function byAgent(words: string, agentId: string, known: KnownNames): string | undefined {
  const agent = known.agents.get(agentId);

  return agent === undefined ? undefined : `${words} ${agent}`;
}

/** What each kind is called now. */
const ENTITY_NAME: EntityNames = {
  // Note that a plan the window still holds as Untitled gives way to the words it was written with, which say more.
  [ENTITY_KIND.PLAN]: {
    live: true,
    blank: titlesNothing,
    held: (plan, known) => known.tasks.get(plan.taskId),
  },
  [ENTITY_KIND.SECTION]: { live: true, held: (_section, _known, { heading }) => heading },
  [ENTITY_KIND.VERSION]: {
    live: false,
    held: (version, known) => {
      const taskName = known.tasks.get(version.planId);

      return taskName === undefined ? undefined : `${taskName}, version ${version.revision}`;
    },
  },
  [ENTITY_KIND.COMMENT]: NO_LIVE_NAME,
  // Note that the window holds the pages of its open task alone, so a page of any other borrows none of their names.
  [ENTITY_KIND.PAGE]: {
    live: true,
    held: (page, known) =>
      "taskId" in page && page.taskId === known.pagesTaskId
        ? known.pages.get(page.pageId)
        : undefined,
  },
  [ENTITY_KIND.AGENT]: { live: true, held: (agent, known) => known.agents.get(agent.agentId) },
  [ENTITY_KIND.WORKER]: NO_LIVE_NAME,
  [ENTITY_KIND.APP]: { live: true, held: () => PRODUCT_NAME },
  [ENTITY_KIND.CHANGES]: {
    live: false,
    held: (changes, known) => byAgent("Changes by", changes.agentId, known),
  },
  [ENTITY_KIND.PULL_REQUEST]: numberedName(pullRequestAddressOf),
  [ENTITY_KIND.PULL_REQUEST_THREAD]: NO_LIVE_NAME,
  [ENTITY_KIND.ISSUE]: numberedName(issueAddressOf),
  [ENTITY_KIND.LINK]: ANSWERED_NAME,
  [ENTITY_KIND.MESSAGE]: {
    live: false,
    held: (message, known) => byAgent("Message from", message.agentId, known),
  },
  [ENTITY_KIND.HOME]: NO_LIVE_NAME,
  [ENTITY_KIND.BOARD]: NO_LIVE_NAME,
  [ENTITY_KIND.INBOX]: NO_LIVE_NAME,
  [ENTITY_KIND.INBOX_ITEM]: {
    live: true,
    held: (item, known) => known.inboxItems.get(item.itemId),
  },
  [ENTITY_KIND.AUTOMATIONS]: NO_LIVE_NAME,
  // Note that an automation's chip reads its workspace's automations as it is drawn (`LinkAutomations`), so the name held is its name now.
  [ENTITY_KIND.AUTOMATION]: {
    live: true,
    held: (automation, known) => known.automations.get(automation.automationId),
  },
  [ENTITY_KIND.AUTOMATION_RUN]: {
    live: false,
    held: (run, known) => known.automations.get(run.automationId),
  },
  [ENTITY_KIND.SETTINGS]: NO_LIVE_NAME,
  [ENTITY_KIND.PERSON]: { live: true, held: (person, known) => known.people.get(person.userId) },
  [ENTITY_KIND.ADMIN]: NO_LIVE_NAME,
  [ENTITY_KIND.FILE]: NO_LIVE_NAME,
  [ENTITY_KIND.FOLDER]: NO_LIVE_NAME,
  [ENTITY_KIND.SERVER]: NO_LIVE_NAME,
  [ENTITY_KIND.TOOL]: NO_LIVE_NAME,
  [ENTITY_KIND.SKILL]: NO_LIVE_NAME,
  [ENTITY_KIND.REPOSITORY]: NO_LIVE_NAME,
  [ENTITY_KIND.WORKSPACE]: NO_LIVE_NAME,
  [ENTITY_KIND.DATE]: NO_LIVE_NAME,
};

/**
 * What each kind is called in words, which a screen reader hears before an
 * entity's name, since the glyph that says it to the eye is hidden from one:
 * "pull request #42 Fix the refresh". Its nouns are the glossary's
 * (`words.ts`'s `TERM`) where it has one. Read it through `entityWordHeard`,
 * which leaves it out where the name already says it.
 */
export const ENTITY_WORD: Readonly<Record<EntityKind, string>> = {
  [ENTITY_KIND.PLAN]: TERM.TASK.one,
  [ENTITY_KIND.SECTION]: TERM.SECTION.one,
  [ENTITY_KIND.VERSION]: "version",
  [ENTITY_KIND.COMMENT]: "comment",
  [ENTITY_KIND.PAGE]: TERM.PAGE.one,
  [ENTITY_KIND.AGENT]: TERM.AGENT.one,
  [ENTITY_KIND.WORKER]: TERM.WORKER.one,
  [ENTITY_KIND.APP]: PRODUCT_NAME,
  [ENTITY_KIND.CHANGES]: "changes",
  [ENTITY_KIND.PULL_REQUEST]: TERM.PULL_REQUEST.one,
  [ENTITY_KIND.PULL_REQUEST_THREAD]: "review thread",
  [ENTITY_KIND.ISSUE]: "issue",
  [ENTITY_KIND.LINK]: "link",
  [ENTITY_KIND.MESSAGE]: "message",
  [ENTITY_KIND.HOME]: "Home",
  [ENTITY_KIND.BOARD]: "tasks",
  [ENTITY_KIND.INBOX]: "Inbox",
  [ENTITY_KIND.INBOX_ITEM]: `Inbox ${TERM.INBOX_ITEM.one}`,
  [ENTITY_KIND.AUTOMATIONS]: "automations",
  [ENTITY_KIND.AUTOMATION]: "automation",
  [ENTITY_KIND.AUTOMATION_RUN]: "automation run",
  [ENTITY_KIND.SETTINGS]: "settings",
  [ENTITY_KIND.PERSON]: TERM.MEMBER.one,
  [ENTITY_KIND.ADMIN]: "admin",
  [ENTITY_KIND.FILE]: TERM.FILE.one,
  [ENTITY_KIND.FOLDER]: "folder",
  [ENTITY_KIND.SERVER]: TERM.INTEGRATION.one,
  [ENTITY_KIND.TOOL]: "tool",
  [ENTITY_KIND.SKILL]: TERM.SKILL.one,
  [ENTITY_KIND.REPOSITORY]: TERM.REPOSITORY.one,
  [ENTITY_KIND.WORKSPACE]: "workspace",
  [ENTITY_KIND.DATE]: "date",
};

/**
 * The word a screen reader hears before an entity's name: its kind's
 * (`ENTITY_WORD`), or nothing where the name already starts with it, as
 * "Inbox", the app's own name, and "Changes by Ada" do. Note that a link labeled with
 * words of its own, `[my queue](…/inbox)`, still says its kind.
 */
export function entityWordHeard(kind: EntityKind, name: string): string | undefined {
  const word = ENTITY_WORD[kind];
  const lead = name.slice(0, word.length);
  const said = lead.localeCompare(word, undefined, { sensitivity: "base" }) === 0;
  // Note that the word must end where a word does, so "Taskbar" still says it is a task.
  const whole = !/^[\p{L}\p{N}]/u.test(name.slice(word.length));

  return said && whole ? undefined : word;
}

/**
 * What an entity is called where nothing names it, neither the window nor
 * its words: its kind's word (`ENTITY_WORD`) as a name, "Automation run", so
 * a screen reader hears its kind once (`entityWordHeard`).
 */
export function entityKindName(kind: EntityKind): string {
  const word = ENTITY_WORD[kind];

  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/** A destination the entity it names already is. */
function asEntity<P extends Entity>(place: P): Entity {
  return place;
}

type DestinationEntities = {
  readonly [K in LinkDestinationKind]: (place: DestinationOf<K>) => Entity;
};

/** The entity each kind of destination names. */
const DESTINATION_ENTITY: DestinationEntities = {
  [LINK_DESTINATION.TASK]: (place) => ({ kind: ENTITY_KIND.PLAN, taskId: place.planId }),
  [LINK_DESTINATION.SECTION]: (place) => ({
    kind: ENTITY_KIND.SECTION,
    taskId: place.planId,
    anchor: place.anchor,
  }),
  [LINK_DESTINATION.PAGE]: (place) =>
    "planId" in place
      ? { kind: ENTITY_KIND.PAGE, taskId: place.planId, pageId: place.pageId }
      : { kind: ENTITY_KIND.PAGE, agentId: place.agentId, pageId: place.pageId },
  // Note that an older link naming the agent under its task names the agent alone, as its mention does.
  [LINK_DESTINATION.AGENT]: (place) => ({ kind: ENTITY_KIND.AGENT, agentId: place.agentId }),
  [LINK_DESTINATION.PERSON]: (place) => ({ kind: ENTITY_KIND.PERSON, userId: place.userId }),
  [LINK_DESTINATION.COMMENT]: asEntity,
  [LINK_DESTINATION.VERSION]: asEntity,
  [LINK_DESTINATION.WORKER]: asEntity,
  [LINK_DESTINATION.CHANGES]: asEntity,
  [LINK_DESTINATION.PULL_REQUEST_THREAD]: asEntity,
  [LINK_DESTINATION.MESSAGE]: asEntity,
  [LINK_DESTINATION.HOME]: asEntity,
  [LINK_DESTINATION.BOARD]: asEntity,
  [LINK_DESTINATION.INBOX]: asEntity,
  [LINK_DESTINATION.INBOX_ITEM]: asEntity,
  [LINK_DESTINATION.AUTOMATIONS]: asEntity,
  [LINK_DESTINATION.AUTOMATION]: asEntity,
  [LINK_DESTINATION.AUTOMATION_RUN]: asEntity,
  [LINK_DESTINATION.SETTINGS]: asEntity,
  [LINK_DESTINATION.ADMIN]: asEntity,
};

/** A destination read through its kind's own entry, which keeps the kind and the destination it reads together. */
function destinationEntity<K extends LinkDestinationKind>(
  kind: K,
  place: DestinationOf<K>,
): Entity {
  return DESTINATION_ENTITY[kind](place);
}

/** An entity's name read through its kind's own entry. */
function nameOf<K extends EntityKind>(
  kind: K,
  entity: EntityOf<K>,
  known: KnownNames,
  said: EntitySaid,
): EntityNameHeld {
  const { live, held, blank } = ENTITY_NAME[kind];
  const name = held(entity, known, said);
  const placeholder = name !== undefined && blank !== undefined && blank(name);

  return { live: live && !placeholder, held: name };
}

/** The entity a mention names: a link to a pull request's or a GitHub issue's page that one, and any other mention the entity it is. */
export function entityOfMention(mention: Mention): Entity {
  if (mention.kind !== MENTION_KIND.LINK) return mention;

  if (pullRequestAddressOf(mention.url) !== undefined) {
    return { kind: ENTITY_KIND.PULL_REQUEST, url: mention.url };
  }

  if (issueAddressOf(mention.url) !== undefined) {
    return { kind: ENTITY_KIND.ISSUE, url: mention.url };
  }

  return mention;
}

/** The entity a link to a destination in the app names. */
export function entityOfDestination(place: LinkDestination): Entity {
  return destinationEntity(place.kind, place);
}

/** What the window calls an entity now, by its kind's entry, and whether that wins over the words it was written with. */
export function entityName(entity: Entity, known: KnownNames, said: EntitySaid): EntityNameHeld {
  return nameOf(entity.kind, entity, known, said);
}
