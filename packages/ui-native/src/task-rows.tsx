// task-rows.tsx -- the rows a task's page and the Tasks list draw beside the task rows: a task's head, an agent, a related task, a group, a row that opens somewhere, and a description's words.

import {
  HStack,
  Image,
  Rectangle,
  RNHostView,
  Spacer,
  Button as SwiftUIButton,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityLabel,
  accessibilityValue,
  buttonStyle,
  clipped,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  monospacedDigit,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import type { PullRequestState } from "@repo/features/agent-wire";
import {
  VERSION_CHANGE_HEARD,
  VERSION_HISTORY_WORDS,
} from "@repo/features/description-history-words";
import { VERSION_CHANGE, type VersionUnit } from "@repo/features/description-version-diff";
import { GLYPH_STATE, GLYPH_STATE_WORDS } from "@repo/features/glyph-state";
import { needsYouWords } from "@repo/features/inbox-list-model";
import type { LinkStanding } from "@repo/features/link-standing-model";
import type { ManagerFace } from "@repo/features/manager-face";
import type { ModelProvider } from "@repo/features/models-wire";
import { pullRequestMarkLabel, pullRequestMarkState } from "@repo/features/pull-request-model";
import {
  STARTED_STANDING,
  type StartedAgentsStanding,
  startedHeard,
  startedShown,
} from "@repo/features/task-agents-model";
import { TASK_STATUS_WORDS } from "@repo/features/task-standing-words";
import type { TaskPriority, TaskStatus } from "@repo/features/task-wire";
import { sinceHeard } from "@repo/features/time-format";
import type { ReactElement, ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import type { RowQuestion } from "./asks.js";
import { BUTTON_LOOK, BUTTON_SIZE, Button } from "./button.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { useRowInset } from "./layout-margin.js";
import {
  FoldChevron,
  type FoldWords,
  foldActions,
  type LongPressGroup,
  LongPressMenu,
  ROW_ACTION_TONE,
  type RowAction,
  type RowFold,
  RowFrame,
  RowHead,
  type RowSubmenu,
  type RowSwipe,
  RowTime,
  rowPlacement,
  StatusRing,
  useNestColumn,
} from "./list-row.js";
import { Markdown, type MarkdownFile, type MarkdownVideo } from "./markdown.js";
import { AgentTile, Avatar, type Face, FailedMark, ToneGlyph, WorkingMark } from "./marks.js";
import { type PageFollowing, PageHeader, type StandingMenus } from "./page-header.js";
import type { PictureRef } from "./picture-source.js";
import { ProblemLine } from "./problem-line.js";
import { useRollingCount } from "./rolling-count.js";
import type { RowPreview } from "./row-preview-model.js";
import { Text } from "./text.js";
import { type BrandColors, STATUS_TONE, useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, ROW_INSET, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What parts the pieces of an agent's line. */
const LINE_PART = "· ";

/** What an agent row's long-press menu opens its pull request with. */
const OPEN_PULL_REQUEST = "Open pull request";

/** How a press-through row's words read: the attention ink for what waits on you, or the body's ink for a place or an act, as the panel's quiet New agent and New sub-task stand. */
export const LINK_ROW_TONE = {
  PLAIN: "plain",
  ATTENTION: "attention",
} as const;

export type LinkRowTone = (typeof LINK_ROW_TONE)[keyof typeof LINK_ROW_TONE];

/** The ink a press-through row's words and glyph stand in. */
function linkInk(colors: BrandColors, tone: LinkRowTone): string {
  if (tone === LINK_ROW_TONE.ATTENTION) return colors.ATTENTION;

  return colors.TEXT_BODY;
}

/** A row's words at the line's end, in the time's style,, in the muted ink or the one given, with tabular figures. */
function EndWords({ words, ink }: { readonly words: string; readonly ink?: string | undefined }) {
  const colors = useColors();
  // Note that at an accessibility size the end stands under the title with the row's width, so a long name, such as a device's, wraps to a second line rather than being cut.
  const lines = useAccessibilitySize() ? 2 : 1;

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.TIME }),
        monospacedDigit(),
        foregroundStyle(ink ?? colors.TEXT_MUTED),
        lineLimit(lines),
      ]}
    >
      {words}
    </Text>
  );
}

/** A row's lead glyph in an ink, at a text style's size, so it grows with Dynamic Type beside the row's words: the muted line's unless the row asks for its title's. */
function LeadGlyph({
  symbol,
  ink,
  textStyle = TYPE_ROLE.ROW_LINE,
}: {
  readonly symbol: Glyph;
  readonly ink: string;
  readonly textStyle?: (typeof TYPE_ROLE)[keyof typeof TYPE_ROLE];
}) {
  return <Image {...glyphImage(symbol)} color={ink} modifiers={[font({ textStyle })]} />;
}

/**
 * A row's line under its title, in the row line's style,, set in to the title's words, which
 * start past the lead's column as it grows with the reader's text. At an
 * accessibility size each fact stands on a line of its own, as Mail's rows
 * stack, since side by side they broke mid-word.
 */
