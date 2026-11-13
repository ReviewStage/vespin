import type { MemorySaveAnswerView } from "@repo/features/agent-view";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import { markdownTree } from "@repo/features/markdown-tree";
import {
  ADD_MEMORY,
  forgetQuestion as forgetWords,
  MEMORY_ACT,
  MEMORY_EDITOR_WORDS,
  MEMORY_PAGE_WORDS,
  MEMORY_RECALLS_WORDS,
  MEMORY_UNRECALLED_WORDS,
  MEMORY_VIEW,
  MEMORY_VIEW_EMPTY,
  MEMORY_VIEW_WORDS,
  MEMORY_VIEWS,
  type MemoryView,
  memoriesInView,
  memorySaveRefusal,
  recallsText,
  unusedWords,
} from "@repo/features/memory-settings-words";
import { MEMORY_BOUNDS, type MemorySummary } from "@repo/features/memory-wire";
import { encodeMention, MENTION_KIND } from "@repo/features/mention-link";
import { formatCount } from "@repo/features/number-format";
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
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  CHOICE_BAR_LOOK,
  Chip,
  ChipName,
  ChoiceBar,
  CONFIRM_LOSS,
  type ComposerNote,
  ConfirmDialog,
  CornerDot,
  DIALOG_SIZE,
  Dialog,
  type DialogHandle,
  EmptyState,
  GAP,
  IconButton,
  Inline,
  LIST_MOTION_WAY,
  LIST_ROW_LEAD,
  LIST_ROW_META,
  LIST_ROW_TITLE_LINES,
  List,
  ListMotion,
  ListRow,
  type ListRowMenu,
  type MenuEntry,
  PlusIcon,
  SETTINGS_SECTION_FRAME,
  SearchField,
  SearchIcon,
  type SelectionAct,
  SelectionBar,
  SettingsLine,
  SettingsSection,
  SKELETON_KIND,
  Skeleton,
  SkeletonRegion,
  STATUS_TONE,
  Stack,
  selectionMenu,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TIME_LOOK,
  Time,
  Tooltip,
  TrashIcon,
  UnreadMark,
  useConfirmDialog,
  useLeaving,
  useMenu,
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
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { mutationOptions, useIsMutating, useMutation, useQuery } from "@tanstack/react-query";
import { Predicate } from "effect";
import { type ReactNode, type RefObject, useId, useMemo, useRef, useState } from "react";
import { actFailureWords, sendAct } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { ANSWER_ACCEPTED, sameAnswer, useConfirmAct } from "../confirm-act.js";
import { useCopyToast } from "../copy-feedback.js";
import { EDITOR_ROOT_SELECTOR } from "../description-editor/contract.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { confirmFailure } from "../failure-report.js";
import { memoriesQuery, memoriesRetryMutation } from "../live-reads.js";
import { MarkdownMessage } from "../markdown-message.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import { PEOPLE_FILTER_WORDS } from "../member-rows.js";
import { linkChip } from "../tasks/mention-chip.js";
import { MessageBox, useMessageBox } from "../tasks/message-box.js";
import { useMentionDoors } from "../tasks/task-mentions.js";
import { useKnownNames } from "../tasks/use-known-names.js";
import { useOpenPlace } from "../tasks/use-open-link.js";
import { useHeldThroughExit } from "../use-held-through-exit.js";
import { ReadFailed } from "./marks.js";

