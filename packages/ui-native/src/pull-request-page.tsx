// pull-request-page.tsx -- a pull request's page: its heading with where it stands, who opened it and its branches, its reviewers' faces, the rows of its checks, the line a change GitHub refused leaves, and the question an act asks first.

import {
  Circle,
  HStack,
  Image,
  Menu,
  ScrollView,
  Button as SwiftUIButton,
  Toggle,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityAddTraits,
  accessibilityElement,
  accessibilityHidden,
  accessibilityHint,
  accessibilityLabel,
  accessibilityValue,
  background,
  buttonStyle,
  controlSize,
  disabled,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  menuIndicator,
  monospacedDigit,
  offset,
  onTapGesture,
  padding,
  redacted,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import {
  type GitHubPerson,
  type PullRequestLabel,
  type PullRequestState,
  REVIEW_STATE,
  type ReviewState,
} from "@repo/features/agent-wire";
import { BOT_TAG_WORDS, githubLoginName } from "@repo/features/github-login";
import { pullRequestMarkState, REVIEW_WORDS } from "@repo/features/pull-request-model";
import { agoText } from "@repo/features/time-format";
import type { ReactElement } from "react";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { FieldChip, type FieldMenu, LabelChip } from "./button.js";
import { GLYPH, type Glyph, glyphImage, type MarkLook } from "./glyph.js";
import { menuActContent } from "./glyph-label.js";
import { PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import { useRowInset } from "./layout-margin.js";
import { LineCounts } from "./line-counts.js";
import { RowFrame, RowHead } from "./list-row.js";
import { Avatar, FACE_KIND, type Face, ToneGlyph } from "./marks.js";
import { REVIEW_LOOK } from "./pull-request-look.js";
import { PULL_REQUEST_SKELETON } from "./pull-request-skeleton-words.js";
import { GoesMark, PUSH_ROW_GOES } from "./settings-form.js";
import { Text } from "./text.js";
import { STATUS_TONE, type StatusTone, toneColor, useColors } from "./tokens/colors.js";
import { MARK_SIZE, RADIUS, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What joins a pull request's branches, the one it merges from after the one it merges into, as GitHub writes it. */
const BRANCH_ARROW = "←";

/**
 * Someone a pull request names on GitHub, as a face, as the panel draws
 * them (`@repo/ui`'s `githubActor`): a person by their login and avatar in
 * a circle, and an App's bot by its login without GitHub's `[bot]`, in its
 * rounded square, wearing the bot tag after its name (`BotTag`). Every
 * place that names a GitHub author, a review's, a comment's, or the
 * opener's, draws them through this.
 */
export function githubFace(person: GitHubPerson): Face {
  return {
    name: githubLoginName(person),
    picture: person.avatarUrl,
    kind: person.bot ? FACE_KIND.APP : FACE_KIND.PERSON,
    bot: person.bot,
  };
}

/** The quiet tag after an App's bot's name, as the panel's `BotBadge` and GitHub's own pages mark one: "bot", muted on a soft fill, on one line at every size, and heard as its word. */
export function BotTag() {
  const colors = useColors();

  return (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.TIME, weight: "medium" }),
        foregroundStyle(colors.TEXT_MUTED),
        lineLimit(1),
        fixedSize(),
        padding({ horizontal: 5, vertical: 1 }),
        background(
          colors.FILL_STRONG,
          SwiftModifiers.shapes.roundedRectangle({ cornerRadius: RADIUS.TAG }),
        ),
      ]}
    >
      {BOT_TAG_WORDS}
    </Text>
  );
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
  /** What a press on where it stands offers, as the panel's pill opens its menu: Convert to draft, Ready for review, Close, Reopen; none where nothing may change, as once merged. */
  readonly stateMenu?: FieldMenu | undefined;
  /** The branch it merges into and the one it merges from; none until its read lands. */
  readonly branches?: { readonly base: string; readonly head: string } | undefined;
  /** Whether it would merge as it stands, in GitHub's sentence: "Ready to merge". */
  readonly sentence?: string | undefined;
  /** Who opened it and when; none until its read lands. */
  readonly opened?: Opened | undefined;
  /** Its labels, in the order GitHub lists them; none until its read lands or where it has none. */
  readonly labels?: readonly PullRequestLabel[] | undefined;
  /** Its reviewers, where each stands, in the order the panel's header draws them (`reviewersOf`); none where it has none. */
  readonly reviewers?: readonly HeadReviewer[] | undefined;
  /** The lines it adds and removes, after its branches as the panel's header counts them; none until any is known. */
  readonly lines?: { readonly additions: number; readonly deletions: number } | undefined;
  /** Whether its own read is still out, so its branches and sentence, not yet known, stand as the system's placeholders where they will. */
  readonly reading?: boolean | undefined;
  /** Where the whole heading stands in for one not read yet: what it is heard as, such as "Reading pull request", every word drawn as a placeholder (`PullRequestHeadSkeleton`). */
  readonly placeholder?: string | undefined;
};

