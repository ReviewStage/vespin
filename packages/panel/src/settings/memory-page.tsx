import { MEMORY_SAVE_FAILURE, type MemorySaveAnswerView } from "@repo/features/agent-view";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import { markdownTree } from "@repo/features/markdown-tree";
import {
  MEMORY_BOUNDS,
  MEMORY_RECALL_WINDOW_DAYS,
  type MemorySummary,
} from "@repo/features/memory-wire";
import { encodeMention, MENTION_KIND } from "@repo/features/mention-link";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { matchesTokens, searchTokens } from "@repo/features/search-tokens";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  countWords,
  readFailedWords,
  readingWords,
  SIGNED_OUT_WORDS,
  TERM,
} from "@repo/features/words";
import type { Workspace } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { SETTINGS_SEARCH_ROW } from "@repo/settings/settings-anchors";
import {
  Badge,
  BUTTON_VARIANT,
  Button,
  CardPress,
  CHIP_LOOK,
  Chip,
  ChipName,
  CONFIRM_LOSS,
  Comment,
  CommentSkeleton,
  type CommentSkeletonLine,
  ConfirmDialog,
  CornerDot,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  EmptyState,
  FormField,
  GAP,
  IconButton,
  Inline,
  LIST_MOTION_WAY,
  ListMotion,
  MoreButton,
  PlusIcon,
  SELECT_BOX_PLACE,
  SETTINGS_SECTION_FRAME,
  SearchField,
  SearchIcon,
  type SelectionAct,
  SelectionBar,
  SelectionRegion,
  SettingsLine,
  SettingsSection,
  SkeletonRegion,
  STATUS_TONE,
  Stack,
  selectionMenu,
  TEXT_AREA_SUBMIT,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextArea,
  TIME_LOOK,
  Time,
  Tooltip,
  TrashIcon,
  useConfirmDialog,
  useLeaving,
  useMenu,
  useMinute,
  usePageScroll,
  VisuallyHidden,
} from "@repo/ui";
import {
  ACTOR_KIND,
  type Actor,
  actorName,
  DELETED_ACCOUNT_ACTOR,
  personActor,
} from "@repo/ui/actor-model";
import { GLYPH, ListFilterIcon } from "@repo/ui/icons";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import {
  VIRTUAL_ROWS_ANCHOR,
  type VirtualRowPlace,
  VirtualRows,
  type VirtualRowsHandle,
} from "@repo/ui/virtual-rows";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { mutationOptions, useIsMutating, useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useId, useMemo, useRef, useState } from "react";
import { actFailureWords, sendAct } from "../act.js";
import { ACTOR_SIZE, ActorMark, ActorRef, commentAuthor } from "../actor-ref.js";
import { ANSWER_ACCEPTED, sameAnswer, useConfirmAct } from "../confirm-act.js";
import { useCopyToast } from "../copy-feedback.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "../desktop/action-menu.js";
import { useFormDialog } from "../desktop/use-form-dialog.js";
import { confirmFailure } from "../failure-report.js";
import { memoriesQuery, memoriesRetryMutation } from "../live-reads.js";
import { MarkdownMessage } from "../markdown-message.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import { PEOPLE_FILTER_WORDS } from "../member-rows.js";
import { linkChip } from "../tasks/mention-chip.js";
import { useMentionDoors } from "../tasks/task-mentions.js";
import { useOpenPlace } from "../tasks/use-open-link.js";
import { ReadFailed, replayMaskedError } from "./marks.js";

/**
 * memory-page.tsx -- Settings › Memory: the facts and conventions the workspace's coding agents kept, found by search and by whose they are, and forgotten one at a time or several at once.
 *
 * A coding agent keeps a memory as it works without asking, and corrects one
 * in place when its developer says otherwise. They are the workspace's: every
 * member's agents in it recall them, and nothing crosses into another
 * workspace. The page draws them as the host holds them, followed live on
 * the service (`LIVE_READ.MEMORIES`), so one an agent keeps, or another
 * member forgets, draws while the page is open.
 *
 * At the top, a search over the words and their keeper's name
 * (`searchTokens`), lit where it landed, and the Tasks page's Filter, its
 * glyph alone with a dot while it keeps anything, whose one field is Kept by,
 * each keeper with their face and how many they kept, and everyone who left
 * the workspace as one; a chip under the search says each one kept, its ×
 * lifting it, beside a Clear.
 *
 * The memories agents use stand first: most recalled in the last thirty
 * days, then most recently kept or corrected, as a caption under the search
 * says, so what no agent reaches sinks to the foot, where it is pruned.
 *
 * Each memory reads as a note: its keeper's face and name, the name the
 * panel's person chip hanging their card, when it was last kept, and its
 * words whole at any width, drawn as the notes are, since a memory is
 * Markdown (`pnpm db:generate` in backticks). Under its words a line says
 * New on one kept in the last week, Unused on one older than the recall
 * window that no agent was handed in it, the task its words came from as
 * that task's mention chip, which opens the agent's transcript at the line
 * that kept them where one did, and how often agents were handed it and
 * when last. It opens nothing, so a plain press on it only marks where a
 * run of ⇧-clicks starts. Its ⋯ and a right-click offer Edit, Copy words,
 * and Delete to a reader who may change it: its words are theirs, or they
 * own or administer the workspace. To any other reader Edit stands nowhere
 * and Delete stands unavailable, saying who may. Edit opens the memory's
 * words in a card that saves them in place (`ACT_KIND.MEMORIES_SAVE`
 * naming the memory it replaces), drawn at once over the list; Add memory,
 * beside the Filter, opens the same card empty and keeps a new one.
 *
 * Memories are chosen together as the Tasks page's rows are (#5761): the box
 * in a row's gutter under the pointer, X, ⌘- and ⇧-clicks, ⌘A, and Esc. A
 * bar floating at the page's foot then forgets or copies them all, and a
 * chosen row's ⋯ and right-click offer the bar's acts under how many it acts
 * on. Delete, of one or of several, asks once first, in red, as the Inbox's
 * Resolve does, since no memory comes back once forgotten. Each is gone from
 * the list the moment it is sent, and back only where the service refused
 * it; several are forgotten one after another, the first refusal stopping
 * the rest, and the memories the reader may not forget are left chosen and
 * said so. The list draws only the memories near the view (`VirtualRows`),
 * in the page's own scroller, so a workspace's thousand draw as quickly as a
 * few; ⇧-clicks, ⇧↑↓, and ⌘A reach the memories it leaves undrawn, and the
 * memory holding the keyboard stays drawn wherever the page is scrolled.
 * A memory is members' own words about their work, so the list stands under
 * the mask mark, which Settings' own unmask would otherwise leave readable.
 */