function RowLine({
  past = 0,
  children,
}: {
  /** How much more stands before the title's words, such as a parent's fold. */
  readonly past?: number | undefined;
  readonly children: ReactNode;
}) {
  const stacked = useAccessibilitySize();
  const lead = useScaledSize(MARK_SIZE.LEAD);
  // Note that the line starts where the title's words do: past the unread dot, its gutter, and the lead's column, each mark as it grows with the reader's text, and past whatever else leads the title.
  const dot = useScaledSize(MARK_SIZE.UNREAD);
  const inset = padding({ leading: dot + ROW_INSET.GUTTER + lead + SPACE.ROW + past });

  if (stacked) {
    return (
      <VStack alignment="leading" spacing={2} modifiers={[inset]}>
        {children}
      </VStack>
    );
  }

  return (
    <HStack spacing={SPACE.TIGHT + 1} alignment="center" modifiers={[inset]}>
      {children}
      <Spacer />
    </HStack>
  );
}

type TaskHeadProps = {
  readonly name: string;
  readonly status: TaskStatus | undefined;
  readonly priority: TaskPriority | undefined;
  /** Who it is assigned to, or the words for no one. */
  readonly assignee: Face & { readonly nobody: boolean };
  /** Who created it and when, the line under its chips: "Created by Ada Lovelace · Oct 5". */
  readonly createdBy?: string | undefined;
  /** Who follows it, as a chip under its fields; none where it carries no followers. */
  readonly following?: PageFollowing | undefined;
  /** What a press on each of its chips offers, where the reader may change that field. */
  readonly menus?: StandingMenus | undefined;
};

/**
 * A task's head as the first row of its page: its name as the page's
 * heading, its status, priority and assignee as small chips, each opening
 * the menu of its field's values where it carries one, who follows
 * it as a chip that opens them, and who created it. Its path stands in the
 * bar above.
 */
export function TaskHead(props: TaskHeadProps) {
  const { name, status, priority, assignee, createdBy, following, menus } = props;

  return (
    <VStack
      alignment="leading"
      modifiers={[
        listRowBackground("clear"),
        listRowSeparator("hidden"),
        listRowInsets({ leading: 0, trailing: 0, top: 0, bottom: 0 }),
        frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
      ]}
    >
      <PageHeader
        title={name}
        status={status}
        priority={priority}
        assignee={assignee}
        following={following}
        byline={createdBy}
        menus={menus}
      />
    </VStack>
  );
}

/** What an agent is doing, as its line says it: at work, failed, or at rest. */
export const AGENT_ROW_STATE = {
  WORKING: "working",
  FAILED: "failed",
  REST: "rest",
} as const;

export type AgentRowState = (typeof AGENT_ROW_STATE)[keyof typeof AGENT_ROW_STATE];

type AgentRowProps = {
  /** The row's id, which its list's `onSelect` is called with. */
  readonly id: string;
  readonly name: string;
  /** The provider whose harness it runs in, whose mark its tile wears; the hard hat where it is not known. */
  readonly harness?: ModelProvider | undefined;
  /** A Manager's face, which leads the row in its tile's place, livelier while it works, as the panel's sidebar row wears it (`ManagerGlyph`); none for any other agent. */
  readonly face?: ManagerFace | undefined;
  readonly state: AgentRowState;
  /** Where it runs: "Cloud", or the device's name. */
  readonly runsOn: string;
  /** The glyph that leads where it runs, as the panel's row draws it: the cloud's, or its device's. */
  readonly runsOnGlyph?: Glyph | undefined;
  /** How many of its threads wait on the reader; none said at none. */
  readonly waiting: number;
  /** The task it works on, named first in its line where the list holds agents of many tasks, as ⌘K's agent rows name it; none on the task's own page. */
  readonly task?: string | undefined;
  /** The pull request it opened: its state's glyph and number in its line, and Open pull request in its long-press menu. */
  readonly pullRequest?:
    | {
        readonly number: number;
        readonly state: PullRequestState;
        /** Whether GitHub's merge queue holds it, which its glyph says as the panel's does. */
        readonly queued?: true | undefined;
        readonly onPress: () => void;
      }
    | undefined;
  /** What a swipe from the trailing edge reveals, such as Stop or Archive, the first of it on a full swipe. */
  readonly trailingActions?: readonly RowSwipe[] | undefined;
  /** Its long press menu past its fold and its pull request, in the panel's agent menu's groups (`agentMenuGroups`): its links, Rename, Stop and Archive, and last and alone, Permanently delete. Its swipes stand behind the swipe alone. */
  readonly menu?: readonly LongPressGroup[] | undefined;
  /** What its long press lifts over its menu (`agentPreview`). */
  readonly preview?: RowPreview | undefined;
  /** What its acts ask first, such as Archive, standing by the row; none where its acts never ask. */
  readonly question?: RowQuestion | undefined;
  /** How deep it stands nested under the agent that started it, which sets it in from the list's edge; at the top unless said. */
  readonly depth?: number | undefined;
  /** The fold of the agents it started, where it started any: whether they stand open under it, and what its chevron's press does. Its caller holds it and draws them as rows of their own under it, a level deeper. */
  readonly fold?: RowFold | undefined;
  /** Where the agents it started stand, at every depth; none where it started none. */
  readonly started?: StartedAgentsStanding | undefined;
  /** Whether it said something the reader has not read, as a Manager's chat does, which its unread dot says as a task's row says its own; read unless said. */
  readonly unread?: boolean | undefined;
};

/** What an unread agent's row is heard as first, as a task's row is. */
const AGENT_UNREAD = "Unread";