/** A reviewer as a pull request's heading draws them: by their face, and where their reviews leave them. */
export type HeadReviewer = {
  readonly by: Face;
  readonly state: ReviewState;
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
 * An App's bot's name wears its tag after it, as the panel's does.
 */
function OpenedLine({ opened, wraps }: { readonly opened: Opened; readonly wraps: boolean }) {
  const colors = useColors();
  const face = useScaledSize(MARK_SIZE.FACE);
  const by = opened.by;
  const verb = by === undefined ? "Opened" : "opened";
  const now = Date.now();
  // Note that a bot's name stands as words of its own, since SwiftUI holds no tag inside a run of words, so the tag can follow it.
  const tagged = by?.bot === true;

  const when =
    opened.mergedAt === null
      ? `${verb} ${agoText(opened.at, now)}`
      : `${verb} · merged ${agoText(opened.mergedAt, now)}`;

  return (
    <HStack spacing={SPACE.TIGHT + 2}>
      {by === undefined ? null : (
        <Avatar name={by.name} picture={by.picture} kind={by.kind} size={face} />
      )}
      {by === undefined || !tagged ? null : (
        <HStack spacing={SPACE.TIGHT}>
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_LINE }),
              foregroundStyle(colors.TEXT_BODY),
              lineLimit(1),
            ]}
          >
            {by.name}
          </Text>
          <BotTag />
        </HStack>
      )}
      <Text modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), ...(wraps ? [] : [lineLimit(1)])]}>
        {by === undefined || tagged ? null : (
          <Text modifiers={[foregroundStyle(colors.TEXT_BODY)]}>{`${by.name} `}</Text>
        )}
        <Text modifiers={[foregroundStyle(colors.TEXT_MUTED)]}>{when}</Text>
      </Text>
    </HStack>
  );
}

/** How many reviewers' faces a pull request's heading draws before it counts the rest, as the panel's header does. */
const HEAD_FACES = 3;

/** What the heading's reviewers are heard as, before who they are and where each stands. */
const REVIEWERS_HEARD = "Reviewers";

/**
 * The glyph a reviewer's face wears at its corner, cut from a disc of its
 * tone, as the panel's face badge draws it: a check, a cross, a slash, a
 * speech mark; a review asked for and not given wears the disc alone,
 * smaller, as GitHub's waiting dot.
 */
const FACE_BADGE_GLYPHS = {
  [REVIEW_STATE.APPROVED]: GLYPH.CHECK,
  [REVIEW_STATE.CHANGES_REQUESTED]: GLYPH.REMOVE,
  [REVIEW_STATE.DISMISSED]: GLYPH.CHECK_SKIPPED,
  [REVIEW_STATE.COMMENTED]: GLYPH.COMMENT,
  [REVIEW_STATE.REQUESTED]: undefined,
} as const satisfies Record<ReviewState, Glyph | undefined>;

/** How much of a face's side its badge's disc stands at, a waiting dot's smaller, and how much of the disc its glyph fills. */
const FACE_BADGE_SCALE = 0.62;
const FACE_DOT_SCALE = 0.44;
const FACE_BADGE_GLYPH_SCALE = 0.62;

