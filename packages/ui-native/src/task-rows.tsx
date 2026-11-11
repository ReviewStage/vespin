// task-rows.tsx -- the rows a task's page and the Tasks list draw beside the task rows: a task's head, an agent, a related task, a group, a row that opens somewhere, and a description's words.

import {
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
import type { ModelProvider } from "@repo/features/models-wire";
import { PULL_REQUEST_STATE_LABEL, pullRequestMarkState } from "@repo/features/pull-request-model";
import { TASK_STATUS_WORDS } from "@repo/features/task-standing-words";
import type { TaskStatus } from "@repo/features/task-wire";
import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { HOVER_EFFECT, hoverEffect } from "./interactions.js";
import { RowFrame, RowHead, type RowSwipe, rowPlacement } from "./list-row.js";
import { Markdown } from "./markdown.js";
import {
  AgentTile,
  type Face,
  FailedMark,
  TaskStatusMark,
  ToneGlyph,
  WorkingMark,
} from "./marks.js";
import { PageHeader } from "./page-header.js";
import type { SfSymbol } from "./sf-symbol.js";
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

/** A row's lead glyph in an ink, at the title's size, so it grows with Dynamic Type beside it. */
function LeadGlyph({ symbol, ink }: { readonly symbol: SfSymbol; readonly ink: string }) {
  return (
    <Image systemName={symbol} color={ink} modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE })]} />
  );
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
};

/**
 * A task's head as the first row of its page: its name as the page's
 * heading, its status, priority and assignee as small chips, and who
 * created it. Its path stands in the bar above.
 */
export function TaskHead({ name, status, priority, assignee, createdBy }: TaskHeadProps) {
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
        summary={createdBy}
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
        hoverEffect(HOVER_EFFECT.HIGHLIGHT),
        accessibilityValue(PULL_REQUEST_STATE_LABEL[pullRequest.state]),
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
  /** How the task stands to this one: "Sub-task", "Blocked by", "Blocks". */
  readonly relation: string;
};

/** A task related to the one shown: its status ring and name, and at the line's end how it stands to this one. */
export function RelationRow({ id, name, status, relation }: RelationRowProps) {
  const colors = useColors();

  const row: ReactElement = (
    <RowHead
      unread={false}
      faded={false}
      lead={
        status === undefined ? (
          <ToneGlyph glyph="doc.text" tone={STATUS_TONE.NEUTRAL} textStyle={TYPE_ROLE.ROW_LINE} />
        ) : (
          <TaskStatusMark status={status} />
        )
      }
      title={name}
      ink={colors.TEXT_BODY}
      end={<EndWords words={relation} />}
    />
  );

  return (
    <RowFrame
      id={id}
      row={row}
      heard={{
        label: name,
        value: [status === undefined ? undefined : TASK_STATUS_WORDS[status], relation],
      }}
    />
  );
}

type LinkRowProps = {
  readonly symbol: SfSymbol;
  readonly label: string;
  /** Words at the line's end in the muted ink, such as a page's age. */
  readonly detail?: string | undefined;
  readonly tone?: LinkRowTone | undefined;
  readonly disabled?: boolean | undefined;
  readonly onPress: () => void;
};

/**
 * A row pressed to go somewhere or act, in a row's columns: its glyph, its
 * words, and its detail at the line's end, with no mark of where it goes,
 * as the panel's draw none: Automations, New agent, a page, or the threads
 * that need you.
 */
export function LinkRow({
  symbol,
  label,
  detail,
  tone = LINK_ROW_TONE.PLAIN,
  disabled = false,
  onPress,
}: LinkRowProps) {
  const colors = useColors();
  const ink = linkInk(colors, tone);

  return (
    <SwiftUIButton
      onPress={onPress}
      {...(disabled ? { disabled: true } : {})}
      modifiers={[...rowPlacement(colors), buttonStyle("borderless"), accessibilityLabel(label)]}
    >
      <RowHead
        unread={false}
        faded={false}
        lead={<LeadGlyph symbol={symbol} ink={ink} />}
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
  readonly symbol: SfSymbol;
  /** How many it holds, such as the Inbox's threads waiting on you; no count where none is given. */
  readonly count?: number | undefined;
  /** What a flow finds the row by, such as the Search tab's id where the sidebar stands for the tab bar. */
  readonly testId?: string | undefined;
};

/** A place a wide window's sidebar picks, such as the Inbox or Tasks: its glyph, its name, and how many it holds. */
export function GroupRow({ id, title, symbol, count, testId }: GroupRowProps) {
  const colors = useColors();

  const row: ReactElement = (
    <RowHead
      unread={false}
      faded={false}
      lead={<LeadGlyph symbol={symbol} ink={colors.TEXT_MUTED} />}
      title={title}
      ink={colors.TEXT_BODY}
      end={count === undefined ? undefined : <EndWords words={String(count)} />}
    />
  );

  const heard = { label: title, value: count === undefined ? [] : [String(count)] };

  if (testId === undefined) return <RowFrame id={id} row={row} heard={heard} />;

  return (
    <RowFrame
      id={id}
      row={<HStack modifiers={[accessibilityIdentifier(testId)]}>{row}</HStack>}
      heard={heard}
    />
  );
}

type WordsRowProps = {
  readonly words: string;
  /** The task's repository, `owner/name`, whose GitHub pages are its files' chips. */
  readonly repository?: string | null | undefined;
  /** Opens a link or a chip pressed, by the address it was written as, where the app draws it or in Safari. */
  readonly onOpenLink: (address: string) => void;
};

/**
 * A description's words as a row of a list, read-only and flat on the
 * ground: the Markdown drawn in React Native views hosted in the row, as
 * wide as the list and as tall as the words, since SwiftUI has no piece
 * that draws the panel's Markdown.
 */
export function WordsRow({ words, repository, onOpenLink }: WordsRowProps) {
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
        <View>
          <Markdown words={words} repository={repository} onOpenLink={onOpenLink} headings />
        </View>
      </RNHostView>
    </VStack>
  );
}