/** Whether an agent's row says the agents it started stand open under it, as a task's row says its sub-tasks. */
const STARTED_SHOWN = "Agents it started shown";
const STARTED_HIDDEN = "Agents it started hidden";

/** What an agent's fold is heard as, folded and open, naming the agent. */
function startedFold(name: string): FoldWords {
  return { show: `Show agents started by ${name}`, hide: `Hide agents started by ${name}` };
}

/** What an agent row is heard as: its name, then where it stands, where it runs, its task, the agents it started, its pull request, what of it needs you, and whether the agents it started stand open. */
function agentHeard(props: AgentRowProps) {
  const { name, state, runsOn, task, started, pullRequest, waiting, fold, unread } = props;

  return {
    label: name,
    value: [
      unread === true && AGENT_UNREAD,
      state === AGENT_ROW_STATE.WORKING && GLYPH_STATE_WORDS[GLYPH_STATE.WORKING],
      state === AGENT_ROW_STATE.FAILED && GLYPH_STATE_WORDS[GLYPH_STATE.FAILED],
      runsOn,
      task,
      (started?.working ?? 0) > 0 && startedHeard(started?.working ?? 0, STARTED_STANDING.WORKING),
      (started?.failed ?? 0) > 0 && startedHeard(started?.failed ?? 0, STARTED_STANDING.FAILED),
      pullRequest !== undefined &&
        `Pull request #${pullRequest.number}, ${pullRequestMarkLabel(pullRequest)}`,
      waiting > 0 && needsYouWords(waiting),
      fold !== undefined && (fold.open ? STARTED_SHOWN : STARTED_HIDDEN),
    ],
  };
}

/** An agent's pull request in its line: its state's glyph and its number, which the row's long-press menu opens. */
function PullRequestMark({
  pullRequest,
}: {
  readonly pullRequest: NonNullable<AgentRowProps["pullRequest"]>;
}) {
  const colors = useColors();
  const look = PULL_REQUEST_LOOK[pullRequestMarkState(pullRequest)];

  return (
    <HStack spacing={SPACE.TIGHT}>
      <ToneGlyph glyph={look.symbol} tone={look.tone} textStyle={TYPE_ROLE.ROW_LINE} hidden />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE }),
          monospacedDigit(),
          foregroundStyle(colors.TEXT_MUTED),
          accessibilityValue(pullRequestMarkLabel(pullRequest)),
        ]}
      >
        {`#${pullRequest.number}`}
      </Text>
    </HStack>
  );
}

/** The row's menu act that opens its pull request, its number and state under its words; none without one. */
function pullRequestActions(pullRequest: AgentRowProps["pullRequest"]): readonly RowAction[] {
  if (pullRequest === undefined) return [];

  return [
    {
      label: OPEN_PULL_REQUEST,
      symbol: GLYPH.PULL_REQUEST,
      detail: `#${pullRequest.number} · ${pullRequestMarkLabel(pullRequest)}`,
      tone: ROW_ACTION_TONE.NEUTRAL,
      onPress: pullRequest.onPress,
    },
  ];
}

/** What an agent's line says of a state, its own or the agents' it started: the spinner or the alert, then its words (Working, Failed, "2 working"). */
function AgentStateWords({
  working,
  words,
}: {
  readonly working: boolean;
  readonly words: string;
}) {
  const colors = useColors();

  return (
    <HStack spacing={SPACE.TIGHT}>
      {working ? <WorkingMark /> : <FailedMark />}
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE }),
          // Note that Failed stands muted beside the failed mark, which already carries the red, as the panel marks a failed agent by its glyph alone.
          foregroundStyle(colors.TEXT_MUTED),
        ]}
      >
        {words}
      </Text>
    </HStack>
  );
}

/**
 * One agent on a task, as a row: its tile, its name with where it runs at
 * the line's end, and under them what it is doing, how many of the agents
 * it started, at every depth, still work and failed, its pull request, and how many of its threads
 * wait on the reader, in the accent, since they want you. An agent that
 * started others leads with the fold a parent task's row leads with, whose
 * press opens them; its caller draws them as rows of their own under it, a
 * level deeper, as a task's sub-tasks stand. One that said something the
 * reader has not read, as a Manager's chat does, leads with the unread dot.
 */
