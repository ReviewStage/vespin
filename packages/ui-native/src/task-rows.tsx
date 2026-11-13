// task-rows.tsx -- the rows a task's page and the Tasks list draw beside the task rows: a task's head, an agent, a related task, a group, a row that opens somewhere, and a description's words.

import {
  ContextMenu,
  HStack,
  Image,
  RNHostView,
  Spacer,
  Button as SwiftUIButton,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityHint,
  accessibilityIdentifier,
  accessibilityLabel,
  accessibilityValue,
  buttonStyle,
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
import { GLYPH_STATE, GLYPH_STATE_WORDS } from "@repo/features/glyph-state";
import { needsYouWords } from "@repo/features/inbox-list-model";
import type { LinkStanding } from "@repo/features/link-standing-model";
import type { ModelProvider } from "@repo/features/models-wire";
import { pullRequestMarkLabel, pullRequestMarkState } from "@repo/features/pull-request-model";
import { TASK_STATUS_WORDS } from "@repo/features/task-standing-words";
import type { TaskStatus } from "@repo/features/task-wire";
import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { BrandMark } from "./brand-mark.js";
import { GLYPH, type Glyph, glyphImage } from "./glyph.js";
import { PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { dropLink } from "./interactions.js";
import {
  actionButton,
  ROW_PLACE,
  type RowAction,
  RowFrame,
  RowHead,
  type RowSubmenu,
  type RowSwipe,
  rowPlacement,
} from "./list-row.js";
import { Markdown, type MarkdownVideo } from "./markdown.js";
import {
  AgentTile,
  Avatar,
  type Face,
  FailedMark,
  TaskStatusMark,
  ToneGlyph,
  WorkingMark,
} from "./marks.js";
import { type PageFollowing, PageHeader, type StandingMenus } from "./page-header.js";
import { type BrandColors, STATUS_TONE, useColors } from "./tokens/colors.js";
import { MARK_SIZE, ROW_INSET, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What parts the pieces of an agent's line. */
const LINE_PART = "· ";

/** What a pull request's number in an agent's line is heard to do. */
const OPENS_PULL_REQUEST = "Opens the pull request";

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

/** A row's 12 pt words at the line's end, in the muted ink or the one given, with tabular figures. */
function EndWords({ words, ink }: { readonly words: string; readonly ink?: string | undefined }) {
  const colors = useColors();

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.TIME }),
        monospacedDigit(),
        foregroundStyle(ink ?? colors.TEXT_MUTED),
        lineLimit(1),
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

/** A row's 13 pt line under its title, set in to the title's words. */
function RowLine({ children }: { readonly children: ReactNode }) {
  return (
    <HStack
      spacing={SPACE.TIGHT + 1}
      alignment="center"
      modifiers={[padding({ leading: ROW_INSET.TEXT - ROW_INSET.LEADING })]}
    >
      {children}
      <Spacer />
    </HStack>
  );
}

type TaskHeadProps = {
  readonly name: string;
  readonly status: TaskStatus | undefined;
  /** Its priority's name. */
  readonly priority: string | undefined;
  /** Who it is assigned to, or the words for no one. */
  readonly assignee: Face & { readonly nobody: boolean };
  /** Who created it and when, the line under its chips: "Created by Ada Lovelace · Oct 5". */
  readonly createdBy?: string | undefined;
  /** Who follows it, as a chip under its fields; none while its workspace has Following off. */
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
        summary={createdBy}
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
  /** The provider whose harness it runs in, whose mark its tile wears; the sparkles where it is not known. */
  readonly harness?: ModelProvider | undefined;
  readonly state: AgentRowState;
  /** Where it runs: "Cloud", or the device's name. */
  readonly runsOn: string;
  /** How many of its threads wait on the reader; none said at none. */
  readonly waiting: number;
  /** The pull request it opened, its state's glyph and number in its line, pressed to open it. */
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
  /** What its long press lifts over its menu (`AgentPreview`). */
  readonly preview?: ReactElement | undefined;
};

/** An agent's pull request in its line: its state's glyph and its number, pressed to open it. */
function PullRequestLink({
  pullRequest,
}: {
  readonly pullRequest: NonNullable<AgentRowProps["pullRequest"]>;
}) {
  const colors = useColors();
  const look = PULL_REQUEST_LOOK[pullRequestMarkState(pullRequest)];

  return (
    <SwiftUIButton
      onPress={pullRequest.onPress}
      modifiers={[
        buttonStyle("borderless"),
        accessibilityValue(pullRequestMarkLabel(pullRequest)),
        accessibilityHint(OPENS_PULL_REQUEST),
      ]}
    >
      <HStack spacing={SPACE.TIGHT}>
        <ToneGlyph glyph={look.symbol} tone={look.tone} textStyle={TYPE_ROLE.ROW_LINE} hidden />
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE }),
            monospacedDigit(),
            foregroundStyle(colors.TEXT_MUTED),
          ]}
        >
          {`#${pullRequest.number}`}
        </Text>
      </HStack>
    </SwiftUIButton>
  );
}