/** How far past the face's end corner its badge stands, and how wide the ground's ring around it, in points, as the panel rings its badge off the face. */
const FACE_BADGE_OUT = 3;
const FACE_BADGE_RING = 2;

/** One reviewer's face, wearing where they stand at its corner: a disc of its tone ringed by the ground, its glyph cut from it in the ground's ink. */
function ReviewerFace({
  reviewer,
  size,
}: {
  readonly reviewer: HeadReviewer;
  readonly size: number;
}) {
  const colors = useColors();
  const glyph = FACE_BADGE_GLYPHS[reviewer.state];
  const disc = size * (glyph === undefined ? FACE_DOT_SCALE : FACE_BADGE_SCALE);
  const ring = disc + FACE_BADGE_RING;

  return (
    <ZStack alignment="bottomTrailing" modifiers={[frame({ width: size, height: size })]}>
      <Avatar
        name={reviewer.by.name}
        picture={reviewer.by.picture}
        kind={reviewer.by.kind}
        size={size}
      />
      <ZStack
        modifiers={[
          frame({ width: ring, height: ring }),
          offset({ x: FACE_BADGE_OUT, y: FACE_BADGE_OUT }),
        ]}
      >
        <Circle modifiers={[foregroundStyle(colors.GROUND)]} />
        <Circle
          modifiers={[
            frame({ width: disc, height: disc }),
            foregroundStyle(toneColor(colors, REVIEW_LOOK[reviewer.state].tone)),
          ]}
        />
        {glyph === undefined ? null : (
          <Image
            {...glyphImage(glyph)}
            color={colors.GROUND}
            modifiers={[font({ size: disc * FACE_BADGE_GLYPH_SCALE, weight: "bold" })]}
          />
        )}
      </ZStack>
    </ZStack>
  );
}

/**
 * A pull request's reviewers as its heading draws them, as the panel's
 * header does: their first faces, each wearing where they stand at its
 * corner, and a count of the rest. A press opens the system's menu of every
 * reviewer, by name, where they stand, and its glyph in its tone, as the
 * panel's faces reveal the rest past their count (`MoreFaces`), so a
 * reviewer past the third is reachable by sight as well as by VoiceOver.
 * The faces are heard as one element, every reviewer by name with where
 * they stand.
 */
function HeadReviewers({ reviewers }: { readonly reviewers: readonly HeadReviewer[] }) {
  const colors = useColors();
  const size = useScaledSize(MARK_SIZE.FACE);
  const drawn = reviewers.slice(0, HEAD_FACES);
  const rest = reviewers.length - drawn.length;
  const heard = reviewers.map(({ by, state }) => `${by.name}, ${REVIEW_WORDS[state]}`).join("; ");

  const faces = (
    <HStack spacing={SPACE.TIGHT + 2}>
      {drawn.map((reviewer) => (
        <ReviewerFace key={reviewer.by.name} reviewer={reviewer} size={size} />
      ))}
      {rest === 0 ? null : (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE }),
            monospacedDigit(),
            foregroundStyle(colors.TEXT_MUTED),
          ]}
        >
          {`+${rest}`}
        </Text>
      )}
    </HStack>
  );

  return (
    <Menu
      label={faces}
      modifiers={[
        buttonStyle("plain"),
        menuIndicator("hidden"),
        accessibilityLabel(REVIEWERS_HEARD),
        accessibilityValue(heard),
      ]}
    >
      {reviewers.map(({ by, state }) => (
        <SwiftUIButton
          key={by.name}
          {...menuActContent(
            by.name,
            REVIEW_LOOK[state].symbol,
            REVIEW_WORDS[state],
            toneColor(colors, REVIEW_LOOK[state].tone),
          )}
          onPress={() => undefined}
        />
      ))}
    </Menu>
  );
}