export function AgentRow(props: AgentRowProps) {
  const { id, name, harness, state, runsOn, waiting, pullRequest, task, fold, started } = props;
  const depth = props.depth ?? 0;
  const colors = useColors();
  const resting = state === AGENT_ROW_STATE.REST;
  const startedWorking = started?.working ?? 0;
  const startedFailed = started?.failed ?? 0;
  const told = !resting || pullRequest !== undefined || startedWorking + startedFailed > 0;
  // Note that the facts stand one to a line at the accessibility sizes (`RowLine`), where the needs-you count leads its own line with no separator, and the tile grows with the title.
  const stacked = useAccessibilitySize();
  const tile = useScaledSize(MARK_SIZE.LEAD);
  // Note that each level stands in past the agent that started it, and the words past a fold, by a lead's column, so a nested agent's tile stands under its starter's at every size.
  const column = useNestColumn();
  const folding = startedFold(name);

  // Note that the whole row takes a press, its tile and the room between its pieces included, so a tap on the tile opens the agent as a tap on its name does.
  const row: ReactElement = (
    <VStack
      alignment="leading"
      spacing={2}
      modifiers={[
        padding({ leading: depth * column }),
        SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
      ]}
    >
      <RowHead
        unread={props.unread === true}
        faded={false}
        fold={fold === undefined ? undefined : <FoldChevron fold={fold} words={folding} />}
        lead={
          <AgentTile
            harness={harness}
            size={tile}
            face={props.face}
            working={state === AGENT_ROW_STATE.WORKING}
          />
        }
        title={name}
        ink={colors.TEXT}
        end={
          <HStack spacing={SPACE.TIGHT}>
            {props.runsOnGlyph === undefined ? null : (
              <ToneGlyph glyph={props.runsOnGlyph} tone={STATUS_TONE.NEUTRAL} hidden />
            )}
            <EndWords words={runsOn} />
          </HStack>
        }
      />
      {!told && waiting === 0 && task === undefined ? null : (
        <RowLine past={fold === undefined ? 0 : column}>
          {task === undefined ? null : (
            <Text
              modifiers={[
                font({ textStyle: TYPE_ROLE.ROW_LINE }),
                foregroundStyle(colors.TEXT_MUTED),
                lineLimit(stacked ? 2 : 1),
              ]}
            >
              {task}
            </Text>
          )}
          {task === undefined || (!told && waiting === 0) || stacked ? null : (
            <Text
              modifiers={[
                font({ textStyle: TYPE_ROLE.ROW_LINE }),
                foregroundStyle(colors.TEXT_MUTED),
              ]}
            >
              {LINE_PART.trim()}
            </Text>
          )}
          {resting ? null : (
            <AgentStateWords
              working={state === AGENT_ROW_STATE.WORKING}
              words={
                state === AGENT_ROW_STATE.WORKING
                  ? GLYPH_STATE_WORDS[GLYPH_STATE.WORKING]
                  : GLYPH_STATE_WORDS[GLYPH_STATE.FAILED]
              }
            />
          )}
          {startedWorking === 0 ? null : (
            <AgentStateWords
              working
              words={startedShown(startedWorking, STARTED_STANDING.WORKING)}
            />
          )}
          {startedFailed === 0 ? null : (
            <AgentStateWords
              working={false}
              words={startedShown(startedFailed, STARTED_STANDING.FAILED)}
            />
          )}
          {pullRequest === undefined ? null : <PullRequestMark pullRequest={pullRequest} />}
          {waiting === 0 ? null : (
            <Text
              modifiers={[
                font({ textStyle: TYPE_ROLE.ROW_LINE }),
                foregroundStyle(colors.ACCENT_TEXT),
              ]}
            >
              {`${told && !stacked ? LINE_PART : ""}${needsYouWords(waiting)}`}
            </Text>
          )}
        </RowLine>
      )}
    </VStack>
  );

  return (
    <RowFrame
      id={id}
      row={row}
      indent={(depth + (fold === undefined ? 0 : 1)) * column}
      trailingActions={props.trailingActions}
      menu={[
        [...foldActions(fold, folding), ...pullRequestActions(pullRequest)],
        ...(props.menu ?? []),
      ]}
      preview={props.preview}
      question={props.question}
      heard={agentHeard(props)}
    />
  );
}

type RelationRowProps = {
  readonly id: string;
  readonly name: string;
  readonly status: TaskStatus | undefined;
  /** How the task stands to this one: "Blocked by", "Blocks"; or, in a picker, its key or why it cannot be picked; none where its section says it, as a task's Sub-tasks does. */
  readonly relation?: string | undefined;
  /** The relation's kind's glyph, which leads its words as the panel's relation pill does, and whether it wants the reader, as a blocker still open does, which draws both in the attention ink. */
  readonly relationMark?: { readonly glyph: Glyph; readonly attention: boolean } | undefined;
  /** Whether its words stand muted: a finished task's, as the panel mutes a settled row's name, or one a picker cannot pick, as it dims a task that cannot take the relation. */
  readonly faded?: boolean | undefined;
  /** What a swipe from the trailing edge reveals, such as Remove relation. */
  readonly trailingActions?: readonly RowSwipe[] | undefined;
  /** Menus its long press menu holds, such as Change relation. */
  readonly menuSubmenus?: readonly RowSubmenu[] | undefined;
  /** Its status as a menu its ring opens, as a task's row does (`StatusRing`); none in a picker, or where the task is unknown, where the ring is its mark alone. */
  readonly statusMenu?: RowSubmenu | undefined;
  /** Its long press menu whole, in the panel's order: a related task's Change relation and Remove relation, then the task's own menu, as its Tasks row holds it; where given, its swipes stand behind the swipe alone and `menuSubmenus` is left out. */
  readonly menu?: readonly LongPressGroup[] | undefined;
  /** What its menu's acts ask first, standing by the row (`RowAsking`); none where they never ask. */
  readonly question?: RowQuestion | undefined;
};