/** What the page says while it cannot read or write, and with no account. */
const PAGE_LINE = {
  FAILED: readFailedWords(`${PRODUCT_NAME}'s memory`),
  WORKSPACES_FAILED: readFailedWords("your workspaces"),
  SIGNED_OUT: SIGNED_OUT_WORDS,
  EMPTY: `${PRODUCT_NAME} hasn't remembered anything yet.`,
  FORGET_FAILED: "The memory could not be deleted. Try again.",
  NO_MATCH: "No memories match",
  CLEAR: "Clear search and filter",
} as const;

/** What the Filter is called, on its tooltip and its menu, and its one field. */
const FILTER = "Filter";
const KEPT_BY = "Saved by";

/** What the selection's acts and a row's menu say. */
const MEMORY_ACT = {
  EDIT: "Edit",
  FORGET: "Delete",
  COPY: "Copy text",
} as const;

/** What the button that keeps a new memory says. */
const ADD_MEMORY = "Add memory";

/** What the editor's card says: its title as it edits or adds, its field, and its act. */
const EDITOR_WORDS = {
  EDIT_TITLE: "Edit memory",
  ADD_TITLE: "Add memory",
  FIELD: "Memory",
  PLACEHOLDER: "A fact or convention your agents should carry into later tasks",
  SAVE: "Save",
  SAVING: "Saving",
} as const;

/** What a save that came to no answer says. */
const SAVE_FAILED = "The memory could not be saved. Try again.";

/** What a save the service refused says, by why. */
const SAVE_REFUSAL = {
  [MEMORY_SAVE_FAILURE.MEMORY_OFF]: "Turn on Memory in Settings › Experimental to save a memory.",
  [MEMORY_SAVE_FAILURE.NOT_FOUND]: "This memory no longer exists.",
  [MEMORY_SAVE_FAILURE.MEMORY_CREDENTIAL]:
    "That looks like it holds a credential, which a memory never keeps.",
  [MEMORY_SAVE_FAILURE.MEMORY_FULL]: `This workspace holds ${MEMORY_BOUNDS.MAX_MEMORIES.toLocaleString("en-US")} memories, the most it can. Delete one first.`,
  [MEMORY_SAVE_FAILURE.UNANSWERED]: SAVE_FAILED,
  // Note that a save is always a POST, so the method refused is never the window's; it reads as no answer.
  [MEMORY_SAVE_FAILURE.METHOD_NOT_ALLOWED]: SAVE_FAILED,
} as const satisfies Record<(typeof MEMORY_SAVE_FAILURE)[keyof typeof MEMORY_SAVE_FAILURE], string>;

/** One day, in milliseconds. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a memory reads as New after it was kept. */
const NEW_FOR_MS = 7 * DAY_MS;

/** How far back a memory's recalls are counted, as the service counts them. */
const RECALL_WINDOW_MS = MEMORY_RECALL_WINDOW_DAYS * DAY_MS;

/** What a memory's line says of how agents use it. */
const USE_WORDS = {
  NEW: "New",
  UNUSED: "Unused",
  NOT_YET: "Not recalled yet",
  NEVER: "Never recalled",
} as const;

/** What the caption under the search says the order is. */
const ORDER_WORDS = `most recalled in the last ${MEMORY_RECALL_WINDOW_DAYS} days first`;

/** The key the Kept by filter keeps everyone who left the workspace under, together. */
const FORMER_KEY = "former";

/** What everyone who left is called in the filter. */
const FORMER_WORDS = "Former members";

/** What the skeletons say to a reader who cannot see them. */
const READING_LABEL = {
  MEMORY: readingWords(`${PRODUCT_NAME}'s memory`),
  WORKSPACES: readingWords("your workspaces"),
} as const;

/** The memories that stand while they are read: each a name over a line or two of words. */
const MEMORIES_SKELETON: readonly {
  readonly key: string;
  readonly name: string;
  readonly lines: readonly CommentSkeletonLine[];
}[] = [
  { key: "first", name: "18%", lines: [{ key: "line", width: "82%" }] },
  {
    key: "second",
    name: "24%",
    lines: [
      { key: "line", width: "94%" },
      { key: "end", width: "40%" },
    ],
  },
  { key: "third", name: "20%", lines: [{ key: "line", width: "66%" }] },
];

