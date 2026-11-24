// thread-page.tsx -- an Inbox thread: its path small in the bar, a menu of what it opens, its title as the page's heading, then each message flat, its writer's face or tile, name and time in SwiftUI and its words, pictures, videos, sound clips, and files in React Native views.

import {
  HStack,
  Image,
  RNHostView,
  ScrollView,
  Spacer,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
} from "@expo/ui/swift-ui";
import {
  Animation,
  accessibilityAddTraits,
  accessibilityElement,
  accessibilityHidden,
  accessibilityLabel,
  animation,
  defaultScrollAnchorForRole,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  padding,
  scrollDismissesKeyboard,
} from "@expo/ui/swift-ui/modifiers";
import type { LinkStanding } from "@repo/features/link-standing-model";
import type { ManagerFace as ManagerFaceValue } from "@repo/features/manager-face";
import type { ModelProvider } from "@repo/features/models-wire";
import type { TaskStatus } from "@repo/features/task-wire";
import { sinceHeard, sinceText } from "@repo/features/time-format";
import { type ReactNode, useDeferredValue, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useAccessibilitySize, useReduceMotion } from "./accessibility.js";
import { AudioClip } from "./audio-clip.js";
import { BarContent } from "./bar-content.js";
import { FileChip } from "./file-chip.js";
import { useDockRoom } from "./glass-bar.js";
import { GLYPH, glyphImage } from "./glyph.js";
import { CopyWordsSwiftMenu, PictureOriginProvider, PictureSetProvider } from "./held-menu.js";
import { Markdown, type MarkdownVideo, Picture } from "./markdown.js";
import { AgentTile, Avatar, type Face } from "./marks.js";
import type { MediaSize } from "./media-frame.js";
import { PictureSet, type SetPicture } from "./picture-set.js";
import type { LongPressGroup } from "./row-menu-model.js";
import {
  type BarFootItem,
  type BarMenu,
  BarMenuItem,
  barActItems,
  PathTitle,
} from "./split-view.js";
import { newestRuns, threadRuns } from "./thread-group-model.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, READING_WIDTH, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";
import { type UndeliveredLine, UndeliveredMark } from "./undelivered-mark.js";
import { Video } from "./video.js";

/** Between a writer's face and their name. */
const WRITER_GAP = SPACE.TIGHT * 2;

/** How many of a thread's newest messages its first frame draws at least, the runs before them a render later: more than most threads hold, so most open whole. */
const FIRST_DRAWN = 10;

/** Between one message and the next of the same run, closer than between runs, as Messages draws a speaker's bubbles. */
const RUN_GAP = SPACE.TIGHT * 2;

/** How far a message's words stand in from the page's edge: past the writer's face, under the name, where a row's words start. */
const WORDS_INSET = SPACE.EDGE + MARK_SIZE.WRITER + WRITER_GAP;

const styles = StyleSheet.create({
  words: { paddingLeft: WORDS_INSET, paddingRight: SPACE.EDGE, gap: SPACE.ROW },
});

/** What a message's file is drawn as after its words: a picture, a video in the system's player, a sound clip in its strip, or any other file, such as a PDF, as its chip. */
export const THREAD_MEDIA = {
  PICTURE: "picture",
  VIDEO: "video",
  AUDIO: "audio",
  FILE: "file",
} as const;