/**
 * memory-page.tsx -- Settings › Memory: the facts and conventions the workspace's coding agents kept, listed a row each under views for reading, reviewing, and pruning them, edited and added in place, and forgotten one at a time or several at once.
 *
 * A coding agent keeps a memory as it works without asking, and corrects one
 * in place when its developer says otherwise. They are the workspace's: every
 * member's agents in it recall them, and nothing crosses into another
 * workspace. The page draws them as the host holds them, followed live on
 * the service (`LIVE_READ.MEMORIES`), so one an agent keeps, or another
 * member forgets, draws while the page is open.
 *
 * At the top, a search over the words and their keeper's name
 * (`searchTokens`), lit where it landed, the Tasks page's Filter, its glyph
 * alone with a dot while it keeps anything, whose one field is Saved by,
 * each keeper with their face and how many they kept, and everyone who left
 * the workspace as one, and Add memory. A chip under the search says each
 * keeper kept, its × lifting it, beside a Clear. Under them, the views
 * (`MEMORY_VIEW`), a segmented bar, each counting what the search and the
 * filter leave in it: All, the memories agents recalled most in the last
 * thirty days first, then the most recently kept or corrected; New, those
 * kept in the last week, the newest first, for a member to read over while
 * a wrong one is still young; and Unused, those no agent recalled in the
 * window though kept before it opened, the longest out of use first, over a
 * strip that says so and chooses them all to prune. A caption says how many
 * memories the view holds and what recalls count.
 *
 * The memories stand in a list (`List`), one row each, so a memory's words
 * take the page's width rather than a column's. A row: the box it is chosen
 * by, in the gutter at its start; its words, drawn as the notes are since a
 * memory is Markdown (`pnpm db:generate` in backticks), cut short at two
 * lines and said whole in the hint over them where they are; under them,
 * whose they are, when they were saved, and the agent that saved them, as
 * that agent's mention chip, wearing its harness's mark, whose press opens
 * the agent's transcript at the line that kept it, or the task's chip where
 * the window cannot name the agent; at the end of its first line, how often
 * agents were handed it in the window and when last, or when last before
 * it, or never; and its ⋯. A row opens nothing. Its ⋯, a right-click on it,
 * and the menu key offer Edit, Copy text, and Delete to a reader who may
 * change it: its words are theirs, or they own or administer the
 * workspace. To any other reader Edit stands nowhere and Delete stands
 * unavailable, saying who may.
 *
 * Edit and Add memory open New task's card over the window (`Dialog`'s
 * composer size), headed Edit memory or New memory, holding the agent's
 * box (`MessageBox`), its words, dictation, and round send, which saves;
 * ⌘↩ saves, and Esc or a press outside puts the card away. Either saves
 * through the one save act (`ACT_KIND.MEMORIES_SAVE`), an edit naming the
 * memory it replaces, which the host draws over the list the moment it is
 * sent. The card stands until the service takes the words, held while the
 * save is out, and says under them why it refused; an edit whose memory is
 * deleted meanwhile goes with it, and the answer that follows opens nothing
 * again.
 *
 * Memories are chosen together by their boxes. A bar floating at the page's
 * foot then forgets or copies them all, and a chosen row's ⋯ and right-click
 * offer the bar's acts under how many it acts on. Delete, of one or of
 * several, asks once first, in red, as the Inbox's Resolve does, since no
 * memory comes back once forgotten. Each is gone from the list the moment
 * it is sent, and back only where the service refused it; several are
 * forgotten one after another, the first refusal stopping the rest, and the
 * memories the reader may not forget are left chosen and said so. A memory
 * is members' own words about their work, so the list stands under the
 * mask mark, which Settings' own unmask would otherwise leave readable.
 */

/** What the page says while it cannot read or write, and with no account. */
const PAGE_LINE = {
  FAILED: MEMORY_PAGE_WORDS.FAILED,
  WORKSPACES_FAILED: readFailedWords("your workspaces"),
  SIGNED_OUT: SIGNED_OUT_WORDS,
  FORGET_FAILED: MEMORY_PAGE_WORDS.FORGET_FAILED,
  NO_MATCH: MEMORY_PAGE_WORDS.NO_MATCH,
  CLEAR: "Clear search and filter",
} as const;

/** What the Filter is called, on its tooltip and its menu, and its one field. */
const FILTER = "Filter";
const KEPT_BY = "Saved by";