/**
 * A memory's row: a list row's box, filled under the pointer, keeping a
 * gutter at its start for its box (`SELECT_BOX_PLACE.GUTTER`) as the Tasks
 * list's rows do. Its note stands over the row's press with the pointer let
 * through, and what in it is a control of its own, the keeper's chip, a
 * link, and the ⋯, lifted over the press so a press on one is its own.
 */
const MEMORY_ROW =
  "memory-row relative list-none rounded-control px-row-inset ps-select-gutter py-ui-8 hover:bg-muted";
const MEMORY_NOTE = "memory-note pointer-events-none";
const LIFTED = "pointer-events-auto relative z-1";
const MEMORY_WORDS = "memory-words [&_a]:pointer-events-auto [&_a]:relative [&_a]:z-1";

/** The search's line: the field taking the room the Filter beside it leaves. */
const SEARCH_LINE =
  "memory-search flex items-center gap-control-gap [&>:first-child]:min-w-0 [&>:first-child]:flex-1";

/** The memories' list, a run of rows. */
const MEMORY_LIST = "memory-list";

/** How tall a memory is taken to stand before it is measured: a name over a line of words, in pixels. */
const MEMORY_ESTIMATE_PX = 72;

/** The room between two memories, in pixels: the theme's `ui-2`. */
const MEMORY_GAP_PX = 2;

/** Where the selection bar floats: at the foot of the page, over the rows, as the Tasks list's does. */
const SELECTION_FOOT =
  "memory-selection pointer-events-none sticky bottom-ui-16 z-4 flex justify-center *:pointer-events-auto";

/** A Markdown node, as far as its words go: the words it holds itself, and what it holds. */
interface WordsNode {
  readonly value?: unknown;
  readonly children?: readonly object[];
}

/** The words a node holds, its marks left out: what a row's press is named by, so a reader hears no backticks. */
function wordsIn(node: WordsNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map((child) => wordsIn(child)).join("");
}

/** Whom the Kept by filter files a memory under: its keeper, or everyone who left as one. */
function keeperKey(memory: MemorySummary, actor: Actor): string {
  if (memory.keptBy === null || actor.kind !== ACTOR_KIND.PERSON) return FORMER_KEY;
  return memory.keptBy.userId;
}

/** Who may delete a memory, as its unavailable Delete says it. */
function forgetterOf(memory: MemorySummary, actor: Actor): string {
  if (actor.kind === ACTOR_KIND.PERSON && actor.you) return "You: its words are yours";
  if (memory.forgettable) return "You, as an owner or admin of the workspace";
  const keeper = actor.kind === ACTOR_KIND.PERSON ? actor.name : undefined;
  return keeper === undefined
    ? "Only an owner or an admin"
    : `Only ${keeper}, or an owner or admin`;
}

/** The memories as the page orders them: most recalled in the recall window first, then most recently kept or corrected, as the service lists them. */
function byUse(memories: readonly MemorySummary[]): readonly MemorySummary[] {
  return [...memories].sort(
    (one, other) => other.recalls30d - one.recalls30d || other.updatedAt - one.updatedAt,
  );
}

/** Where a memory's words came from, as a reader who may open its task sees it. */
type MemorySource = NonNullable<MemorySummary["source"]>;

/**
 * The task a memory's words came from, as that task's mention chip, the one
 * a description draws; its press opens the agent's transcript at the line
 * that kept them where one did, and the task otherwise.
 */
function SourceChip({
  source,
  workspaceStep,
}: {
  source: MemorySource;
  /** The step the workspace's links name it by: its slug, or its id where none traveled. */
  workspaceStep: string;
}): React.JSX.Element | null {
  const { agentId, messageId, taskId, taskName } = source;
  const doors = useMentionDoors();
  const openPlace = useOpenPlace();
  const opened = useMemo(
    () =>
      messageId === null || openPlace === undefined
        ? doors
        : {
            ...doors,
            onOpenTask: () =>
              openPlace({ kind: LINK_DESTINATION.MESSAGE, planId: taskId, agentId, messageId }),
          },
    [doors, openPlace, agentId, messageId, taskId],
  );
  const target = encodeMention(
    { kind: MENTION_KIND.TASK, taskId },
    { workspace: workspaceStep, repository: null },
  );
  const chip = linkChip(target, `@${taskName}`, opened);
  return chip === undefined ? null : <span className={LIFTED}>{chip}</span>;
}

/** How often agents were handed a memory, and when last: in the recall window, before it, or never. */
function RecallWords({ memory, fresh }: { memory: MemorySummary; fresh: boolean }): ReactNode {
  const last = memory.lastRecalledAt;
  if (last === null) return fresh ? USE_WORDS.NOT_YET : USE_WORDS.NEVER;
  const when = <Time at={last} look={TIME_LOOK.AGO} hint={false} />;
  // Note that a memory handed out only before the window counts none in it, so the line says when it last was.
  if (memory.recalls30d === 0) return <>Last recalled {when}</>;
  return (
    <>
      Recalled {memory.recalls30d}× · last {when}
    </>
  );
}