/** One file a message carried, drawn after its words; its source none while its bytes are on their way and `null` where they could not be read, which `onRetry` reads again. */
export type ThreadMedia =
  | {
      readonly kind: typeof THREAD_MEDIA.PICTURE;
      readonly key: string;
      readonly source: string | null | undefined;
      readonly onRetry?: (() => void) | undefined;
      readonly alt: string;
      /** The size its header states, in pixels, where its bytes are held, which it stands at before it decodes. */
      readonly size?: MediaSize | undefined;
    }
  | {
      readonly kind: typeof THREAD_MEDIA.VIDEO;
      readonly key: string;
      readonly source: string | null | undefined;
      readonly onRetry?: (() => void) | undefined;
      readonly label: string;
      /** Opens the video where it plays, such as its thread in Safari, for one the system's player cannot read. */
      readonly onOpenElsewhere?: (() => void) | undefined;
    }
  | {
      readonly kind: typeof THREAD_MEDIA.AUDIO;
      readonly key: string;
      /** The clip's file under the app's caches, named by its type's extension; none while its bytes are on their way, and `null` where they could not be read. */
      readonly source: string | null | undefined;
      readonly label: string;
      readonly onRetry: () => void;
    }
  | {
      readonly kind: typeof THREAD_MEDIA.FILE;
      readonly key: string;
      /** The file's address under the app's caches, which its viewer opens. */
      readonly source: string | null | undefined;
      readonly onRetry?: (() => void) | undefined;
      readonly name: string;
      readonly mediaType: string;
      /** Its size in words once its bytes are read. */
      readonly size: string | undefined;
    };

/** One message of a thread, as its comment draws it. */
export type ThreadMessage = {
  readonly id: string;
  /** Who wrote it: a member by their face, their picture where one is known, or the agent by its tile. */
  /** Who wrote it: a member's face, or the agent, whose tile wears its harness's mark where it is known. */
  readonly writer: Face & {
    readonly agent: boolean;
    readonly harness?: ModelProvider | undefined;
  };
  /** When it was written, in epoch milliseconds. */
  readonly at: number;
  readonly words: string;
  /** Whether a member typed it line by line, whose line breaks are kept. */
  readonly typed: boolean;
  readonly media: readonly ThreadMedia[];
  /** What the answer it carries says it was, "Chose Both", and whether it went ahead, a check in the done tone, or held back, a turn back in the muted ink. */
  readonly stamp?: { readonly words: string; readonly ahead: boolean } | undefined;
  /** What happened to the thread after it, such as a member resolving it or the agent withdrawing its ask. */
  readonly after?: readonly ThreadEvent[] | undefined;
  /** The form's values the answer filled, each field's name and what was put in it, which stand under the stamp, as the panel lists them. */
  readonly values?: readonly { readonly label: string; readonly words: string }[] | undefined;
  /** That the reader sent it and it did not go, which it says under its words with what mends it; none for a message that went. */
  readonly undelivered?: UndeliveredLine | undefined;
  /** The reactions it wears as one line, such as "👍 2  ❤️ 1", under its words; none where it wears none. */
  readonly reactions?: string | undefined;
  /** What its long press menu holds after Copy message, such as Add reaction; none where it offers nothing more. */
  readonly menu?: readonly LongPressGroup[] | undefined;
};

/** A line of what happened to a thread: who did it, what they did in the panel's words, when, and an agent's why for a withdrawn ask. */
type ThreadEvent = {
  readonly key: string;
  readonly who: { readonly name: string; readonly agent: boolean };
  readonly did: string;
  readonly at: number | undefined;
  readonly reason?: string | undefined;
};