/** What the list is called to a reader. */
const LIST_LABEL = MEMORY_PAGE_WORDS.TITLE;

/** What the views are called to a reader. */
const VIEWS_LABEL = "Views";

/** The rows that stand while the memories are read: how wide each's words, its line under them, and its recalls stand. */
const SKELETON_ROWS = [
  { words: "86%", line: "34%" },
  { words: "64%", line: "42%" },
  { words: "74%", line: "30%" },
] as const;

/** How wide a skeleton row's recalls stand. */
const SKELETON_USE = "96px";

/** The key the Kept by filter keeps everyone who left the workspace under, together. */
const FORMER_KEY = "former";

/** What everyone who left is called in the filter. */
const FORMER_WORDS = "Former members";

/** What the skeletons say to a reader who cannot see them. */
const READING_LABEL = {
  MEMORY: MEMORY_PAGE_WORDS.READING,
  WORKSPACES: readingWords("your workspaces"),
} as const;

/** The search's line: the field taking the room the Filter and Add memory beside it leave. */
const SEARCH_LINE =
  "memory-search flex items-center gap-control-gap [&>:first-child]:min-w-0 [&>:first-child]:flex-1";

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
  if (Predicate.isString(node.value)) return node.value;

  return (node.children ?? []).map((child) => wordsIn(child)).join("");
}