/** What an agent's line says of its state: the spinner and Working, or the alert and Failed. */
function AgentStateWords({ working }: { readonly working: boolean }) {
  const colors = useColors();

  return (
    <HStack spacing={SPACE.TIGHT}>
      {working ? <WorkingMark /> : <FailedMark />}
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE }),
          foregroundStyle(working ? colors.TEXT_MUTED : colors.DANGER_TEXT),
        ]}
      >
        {working ? GLYPH_STATE_WORDS[GLYPH_STATE.WORKING] : GLYPH_STATE_WORDS[GLYPH_STATE.FAILED]}
      </Text>
    </HStack>
  );
}

/**
 * One agent on a task, as a row: its tile, its name with where it runs at
 * the line's end, and under them what it is doing, its pull request, and
 * how many of its threads wait on the reader, in the accent, since they
 * want you.
 */
export function AgentRow(props: AgentRowProps) {
  const { id, name, harness, state, runsOn, waiting, pullRequest } = props;
  const colors = useColors();
  const resting = state === AGENT_ROW_STATE.REST;
  const told = !resting || pullRequest !== undefined;

  const row: ReactElement = (
    <VStack alignment="leading" spacing={2}>
      <RowHead
        unread={false}
        faded={false}
        lead={<AgentTile name={name} harness={harness} size={MARK_SIZE.LEAD} />}
        title={name}
        ink={colors.TEXT}
        end={<EndWords words={runsOn} />}
      />
      {!told && waiting === 0 ? null : (
        <RowLine>
          {resting ? null : <AgentStateWords working={state === AGENT_ROW_STATE.WORKING} />}
          {pullRequest === undefined ? null : <PullRequestLink pullRequest={pullRequest} />}
          {waiting === 0 ? null : (
            <Text
              modifiers={[
                font({ textStyle: TYPE_ROLE.ROW_LINE }),
                foregroundStyle(colors.ACCENT_TEXT),
              ]}
            >
              {`${told ? LINE_PART : ""}${needsYouWords(waiting)}`}
            </Text>
          )}
        </RowLine>
      )}
    </VStack>
  );

  return (
    <RowFrame id={id} row={row} trailingActions={props.trailingActions} preview={props.preview} />
  );
}

type RelationRowProps = {
  readonly id: string;
  readonly name: string;
  readonly status: TaskStatus | undefined;
  /** How the task stands to this one: "Blocked by", "Blocks"; or, in a picker, its key or why it cannot be picked; none where its section says it, as a task's Sub-tasks does. */
  readonly relation?: string | undefined;
  /** Whether it cannot be picked, which mutes its words, as a picker dims a task that cannot take the relation. */
  readonly faded?: boolean | undefined;
  /** What a swipe from the trailing edge reveals, such as Remove relation. */
  readonly trailingActions?: readonly RowSwipe[] | undefined;
  /** Menus its long press menu holds, such as Change relation. */
  readonly menuSubmenus?: readonly RowSubmenu[] | undefined;
};

/** A task related to the one shown, or one a picker offers: its status ring and name, and at the line's end how it stands to this one, its swipe and long press holding what changes that. */
export function RelationRow({
  id,
  name,
  status,
  relation,
  faded = false,
  trailingActions,
  menuSubmenus,
}: RelationRowProps) {
  const colors = useColors();

  const row: ReactElement = (
    <RowHead
      unread={false}
      faded={faded}
      lead={
        status === undefined ? (
          <ToneGlyph glyph={GLYPH.TASK} tone={STATUS_TONE.NEUTRAL} textStyle={TYPE_ROLE.ROW_LINE} />
        ) : (
          <TaskStatusMark status={status} />
        )
      }
      title={name}
      ink={faded ? colors.TEXT_MUTED : colors.TEXT_BODY}
      end={relation === undefined ? undefined : <EndWords words={relation} />}
    />
  );

  return (
    <RowFrame
      id={id}
      row={row}
      trailingActions={trailingActions}
      menuSubmenus={menuSubmenus}
      heard={{
        label: name,
        value: [status === undefined ? undefined : TASK_STATUS_WORDS[status], relation],
      }}
    />
  );
}