type ThreadPageProps = {
  /** Where the thread stands, its task and then its agent, as the panel's crumbs name them. */
  readonly path: readonly string[];
  /** The status of the task it stands in, its ring leading the path; none for an agent's own thread. */
  readonly status?: TaskStatus | undefined;
  /** The face of the Manager whose thread it is, on no task, leading the path; none for a task's thread. */
  readonly manager?: ManagerFaceValue | undefined;
  /** What the path opens, such as its task and its agent, as the panel's crumbs open them, which a press on the path offers as a menu; none leaves it words alone. */
  readonly pathActions?: BarMenu["actions"] | undefined;
  /** Whether the path heads the page over its title rather than standing in the bar's middle, as in a split view's detail column, whose bar is left to the page's acts. */
  readonly pathInHead?: boolean | undefined;
  /** The thread's title, which heads the page. */
  readonly title: string;
  /** Whether the title is the words the thread stands on, such as a description's comment, quoted as the panel's thread quotes them: muted, regular, and cut to two lines, rather than a heading of its own. */
  readonly quoted?: boolean | undefined;
  readonly messages: readonly ThreadMessage[];
  /** What happened to the thread before every message read, such as a close on a thread nobody wrote on, drawn under its heading. */
  readonly opening?: readonly ThreadEvent[] | undefined;
  /** The task's repository, `owner/name`, whose GitHub pages are its files' chips. */
  readonly repository?: string | null | undefined;
  /** Opens a link or a chip pressed, by the address it was written as, where the app draws it or in Safari. */
  readonly onOpenLink: (address: string) => void;
  /** The address a picture its words draw is drawn from, by the address they name it by; none while it is on its way, and `null` where it could not be read. */
  readonly pictureSource?: ((written: string) => string | null | undefined) | undefined;
  /** Reads a picture its words draw again, by the address they name it by, where it could not be read. */
  readonly onRetryPicture?: ((written: string) => void) | undefined;
  /** The video a picture its words draw names, played in its place; every address names a picture where none is given. */
  readonly videoAt?: ((written: string) => MarkdownVideo | undefined) | undefined;
  /** What GitHub holds of a pull request or issue a chip in its words names, by its page, which the chip says where it stands. */
  readonly linkStanding?: ((page: string) => LinkStanding | undefined) | undefined;
  /** What the times count from; now where none is given. */
  readonly now?: number | undefined;
  /** How a settled thread ended, in one word under its heading, as the panel's card says it: "Answered", "Resolved", "Withdrawn"; none while it stands open. */
  readonly standing?: string | undefined;
  /** The open ask's card, such as its options, steps, or fields, under the messages. */
  readonly ask?: ReactNode | undefined;
  /** The thread's main acts as glyphs before its ⋯ in a split view's detail bar, such as Resolve; none in a compact window, whose ⋯ holds them. */
  readonly acts?: readonly BarFootItem[] | undefined;
  /** The thread's ⋯ menu, such as Copy link, in a split view's detail bar; a compact window's stack holds it in its own bar. */
  readonly menu?: BarMenu | undefined;
  /** What stands at the page's foot under its scroll, such as a split view's composer (`ComposerFoot`). */
  readonly foot?: ReactNode | undefined;
};

/** A thread's heading under its bar: its path where it heads the page, its title in the page heading's style, semibold, or the words it stands on quoted in the row title's style, muted and cut to two lines, and how it ended under it in the row line's style, muted, once it is settled. */
function ThreadHead({
  title,
  quoted = false,
  standing,
  path,
}: Pick<ThreadPageProps, "title" | "quoted" | "standing"> & {
  readonly path?: ReactNode | undefined;
}) {
  const colors = useColors();

  // Note that a quoted block reads as what the thread is on, as the panel's quote line does, so a whole paragraph never stands as the page's bold title.
  const look = quoted
    ? [font({ textStyle: TYPE_ROLE.ROW_TITLE }), foregroundStyle(colors.TEXT_MUTED), lineLimit(2)]
    : [
        font({ textStyle: TYPE_ROLE.PAGE_HEADING, weight: "semibold" }),
        foregroundStyle(colors.TEXT),
      ];

  return (
    <VStack
      alignment="leading"
      spacing={SPACE.TIGHT}
      modifiers={[padding({ horizontal: SPACE.EDGE, top: SPACE.TIGHT })]}
    >
      {path}
      <Text modifiers={[...look, accessibilityAddTraits(["isHeader"])]}>{title}</Text>
      {standing === undefined ? null : (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "medium" }),
            foregroundStyle(colors.TEXT_MUTED),
          ]}
        >
          {standing}
        </Text>
      )}
    </VStack>
  );
}

