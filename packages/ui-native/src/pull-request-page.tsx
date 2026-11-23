// pull-request-page.tsx -- a pull request's page: its heading with where it stands, who opened it and its branches, the rows of its checks and reviews, each with its face, the line a change GitHub refused leaves, and the question an act asks first.

import { HStack, Menu, ScrollView, Text, Toggle, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  accessibilityHint,
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  lineLimit,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  menuIndicator,
  monospacedDigit,
  onTapGesture,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { GitHubPerson, PullRequestLabel, PullRequestState } from "@repo/features/agent-wire";
import { pullRequestMarkState } from "@repo/features/pull-request-model";
import { agoText } from "@repo/features/time-format";
import type { ReactElement } from "react";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { FieldChip, LabelChip } from "./button.js";
import { GLYPH, type MarkLook } from "./glyph.js";
import { PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { RowFrame, RowHead } from "./list-row.js";
import { Avatar, FACE_KIND, type Face, ToneGlyph } from "./marks.js";
import { GoesMark, PUSH_ROW_GOES } from "./settings-form.js";
import { STATUS_TONE, useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What joins a pull request's branches, the one it merges from after the one it merges into, as GitHub writes it. */
const BRANCH_ARROW = "←";

/** Someone a pull request names on GitHub, as a face: their login, their avatar, and an App's bot in its rounded square, as the panel draws them. */
export function githubFace(person: GitHubPerson): Face {
  return {
    name: person.login,
    picture: person.avatarUrl,
    kind: person.bot ? FACE_KIND.APP : FACE_KIND.PERSON,
  };
}

/** Who opened a pull request and when, and when it merged where it has. */
type Opened = {
  /** Who opened it, by their GitHub name and avatar; none where the read names no one. */
  readonly by: Face | undefined;
  readonly at: number;
  readonly mergedAt: number | null;
};

type PullRequestHeadProps = {
  readonly title: string;
  /** What a tap on the title does, opening its edit, and what VoiceOver hears it does ("Edit title"); none where it can't be edited now, as while another change is out. */
  readonly titleEdit?: { readonly heard: string; readonly onPress: () => void } | undefined;
  readonly number: number;
  readonly state: PullRequestState;
  /** Whether GitHub's merge queue holds it, which its mark says in the merge's glyph. */
  readonly queued: boolean;
  /** Where it stands in a word, as the panel's pill says it: "Open", "Queued #2", "Merged". */
  readonly stateLabel: string;
  /** The branch it merges into and the one it merges from; none until its read lands. */
  readonly branches?: { readonly base: string; readonly head: string } | undefined;
  /** Whether it would merge as it stands, in GitHub's sentence: "Ready to merge". */
  readonly sentence?: string | undefined;
  /** Who opened it and when; none until its read lands. */
  readonly opened?: Opened | undefined;
  /** Its labels, in the order GitHub lists them; none until its read lands or where it has none. */
  readonly labels?: readonly PullRequestLabel[] | undefined;
};

/** One branch, as the panel's header names it: Lucide's branch glyph, then its name in the monospaced face, on one line, or wrapped where `wraps`. */
function Branch({ name, wraps }: { readonly name: string; readonly wraps: boolean }) {
  const colors = useColors();

  return (
    <HStack spacing={SPACE.TIGHT}>
      <ToneGlyph
        glyph={GLYPH.BRANCH}
        tone={STATUS_TONE.NEUTRAL}
        textStyle={TYPE_ROLE.ROW_LINE}
        hidden
      />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE, design: "monospaced" }),
          foregroundStyle(colors.TEXT_BODY),
          ...(wraps ? [] : [lineLimit(1)]),
        ]}
      >
        {name}
      </Text>
    </HStack>
  );
}

/**
 * Who opened a pull request and when, as the panel's header says it in one
 * phrase: their face and name, then "opened 3h ago", or, once it merged,
 * "opened · merged 1h ago", the moment that matters once it has; without
 * anyone to name, the phrase alone; on one line, or wrapped where `wraps`.
 */