/** A task related to the one shown, or one a picker offers: its status ring and name, and at the line's end how it stands to this one, led by its kind's glyph where given, its swipe and long press holding what changes that. */
export function RelationRow({
  id,
  name,
  status,
  relation,
  relationMark,
  faded = false,
  trailingActions,
  menuSubmenus,
  statusMenu,
  menu,
  question,
}: RelationRowProps) {
  const colors = useColors();
  const inset = useRowInset();

  const row: ReactElement = (
    <RowHead
      unread={false}
      faded={faded}
      lead={
        status === undefined ? (
          <ToneGlyph glyph={GLYPH.TASK} tone={STATUS_TONE.NEUTRAL} textStyle={TYPE_ROLE.ROW_LINE} />
        ) : (
          <StatusRing status={status} menu={statusMenu} edge={inset.lead} />
        )
      }
      title={name}
      ink={faded ? colors.TEXT_MUTED : colors.TEXT_BODY}
      end={
        relation === undefined ? undefined : (
          <HStack spacing={SPACE.TIGHT}>
            {relationMark === undefined ? null : (
              <ToneGlyph
                glyph={relationMark.glyph}
                tone={relationMark.attention ? STATUS_TONE.ATTENTION : STATUS_TONE.NEUTRAL}
                hidden
              />
            )}
            <EndWords
              words={relation}
              ink={relationMark?.attention === true ? colors.ACCENT_TEXT : undefined}
            />
          </HStack>
        )
      }
    />
  );

  return (
    <RowFrame
      id={id}
      row={row}
      trailingActions={trailingActions}
      menuSubmenus={menuSubmenus}
      menu={menu}
      question={question}
      heard={{
        label: name,
        value: [status === undefined ? undefined : TASK_STATUS_WORDS[status], relation],
      }}
    />
  );
}

type LinkRowProps = {
  readonly symbol: Glyph;
  readonly label: string;
  /** Words at the line's end in the muted ink, such as a page's age. */
  readonly detail?: string | undefined;
  readonly tone?: LinkRowTone | undefined;
  readonly disabled?: boolean | undefined;
  readonly onPress: () => void;
  /** What its long press holds, in the panel's right-click menu's groups for what it opens, such as a page's Copy link; none for a row that acts rather than opens, such as New agent. */
  readonly menu?: readonly LongPressGroup[] | undefined;
};

/**
 * A row pressed to go somewhere or act, in a row's columns: its glyph, its
 * words, and its detail at the line's end, with no mark of where it goes,
 * as the panel's draw none: Automations, New agent, a page, or the threads
 * that need you. A row that opens something, such as a page, holds the
 * panel's menu for it on a long press (`LongPressMenu`).
 */
export function LinkRow({
  symbol,
  label,
  detail,
  tone = LINK_ROW_TONE.PLAIN,
  disabled: off = false,
  onPress,
  menu,
}: LinkRowProps) {
  const colors = useColors();
  const inset = useRowInset();
  const ink = linkInk(colors, tone);
  // Note that a held row stands its place in the list on the frame around its menu, as `RowFrame` does, since the menu wraps the button.
  const placed = menu === undefined ? rowPlacement(colors, inset) : [];

  const button = (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        disabled(off),
        ...placed,
        buttonStyle("borderless"),
        accessibilityLabel(label),
        // Note that the detail is heard after the label, since the label stands for the whole row.
        ...(detail === undefined ? [] : [accessibilityValue(detail)]),
      ]}
    >
      {/* Note that the shape stands on the row's own stack, the button's label, so a press on the row's blank run past its words still goes, since a borderless button answers only where its label is hit. */}
      <HStack modifiers={[SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle())]}>
        <RowHead
          unread={false}
          faded={false}
          lead={<LeadGlyph symbol={symbol} ink={ink} />}
          title={label}
          ink={ink}
          end={detail === undefined ? null : <EndWords words={detail} />}
        />
      </HStack>
    </SwiftUIButton>
  );

  if (menu === undefined) return button;

  return (
    <HStack modifiers={rowPlacement(colors, inset)}>
      <LongPressMenu groups={menu}>{button}</LongPressMenu>
    </HStack>
  );
}

/** Who wrote a version, by the mark its row leads with: a person, an agent, or the history from before versions were kept. */
export const VERSION_WRITER = {
  PERSON: "person",
  AGENT: "agent",
  EARLIER: "earlier",
} as const;

/** A version's writer as its mark draws them: a person by their face, an agent by its tile, name and harness's mark where it is known, and the earlier history by a mark of its own. */
export type VersionWriter =
  | { readonly kind: typeof VERSION_WRITER.PERSON; readonly face: Face }
  | {
      readonly kind: typeof VERSION_WRITER.AGENT;
      readonly name: string;
      readonly harness: ModelProvider | undefined;
    }
  | { readonly kind: typeof VERSION_WRITER.EARLIER };

/** A version's writer's mark at a row's lead, as the panel's version rows lead: a person's face, an agent's tile with its harness's mark, or the history glyph for the history before versions were kept; each grows with Dynamic Type, as a face does. */
function VersionMark({ writer }: { readonly writer: VersionWriter }) {
  const colors = useColors();
  const size = useScaledSize(MARK_SIZE.LEAD);

  switch (writer.kind) {
    case VERSION_WRITER.PERSON:
      return <Avatar name={writer.face.name} picture={writer.face.picture} size={size} />;
    case VERSION_WRITER.AGENT:
      return <AgentTile harness={writer.harness} size={size} />;
    case VERSION_WRITER.EARLIER:
      return <LeadGlyph symbol={GLYPH.HISTORY} ink={colors.TEXT_MUTED} />;
  }
}