/** A message's files in runs: each run of pictures side by side as one set, and each other file alone, in the order the message carried them. */
function mediaRuns(media: readonly ThreadMedia[]): readonly (readonly ThreadMedia[])[] {
  const runs: ThreadMedia[][] = [];

  for (const each of media) {
    const last = runs.at(-1);
    const joins = each.kind === THREAD_MEDIA.PICTURE && last?.[0]?.kind === THREAD_MEDIA.PICTURE;

    if (joins) last.push(each);
    else runs.push([each]);
  }

  return runs;
}

/** A picture of a run as its set draws it; none for a file of another kind, which a run of pictures never holds. */
function setPicture(media: ThreadMedia): readonly SetPicture[] {
  return media.kind === THREAD_MEDIA.PICTURE
    ? [{ key: media.key, source: media.source, alt: media.alt, onRetry: media.onRetry }]
    : [];
}

/** A file after a message's words, as its kind draws it. */
function MediaView({ media }: { readonly media: ThreadMedia }) {
  switch (media.kind) {
    case THREAD_MEDIA.PICTURE:
      return (
        <Picture source={media.source} alt={media.alt} size={media.size} onRetry={media.onRetry} />
      );
    case THREAD_MEDIA.VIDEO:
      return (
        <Video
          source={media.source}
          label={media.label}
          onOpenElsewhere={media.onOpenElsewhere}
          onRetry={media.onRetry}
        />
      );
    case THREAD_MEDIA.AUDIO:
      return <AudioClip source={media.source} label={media.label} onRetry={media.onRetry} />;
    case THREAD_MEDIA.FILE:
      return (
        <FileChip
          name={media.name}
          mediaType={media.mediaType}
          source={media.source}
          size={media.size}
          onRetry={media.onRetry}
        />
      );
  }
}

/** What a sent answer's mark is heard as: it went ahead with what was asked, or held back. */
const STAMP_HEARD = { AHEAD: "Went ahead", HELD: "Held back" } as const;

/** A sent answer's stamp under its writer's name, where its words start: its mark and its words, in the row line's style. */
function AnswerStamp({ stamp }: { readonly stamp: NonNullable<ThreadMessage["stamp"]> }) {
  const colors = useColors();

  return (
    <HStack
      spacing={SPACE.TIGHT + 2}
      modifiers={[padding({ leading: WORDS_INSET, trailing: SPACE.EDGE })]}
    >
      <Image
        {...glyphImage(stamp.ahead ? GLYPH.CHECK : GLYPH.UNDO)}
        size={MARK_SIZE.GLYPH - 2}
        color={stamp.ahead ? colors.COMPLETE : colors.TEXT_MUTED}
        modifiers={[accessibilityLabel(stamp.ahead ? STAMP_HEARD.AHEAD : STAMP_HEARD.HELD)]}
      />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "medium" }),
          foregroundStyle(colors.TEXT),
        ]}
      >
        {stamp.words}
      </Text>
      <Spacer />
    </HStack>
  );
}

/**
 * A line of what happened to the thread among its messages, as the panel's
 * thread draws one: a glyph in the face's column, whoever did it, what
 * they did and when, in the muted ink, and an agent's why for a
 * withdrawn ask under it, where the messages' words start.
 */
function EventLine({
  event,
  now,
}: {
  readonly event: ThreadEvent;
  readonly now?: number | undefined;
}) {
  const colors = useColors();
  const resolved = !event.who.agent;
  const moment = now ?? Date.now();
  const when = event.at === undefined ? undefined : sinceText(event.at, moment);
  const heard = `${event.who.name} ${event.did}${event.at === undefined ? "" : `, ${sinceHeard(event.at, moment)}`}${event.reason === undefined ? "" : `. ${event.reason}`}`;

  return (
    <VStack
      alignment="leading"
      spacing={SPACE.TIGHT}
      modifiers={[
        padding({ horizontal: SPACE.EDGE }),
        accessibilityElement("ignore"),
        accessibilityLabel(heard),
      ]}
    >
      <HStack spacing={WRITER_GAP} alignment="firstTextBaseline">
        <Image
          {...glyphImage(resolved ? GLYPH.RESOLVED : GLYPH.UNDO)}
          size={MARK_SIZE.GLYPH - 2}
          color={colors.TEXT_MUTED}
          modifiers={[frame({ width: MARK_SIZE.WRITER }), accessibilityHidden()]}
        />
        {/* Note that the line is one text, never a nested one, since `@expo/ui`'s native text keeps a nested child's first words. */}
        <Text
          modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}
        >
          {`${event.who.name} ${event.did}${when === undefined ? "" : ` · ${when}`}`}
        </Text>
        <Spacer />
      </HStack>
      {event.reason === undefined ? null : (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.ROW_LINE }),
            foregroundStyle(colors.TEXT_MUTED),
            padding({ leading: MARK_SIZE.WRITER + WRITER_GAP }),
          ]}
        >
          {event.reason}
        </Text>
      )}
    </VStack>
  );
}