/** Who a row is of, where it leads with a face in its glyph's place, as the panel's version rows lead with their writer's: a member by their face, a coding agent by its tile, or the product by its mark. */
export const LINK_FACE = {
  PERSON: "person",
  AGENT: "agent",
  PRODUCT: "product",
} as const;

export type LinkFace =
  | { readonly of: typeof LINK_FACE.PERSON; readonly face: Face }
  | {
      readonly of: typeof LINK_FACE.AGENT;
      readonly name: string;
      readonly harness: ModelProvider | undefined;
    }
  | { readonly of: typeof LINK_FACE.PRODUCT };

/** A row's face at the size a face stands in a row's lead column, growing with Dynamic Type. */
function LinkFaceMark({ face }: { readonly face: LinkFace }) {
  const size = useScaledSize(MARK_SIZE.FACE);

  switch (face.of) {
    case LINK_FACE.PERSON:
      return <Avatar name={face.face.name} picture={face.face.picture} size={size} />;
    case LINK_FACE.AGENT:
      return <AgentTile name={face.name} harness={face.harness} size={size} />;
    case LINK_FACE.PRODUCT:
      return <BrandMark size={size} />;
  }
}

type LinkRowProps = {
  readonly symbol: Glyph;
  /** Who the row is of, by their face in the glyph's place; the glyph where none is given. */
  readonly face?: LinkFace | undefined;
  readonly label: string;
  /** Words at the line's end in the muted ink, such as a page's age. */
  readonly detail?: string | undefined;
  readonly tone?: LinkRowTone | undefined;
  readonly disabled?: boolean | undefined;
  readonly onPress: () => void;
};

/**
 * A row pressed to go somewhere or act, in a row's columns: its glyph, or
 * whose it is by their face, its words, and its detail at the line's end, with no mark of where it goes,
 * as the panel's draw none: Automations, New agent, a page, or the threads
 * that need you.
 */
export function LinkRow({
  symbol,
  face,
  label,
  detail,
  tone = LINK_ROW_TONE.PLAIN,
  disabled: off = false,
  onPress,
}: LinkRowProps) {
  const colors = useColors();
  const ink = linkInk(colors, tone);

  return (
    <SwiftUIButton
      onPress={onPress}
      modifiers={[
        disabled(off),
        ...rowPlacement(colors),
        buttonStyle("borderless"),
        accessibilityLabel(label),
        // Note that the detail is heard after the label, since the label stands for the whole row.
        ...(detail === undefined ? [] : [accessibilityValue(detail)]),
      ]}
    >
      <RowHead
        unread={false}
        faded={false}
        lead={
          face === undefined ? (
            <LeadGlyph symbol={symbol} ink={ink} />
          ) : (
            <LinkFaceMark face={face} />
          )
        }
        title={label}
        ink={ink}
        end={detail === undefined ? null : <EndWords words={detail} />}
      />
    </SwiftUIButton>
  );
}

type GroupRowProps = {
  /** The row's id, which its list's `onSelect` is called with. */
  readonly id: string;
  readonly title: string;
  readonly symbol: Glyph;
  /** How many it holds, such as the Inbox's threads waiting on you; no count where none is given. */
  readonly count?: number | undefined;
  /** What a flow finds the row by, such as the Search tab's id where the sidebar stands for the tab bar. */
  readonly testId?: string | undefined;
  /** Takes a row dragged onto it, on an iPad, and hands on the row's link, as a `ListSection`'s header does. */
  readonly onDropLink?: ((url: string) => void) | undefined;
};

/**
 * A place a wide window's sidebar picks, such as the Inbox, Tasks, or a
 * section of tasks, as Mail draws a mailbox: its glyph a step over its name
 * in a column of its own, so every name starts at one edge, its name at the
 * body's size, and how many it holds at the trailing edge in the muted ink,
 * the whole row in a rounded fill while it is picked.
 */