/** The line under a memory's words: New or Unused, the task its words came from, and how agents use it. */
function MemoryUseLine({
  memory,
  workspaceStep,
}: {
  memory: MemorySummary;
  workspaceStep: string;
}): React.JSX.Element {
  const now = useMinute();
  const age = now - memory.createdAt;
  const fresh = age < NEW_FOR_MS;
  const unused = !fresh && age > RECALL_WINDOW_MS && memory.recalls30d === 0;
  return (
    <Inline gap={GAP.ICON} className="memory-use">
      {fresh ? <Badge tone={STATUS_TONE.WORKING}>{USE_WORDS.NEW}</Badge> : null}
      {unused ? <Badge tone={STATUS_TONE.ATTENTION}>{USE_WORDS.UNUSED}</Badge> : null}
      {memory.source === null ? null : (
        <SourceChip source={memory.source} workspaceStep={workspaceStep} />
      )}
      <Text
        variant={TEXT_VARIANT.CAPTION}
        tone={TEXT_TONE.MUTED}
        as={TEXT_ELEMENT.SPAN}
        className="memory-recalls"
      >
        <RecallWords memory={memory} fresh={fresh} />
      </Text>
    </Inline>
  );
}

/** One memory with whose words it holds, as the members the panel reads name them. */
interface ShownMemory {
  readonly memory: MemorySummary;
  readonly actor: Actor;
  readonly keeper: string;
}

/** The memories while they are read: the notes' own shapes, under a label a reader hears. */
function MemoriesSkeleton({ label }: { label: string }): React.JSX.Element {
  return (
    <SkeletonRegion label={label}>
      <Stack gap={GAP.BLOCK}>
        {MEMORIES_SKELETON.map((each) => (
          <CommentSkeleton key={each.key} name={each.name} lines={each.lines} />
        ))}
      </Stack>
    </SkeletonRegion>
  );
}

/** What a row chosen among several acts on: how many, and the bar's acts. */
interface ChosenMemories {
  readonly count: number;
  readonly acts: readonly SelectionAct[];
}

/** A plain press on a memory, which has nothing to open: it only marks where a run of ⇧-clicks starts. */
function anchorOnly(): void {}

/** One memory's row: its note, and its ⋯ and right-click. */
function MemoryRow({
  shown,
  place,
  found,
  locked,
  chosen,
  workspaceStep,
  onEdit,
  onForget,
  onCopy,
}: {
  shown: ShownMemory;
  /** Where the row stands in the run drawing only the rows near the view, which its item wears. */
  place: VirtualRowPlace;
  /** The words the search asks for, lit where they landed. */
  found: readonly string[];
  /** Whether a forget is out, which every Forget waits out. */
  locked: boolean;
  /** The selection the row stands in among several, whose acts its menu offers; none otherwise. */
  chosen: ChosenMemories | undefined;
  /** The step the workspace's links name it by, which the source task's chip is written under. */
  workspaceStep: string;
  onEdit: () => void;
  onForget: () => void;
  onCopy: () => void;
}): React.JSX.Element {
  const { memory, actor } = shown;
  const menu = useMenu(true);
  const own: readonly (readonly MenuEntry[])[] = [
    [
      // Note that Edit stands only where the reader may change the memory's words, who may also delete it, as `forgettable` says.
      ...(memory.forgettable
        ? [{ label: MEMORY_ACT.EDIT, icon: <GLYPH.RENAME />, onSelect: onEdit }]
        : []),
      { label: MEMORY_ACT.COPY, icon: <GLYPH.COPY />, onSelect: onCopy },
    ],
    [
      {
        label: MEMORY_ACT.FORGET,
        icon: <TrashIcon />,
        danger: true,
        disabled: !memory.forgettable || locked,
        detail: memory.forgettable ? undefined : forgetterOf(memory, actor),
        // Note that the detail names who may forget it, which masks the item's words with it.
        replayMasked: !memory.forgettable,
        onSelect: onForget,
      },
    ],
  ];
  return (
    <li {...place} className={MEMORY_ROW}>
      <CardPress
        selectKey={memory.id}
        selectBox={SELECT_BOX_PLACE.GUTTER}
        onPress={anchorOnly}
        contextMenu={menu.contextMenu()}
      >
        <VisuallyHidden>{wordsIn(markdownTree(memory.text))}</VisuallyHidden>
      </CardPress>
      <div className={MEMORY_NOTE}>
        <Comment
          author={commentAuthor(actor)}
          nameRef={
            <span className={LIFTED}>
              <ActorRef actor={actor} nameOnly />
            </span>
          }
          at={memory.updatedAt}
          trailing={
            <span className={LIFTED}>
              <MoreButton thing="Memory" {...menu.trigger()} />
            </span>
          }
        >
          <Stack gap={GAP.TIGHT}>
            <div className={MEMORY_WORDS}>
              <MarkdownMessage words={memory.text} className="memory-text" found={found} />
            </div>
            <MemoryUseLine memory={memory} workspaceStep={workspaceStep} />
          </Stack>
        </Comment>
      </div>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={chosen === undefined ? "Memory actions" : countWords(chosen.count, TERM.MEMORY)}
          heading={
            chosen === undefined ? undefined : (
              <ReplayUnmask>{countWords(chosen.count, TERM.MEMORY)}</ReplayUnmask>
            )
          }
          menu={menu.drawn}
          groups={chosen === undefined ? own : selectionMenu(chosen.acts)}
          replayUnmasked
          onClose={menu.close}
        />
      )}
    </li>
  );
}