/** The values an answer filled, one a line under its stamp, where the message's words start: each field's name muted, then what was put in it, as the panel's answered thread lists them; past an accessibility size the value stands under its name rather than beside it, so neither wraps to a narrow column, and each is heard as one element. */
function AnswerValues({ values }: { readonly values: NonNullable<ThreadMessage["values"]> }) {
  const colors = useColors();
  const stacked = useAccessibilitySize();

  const label = (words: string) => (
    <Text modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_MUTED)]}>
      {words}
    </Text>
  );

  const value = (words: string) => (
    <Text modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT_BODY)]}>
      {words}
    </Text>
  );

  return (
    <VStack
      alignment="leading"
      spacing={SPACE.TIGHT}
      modifiers={[padding({ leading: WORDS_INSET, trailing: SPACE.EDGE })]}
    >
      {values.map(({ label: name, words }) =>
        stacked ? (
          <VStack
            key={name}
            alignment="leading"
            spacing={2}
            modifiers={[accessibilityElement("combine")]}
          >
            {label(name)}
            {value(words)}
          </VStack>
        ) : (
          <HStack
            key={name}
            alignment="firstTextBaseline"
            spacing={SPACE.TIGHT * 2}
            modifiers={[accessibilityElement("combine")]}
          >
            {label(name)}
            {value(words)}
            <Spacer />
          </HStack>
        ),
      )}
    </VStack>
  );
}