type VersionRowProps = {
  /** Who wrote the version, as its mark draws them. */
  readonly writer: VersionWriter;
  /** The writer as the row names them, such as "You". */
  readonly name: string;
  /** What the version did, such as "3 changes". */
  readonly summary: string;
  /** When it was last saved. */
  readonly at: number;
  readonly now: number;
  /** Whether it is the description as it stands, which its line says first. */
  readonly current: boolean;
  /** Whether it heads its list, which then draws no hairline over it, as a plain list in Mail or Files begins. */
  readonly first: boolean;
  readonly onPress: () => void;
  /** What its long press holds, in the panel's version row menu's groups: its links, then Restore this version on any but the description as it stands. */
  readonly menu?: readonly LongPressGroup[] | undefined;
};

/**
 * A description's version in its history, as the panel's version row stands
 * and as Mail stands a message: the writer's face, their name and the time
 * at the line's end, and what the version did under them on up to two lines,
 * "Current" leading it on the description as it stands. VoiceOver hears it
 * as one element, the writer then what it did and when, the time in words.
 */
export function VersionRow({
  writer,
  name,
  summary,
  at,
  now,
  current,
  first,
  onPress,
  menu,
}: VersionRowProps) {
  const colors = useColors();
  const inset = useRowInset();
  const said = current ? `${VERSION_HISTORY_WORDS.CURRENT} · ${summary}` : summary;

  const placed = [
    ...rowPlacement(colors, inset),
    // Note that a headless plain list draws a hairline over its first row, which iOS's own plain lists leave out.
    ...(first ? [listRowSeparator("hidden", "top")] : []),
  ];

  const button = (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        // Note that a held row stands its place in the list on the frame around its menu, as `RowFrame` does, since the menu wraps the button.
        ...(menu === undefined ? placed : []),
        buttonStyle("borderless"),
        accessibilityLabel(name),
        accessibilityValue([said, sinceHeard(at, now)].join(", ")),
      ]}
    >
      <VStack alignment="leading" spacing={ROW_INSET.THREAD_LINE_GAP}>
        <RowHead
          unread={false}
          faded={false}
          lead={<VersionMark writer={writer} />}
          title={name}
          ink={colors.TEXT}
          end={<RowTime at={at} now={now} />}
        />
        <RowLine>
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_LINE }),
              foregroundStyle(colors.TEXT_MUTED),
              lineLimit(2),
            ]}
          >
            {said}
          </Text>
        </RowLine>
      </VStack>
    </SwiftUIButton>
  );

  if (menu === undefined) return button;

  return (
    <HStack modifiers={placed}>
      <LongPressMenu groups={menu}>{button}</LongPressMenu>
    </HStack>
  );
}

type FailedReadRowProps = {
  /** What could not be read, such as the description. */
  readonly label: string;
  /** The act's words, such as Try again. */
  readonly act: string;
  readonly onPress: () => void;
};

/**
 * A row saying a part of a page could not be read, as `ProblemLine` says
 * every problem in the app: the alert glyph in the attention ink standing
 * where a row's mark does, and the muted words beside it; then its one act at
 * the row's end as the system's small bordered capsule in the ink, as Mail
 * says a message could not be loaded. Note that only the capsule takes a
 * press, so the row reads as a line that says, with the act beside it.
 */
export function FailedReadRow({ label, act, onPress }: FailedReadRowProps) {
  const colors = useColors();
  const inset = useRowInset();

  return (
    <HStack spacing={SPACE.ROW} modifiers={rowPlacement(colors, inset)}>
      {/* Note that the line steps past the unread dot and its gutter, so its glyph stands where a row's lead mark does. */}
      <HStack modifiers={[padding({ leading: MARK_SIZE.UNREAD + ROW_INSET.GUTTER })]}>
        <ProblemLine text={label} />
      </HStack>
      <Spacer />
      <Button label={act} look={BUTTON_LOOK.BORDERED} size={BUTTON_SIZE.SMALL} onPress={onPress} />
    </HStack>
  );
}

/** How many comment threads stand open on a block, and what opens them. */
type WordsComments = {
  readonly count: number;
  /** What the count is heard as: "2 comments". */
  readonly heard: string;
  readonly onOpen: () => void;
};