/** One keeper the Kept by filter offers: whom it files under, their name and face, and how many they kept. */
interface Keeper {
  readonly key: string;
  readonly label: string;
  readonly face: ReactNode;
  readonly count: number;
  /** Whether the label is a member's name rather than Me or the former members' words, kept masked in a screen recording. */
  readonly named: boolean;
}

/** The keepers of `listed`, the reader first as Me, then each by name, everyone who left last. */
function keepersOf(listed: readonly ShownMemory[]): readonly Keeper[] {
  const byKey = new Map<string, Keeper>();
  for (const { memory, actor } of listed) {
    const key = keeperKey(memory, actor);
    const known = byKey.get(key);
    if (known !== undefined) {
      byKey.set(key, { ...known, count: known.count + 1 });
      continue;
    }
    const former = key === FORMER_KEY;
    const you = actor.kind === ACTOR_KIND.PERSON && actor.you;
    const label = former ? FORMER_WORDS : you ? PEOPLE_FILTER_WORDS.ME : actorName(actor);
    const face = former ? <GLYPH.PEOPLE /> : <ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />;
    byKey.set(key, { key, label, face, count: 1, named: !former && !you });
  }
  const rank = (keeper: Keeper) =>
    keeper.label === PEOPLE_FILTER_WORDS.ME ? 0 : keeper.key === FORMER_KEY ? 2 : 1;
  return [...byKey.values()].sort(
    (one, other) => rank(one) - rank(other) || one.label.localeCompare(other.label),
  );
}

/** Puts `key` in the set or takes it out. */
function toggled(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}