/** One message, flat on the page: the writer's face or tile, name in the row line's style, semibold, and time where it leads its run, and under them its words and files. */
function MessageView({
  message,
  head,
  repository,
  onOpenLink,
  pictureSource,
  onRetryPicture,
  videoAt,
  linkStanding,
  now,
}: Omit<
  ThreadPageProps,
  | "path"
  | "status"
  | "manager"
  | "pathActions"
  | "pathInHead"
  | "title"
  | "messages"
  | "ask"
  | "menu"
  | "foot"
> & {
  readonly message: ThreadMessage;
  /** Whether it leads its run, which names who wrote it and when; the messages after it stand under that head with none of their own. */
  readonly head: boolean;
}) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const { writer } = message;
  const moment = now ?? Date.now();

  const name = (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "semibold" }),
        foregroundStyle(colors.TEXT),
        lineLimit(large ? 3 : 1),
      ]}
    >
      {writer.name}
    </Text>
  );

  const time = (
    <Text
      modifiers={[
        font({ textStyle: TYPE_ROLE.TIME }),
        monospacedDigit(),
        foregroundStyle(colors.TEXT_MUTED),
      ]}
    >
      {sinceText(message.at, moment)}
    </Text>
  );

  // Note that the writer's line is heard as one heading, who and when, so VoiceOver's Headings rotor steps from run to run, that a message after its run's head is a container labeled who and when, so VoiceOver says it on entering the message as Messages reads the sender on every bubble, while the message's lines, links and files stay elements of their own, and that past the accessibility sizes the time stands under the name rather than beside it, as Mail's and Settings' do, so a long name keeps its width, and that a long press on the message offers Copy message, a picture's, a recording's, or a file's own menu standing over it.
  return (
    <CopyWordsSwiftMenu words={message.words} groups={message.menu}>
      <VStack
        alignment="leading"
        spacing={SPACE.TIGHT}
        modifiers={
          head
            ? []
            : [
                accessibilityElement("contain"),
                accessibilityLabel(`${writer.name}, ${sinceHeard(message.at, moment)}`),
              ]
        }
      >
        {head ? (
          <HStack
            spacing={WRITER_GAP}
            modifiers={[
              padding({ horizontal: SPACE.EDGE }),
              accessibilityElement("ignore"),
              accessibilityLabel(`${writer.name}, ${sinceHeard(message.at, moment)}`),
              accessibilityAddTraits(["isHeader"]),
            ]}
          >
            {writer.agent ? (
              <AgentTile harness={writer.harness} size={MARK_SIZE.WRITER} />
            ) : (
              <Avatar
                name={writer.name}
                id={writer.id}
                picture={writer.picture}
                size={MARK_SIZE.WRITER}
              />
            )}
            {large ? (
              <VStack alignment="leading" spacing={2}>
                {name}
                {time}
              </VStack>
            ) : (
              <>
                {name}
                {time}
              </>
            )}
            <Spacer />
          </HStack>
        ) : null}
        {message.stamp === undefined ? null : <AnswerStamp stamp={message.stamp} />}
        {message.values === undefined ? null : <AnswerValues values={message.values} />}
        <RNHostView matchContents={{ vertical: true }}>
          <PictureOriginProvider origin={{ by: writer.name, at: message.at }}>
            <View style={styles.words}>
              {message.words.trim() === "" ? null : (
                <Markdown
                  words={message.words}
                  repository={repository}
                  onOpenLink={onOpenLink}
                  typed={message.typed}
                  pictureSource={pictureSource}
                  onRetryPicture={onRetryPicture}
                  videoAt={videoAt}
                  linkStanding={linkStanding}
                />
              )}
              {mediaRuns(message.media).map((run) =>
                run.length === 1 && run[0] !== undefined ? (
                  <MediaView key={run[0].key} media={run[0]} />
                ) : (
                  <PictureSet key={run[0]?.key} pictures={run.flatMap(setPicture)} />
                ),
              )}
            </View>
          </PictureOriginProvider>
        </RNHostView>
        {message.undelivered === undefined ? null : (
          <HStack modifiers={[padding({ leading: WORDS_INSET, trailing: SPACE.EDGE })]}>
            <UndeliveredMark line={message.undelivered} />
            <Spacer />
          </HStack>
        )}
        {message.reactions === undefined ? null : (
          <HStack modifiers={[padding({ leading: WORDS_INSET, trailing: SPACE.EDGE })]}>
            <Text
              modifiers={[font({ textStyle: TYPE_ROLE.TIME }), foregroundStyle(colors.TEXT_MUTED)]}
            >
              {message.reactions}
            </Text>
            <Spacer />
          </HStack>
        )}
      </VStack>
    </CopyWordsSwiftMenu>
  );
}

/**
 * A thread's page, in a `Screen` or a split view's detail alike: SwiftUI
 * scrolls it and draws its heading and each message's writer, and each
 * message's words and files stand in a React Native host as wide as the
 * page and as tall as they are, since SwiftUI has no piece that draws the
 * panel's Markdown. A compact window's stack names the path as the screen's
 * title; elsewhere the page draws it, in the bar's middle or, where it asks,
 * over its title, as a split view's detail column does, so its narrow bar
 * holds the thread's acts with the path's words uncut. It opens at its
 * newest message, as Messages and the panel's board do. A message that lands while it is open is drawn at its foot, as the
 * thread's document moves, and the open ask's card stands under the last.
 */