/** A memory's words as plain text, its paragraphs and items a space apart rather than run together. */
function plainWords(text: string): string {
  return markdownTree(text)
    .children.map((block) => wordsIn({ children: [block] }))
    .join(" ");
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

/** Where a memory's words came from, as a reader who may open its task sees it. */
type MemorySource = NonNullable<MemorySummary["source"]>;

/** One memory with whose words it holds, as the members the panel reads name them, and the agent that saved it as the window names it. */
interface ShownMemory {
  readonly memory: MemorySummary;
  readonly actor: Actor;
  readonly keeper: string;
  /** The agent's name where the window holds it; none where it names the agent not. */
  readonly agentName: string | undefined;
}

/**
 * The agent a memory's words came from, as that agent's mention chip,
 * wearing its harness's mark, whose press opens its transcript at the line
 * that kept them where one did, and its tab otherwise; the task's chip where
 * the window cannot name the agent, opening the same line.
 */
function SourceChip({
  source,
  agentName,
  workspaceStep,
}: {
  source: MemorySource;
  agentName: string | undefined;
  /** The step the workspace's links name it by: its slug, or its id where none traveled. */
  workspaceStep: string;
}): React.JSX.Element | null {
  const { agentId, messageId, taskId, taskName } = source;
  const doors = useMentionDoors();
  const openPlace = useOpenPlace();

  const opened = useMemo(() => {
    if (messageId === null || openPlace === undefined) return doors;

    const openLine = () =>
      openPlace({ kind: LINK_DESTINATION.MESSAGE, planId: taskId, agentId, messageId });

    return { ...doors, onOpenTask: openLine, onOpenAgent: openLine };
  }, [doors, openPlace, agentId, messageId, taskId]);

  const place = { workspace: workspaceStep, repository: null };

  const chip =
    agentName === undefined
      ? linkChip(encodeMention({ kind: MENTION_KIND.TASK, taskId }, place), `@${taskName}`, opened)
      : linkChip(
          encodeMention({ kind: MENTION_KIND.AGENT, agentId }, place),
          `@${agentName}`,
          opened,
        );

  return chip ?? null;
}

/** A memory's recalls, as its row's end says them: how many in the window and when last, when last before it, or never. */
function MemoryUse({ memory }: { memory: MemorySummary }): React.JSX.Element {
  const { recalls30d, lastRecalledAt } = memory;

  if (lastRecalledAt === null) return <>{MEMORY_UNRECALLED_WORDS.NEVER}</>;
  const last = <Time at={lastRecalledAt} look={TIME_LOOK.AGO} hint={false} />;

  // Note that a memory recalled before the window and not since counts none in it, so its row says when last alone.
  return recalls30d === 0 ? (
    <>
      {MEMORY_UNRECALLED_WORDS.LAST} {last}
    </>
  ) : (
    <>
      {recallsText(recalls30d)} · last {last}
    </>
  );
}

/**
 * One memory's row: its words, cut short at two lines and said whole in the
 * hint over them where they are; whose they are, when they were saved, and
 * the agent they came from on the line under them; its recalls at the end of
 * its first line; chosen by its box; and its acts in its ⋯.
 */
function MemoryRow({
  shown,
  found,
  menu,
  workspaceStep,
}: {
  shown: ShownMemory;
  /** The words the search asks for, lit where they landed. */
  found: readonly string[];
  menu: ListRowMenu;
  /** The step the workspace's links name it by, which a memory's source is written under. */
  workspaceStep: string;
}): React.JSX.Element {
  const { memory, actor, agentName } = shown;
  const [clipped, setClipped] = useState(false);

  return (
    <ListRow
      // Note that a memory is never unread: the empty gutter is the room its select box stands in, as the Inbox's rows keep it.
      leading={<UnreadMark unread={false} />}
      title={<MemoryWords text={memory.text} found={found} whole={clipped} />}
      titleLines={LIST_ROW_TITLE_LINES.TWO}
      onTitleClipped={setClipped}
      lead={{ icon: <ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />, label: actorName(actor) }}
      leadAt={LIST_ROW_LEAD.INLINE}
      description={
        <>
          Saved <Time at={memory.updatedAt} look={TIME_LOOK.AGO} hint={false} />
          {memory.source === null ? null : (
            <>
              {" · "}
              <SourceChip
                source={memory.source}
                agentName={agentName}
                workspaceStep={workspaceStep}
              />
            </>
          )}
        </>
      }
      meta={<MemoryUse memory={memory} />}
      metaAt={LIST_ROW_META.TITLE}
      selectKey={memory.id}
      selectBox
      menu={menu}
    />
  );
}

/** The memories while they are read: rows of bones standing as a memory's row does, under a label a reader hears. */
function MemoriesSkeleton({ label }: { label: string }): React.JSX.Element {
  return (
    <SkeletonRegion label={label}>
      <List label={LIST_LABEL}>
        {SKELETON_ROWS.map(({ words, line }) => (
          <ListRow
            key={words}
            leading={<UnreadMark unread={false} />}
            title={<Skeleton width={words} />}
            titleLines={LIST_ROW_TITLE_LINES.TWO}
            lead={{ icon: <Skeleton kind={SKELETON_KIND.CIRCLE} />, label: "" }}
            leadAt={LIST_ROW_LEAD.INLINE}
            description={<Skeleton width={line} />}
            meta={<Skeleton width={SKELETON_USE} />}
            metaAt={LIST_ROW_META.TITLE}
          />
        ))}
      </List>
    </SkeletonRegion>
  );
}

/** What a row chosen among several acts on: how many, and the bar's acts. */
interface ChosenMemories {
  readonly count: number;
  readonly acts: readonly SelectionAct[];
}

/** A memory's own acts, in its ⋯ and its right-click: Edit and Copy text, then Delete. */
function memoryMenu(
  shown: ShownMemory,
  locked: boolean,
  doors: {
    readonly onEdit: () => void;
    readonly onCopy: () => void;
    readonly onForget: () => void;
  },
): readonly (readonly MenuEntry[])[] {
  const { memory, actor } = shown;

  return [
    [
      // Note that Edit stands only where the reader may change the memory's words, who may also delete it, as `forgettable` says.
      ...(memory.forgettable
        ? [{ label: MEMORY_ACT.EDIT, icon: <GLYPH.RENAME />, onSelect: doors.onEdit }]
        : []),
      { label: MEMORY_ACT.COPY, icon: <GLYPH.COPY />, onSelect: doors.onCopy },
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
        onSelect: doors.onForget,
      },
    ],
  ];
}