function OpenedLine({ opened, wraps }: { readonly opened: Opened; readonly wraps: boolean }) {
  const colors = useColors();
  const face = useScaledSize(MARK_SIZE.FACE);
  const verb = opened.by === undefined ? "Opened" : "opened";
  const now = Date.now();

  const when =
    opened.mergedAt === null
      ? `${verb} ${agoText(opened.at, now)}`
      : `${verb} · merged ${agoText(opened.mergedAt, now)}`;

  return (
    <HStack spacing={SPACE.TIGHT + 2}>
      {opened.by === undefined ? null : (
        <Avatar
          name={opened.by.name}
          picture={opened.by.picture}
          kind={opened.by.kind}
          size={face}
        />
      )}
      <Text modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), ...(wraps ? [] : [lineLimit(1)])]}>
        {opened.by === undefined ? null : (
          <Text modifiers={[foregroundStyle(colors.TEXT_BODY)]}>{`${opened.by.name} `}</Text>
        )}
        <Text modifiers={[foregroundStyle(colors.TEXT_MUTED)]}>{when}</Text>
      </Text>
    </HStack>
  );
}

/**
 * A pull request's heading, as a list's first row: its title in 20 pt
 * semibold with its number muted after it, which a tap opens to edit where
 * it may be edited, then where it stands as a chip,
 * its state's glyph in GitHub's color and its word, then who opened it and
 * when, by their face, then its labels filled with their colors, scrolling
 * sideways where they run past the row, then its branches on a line of
 * their own, the one it merges into first, then GitHub's sentence of
 * whether it would merge, in the body's ink. Past the accessibility sizes,
 * who opened it wraps rather than cuts, and the branches stand on two
 * lines, the one it merges from under the arrow, each wrapping.
 */
export function PullRequestHead({
  title,
  titleEdit,
  number,
  state,
  queued,
  stateLabel,
  branches,
  sentence,
  opened,
  labels = [],
}: PullRequestHeadProps) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const look = PULL_REQUEST_LOOK[pullRequestMarkState({ state, queued })];

  const arrow = (
    <Text modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}>
      {BRANCH_ARROW}
    </Text>
  );

  return (
    <VStack
      alignment="leading"
      spacing={SPACE.ROW}
      modifiers={[
        listRowBackground("clear"),
        listRowSeparator("hidden"),
        listRowInsets({ leading: SPACE.EDGE, trailing: SPACE.EDGE, top: SPACE.TIGHT, bottom: 0 }),
      ]}
    >
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.PAGE_HEADING, weight: "semibold" }),
          foregroundStyle(colors.TEXT),
          // Note that the title opens its edit on a tap, as Notes and Reminders edit a title where it stands, heard as a button with what it does, since nothing marks it to the eye.
          ...(titleEdit === undefined
            ? []
            : [
                onTapGesture(titleEdit.onPress),
                accessibilityAddTraits(["isButton"]),
                accessibilityHint(titleEdit.heard),
              ]),
        ]}
      >
        <Text>{title}</Text>
        <Text modifiers={[foregroundStyle(colors.TEXT_MUTED), monospacedDigit()]}>
          {` #${number}`}
        </Text>
      </Text>
      <HStack spacing={SPACE.TIGHT + 2}>
        <FieldChip label={stateLabel} mark={{ glyph: look.symbol, tone: look.tone }} />
      </HStack>
      {opened === undefined ? null : <OpenedLine opened={opened} wraps={large} />}
      {labels.length === 0 ? null : (
        <ScrollView axes="horizontal" showsIndicators={false}>
          <HStack spacing={SPACE.TIGHT}>
            {labels.map((label) => (
              <LabelChip key={label.name} name={label.name} color={label.color} />
            ))}
          </HStack>
        </ScrollView>
      )}
      {branches === undefined ? null : large ? (
        <VStack alignment="leading" spacing={SPACE.TIGHT}>
          <Branch name={branches.base} wraps />
          <HStack spacing={SPACE.TIGHT + 2}>
            {arrow}
            <Branch name={branches.head} wraps />
          </HStack>
        </VStack>
      ) : (
        <HStack spacing={SPACE.TIGHT + 2}>
          <Branch name={branches.base} wraps={false} />
          {arrow}
          <Branch name={branches.head} wraps={false} />
        </HStack>
      )}
      {sentence === undefined ? null : (
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_BODY)]}
        >
          {sentence}
        </Text>
      )}
    </VStack>
  );
}