type WordsRowProps = {
  readonly words: string;
  /** The task's repository, `owner/name`, whose GitHub pages are its files' chips. */
  readonly repository?: string | null | undefined;
  /** Opens a link or a chip pressed, by the address it was written as, where the app draws it or in Safari. */
  readonly onOpenLink: (address: string) => void;
  /** What a long press on the words offers, such as Comment on one block of a description; none where the words are read alone. */
  readonly menuActions?: readonly RowAction[] | undefined;
  /** The comment threads standing open on the words, counted beside them; none where none stand. */
  readonly comments?: WordsComments | undefined;
  /** How far under the words the next row stands: a page's gap after the last block, a block's own gap between blocks. */
  readonly last?: boolean | undefined;
  /** The address a picture is drawn from, by the address its words name it by, such as a description's picture read through the host; each from the address it names where none is given. */
  readonly pictureSource?: ((written: string) => PictureRef | null | undefined) | undefined;
  /** The video a picture's address names, played in its place; none where none is given. */
  readonly videoAt?: ((written: string) => MarkdownVideo | undefined) | undefined;
  /** The file a picture's address names, such as a description's PDF, drawn as its chip in its place. */
  readonly fileAt?: ((written: string) => MarkdownFile | undefined) | undefined;
  /** What GitHub holds of a pull request or issue a chip in the words names, by its page, which the chip says where it stands. */
  readonly linkStanding?: ((page: string) => LinkStanding | undefined) | undefined;
  /** Whether raw HTML in the words stays unseen, as GitHub's page hides a pull request body's comments and tags. */
  readonly hidesHtml?: boolean | undefined;
  /** How the words stand against the version before them, where they are a version's section, which a bar at their leading edge marks; none where they are read alone. */
  readonly change?: VersionUnit["change"] | undefined;
  /** Takes a press on the words, by how far in from their start it landed, as a description edited in place puts the caret there; none where the words are read alone. A link or a chip pressed still opens. */
  readonly onPressAt?: ((x: number, y: number) => void) | undefined;
  /** Where its words start: the screen's edge, or the rows' leading marks'; the screen's edge where none is given. */
  readonly edge?: WordsEdge | undefined;
  /** Groups its long press menu holds after its acts, such as a pull request description's Add reaction; none where it offers nothing more. */
  readonly menuGroups?: readonly LongPressGroup[] | undefined;
  /** The reactions the words wear as one line, such as "👍 2  ❤️ 1", under them; none where they wear none. */
  readonly reactions?: string | undefined;
  /** Whether the words stand cut to their first dozen lines or so, fading into the ground at their foot, as a long pull request description stands until Show more. */
  readonly folded?: boolean | undefined;
};

/**
 * A document's field as a row of a list, as a task's description edited in
 * place stands where its words were read: the field, grown to its words,
 * hosted in the row as the read words are, with the same insets, so the
 * words stand where they stood.
 */
export function FieldRow({ children }: { readonly children: ReactNode }) {
  return (
    <VStack
      modifiers={[
        listRowBackground("clear"),
        listRowSeparator("hidden"),
        listRowInsets({
          leading: SPACE.EDGE,
          trailing: SPACE.EDGE,
          top: SPACE.TIGHT,
          bottom: SPACE.PAGE,
        }),
        frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
      ]}
    >
      <RNHostView matchContents={{ vertical: true }}>
        <View>{children}</View>
      </RNHostView>
    </VStack>
  );
}

/**
 * Where a description's words start: at the screen's edge, as a task's page
 * stands them under its grouped headers, or where a list's rows start their
 * leading marks (`inset.lead`), as a pull request's page stands its heading,
 * its rows, and its words on one edge.
 */
export const WORDS_EDGE = {
  PAGE: "page",
  ROWS: "rows",
} as const;

export type WordsEdge = (typeof WORDS_EDGE)[keyof typeof WORDS_EDGE];

/** How tall folded words stand at the body's size, about twelve of its lines. */
const FOLDED_HEIGHT = 264;

/** How tall the fade at the foot of folded words stands, about two lines of the body. */
const FOLD_FADE = 44;

/** The bar a version's section wears by how it changed, as the panel's version page edges one: green for words written, red for words struck, which also stand dimmed. */
const CHANGE_BAR = {
  [VERSION_CHANGE.ADDED]: { color: "COMPLETE", dimmed: false },
  [VERSION_CHANGE.CHANGED]: { color: "COMPLETE", dimmed: false },
  [VERSION_CHANGE.REMOVED]: { color: "DANGER", dimmed: true },
} as const satisfies Record<
  keyof typeof VERSION_CHANGE_HEARD,
  { readonly color: keyof BrandColors; readonly dimmed: boolean }
>;

/**
 * How far a struck section's words fade, as the panel draws them in its quiet
 * ink. Note that it fades no further than keeps the body's ink at WCAG's
 * 4.5:1 on the ground, in the light theme and the dark: about 5:1 on white
 * and 6.7:1 on near-black.
 */
const STRUCK_OPACITY = 0.62;

/** How wide a changed section's bar stands, in points. */
const CHANGE_BAR_WIDTH = 3;

/**
 * A changed section: its words in the page's own column, set in by the
 * bar's room, and the bar standing in that room the words' whole height.
 * Note that the words never stand in a row beside the bar, because a row
 * the host measured with no width of its own laid them out at their whole
 * length, so a changed section's lines ran past the page cut off rather
 * than wrapping, as an unchanged one's wrap.
 */
const CHANGED_STYLE = StyleSheet.create({
  words: { paddingLeft: CHANGE_BAR_WIDTH + SPACE.ROW },
  bar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: CHANGE_BAR_WIDTH,
    borderRadius: CHANGE_BAR_WIDTH / 2,
  },
  struck: { opacity: STRUCK_OPACITY },
});

/**
 * A version's section at its leading edge's bar, heard before the words as
 * how the section changed, since the bar itself says nothing to VoiceOver.
 */
function ChangedWords({
  change,
  children,
}: {
  readonly change: VersionUnit["change"];
  readonly children: ReactNode;
}) {
  const colors = useColors();

  if (change === VERSION_CHANGE.SAME) return children;
  const bar = CHANGE_BAR[change];

  return (
    <View style={CHANGED_STYLE.words}>
      <View
        accessible
        accessibilityLabel={VERSION_CHANGE_HEARD[change]}
        style={[CHANGED_STYLE.bar, { backgroundColor: colors[bar.color] }]}
      />
      <View style={bar.dimmed ? CHANGED_STYLE.struck : undefined}>{children}</View>
    </View>
  );
}