/**
 * A pull request's heading, as a list's first row: its title in 20 pt
 * semibold with its number muted after it, which a tap opens to edit where
 * it may be edited, then where it stands as a chip, its state's glyph in
 * GitHub's color and its word, which opens the system's menu of what may
 * change there where it is handed one, as the panel's pill does, then who
 * opened it and
 * when, by their face, and its reviewers' faces, each wearing where they
 * stand, as the panel's people line draws them, then its labels filled with their colors, scrolling
 * sideways where they run past the row, then its branches on a line of
 * their own, the one it merges into first, and the lines it adds and
 * removes after them, as the panel's header counts them, then GitHub's sentence of
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
  stateMenu,
  branches,
  sentence,
  opened,
  labels = [],
  reviewers = [],
  lines,
  reading = false,
  placeholder,
}: PullRequestHeadProps) {
  const colors = useColors();
  const inset = useRowInset();
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
        listRowInsets({
          leading: inset.lead,
          trailing: inset.margin,
          top: SPACE.TIGHT,
          bottom: 0,
        }),
        // Note that a heading standing in for one not read is heard as what it waits on, never its placeholder words.
        ...(placeholder === undefined
          ? []
          : [redacted(), accessibilityElement("ignore"), accessibilityLabel(placeholder)]),
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
        <FieldChip
          label={stateLabel}
          mark={{ glyph: look.symbol, tone: look.tone }}
          menu={stateMenu}
        />
      </HStack>
      {/* Note that the reviewers' faces stand after who opened it, as the panel's people line names them, on a line of their own past the accessibility sizes, where who opened it wraps. */}
      {reviewers.length === 0 ? (
        opened === undefined ? null : (
          <OpenedLine opened={opened} wraps={large} />
        )
      ) : large || opened === undefined ? (
        <>
          {opened === undefined ? null : <OpenedLine opened={opened} wraps />}
          <HeadReviewers reviewers={reviewers} />
        </>
      ) : (
        <HStack spacing={SPACE.ROW}>
          <OpenedLine opened={opened} wraps={false} />
          <HeadReviewers reviewers={reviewers} />
        </HStack>
      )}
      {labels.length === 0 ? null : (
        <ScrollView axes="horizontal" showsIndicators={false}>
          <HStack spacing={SPACE.TIGHT}>
            {labels.map((label) => (
              <LabelChip key={label.name} name={label.name} color={label.color} />
            ))}
          </HStack>
        </ScrollView>
      )}
      {branches === undefined && reading ? (
        <HStack spacing={SPACE.TIGHT + 2} modifiers={[redacted(), accessibilityHidden()]}>
          <Branch name={PULL_REQUEST_SKELETON.BRANCHES.base} wraps={false} />
          {arrow}
          <Branch name={PULL_REQUEST_SKELETON.BRANCHES.head} wraps={false} />
        </HStack>
      ) : null}
      {branches === undefined ? null : large ? (
        <VStack alignment="leading" spacing={SPACE.TIGHT}>
          <Branch name={branches.base} wraps />
          <HStack spacing={SPACE.TIGHT + 2}>
            {arrow}
            <Branch name={branches.head} wraps />
          </HStack>
          {lines === undefined ? null : (
            <LineCounts {...lines} textStyle={TYPE_ROLE.ROW_LINE} heard />
          )}
        </VStack>
      ) : (
        <HStack spacing={SPACE.TIGHT + 2}>
          <Branch name={branches.base} wraps={false} />
          {arrow}
          <Branch name={branches.head} wraps={false} />
          {lines === undefined ? null : (
            <LineCounts {...lines} textStyle={TYPE_ROLE.ROW_LINE} heard />
          )}
        </HStack>
      )}
      {sentence === undefined && !reading ? null : (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE }),
            foregroundStyle(colors.TEXT_BODY),
            ...(sentence === undefined ? [redacted(), accessibilityHidden()] : []),
          ]}
        >
          {sentence ?? PULL_REQUEST_SKELETON.SENTENCE}
        </Text>
      )}
    </VStack>
  );
}

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
  /** Whose row it is, by their face beside the mark, where the panel draws one: the App that runs a check. */
  readonly face?: Face | undefined;
  /** The address a press on it opens out of the app, such as a check's run, marked at its end by the arrow out; none where it takes no press. */
  readonly opens?: string | undefined;
  /** Whether a press on it pushes a page of its own, such as the checks' list, marked at its end by the chevron; none where it opens an address or takes no press. */
  readonly pushes?: boolean | undefined;
  /** What it counts at its end in the detail's place, as the panel's tab counts what it opens: "✓ 5", "1/4 viewed"; none where it counts nothing. */
  readonly count?: RowCount | undefined;
  /** Whether what it counts is still read, so its end, where nothing says it yet, stands as the system's placeholder where it will, as the checks' count does while they are read. */
  readonly reading?: boolean | undefined;
};