/** The Tasks page's Filter: its glyph alone, named by its tooltip, a dot at its corner while it keeps anything, and Kept by its one field, its keepers listed under it in the menu itself. */
function KeptByFilter({
  keepers,
  kept,
  onKept,
}: {
  keepers: readonly Keeper[];
  kept: ReadonlySet<string>;
  onKept: (kept: ReadonlySet<string>) => void;
}): React.JSX.Element {
  const menu = useMenu(true);
  const people: MenuAction[] = keepers.map((keeper) => ({
    label: keeper.label,
    replayMasked: keeper.named,
    icon: <>{keeper.face}</>,
    detail: String(keeper.count),
    checked: kept.has(keeper.key),
    stays: true,
    onSelect: () => onKept(toggled(kept, keeper.key)),
  }));
  return (
    <>
      <CornerDot shown={kept.size > 0}>
        <Tooltip label={FILTER}>
          <IconButton icon={<ListFilterIcon />} label={FILTER} {...menu.trigger()} />
        </Tooltip>
      </CornerDot>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={FILTER}
          menu={menu.drawn}
          // Note that Kept by is the filter's one field, so its keepers stand in the menu itself under its heading rather than behind a submenu of their own.
          heading={KEPT_BY}
          groups={[people]}
          replayUnmasked
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The keeper a chip stands for, by which its chip leaves. */
const keeperChipKey = (keeper: Keeper): string => keeper.key;

/** The filter's chips and Clear, a chip lifted scaling out where it stood. */
function KeptByLine({
  line,
  keepers,
  kept,
  onKept,
}: {
  line: React.RefObject<HTMLElement | null>;
  keepers: readonly Keeper[];
  kept: ReadonlySet<string>;
  onKept: (kept: ReadonlySet<string>) => void;
}): React.JSX.Element | null {
  // Note that the keepers are read again on every render, so the list the chips leave by is kept until another keeper is kept.
  const listed = keepers.filter((keeper) => kept.has(keeper.key));
  const [stable, setStable] = useState(listed);
  const same =
    stable.length === listed.length &&
    stable.every(
      (keeper, at) => keeper.key === listed[at]?.key && keeper.label === listed[at]?.label,
    );
  if (!same) setStable(listed);
  const drawn = useLeaving(same ? stable : listed, keeperChipKey);
  if (drawn.length === 0) return null;
  return (
    <Inline gap={GAP.TIGHT} ref={line} moves>
      {drawn.map(({ key, value: keeper, leaving }) => {
        const name = `${KEPT_BY} ${keeper.label === PEOPLE_FILTER_WORDS.ME ? "me" : keeper.label}`;
        return (
          <Chip
            key={key}
            look={CHIP_LOOK.FILTER}
            motionKey={key}
            removeLabel={`Remove filter: ${name}`}
            onRemove={() => {
              if (!leaving) onKept(toggled(kept, keeper.key));
            }}
          >
            {keeper.face}
            <ChipName>{name}</ChipName>
          </Chip>
        );
      })}
      {kept.size === 0 ? null : (
        <Button variant={BUTTON_VARIANT.QUIET} onClick={() => onKept(new Set())}>
          Clear
        </Button>
      )}
    </Inline>
  );
}

/** What the filter keeps, a chip for each keeper, its × lifting them, and Clear, under a motion that scales a chip in and out (`ListMotion`). */
function KeptByChips(props: {
  keepers: readonly Keeper[];
  kept: ReadonlySet<string>;
  onKept: (kept: ReadonlySet<string>) => void;
}): React.JSX.Element {
  const line = useRef<HTMLElement | null>(null);
  return (
    <ListMotion root={line} way={LIST_MOTION_WAY.SCALE}>
      <KeptByLine line={line} {...props} />
    </ListMotion>
  );
}

/** What Delete asks, of one memory or of several, and what it says of those the reader may not delete. */
function forgetQuestion(asked: readonly MemorySummary[], left: number) {
  const one = asked.length === 1;
  const them = one ? "it" : "them";
  const body = `No agent will recall ${them} in any later task in this workspace, for anyone.`;
  const kept =
    left === 0
      ? ""
      : ` ${countWords(left, TERM.MEMORY)} you may not delete ${left === 1 ? "stays" : "stay"}.`;
  return {
    title: one ? "Delete this memory?" : `Delete ${countWords(asked.length, TERM.MEMORY)}?`,
    body: `${body}${kept}`,
    verb: `${MEMORY_ACT.FORGET} ${one ? TERM.MEMORY.one : TERM.MEMORY.many}`,
    running: "Deleting",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
  };
}

/** What the list says where it holds nothing: a search or the filter that leaves nothing, or a workspace that has kept nothing yet. */
function NothingShown({
  narrowed,
  onClear,
}: {
  narrowed: boolean;
  onClear: () => void;
}): React.JSX.Element {
  if (narrowed) {
    return (
      <EmptyState
        icon={<SearchIcon />}
        title={PAGE_LINE.NO_MATCH}
        action={{ label: PAGE_LINE.CLEAR, onClick: onClear }}
        replayUnmasked
      />
    );
  }
  return <SettingsLine>{PAGE_LINE.EMPTY}</SettingsLine>;
}

/**
 * Memories forgotten in `workspaceId`, as Forget's question holds its own
 * mutation over them: one after another through the port, each sent once
 * the one before answered, the first refusal stopping the rest. Note that
 * the host draws a forget gone the moment it is asked and keeps it gone
 * until the read carries it, so the answer only says whether it was taken.
 */
function memoriesForgetMutation(workspaceId: string) {
  return mutationOptions({
    mutationKey: [ACT_KIND.MEMORIES_FORGET, workspaceId],
    mutationFn: (ids: readonly string[]): Promise<ActionResult> =>
      ids.reduce<Promise<ActionResult>>(
        (before, id) =>
          before.then((result) =>
            result.status !== ACTION_RESULT_STATUS.ACCEPTED
              ? result
              : sendAct(ACT_KIND.MEMORIES_FORGET, { workspaceId, id })
                  .catch(() => undefined)
                  .then(
                    (answer): ActionResult =>
                      answer === undefined || "failure" in answer
                        ? { status: ACTION_RESULT_STATUS.REJECTED, reason: PAGE_LINE.FORGET_FAILED }
                        : { status: ACTION_RESULT_STATUS.ACCEPTED },
                  ),
          ),
        Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      ),
  });
}

/** A save's answer as the editor's act reads it: taken, or refused in the service's own words. */
function saveAnswered(answer: MemorySaveAnswerView): ActionResult {
  return "failure" in answer
    ? { status: ACTION_RESULT_STATUS.REJECTED, reason: SAVE_REFUSAL[answer.failure] }
    : ANSWER_ACCEPTED;
}

/**
 * The card a memory's words are edited in, or a new one's typed: the words
 * in a note at most `MEMORY_BOUNDS.MAX_CHARS` long, saved through the one
 * save act, naming the memory it replaces where it edits one. A refusal
 * stands in the card in the service's words while the words stay typed.
 * Note that the host draws an edit's words over the list the moment they
 * are sent, so the list shows them whether or not the read has carried
 * them yet.
 */
function useMemoryEditor(workspaceId: string, listed: ReadonlySet<string>) {
  const [editing, setEditing] = useState<MemorySummary | undefined>(undefined);
  const [text, setText] = useState("");
  const saving = useMutation({
    mutationKey: [ACT_KIND.MEMORIES_SAVE, workspaceId],
    mutationFn: (save: { readonly text: string; readonly replaces: string | undefined }) =>
      sendAct(ACT_KIND.MEMORIES_SAVE, {
        workspaceId,
        text: save.text,
        ...(save.replaces === undefined ? {} : { replaces: save.replaces }),
      }),
  });
  const words = text.trim();
  const act = useConfirmAct(saving, {
    send: () => saving.mutateAsync({ text: words, replaces: editing?.id }),
    answered: saveAnswered,
    failed: (error) => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: actFailureWords(error) }),
  });
  // Note that an edit's question goes with its memory, so one deleted meanwhile puts the card away.
  const confirm = useConfirmDialog(
    { subject: editing === undefined || listed.has(editing.id), surfaceOpen: true },
    act,
    confirmFailure(FAILURE_SURFACE.MEMORY_SAVE),
  );
  const form = useFormDialog(
    confirm,
    words !== "" && text.length <= MEMORY_BOUNDS.MAX_CHARS && words !== editing?.text,
  );
  const open = (memory: MemorySummary | undefined) => {
    setEditing(memory);
    setText(memory?.text ?? "");
    confirm.ask();
  };
  const dialog = (
    <Dialog
      open={form.open}
      title={editing === undefined ? EDITOR_WORDS.ADD_TITLE : EDITOR_WORDS.EDIT_TITLE}
      replayUnmasked
      busy={form.settling}
      refused={form.refusal !== undefined}
      onDismiss={form.dismiss}
      onExited={() => {
        // Note that a card put away mid-save, its memory deleted under it, keeps what it edited, so the save's answer finds no question standing rather than one for a new memory.
        if (saving.isPending) return;
        setEditing(undefined);
        setText("");
      }}
      actions={
        <DialogActions
          onCancel={form.dismiss}
          act={{
            verb: EDITOR_WORDS.SAVE,
            tone: DIALOG_TONE.PRIMARY,
            running: EDITOR_WORDS.SAVING,
            ...form.act,
          }}
        />
      }
    >
      <FormField
        label={EDITOR_WORDS.FIELD}
        error={replayMaskedError(form.refusal)}
        count={{ length: text.length, limit: MEMORY_BOUNDS.MAX_CHARS }}
      >
        {(control) => (
          // Note that a memory is a member's own words, kept out of a screen recording as the list's are.
          <ReplayMask>
            <TextArea
              field={control}
              value={text}
              onChange={setText}
              grow
              autoFocus
              placeholder={EDITOR_WORDS.PLACEHOLDER}
              maxLength={MEMORY_BOUNDS.MAX_CHARS}
              busy={form.settling}
              submitKey={TEXT_AREA_SUBMIT.MOD_ENTER}
              onSubmit={form.submit}
            />
          </ReplayMask>
        )}
      </FormField>
    </Dialog>
  );
  return { edit: (memory: MemorySummary) => open(memory), add: () => open(undefined), dialog };
}