export function ThreadPage(props: ThreadPageProps) {
  const {
    path,
    status,
    manager,
    pathActions,
    pathInHead = false,
    title,
    quoted,
    messages,
    opening,
    ask,
    acts = [],
    menu,
    foot,
    standing,
    ...drawing
  } = props;

  // Note that a page docked under a composer leaves room under its last message for the bar as tall as it stands; one in a split view's column leaves none.
  const footRoom = useDockRoom();
  const reduceMotion = useReduceMotion();

  const runs = useMemo(() => threadRuns(messages), [messages]);

  // Note that a long thread's first frame draws its newest runs alone, and React draws the runs before them in the render after it, above them, while the page holds to its foot, so opening a thread of many messages costs what one of a few does.
  const shown = useDeferredValue(runs, newestRuns(runs, FIRST_DRAWN));

  // Note that the path heading the page wraps, so its words stand uncut, while the bar's keeps to one line.
  const pathTitle = (
    <PathTitle
      path={path}
      status={status}
      manager={manager}
      actions={pathActions}
      wrap={pathInHead}
    />
  );

  // Note that a thread opens at its newest message and keeps to its foot as it grows or the keyboard rises, as Messages does and the panel's board does, while one too short to scroll stands under its heading.
  // Note that the thread's pictures are one set its viewer swipes through, every message's together.
  return (
    <PictureSetProvider>
      <Toolbar>
        <VStack spacing={0}>
          <ScrollView
            modifiers={[
              scrollDismissesKeyboard("interactively"),
              defaultScrollAnchorForRole("bottom", "initialOffset"),
              defaultScrollAnchorForRole("bottom", "sizeChanges"),
              defaultScrollAnchorForRole("top", "alignment"),
            ]}
          >
            <VStack
              alignment="leading"
              spacing={SPACE.EDGE}
              modifiers={[
                // Note that a wide window centers the thread's column at the reading width, as Mail centers a message, rather than running its lines across the screen.
                frame({ maxWidth: READING_WIDTH, alignment: "leading" }),
                frame({ maxWidth: Number.POSITIVE_INFINITY }),
                padding({ bottom: SPACE.PAGE + footRoom }),
                // Note that a message landing, a reply's included, comes in on the system's default spring, as Messages' bubbles do, and the ask's card it answered steps away on the same one, since it goes as the reply lands; with Reduce Motion on they stand at once.
                ...(reduceMotion ? [] : [animation(Animation.default, messages.length)]),
              ]}
            >
              <ThreadHead
                title={title}
                quoted={quoted}
                standing={standing}
                path={pathInHead ? pathTitle : undefined}
              />
              {(opening ?? []).map((event) => (
                <EventLine key={event.key} event={event} now={drawing.now} />
              ))}
              {/* Note that a run's messages stand under its first one's head, and a line of what happened after a message ends its run, so it stands between runs. */}
              {shown.map((run) => (
                <VStack key={run[0]?.id} alignment="leading" spacing={RUN_GAP}>
                  {run.map((message, index) => (
                    <VStack key={message.id} alignment="leading" spacing={SPACE.EDGE}>
                      <MessageView message={message} head={index === 0} {...drawing} />
                      {(message.after ?? []).map((event) => (
                        <EventLine key={event.key} event={event} now={drawing.now} />
                      ))}
                    </VStack>
                  ))}
                </VStack>
              ))}
              {/* Note that the ask stands where the messages' words do, past the writers' faces, so a notice's Got it and a card line up under what they answer. */}
              {ask === undefined ? null : (
                <VStack
                  alignment="leading"
                  modifiers={[padding({ leading: WORDS_INSET, trailing: SPACE.EDGE })]}
                >
                  {ask}
                </VStack>
              )}
            </VStack>
          </ScrollView>
          {foot}
        </VStack>
        <BarContent>
          {pathInHead ? null : <ToolbarItem placement="principal">{pathTitle}</ToolbarItem>}
          {barActItems(acts)}
          {menu === undefined ? null : (
            <ToolbarItem placement="topBarTrailing">
              <BarMenuItem menu={menu} />
            </ToolbarItem>
          )}
        </BarContent>
      </Toolbar>
    </PictureSetProvider>
  );
}