/** Where a row's face stands: in the lead column in its mark's place, as a reviewer's does, or beside the mark before the title, as the App that runs a check does. */
export const MARK_FACE = {
  LEAD: "lead",
  BESIDE: "beside",
} as const;

export type MarkFace = (typeof MARK_FACE)[keyof typeof MARK_FACE];

type MarkRowProps = {
  /** The row's id, which its list's `onSelect` is called with. */
  readonly id: string;
  /** Its mark: where the thing it names stands, in that tone. */
  readonly mark: MarkLook;
  readonly title: string;
  /** What ends its line, muted: where it stands in words, or how long it ran. */
  readonly detail?: string | undefined;
  /** Where it stands in words, heard before the detail, since the mark says it only to the eye; not heard twice where the detail says it already. */
  readonly standing?: string | undefined;
  /** Whose row it is, by their face, where the panel draws one: a reviewer, or the App that runs a check. */
  readonly face?: { readonly of: Face; readonly stands: MarkFace } | undefined;
  /** The address a press on it opens out of the app, such as a check's run, marked at its end by the arrow out; none where it takes no press. */
  readonly opens?: string | undefined;
};

/** What a row that opens an address out of the app is heard to do, in the arrow's place: GitHub by name where the address is GitHub's, since a check's run may be another CI's page. */
const OPENS_HEARD = {
  GITHUB: "Opens on GitHub",
  WEB: "Opens on the web",
} as const;

/** GitHub's own host, which a pull request's page and most checks' runs stand on. */
const GITHUB_HOST = "github.com";

/** What a press on a row opening `address` is heard to do. */
function opensHeard(address: string): string {
  const host = URL.canParse(address) ? new URL(address).hostname : "";

  return host === GITHUB_HOST || host.endsWith(`.${GITHUB_HOST}`)
    ? OPENS_HEARD.GITHUB
    : OPENS_HEARD.WEB;
}

/**
 * A row of a pull request's page, such as a check or a reviewer: its mark
 * in the lead column, its name in the row title's style, and what ends its
 * line in the time's, muted, standing as every list row does, plain and edge to edge with a
 * hairline under the words. A reviewer's face takes the lead column, its
 * mark moving to the line's end before its words, as the panel's facepile
 * wears where each stands; a check's App stands by its avatar beside the
 * mark. A row that opens an address out of the app ends in its arrow. The row is heard as one
 * element: its name, where it stands, its words, and where a press goes.
 */
export function MarkRow({ id, mark, title, detail, standing, face, opens }: MarkRowProps) {
  const colors = useColors();
  const faceSize = useScaledSize(MARK_SIZE.FACE);
  const glyph = <ToneGlyph glyph={mark.symbol} tone={mark.tone} textStyle={TYPE_ROLE.ROW_TITLE} />;
  const leads = face?.stands === MARK_FACE.LEAD;

  const avatar =
    face === undefined ? null : (
      <Avatar name={face.of.name} picture={face.of.picture} kind={face.of.kind} size={faceSize} />
    );

  const words =
    detail === undefined ? null : (
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.TIME }),
          monospacedDigit(),
          foregroundStyle(colors.TEXT_MUTED),
          lineLimit(1),
        ]}
      >
        {detail}
      </Text>
    );

  const row: ReactElement = (
    <RowHead
      unread={false}
      faded={false}
      lead={leads ? avatar : glyph}
      beside={leads ? undefined : avatar}
      title={title}
      ink={colors.TEXT_BODY}
      end={
        leads ? (
          <HStack spacing={SPACE.TIGHT}>
            {glyph}
            {words}
          </HStack>
        ) : (
          words
        )
      }
      trail={opens === undefined ? null : <GoesMark goes={PUSH_ROW_GOES.OUT} />}
    />
  );

  return (
    <RowFrame
      id={id}
      row={row}
      heard={{
        label: title,
        value: [standing !== detail && standing, detail, opens !== undefined && opensHeard(opens)],
      }}
    />
  );
}

