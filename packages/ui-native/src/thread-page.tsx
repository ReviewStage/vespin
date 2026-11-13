// thread-page.tsx -- an Inbox thread: its path small in the bar, a menu of what it opens, its title as the page's heading, then each message flat, its writer's face or tile, name and time in SwiftUI and its words, pictures, videos, and files in React Native views.

import {
  HStack,
  Image,
  Menu,
  RNHostView,
  ScrollView,
  Spacer,
  Button as SwiftUIButton,
  Text,
  Toolbar,
  ToolbarItem,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  accessibilityElement,
  accessibilityHidden,
  accessibilityLabel,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  padding,
  scrollDismissesKeyboard,
} from "@expo/ui/swift-ui/modifiers";
import type { LinkStanding } from "@repo/features/link-standing-model";
import type { ModelProvider } from "@repo/features/models-wire";
import type { TaskStatus } from "@repo/features/task-wire";
import { sinceHeard, sinceText } from "@repo/features/time-format";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useAccessibilitySize } from "./accessibility.js";
import { BarContent } from "./bar-content.js";
import { FileChip } from "./file-chip.js";
import { useDockRoom } from "./glass-bar.js";
import { GLYPH, glyphImage } from "./glyph.js";
import { actContent } from "./glyph-label.js";
import { CopyWordsSwiftMenu } from "./held-menu.js";
import { Markdown, type MarkdownVideo, Picture } from "./markdown.js";
import { AgentTile, Avatar, type Face, TaskStatusMark } from "./marks.js";
import { BAR_ITEM_MENU, type BarMenu, BarMenuItem } from "./split-view.js";
import { threadRuns } from "./thread-group-model.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, READING_WIDTH, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";
import { Video } from "./video.js";

/** What parts a thread's path, as the panel's crumbs part a task from its agent. */
export const PATH_PART = " › ";

/** Between a writer's face and their name. */
const WRITER_GAP = SPACE.TIGHT * 2;

/** Between one message and the next of the same run, closer than between runs, as Messages draws a speaker's bubbles. */
const RUN_GAP = SPACE.TIGHT * 2;

/** How far a message's words stand in from the page's edge: past the writer's face, under the name, where a row's words start. */
const WORDS_INSET = SPACE.EDGE + MARK_SIZE.WRITER + WRITER_GAP;

const styles = StyleSheet.create({
  words: { paddingLeft: WORDS_INSET, paddingRight: SPACE.EDGE, gap: SPACE.ROW },
});

/** What a message's file is drawn as after its words: a picture, a video in the system's player, or any other file, such as a PDF, as its chip. */
export const THREAD_MEDIA = {
  PICTURE: "picture",
  VIDEO: "video",
  FILE: "file",
} as const;

/** One file a message carried, drawn after its words; its source none while its bytes are on their way. */
export type ThreadMedia =
  | {
      readonly kind: typeof THREAD_MEDIA.PICTURE;
      readonly key: string;
      readonly source: string | undefined;
      readonly alt: string;
    }
  | {
      readonly kind: typeof THREAD_MEDIA.VIDEO;
      readonly key: string;
      readonly source: string | undefined;
      readonly label: string;
      /** Opens the video where it plays, such as its thread in Safari, for one the system's player cannot read. */
      readonly onOpenElsewhere?: (() => void) | undefined;
    }
  | {
      readonly kind: typeof THREAD_MEDIA.FILE;
      readonly key: string;
      /** The file's address under the app's caches, which its viewer opens. */
      readonly source: string | undefined;
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
    /** The member's account or the agent, which a run of messages is grouped by; the name alone where none is known. */
    readonly id?: string | undefined;
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
};