/** A row's menu: the memory's own acts, or the bar's under how many where it stands chosen among several. */
function rowMenuOf(
  chosen: ChosenMemories | undefined,
  groups: readonly (readonly MenuEntry[])[],
): ListRowMenu {
  return chosen === undefined
    ? { thing: "Memory", groups, replayUnmasked: true }
    : {
        thing: "Memory",
        heading: <ReplayUnmask>{countWords(chosen.count, TERM.MEMORY)}</ReplayUnmask>,
        groups: selectionMenu(chosen.acts),
        replayUnmasked: true,
      };
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
  return {
    ...forgetWords(asked.length, left),
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
  };
}

/** What the list says where it holds nothing: a search or the filter that leaves nothing, or a view, or a workspace, that holds nothing yet. */
function NothingShown({
  narrowed,
  empty,
  onClear,
}: {
  narrowed: boolean;
  /** What the list says where nothing narrows it. */
  empty: string;
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

  return <SettingsLine>{empty}</SettingsLine>;
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
  const refusal = memorySaveRefusal(answer);

  return refusal === undefined
    ? ANSWER_ACCEPTED
    : { status: ACTION_RESULT_STATUS.REJECTED, reason: refusal };
}

/** A memory's words as its row draws them: lit where the search landed, and said whole in the hint over them where its row cuts them short. */
function MemoryWords({
  text,
  found,
  whole,
}: {
  text: string;
  /** The words the search asks for, lit where they landed. */
  found: readonly string[];
  /** Whether the row cuts the words short, so the hint says them whole. */
  whole: boolean;
}): React.JSX.Element {
  return (
    <Tooltip label={whole ? plainWords(text) : undefined}>
      <div className="memory-words">
        {/* A memory's words stand inside its row, so they stay words going nowhere, links among them. */}
        <MarkdownMessage words={text} className="memory-text" found={found} link={null} />
      </div>
    </Tooltip>
  );
}

/** The words the card is writing, which memory they replace, and what the service last said of them. */
interface Editing {
  /** The memory whose words are edited; none for a new one's draft. */
  readonly replaces: MemorySummary | undefined;
  readonly text: string;
  /** Why the service refused the last save, said under the field; none while it refused none. */
  readonly refusal: ComposerNote | undefined;
  /** Which opening of the card this is, which a save's answer must still find standing to act on. */
  readonly opening: number;
}

/** The words field, the editor's own root, which the card hands focus to. */
const FIELD_SELECTOR = EDITOR_ROOT_SELECTOR;

/** The dialog's own card, which holds focus while the field has not landed. */
const CARD_SELECTOR = '[aria-modal="true"]';

/**
 * The card a memory's words are written in: New task's card over the
 * window (`new-task-dialog.tsx`), its head naming what it does, over the
 * agent's box (`MessageBox` as `agent-composer.tsx` draws it), its words,
 * dictation, and round send, which saves. ⌘↩ saves, since a bare Return
 * writes a line; Esc in the words and a press outside put it away, which a
 * save out holds back, as the card is held. The service's refusal stands
 * under the words. Note that the field is the editor the box mounts once
 * its bundle has landed, so the card hands focus to it by where it stands,
 * as New task's does.
 */
function MemoryCard({
  open,
  editing,
  busy,
  onChange,
  onSave,
  onDismiss,
  onExited,
}: {
  /** Whether the card stands; falling, it fades out, then tells its owner it is gone. */
  open: boolean;
  editing: Editing;
  /** Whether a save is out, which holds the card. */
  busy: boolean;
  onChange: (text: string) => void;
  onSave: () => void;
  onDismiss: () => void;
  onExited: () => void;
}): React.JSX.Element {
  const dialog = useRef<DialogHandle>(null);
  const titleId = useId();
  const body = useRef<HTMLDivElement>(null);

  const field = useMemo(
    (): RefObject<HTMLElement | null> => ({
      get current() {
        const card = body.current?.closest<HTMLElement>(CARD_SELECTOR) ?? null;

        return body.current?.querySelector<HTMLElement>(FIELD_SELECTOR) ?? card;
      },
    }),
    [],
  );

  const title = editing.replaces === undefined ? MEMORY_EDITOR_WORDS.ADD : MEMORY_EDITOR_WORDS.EDIT;

  const box = useMessageBox({
    draft: editing.text,
    setDraft: onChange,
    placeholder: MEMORY_EDITOR_WORDS.PLACEHOLDER,
    label: title,
    maxLength: MEMORY_BOUNDS.MAX_CHARS,
    onSubmit: onSave,
    // Note that the words' Escape goes through the dialog, so a save out holds it back as it holds the card's own.
    onLeave: () => dialog.current?.dismiss(),
    enterWrites: true,
    takesFiles: false,
    focusedByOwner: true,
    held: busy,
  });

  return (
    <Dialog
      open={open}
      size={DIALOG_SIZE.COMPOSER}
      labelledBy={titleId}
      ref={dialog}
      busy={busy}
      initialFocus={field}
      replayUnmasked
      onDismiss={onDismiss}
      onExited={onExited}
    >
      <div className="memory-card flex min-h-0 flex-col gap-block-gap" ref={body}>
        <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2} id={titleId}>
          {title}
        </Text>
        {/* Note that a memory is a member's own words, kept out of a screen recording as the table's are. */}
        <ReplayMask>
          <MessageBox
            box={box}
            className="memory-field"
            send={{
              label: MEMORY_EDITOR_WORDS.SAVE,
              empty: editing.text.trim() === "",
              held: busy,
            }}
            note={editing.refusal}
          />
        </ReplayMask>
      </div>
    </Dialog>
  );
}