export function GroupRow({ id, title, symbol, count, testId, onDropLink }: GroupRowProps) {
  const colors = useColors();
  const stacked = useAccessibilitySize();
  const leadWidth = useScaledSize(MARK_SIZE.SIDEBAR_LEAD);

  const name = (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.SIDEBAR_TITLE }),
        foregroundStyle(colors.TEXT),
        lineLimit(stacked ? 2 : 1),
      ]}
    >
      {title}
    </Text>
  );

  const counted =
    count === undefined ? null : (
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.SIDEBAR_COUNT }),
          monospacedDigit(),
          foregroundStyle(colors.TEXT_MUTED),
          lineLimit(1),
        ]}
      >
        {String(count)}
      </Text>
    );

  // Note that at an accessibility size the count stands under the name rather than beside it, as the list's rows stack their end, so a long name keeps the row's width.
  const row: ReactElement = (
    <HStack spacing={SPACE.ROW} alignment={stacked ? "top" : "center"}>
      <HStack modifiers={[frame({ width: leadWidth })]}>
        <LeadGlyph symbol={symbol} ink={colors.TEXT_MUTED} textStyle={TYPE_ROLE.SIDEBAR_GLYPH} />
      </HStack>
      {stacked ? (
        <VStack alignment="leading" spacing={2}>
          {name}
          {counted}
        </VStack>
      ) : (
        name
      )}
      <Spacer />
      {stacked ? null : counted}
    </HStack>
  );

  const heard = { label: title, value: count === undefined ? [] : [String(count)] };

  const modifiers = [
    ...(testId === undefined ? [] : [accessibilityIdentifier(testId)]),
    ...(onDropLink === undefined ? [] : [dropLink(onDropLink)]),
  ];

  return (
    <RowFrame
      id={id}
      row={modifiers.length === 0 ? row : <HStack modifiers={modifiers}>{row}</HStack>}
      heard={heard}
      place={ROW_PLACE.SIDEBAR}
    />
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
  readonly pictureSource?: ((written: string) => string | null | undefined) | undefined;
  /** The video a picture's address names, played in its place; none where none is given. */
  readonly videoAt?: ((written: string) => MarkdownVideo | undefined) | undefined;
  /** What GitHub holds of a pull request or issue a chip in the words names, by its page, which the chip says where it stands. */
  readonly linkStanding?: ((page: string) => LinkStanding | undefined) | undefined;
};

/** The count of a block's open comment threads at its trailing edge, as a document's margin marks them, opening them on a press. */
function CommentCount({ comments }: { readonly comments: WordsComments }) {
  const colors = useColors();

  return (
    <SwiftUIButton
      onPress={comments.onOpen}
      modifiers={[buttonStyle("borderless"), accessibilityLabel(comments.heard)]}
    >
      <HStack spacing={SPACE.TIGHT}>
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
  linkStanding,
}: WordsRowProps) {
  const colors = useColors();

  const host = (
    <RNHostView matchContents={{ vertical: true }}>
      <View>
        <Markdown
          words={words}
          repository={repository}
          onOpenLink={onOpenLink}
          pictureSource={pictureSource}
          videoAt={videoAt}
          linkStanding={linkStanding}
          headings
        />
      </View>
    </RNHostView>
  );

  const held =
    menuActions.length === 0 ? (
      host
    ) : (
      <ContextMenu>
        <ContextMenu.Items>
          {menuActions.map((action) => actionButton(action, colors))}
        </ContextMenu.Items>
        <ContextMenu.Trigger>{host}</ContextMenu.Trigger>
      </ContextMenu>
    );

  return (
    <HStack
      alignment="top"
      spacing={SPACE.ROW}
      modifiers={[
        listRowBackground("clear"),
        listRowSeparator("hidden"),
        listRowInsets({
          leading: SPACE.EDGE,
          trailing: SPACE.EDGE,
          top: SPACE.TIGHT,
          bottom: last ? SPACE.PAGE : SPACE.TIGHT,
        }),
        frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
      ]}
    >
      <VStack modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" })]}>
        {held}
      </VStack>
      {comments === undefined || comments.count === 0 ? null : <CommentCount comments={comments} />}
    </HStack>
  );
}