type ThreadPageProps = {
  /** Where the thread stands, its task and then its agent, as the panel's crumbs name them. */
  readonly path: readonly string[];
  /** The status of the task it stands in, its ring leading the path; none for an agent's own thread. */
  readonly status?: TaskStatus | undefined;
  /** What the path opens, such as its task and its agent, as the panel's crumbs open them, which a press on the path offers as a menu; none leaves it words alone. */
  readonly pathActions?: BarMenu["actions"] | undefined;
  /** The thread's title, which heads the page. */
  readonly title: string;
  readonly messages: readonly ThreadMessage[];
  /** The task's repository, `owner/name`, whose GitHub pages are its files' chips. */
  readonly repository?: string | null | undefined;
  /** Opens a link or a chip pressed, by the address it was written as, where the app draws it or in Safari. */
  readonly onOpenLink: (address: string) => void;
  /** The address a picture its words draw is drawn from, by the address they name it by; none while it is on its way. */
  readonly pictureSource?: ((written: string) => string | undefined) | undefined;
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
  /** The thread's ⋯ menu, such as Resolve, in a split view's detail bar; a compact window's stack holds it in its own bar. */
  readonly menu?: BarMenu | undefined;
  /** What stands at the page's foot under its scroll, such as a split view's composer (`ComposerFoot`). */
  readonly foot?: ReactNode | undefined;
};

/** A thread's heading under its bar: its title in 20 pt semibold, and how it ended under it, 13 pt muted, once it is settled. */
function ThreadHead({ title, standing }: Pick<ThreadPageProps, "title" | "standing">) {
  const colors = useColors();

  return (
    <VStack
      alignment="leading"
      spacing={SPACE.TIGHT}
      modifiers={[padding({ horizontal: SPACE.EDGE, top: SPACE.TIGHT })]}
    >
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.PAGE_HEADING, weight: "semibold" }),
          foregroundStyle(colors.TEXT),
          accessibilityAddTraits(["isHeader"]),
        ]}
      >
        {title}
      </Text>
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

/**
 * A split view's detail column's bar: a page's path, small and muted after
 * its task's ring, in the bar's middle, as a compact window's stack draws it
 * in its own bar. Given what it opens, the path is a menu of them under a
 * small chevron, as iOS's own title menus stand, so a thread leads to its
 * task and its agent as the panel's crumbs do.
 */
export function PathTitle({
  path,
  status,
  actions = [],
}: Pick<ThreadPageProps, "path" | "status"> & {
  readonly actions?: BarMenu["actions"] | undefined;
}) {
  const colors = useColors();
  const words = path.join(PATH_PART);

  const title = (
    <HStack spacing={SPACE.TIGHT + 2}>
      {status === undefined ? null : <TaskStatusMark status={status} />}
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE, weight: "medium" }),
          foregroundStyle(colors.TEXT_MUTED),
          lineLimit(1),
        ]}
      >
        {words}
      </Text>
      {actions.length === 0 ? null : (
        <Image
          {...glyphImage(GLYPH.UNFOLDED)}
          size={MARK_SIZE.GLYPH - 4}
          color={colors.TEXT_MUTED}
          modifiers={[accessibilityHidden(true)]}
        />
      )}
    </HStack>
  );

  if (actions.length === 0) return title;

  return (
    // Note that the menu takes a bar item's plain look, so the bar's glass is the one layer around the path, as the ⋯ stands.
    <Menu label={title} modifiers={[...BAR_ITEM_MENU, accessibilityLabel(words)]}>
      {actions.map((action) => (
        <SwiftUIButton
          key={action.label}
          {...actContent(action.label, action.symbol)}
          onPress={action.onPress}
          modifiers={[disabled(action.disabled === true)]}
        />
      ))}
    </Menu>
  );
}

/** A file after a message's words, as its kind draws it. */
function MediaView({ media }: { readonly media: ThreadMedia }) {
  switch (media.kind) {
    case THREAD_MEDIA.PICTURE:
      return <Picture source={media.source} alt={media.alt} />;
    case THREAD_MEDIA.VIDEO:
      return (
        <Video source={media.source} label={media.label} onOpenElsewhere={media.onOpenElsewhere} />
      );
    case THREAD_MEDIA.FILE:
      return (
        <FileChip
          name={media.name}
          mediaType={media.mediaType}
          source={media.source}
          size={media.size}
        />
      );
  }
}