/** The memories as read: the search and the filter, the list, and the bar over what is chosen. */
function MemoryList({
  readerId,
  memories,
  workspaceId,
  workspaceStep,
}: {
  /** The signed-in account, whose own memories read as You and Me. */
  readerId: string | undefined;
  memories: readonly MemorySummary[];
  /** The workspace the memories are kept in, whose forgets every Forget waits out. */
  workspaceId: string;
  /** The step the workspace's links name it by, which a memory's source task is written under. */
  workspaceStep: string;
}): React.JSX.Element {
  const forgets = memoriesForgetMutation(workspaceId);
  const forgettingAll = useMutation(forgets);
  // Note that a forget out locks every Forget in its workspace until it answers.
  const forgetting = useIsMutating({ mutationKey: forgets.mutationKey }) > 0;
  const { members, former } = useMemberDirectory();
  const copy = useCopyToast();
  const regionId = useId();
  const [query, setQuery] = useState("");
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [asked, setAsked] = useState<readonly MemorySummary[]>([]);
  const found = searchTokens(query);
  const editor = useMemoryEditor(workspaceId, new Set(memories.map((memory) => memory.id)));
  const all = byUse(memories).map((memory): ShownMemory => {
    // Note that the service names a memory's keeper as nobody only once their account is deleted.
    const actor =
      memory.keptBy === null
        ? DELETED_ACCOUNT_ACTOR
        : personActor(memory.keptBy, members, readerId, former);
    const keeper = memory.keptBy?.name ?? "";
    return { memory, actor, keeper };
  });
  const searched = all.filter((each) => matchesTokens([each.memory.text, each.keeper], found));
  const listed = searched.filter(
    (each) => kept.size === 0 || kept.has(keeperKey(each.memory, each.actor)),
  );
  // Note that a memory no longer drawn leaves the selection for good, as a task does, so one a search hid is not chosen again unasked.
  const drawn = new Set(listed.map((each) => each.memory.id));
  const standing: ReadonlySet<string> = new Set([...selected].filter((id) => drawn.has(id)));
  if (standing.size !== selected.size) setSelected(standing);
  const chosen = listed.filter((each) => standing.has(each.memory.id)).map((each) => each.memory);
  const forgettable = asked.filter((memory) => memory.forgettable);
  const forgetConfirmAct = useConfirmAct(forgettingAll, {
    send: () => forgettingAll.mutateAsync(forgettable.map((memory) => memory.id)),
    answered: sameAnswer,
  });
  const forgetConfirm = useConfirmDialog(
    { subject: asked.length > 0, surfaceOpen: true },
    forgetConfirmAct,
    confirmFailure(FAILURE_SURFACE.MEMORY_FORGET),
  );
  const askForget = (memories: readonly MemorySummary[]) => {
    setAsked(memories);
    forgetConfirm.ask();
  };
  const copyAll = (memories: readonly MemorySummary[]) =>
    copy(
      memories.map((memory) => memory.text).join("\n\n"),
      memories.length === 1
        ? "Memory copied"
        : `${countWords(memories.length, TERM.MEMORY)} copied`,
    );
  const acts: readonly SelectionAct[] = [
    ...(chosen.some((memory) => memory.forgettable) && !forgetting
      ? [{ label: MEMORY_ACT.FORGET, icon: <TrashIcon />, onAct: () => askForget(chosen) }]
      : []),
    { label: MEMORY_ACT.COPY, icon: <GLYPH.COPY />, onAct: () => copyAll(chosen) },
  ];
  const several: ChosenMemories | undefined =
    chosen.length > 1 ? { count: chosen.length, acts } : undefined;
  const clear = () => {
    setQuery("");
    setKept(new Set());
  };
  const keepers = keepersOf(searched);
  const { scroller, shiftedBy } = usePageScroll();
  const run = useRef<VirtualRowsHandle>(null);
  const keys = useMemo(() => listed.map((each) => each.memory.id), [listed]);
  const order = useMemo(() => [keys], [keys]);
  const bringIn = useCallback(
    (key: string, then: () => void) => run.current?.bringIn(key, then) ?? false,
    [],
  );
  return (
    <SettingsSection anchor={SETTINGS_SEARCH_ROW.MEMORY} frame={SETTINGS_SECTION_FRAME.NONE}>
      <Stack gap={GAP.SECTION}>
        <Stack gap={GAP.CONTROL}>
          <div className={SEARCH_LINE}>
            <SearchField
              label="Search memories"
              placeholder="Search memories"
              value={query}
              onChange={setQuery}
              onClear={() => setQuery("")}
              onEscape={() => setQuery("")}
              {...(found.length === 0 ? {} : { tally: { count: listed.length } })}
            />
            <KeptByFilter keepers={keepers} kept={kept} onKept={setKept} />
            <Button variant={BUTTON_VARIANT.OUTLINE} icon={<PlusIcon />} onClick={editor.add}>
              {ADD_MEMORY}
            </Button>
          </div>
          <KeptByChips keepers={keepersOf(all)} kept={kept} onKept={setKept} />
          {listed.length === 0 ? null : (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} className="memory-order">
              {`${countWords(listed.length, TERM.MEMORY)} · ${ORDER_WORDS}`}
            </Text>
          )}
        </Stack>
        {listed.length === 0 ? (
          <NothingShown narrowed={found.length > 0 || kept.size > 0} onClear={clear} />
        ) : (
          <SelectionRegion
            id={regionId}
            selection={{ selected: standing, onChange: setSelected }}
            order={order}
            bringIn={bringIn}
          >
            <VirtualRows
              scroller={scroller}
              shiftedBy={shiftedBy}
              keys={keys}
              estimate={MEMORY_ESTIMATE_PX}
              gap={MEMORY_GAP_PX}
              anchor={VIRTUAL_ROWS_ANCHOR.START}
              listItems
              holdsFocus
              className={MEMORY_LIST}
              handle={run}
            >
              {(index, place) => {
                const shown = listed[index];
                return shown === undefined ? null : (
                  <MemoryRow
                    shown={shown}
                    place={place}
                    found={found}
                    locked={forgetting}
                    chosen={
                      several !== undefined && standing.has(shown.memory.id) ? several : undefined
                    }
                    workspaceStep={workspaceStep}
                    onEdit={() => editor.edit(shown.memory)}
                    onForget={() => askForget([shown.memory])}
                    onCopy={() => copyAll([shown.memory])}
                  />
                );
              }}
            </VirtualRows>
          </SelectionRegion>
        )}
      </Stack>
      <div className={SELECTION_FOOT}>
        <SelectionBar
          count={chosen.length}
          acts={acts}
          onClear={() => setSelected(new Set())}
          controls={regionId}
        />
      </div>
      <ConfirmDialog
        open
        confirm={forgetConfirm}
        question={forgetQuestion(asked, asked.length - forgettable.length)}
      />
      {editor.dialog}
    </SettingsSection>
  );
}