/** What a row counts at its end, as the panel's tab counts it: a glyph saying how what it counts went where one does, and the count, both in its tone; heard as `heard`. */
export type RowCount = {
  readonly words: string;
  readonly tone: StatusTone;
  readonly glyph?: Glyph | undefined;
  readonly heard: string;
};

/** A row's count, its glyph and its words in its tone, in figures of one width. */
function CountWords({ count }: { readonly count: RowCount }) {
  const colors = useColors();
  const ink = toneColor(colors, count.tone);

  return (
    <HStack spacing={SPACE.TIGHT}>
      {count.glyph === undefined ? null : (
        <ToneGlyph glyph={count.glyph} tone={count.tone} textStyle={TYPE_ROLE.TIME} hidden />
      )}
      {count.words === "" ? null : (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.TIME }),
            monospacedDigit(),
            foregroundStyle(ink),
            lineLimit(1),
          ]}
        >
          {count.words}
        </Text>
      )}
    </HStack>
  );
}

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
 * A row of a pull request's page, such as a check: its mark in the lead
 * column, its name in the row title's style, and what ends its line in the
 * time's, muted, standing as every list row does, plain and edge to edge
 * with a hairline under the words. A check's App stands by its avatar
 * beside the mark. A row that opens an address out of the app ends in its arrow, and one
 * that pushes a page of its own, such as the checks' list, in the chevron;
 * one that counts what it opens, as the panel's tab does, ends in its count
 * in the detail's place. The row is heard as one
 * element: its name, where it stands, its words, and where a press goes.
 */
export function MarkRow({
  id,
  mark,
  title,
  detail,
  standing,
  face,
  opens,
  pushes,
  count,
  reading = false,
}: MarkRowProps) {
  const colors = useColors();
  const faceSize = useScaledSize(MARK_SIZE.FACE);
  const glyph = <ToneGlyph glyph={mark.symbol} tone={mark.tone} textStyle={TYPE_ROLE.ROW_TITLE} />;

  const avatar =
    face === undefined ? null : (
      <Avatar name={face.name} picture={face.picture} kind={face.kind} size={faceSize} />
    );

  const words =
    detail === undefined && !reading ? null : (
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.TIME }),
          monospacedDigit(),
          foregroundStyle(colors.TEXT_MUTED),
          lineLimit(1),
          ...(detail === undefined ? [redacted(), accessibilityHidden()] : []),
        ]}
      >
        {detail ?? PULL_REQUEST_SKELETON.COUNT}
      </Text>
    );

  const row: ReactElement = (
    <RowHead
      unread={false}
      faded={false}
      lead={glyph}
      beside={avatar}
      title={title}
      after={face?.bot === true ? <BotTag /> : undefined}
      ink={colors.TEXT_BODY}
      end={count === undefined ? words : <CountWords count={count} />}
      trail={
        opens !== undefined ? (
          <GoesMark goes={PUSH_ROW_GOES.OUT} />
        ) : pushes === true ? (
          <GoesMark goes={PUSH_ROW_GOES.PAGE} />
        ) : null
      }
    />
  );

  return (
    <RowFrame
      id={id}
      row={row}
      heard={{
        label: title,
        value: [
          face?.bot === true && BOT_TAG_WORDS,
          standing !== detail && standing,
          detail,
          count?.heard,
          opens !== undefined && opensHeard(opens),
        ],
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
  const inset = useRowInset();

  return (
    <HStack
      alignment="top"
      spacing={SPACE.ROW}
      modifiers={[
        listRowBackground("clear"),
        listRowInsets({
          leading: inset.lead,
          trailing: inset.margin,
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
  const inset = useRowInset();

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
      leading: inset.lead,
      trailing: inset.margin,
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