/** What a sent answer's mark is heard as: it went ahead with what was asked, or held back. */
const STAMP_HEARD = { AHEAD: "Went ahead", HELD: "Held back" } as const;

/** A sent answer's stamp under its writer's name, where its words start: its mark and its words, 13 pt. */
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

/** One message, flat on the page: the writer's face or tile, name in 13 pt semibold and time where it leads its run, and under them its words and files. */
function MessageView({
  message,
  head,
  repository,
  onOpenLink,
  pictureSource,
  videoAt,
  linkStanding,
  now,
}: Omit<
  ThreadPageProps,
  "path" | "status" | "pathActions" | "title" | "messages" | "ask" | "menu" | "foot"
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
    <CopyWordsSwiftMenu words={message.words}>
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
              <AgentTile name={writer.name} harness={writer.harness} size={MARK_SIZE.WRITER} />
            ) : (
              <Avatar name={writer.name} picture={writer.picture} size={MARK_SIZE.WRITER} />
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
        <RNHostView matchContents={{ vertical: true }}>
          <View style={styles.words}>
            {message.words.trim() === "" ? null : (
              <Markdown
                words={message.words}
                repository={repository}
                onOpenLink={onOpenLink}
                typed={message.typed}
                pictureSource={pictureSource}
                videoAt={videoAt}
                linkStanding={linkStanding}
              />
            )}
            {message.media.map((media) => (
              <MediaView key={media.key} media={media} />
            ))}
          </View>
        </RNHostView>
      </VStack>
    </CopyWordsSwiftMenu>
  );
}

/**
 * A thread's page, in a `Screen` or a split view's detail alike: SwiftUI
 * scrolls it and draws its heading and each message's writer, and each
 * message's words and files stand in a React Native host as wide as the
 * page and as tall as they are, since SwiftUI has no piece that draws the
 * panel's Markdown. The path stands in the bar: a compact window's stack
 * names it as the screen's title, and a split view's detail column draws it
 * here. A message that lands while it is open is drawn at its foot, as the
 * thread's document moves, and the open ask's card stands under the last.
 */
export function ThreadPage(props: ThreadPageProps) {
  const { path, status, pathActions, title, messages, ask, menu, foot, standing, ...drawing } =
    props;

  // Note that a page docked under a composer leaves room under its last message for the bar as tall as it stands; one in a split view's column leaves none.
  const footRoom = useDockRoom();

  return (
    <Toolbar>
      <VStack spacing={0}>
        <ScrollView modifiers={[scrollDismissesKeyboard("interactively")]}>
          <VStack
            alignment="leading"
            spacing={SPACE.EDGE}
            modifiers={[
              // Note that a wide window centers the thread's column at the reading width, as Mail centers a message, rather than running its lines across the screen.
              frame({ maxWidth: READING_WIDTH, alignment: "leading" }),
              frame({ maxWidth: Number.POSITIVE_INFINITY }),
              padding({ bottom: SPACE.PAGE + footRoom }),
            ]}
          >
            <ThreadHead title={title} standing={standing} />
            {threadRuns(messages).map((run) => (
              <VStack key={run[0]?.id} alignment="leading" spacing={RUN_GAP}>
                {run.map((message, index) => (
                  <MessageView key={message.id} message={message} head={index === 0} {...drawing} />
                ))}
              </VStack>
            ))}
            {ask === undefined ? null : (
              <VStack alignment="leading" modifiers={[padding({ horizontal: SPACE.EDGE })]}>
                {ask}
              </VStack>
            )}
          </VStack>
        </ScrollView>
        {foot}
      </VStack>
      <BarContent>
        <ToolbarItem placement="principal">
          <PathTitle path={path} status={status} actions={pathActions} />
        </ToolbarItem>
        {menu === undefined ? null : (
          <ToolbarItem placement="topBarTrailing">
            <BarMenuItem menu={menu} />
          </ToolbarItem>
        )}
      </BarContent>
    </Toolbar>
  );
}