/** The count of a block's open comment threads at its trailing edge, as a document's margin marks them, opening them on a press. */
function CommentCount({ comments }: { readonly comments: WordsComments }) {
  const colors = useColors();
  const rolling = useRollingCount(comments.count);

  return (
    <SwiftUIButton
      onPress={comments.onOpen}
      modifiers={[buttonStyle("borderless"), accessibilityLabel(comments.heard)]}
    >
      {/* Note that the count stands in Apple's least target, the shape on that frame rather than on the button, since a borderless button takes a press only where its label is hit. */}
      {/* Note that it stands at its target's top, set down a little, so it reads level with the block's first line, a heading's or a paragraph's, rather than 22 pt down the target's middle. */}
      <HStack
        spacing={SPACE.TIGHT}
        modifiers={[
          padding({ top: SPACE.TIGHT }),
          frame({ minWidth: PRESS_SIZE, minHeight: PRESS_SIZE, alignment: "top" }),
          SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
        ]}
      >
        <Image
          {...glyphImage(GLYPH.COMMENT)}
          size={MARK_SIZE.GLYPH - 2}
          color={colors.TEXT_MUTED}
        />
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.TIME }),
            monospacedDigit(),
            foregroundStyle(colors.TEXT_MUTED),
            ...rolling,
          ]}
        >
          {String(comments.count)}
        </Text>
      </HStack>
    </SwiftUIButton>
  );
}

/**
 * A description's words as a row of a list, read-only and flat on the
 * ground: the Markdown drawn in React Native views hosted in the row, as
 * wide as the list and as tall as the words, since SwiftUI has no piece
 * that draws the panel's Markdown. Given acts, a long press lifts the words
 * over the system's menu of them, as a document's block offers Comment;
 * given comments, their count stands at the words' trailing edge.
 */
export function WordsRow({
  words,
  repository,
  onOpenLink,
  menuActions = [],
  comments,
  last = true,
  pictureSource,
  videoAt,
  fileAt,
  linkStanding,
  hidesHtml,
  change = VERSION_CHANGE.SAME,
  onPressAt,
  folded = false,
  menuGroups = [],
  reactions,
  edge = WORDS_EDGE.PAGE,
}: WordsRowProps) {
  const colors = useColors();
  const inset = useRowInset();
  const foldedHeight = useScaledSize(FOLDED_HEIGHT);

  // Note that the press is the words' own, not VoiceOver's: the words stay read as words, and the section's Edit edits them.
  const host = (
    <RNHostView matchContents={{ vertical: true }}>
      <Pressable
        accessible={false}
        disabled={onPressAt === undefined}
        onPress={({ nativeEvent }) => onPressAt?.(nativeEvent.locationX, nativeEvent.locationY)}
      >
        <ChangedWords change={change}>
          <Markdown
            words={words}
            repository={repository}
            onOpenLink={onOpenLink}
            pictureSource={pictureSource}
            videoAt={videoAt}
            fileAt={fileAt}
            linkStanding={linkStanding}
            hidesHtml={hidesHtml}
            headings
            diagrams
          />
        </ChangedWords>
      </Pressable>
    </RNHostView>
  );

  const held = <LongPressMenu groups={[menuActions, ...menuGroups]}>{host}</LongPressMenu>;

  return (
    <HStack
      alignment="top"
      spacing={SPACE.ROW}
      modifiers={[
        listRowBackground("clear"),
        listRowSeparator("hidden"),
        listRowInsets({
          leading: edge === WORDS_EDGE.ROWS ? inset.lead : SPACE.EDGE,
          trailing: edge === WORDS_EDGE.ROWS ? inset.margin : SPACE.EDGE,
          top: SPACE.TIGHT,
          bottom: last ? SPACE.PAGE : SPACE.TIGHT,
        }),
        frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
      ]}
    >
      <VStack
        alignment="leading"
        spacing={SPACE.TIGHT}
        modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" })]}
      >
        {!folded ? (
          <VStack modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" })]}>
            {held}
          </VStack>
        ) : (
          // Note that folded words are laid out whole and cut by their frame, so a block is never split mid-structure, and their foot fades into the ground rather than cutting a line in half.
          <ZStack alignment="bottom">
            <VStack
              modifiers={[
                frame({
                  maxWidth: Number.POSITIVE_INFINITY,
                  maxHeight: foldedHeight,
                  alignment: "topLeading",
                }),
                clipped(),
              ]}
            >
              {held}
            </VStack>
            <Rectangle
              modifiers={[
                frame({ height: FOLD_FADE }),
                foregroundStyle({
                  type: "linearGradient",
                  colors: ["clear", colors.GROUND],
                  startPoint: { x: 0.5, y: 0 },
                  endPoint: { x: 0.5, y: 1 },
                }),
              ]}
            />
          </ZStack>
        )}
        {reactions === undefined ? null : (
          <Text
            modifiers={[font({ textStyle: TYPE_ROLE.TIME }), foregroundStyle(colors.TEXT_MUTED)]}
          >
            {reactions}
          </Text>
        )}
      </VStack>
      {comments === undefined || comments.count === 0 ? null : <CommentCount comments={comments} />}
    </HStack>
  );
}