/** A refused save as the card says it under its words, reported once on its surface. */
function refusalNote(result: ActionResult): ComposerNote | undefined {
  if (result.status !== ACTION_RESULT_STATUS.REJECTED) return undefined;

  return { words: result.reason, failure: confirmFailure(FAILURE_SURFACE.MEMORY_SAVE)(result) };
}

/**
 * The card a memory's words are edited in, or a new one's written in, and
 * its save through the one save act, naming the memory it replaces where it
 * edits one. The card stands until the service takes the words, and says
 * under them why it refused while they stay written; nothing puts it away,
 * and no other Edit or Add opens over it, while a save is out. An edit goes
 * with its memory: one deleted meanwhile puts the card away, and the answer
 * that follows finds no opening of its own standing, so it opens nothing
 * again.
 */
function useMemoryEditor(workspaceId: string, kept: ReadonlySet<string>) {
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [openings, setOpenings] = useState(0);

  const saving = useMutation({
    mutationKey: [ACT_KIND.MEMORIES_SAVE, workspaceId],
    mutationFn: (save: { readonly text: string; readonly replaces: string | undefined }) =>
      sendAct(ACT_KIND.MEMORIES_SAVE, {
        workspaceId,
        text: save.text,
        ...(save.replaces !== undefined && { replaces: save.replaces }),
      }),
  });

  if (editing?.replaces !== undefined && !kept.has(editing.replaces.id)) setEditing(undefined);

  const open = (memory: MemorySummary | undefined) => {
    // Note that a save out keeps its card, so its answer, or its refusal, still finds it.
    if (saving.isPending) return;
    const opening = openings + 1;
    setOpenings(opening);
    setEditing({ replaces: memory, text: memory?.text ?? "", refusal: undefined, opening });
  };

  const save = () => {
    if (editing === undefined || saving.isPending) return;
    const words = editing.text.trim();

    if (words === "" || editing.text.length > MEMORY_BOUNDS.MAX_CHARS) return;

    // Note that an edit that changed nothing puts the card away with nothing to send.
    if (words === editing.replaces?.text) {
      setEditing(undefined);

      return;
    }

    const { opening } = editing;
    void saving
      .mutateAsync({ text: words, replaces: editing.replaces?.id })
      .then(saveAnswered, (cause: unknown): ActionResult => {
        return { status: ACTION_RESULT_STATUS.REJECTED, reason: actFailureWords(cause) };
      })
      .then((result) => {
        const refusal = refusalNote(result);
        setEditing((was) => {
          if (was?.opening !== opening) return was;

          return refusal === undefined ? undefined : { ...was, refusal };
        });
      });
  };

  // The card is drawn through its fade, on the words it last held.
  const { held, onExited } = useHeldThroughExit(editing);

  const card =
    held === undefined ? null : (
      <MemoryCard
        // Note that each opening is a card of its own, so its words open afresh.
        key={held.opening}
        open={editing !== undefined}
        editing={held}
        busy={saving.isPending}
        onChange={(text) => setEditing((was) => (was === undefined ? was : { ...was, text }))}
        onSave={save}
        // Note that a save out holds the card until it answers, so its refusal has a card to stand under.
        onDismiss={() => {
          if (!saving.isPending) setEditing(undefined);
        }}
        onExited={onExited}
      />
    );

  return {
    /** The card, while it stands and through its fade. */
    card,
    edit: (memory: MemorySummary) => open(memory),
    add: () => open(undefined),
  };
}