export function MemorySection({
  signedIn,
  workspace,
  readerId,
  workspacesFailed,
  onRetryWorkspaces,
}: {
  signedIn: boolean;
  /** The workspace Settings shows, whose memories the page reads; absent before the workspaces are read. */
  workspace: Workspace | undefined;
  /** The signed-in account, whose own memories read as You. */
  readerId: string | undefined;
  /** Whether the read the workspaces arrive with failed, so no workspace will arrive until it is asked again. */
  workspacesFailed: boolean;
  /** Asks for the workspaces again. */
  onRetryWorkspaces: (() => void) | undefined;
}): React.JSX.Element {
  const workspaceId = workspace?.id;
  // The memories as the host holds them, followed live while the page shows them, so a memory an agent keeps meanwhile draws as it lands.
  const memories = useQuery(memoriesQuery(signedIn ? workspaceId : undefined));
  const retryMemories = useMutation(memoriesRetryMutation());
  if (!signedIn) return <SettingsLine>{PAGE_LINE.SIGNED_OUT}</SettingsLine>;
  // Note that no workspace is a read not answered yet or one that failed, never a workspace-less account, which holds its own.
  if (workspace === undefined) {
    return workspacesFailed ? (
      <ReadFailed
        line={PAGE_LINE.WORKSPACES_FAILED}
        surface={FAILURE_SURFACE.WORKSPACES_READ}
        onRetry={onRetryWorkspaces}
      />
    ) : (
      <MemoriesSkeleton label={READING_LABEL.WORKSPACES} />
    );
  }
  return memories.data !== undefined ? (
    // Note that the keepers are read in the workspace Settings shows, which may not be the one the window's tasks stand in.
    <MemberDirectory workspace={workspace} readerId={readerId}>
      <ReplayMask>
        <MemoryList
          readerId={readerId}
          memories={memories.data}
          workspaceId={workspace.id}
          workspaceStep={workspace.slug ?? workspace.id}
        />
      </ReplayMask>
    </MemberDirectory>
  ) : memories.isError ? (
    <ReadFailed
      line={PAGE_LINE.FAILED}
      surface={FAILURE_SURFACE.MEMORIES_READ}
      about={{ workspaceId: workspace.id }}
      onRetry={() => retryMemories.mutate({ workspaceId: workspace.id })}
    />
  ) : (
    <MemoriesSkeleton label={READING_LABEL.MEMORY} />
  );
}