/**
 * What a change GitHub did not make leaves to say, as a list's row: our
 * sentence in the muted ink by a warning in the attention ink, as the
 * failure notice and the panel's problem line draw a refusal, and GitHub's
 * own words quoted under it where it said some.
 */
export function WriteNoteRow({
  words,
  said,
}: {
  readonly words: string;
  readonly said?: string | undefined;
}) {
  const colors = useColors();

  return (
    <HStack
      alignment="top"
      spacing={SPACE.ROW}
      modifiers={[
        listRowBackground("clear"),
        listRowInsets({
          leading: SPACE.EDGE,
          trailing: SPACE.EDGE,
          top: SPACE.TIGHT,
          bottom: SPACE.TIGHT,
        }),
      ]}
    >
      <ToneGlyph
        glyph={GLYPH.FAILED}
        tone={STATUS_TONE.ATTENTION}
        textStyle={TYPE_ROLE.ROW_LINE}
        hidden
      />
      <VStack alignment="leading" spacing={2}>
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
        >
          {words}
        </Text>
        {said === undefined ? null : (
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_LINE }),
              foregroundStyle(colors.TEXT_MUTED),
            ]}
          >
            {said}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}

/** A way to merge the merge's menu offers, such as Squash and merge, checked where it is the one a tap uses. */
export interface MergeMethodChoice {
  readonly label: string;
  readonly on: boolean;
  readonly onPress: () => void;
}

/**
 * The merge's one press as a row of the page, under its heading in every
 * window, as the panel's head stands Merge under the title, so the bar
 * keeps its path: the system's large button, as wide as its words,
 * filled in the accent with its words in the brand's ink where it is the
 * page's one act, such as Squash and merge, and outlined in it otherwise,
 * such as Remove from queue. Where the repository merges more than one way
 * it is a split button, as the panel's merge box is: a tap merges the way
 * chosen, and a long press or its chevron opens the ways, the chosen one
 * checked. It is dimmed while a change is out, its words then saying what
 * is under way. Note that a single press is the same menu with no ways and
 * no chevron, rather than a bordered button, because a list takes a row
 * holding the system's button as one row-wide button, and a `RowList`
 * always keeps a selection, so on a regular width a press on the row went
 * to selecting it, untagged, and did nothing; a menu takes its own press
 * there, in the system's same bordered look.
 */
export function MergeActRow({
  label,
  prominent,
  disabled: dimmed,
  methods = [],
  onPress,
}: {
  readonly label: string;
  readonly prominent: boolean;
  readonly disabled: boolean;
  /** The ways to merge, offered behind the chevron where there is more than one. */
  readonly methods?: readonly MergeMethodChoice[];
  readonly onPress: () => void;
}) {
  const colors = useColors();

  const words = (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_TITLE, weight: "semibold" }),
        foregroundStyle(prominent ? colors.ON_ACCENT : colors.TEXT),
      ]}
    >
      {label}
    </Text>
  );

  const look = [
    buttonStyle(prominent ? "borderedProminent" : "bordered"),
    controlSize("large"),
    tint(prominent ? colors.ACCENT : colors.TEXT),
    disabled(dimmed),
    listRowBackground("clear"),
    listRowSeparator("hidden"),
    listRowInsets({
      leading: SPACE.EDGE,
      trailing: SPACE.EDGE,
      top: SPACE.TIGHT,
      bottom: SPACE.TIGHT,
    }),
  ];

  // Note that a single way to merge leaves nothing to choose, so the press stands with no chevron and nothing behind it.
  const chooses = methods.length > 1;

  return (
    <Menu
      label={words}
      onPrimaryAction={onPress}
      modifiers={[...look, menuIndicator(chooses ? "visible" : "hidden")]}
    >
      {(chooses ? methods : []).map((method) => (
        <Toggle
          key={method.label}
          label={method.label}
          isOn={method.on}
          onIsOnChange={() => method.onPress()}
        />
      ))}
    </Menu>
  );
}