/** The memories as read: the search, the filter, and Add memory, the views, the list, and the bar over what is chosen. */
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
  /** The step the workspace's links name it by, which a memory's source is written under. */
  workspaceStep: string;
}): React.JSX.Element {
  const forgets = memoriesForgetMutation(workspaceId);
  const forgettingAll = useMutation(forgets);
  // Note that a forget out locks every Forget in its workspace until it answers.
  const forgetting = useIsMutating({ mutationKey: forgets.mutationKey }) > 0;
  const { members, former } = useMemberDirectory();
  const agents = useKnownNames().agents;
  const copy = useCopyToast();
  const regionId = useId();
  const panelId = useId();

  const tabIds = {
    [MEMORY_VIEW.ALL]: useId(),
    [MEMORY_VIEW.NEW]: useId(),
    [MEMORY_VIEW.UNUSED]: useId(),
  };

  const [view, setView] = useState<MemoryView>(MEMORY_VIEW.ALL);
  const [query, setQuery] = useState("");
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [asked, setAsked] = useState<readonly MemorySummary[]>([]);
  const found = searchTokens(query);
  const editor = useMemoryEditor(workspaceId, new Set(memories.map((memory) => memory.id)));

  const all = memories.map((memory): ShownMemory => {
    // Note that the service names a memory's keeper as nobody only once their account is deleted.
    const actor =
      memory.keptBy === null
        ? DELETED_ACCOUNT_ACTOR
        : personActor(memory.keptBy, members, readerId, former);

    const keeper = memory.keptBy?.name ?? "";
    const agentName = memory.source === null ? undefined : agents.get(memory.source.agentId);

    return { memory, actor, keeper, agentName };
  });

  const searched = all.filter((each) => matchesTokens([each.memory.text, each.keeper], found));

  const narrowed = searched.filter(
    (each) => kept.size === 0 || kept.has(keeperKey(each.memory, each.actor)),
  );

  // Note that the views split what the search and the filter leave, so each one's count says what pressing it shows.
  const byId = new Map(narrowed.map((each) => [each.memory.id, each]));
  const now = Date.now();

  const inView = (each: MemoryView) =>
    memoriesInView(
      narrowed.map(({ memory }) => memory),
      each,
      now,
    ).flatMap((memory) => byId.get(memory.id) ?? []);

  const listed = inView(view);

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
      ? [
          {
            label: MEMORY_ACT.FORGET,
            icon: <TrashIcon />,
            danger: true,
            onAct: () => askForget(chosen),
          },
        ]
      : []),
    { label: MEMORY_ACT.COPY, icon: <GLYPH.COPY />, onAct: () => copyAll(chosen) },
  ];

  const several: ChosenMemories | undefined =
    chosen.length > 1 ? { count: chosen.length, acts } : undefined;

  const clear = () => {
    setQuery("");
    setKept(new Set());
  };

  const viewItems = MEMORY_VIEWS.map((each) => ({
    value: each,
    label: MEMORY_VIEW_WORDS[each],
    count: formatCount(inView(each).length),
  }));

  const unused = unusedWords(listed.length);

  const keepers = keepersOf(searched);

  const rowMenu = (row: ShownMemory): ListRowMenu => {
    const { memory } = row;

    return rowMenuOf(
      several !== undefined && standing.has(memory.id) ? several : undefined,
      memoryMenu(row, forgetting, {
        onEdit: () => editor.edit(memory),
        onCopy: () => copyAll([memory]),
        onForget: () => askForget([memory]),
      }),
    );
  };

  return (
    <SettingsSection anchor={SETTINGS_SEARCH_ROW.MEMORY} frame={SETTINGS_SECTION_FRAME.NONE}>
      <Stack gap={GAP.SECTION}>
        <Stack gap={GAP.CONTROL}>
          <div className={SEARCH_LINE}>
            <SearchField
              label={MEMORY_PAGE_WORDS.SEARCH}
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
          {memories.length === 0 ? null : (
            <ChoiceBar
              label={VIEWS_LABEL}
              items={viewItems}
              value={view}
              look={CHOICE_BAR_LOOK.SEGMENTED}
              panels={(each) => ({ tab: tabIds[each], panel: panelId })}
              onChange={setView}
            />
          )}
          {listed.length === 0 ? null : (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {`${countWords(listed.length, TERM.MEMORY)} · ${MEMORY_RECALLS_WORDS}`}
            </Text>
          )}
        </Stack>
        <div id={panelId} role="tabpanel" aria-labelledby={tabIds[view]}>
          <Stack gap={GAP.CONTROL}>
            {view === MEMORY_VIEW.UNUSED && listed.length > 0 ? (
              <Banner
                look={BANNER_LOOK.STRIP}
                tone={STATUS_TONE.ATTENTION}
                glyph={<GLYPH.TIME />}
                actions={
                  <Button
                    variant={BUTTON_VARIANT.OUTLINE}
                    onClick={() => setSelected(new Set(listed.map((each) => each.memory.id)))}
                  >
                    {unused.choose}
                  </Button>
                }
              >
                {unused.line}
              </Banner>
            ) : null}
            {listed.length === 0 ? (
              <NothingShown
                // Note that a view the search and the filter leave empty while another holds their matches says so as the view, not as a search that missed.
                narrowed={narrowed.length === 0 && (found.length > 0 || kept.size > 0)}
                empty={MEMORY_VIEW_EMPTY[memories.length === 0 ? MEMORY_VIEW.ALL : view]}
                onClear={clear}
              />
            ) : (
              <List
                id={regionId}
                label={LIST_LABEL}
                selection={{ selected: standing, onChange: setSelected }}
              >
                {listed.map((each) => (
                  <MemoryRow
                    key={each.memory.id}
                    shown={each}
                    found={found}
                    menu={rowMenu(each)}
                    workspaceStep={workspaceStep}
                  />
                ))}
              </List>
            )}
          </Stack>
        </div>
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
      {editor.card}
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
        {/* Note that the list is drawn anew for each workspace, so a draft, an edit, a search, or a choice never carries into another. */}
        <MemoryList
          key={workspace.id}
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
