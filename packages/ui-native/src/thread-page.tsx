// thread-page.tsx -- an Inbox thread as the panel's pane draws it: its path and its title as the subject, then each message as a comment, its writer's face or tile, name and time in SwiftUI and its words, pictures, and videos in React Native views.

import { HStack, RNHostView, ScrollView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import type { TaskStatus } from "@repo/features/task-wire";
import { sinceText } from "@repo/features/time-format";
import { StyleSheet, View } from "react-native";
import { Markdown, type MarkdownPlace, type MarkdownVideo, Picture } from "./markdown.js";
import { AgentTile, Avatar, TaskStatusMark } from "./marks.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { Video } from "./video.js";

/** What parts a thread's path, as the panel's crumbs part a task from its agent. */
const PATH_PART = " › ";

/** How far a message's words stand in from the page's edge: past the writer's face, so they line up under the name. */
const WORDS_INSET = SPACE.PAGE + MARK_SIZE.AVATAR + SPACE.ROW;

const styles = StyleSheet.create({
  words: { paddingLeft: WORDS_INSET, paddingRight: SPACE.PAGE, gap: SPACE.ROW },
});

/** What a message's file is drawn as after its words: a picture, or a video in the system's player. */
export const THREAD_MEDIA = {
  PICTURE: "picture",
  VIDEO: "video",
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
    };

/** One message of a thread, as its comment draws it. */
export type ThreadMessage = {
  readonly id: string;
  /** Who wrote it: a member by their face, or the agent by its tile. */
  readonly writer: { readonly name: string; readonly agent: boolean };
  /** When it was written, in epoch milliseconds. */
  readonly at: number;
  readonly words: string;
  /** Whether a member typed it line by line, whose line breaks are kept. */
  readonly typed: boolean;
  readonly media: readonly ThreadMedia[];
};

type ThreadPageProps = {
  /** Where the thread stands, its task and then its agent, as the panel's crumbs name them. */
  readonly path: readonly string[];
  /** The status of the task it stands in, its ring leading the path; none for an agent's own thread. */
  readonly status?: TaskStatus | undefined;
  /** The thread's title, which leads the page as its subject. */
  readonly title: string;
  readonly messages: readonly ThreadMessage[];
  /** The task's repository, `owner/name`, whose GitHub pages are its files' chips. */
  readonly repository?: string | null | undefined;
  /** Routes a link or a chip naming a place in the app; every other link opens in Safari. */
  readonly onOpenPlace: (place: MarkdownPlace) => void;
  /** The address a picture its words draw is drawn from, by the address they name it by; none while it is on its way. */
  readonly pictureSource?: ((written: string) => string | undefined) | undefined;
  /** The video a picture its words draw names, played in its place; every address names a picture where none is given. */
  readonly videoAt?: ((written: string) => MarkdownVideo | undefined) | undefined;
  /** What the times count from; now where none is given. */
  readonly now?: number | undefined;
};

/** A thread's head: its path in the caption's muted ink after the task's ring, and its title as the subject. */
function ThreadHead({ path, status, title }: Pick<ThreadPageProps, "path" | "status" | "title">) {
  const colors = useColors();
  return (
    <VStack
      alignment="leading"
      spacing={SPACE.TIGHT * 2}
      modifiers={[padding({ horizontal: SPACE.PAGE, top: SPACE.ROW, bottom: SPACE.PAGE })]}
    >
      <HStack spacing={SPACE.TIGHT + 2}>
        {status === undefined ? null : <TaskStatusMark status={status} />}
        <Text
          modifiers={[
            font({ textStyle: "subheadline" }),
            foregroundStyle(colors.TEXT_MUTED),
            lineLimit(1),
          ]}
        >
          {path.join(PATH_PART)}
        </Text>
      </HStack>
      <Text
        modifiers={[
          font({ textStyle: "title2", weight: "semibold" }),
          foregroundStyle(colors.TEXT),
        ]}
      >
        {title}
      </Text>
    </VStack>
  );
}

/** A file after a message's words, as its kind draws it. */
function MediaView({ media }: { readonly media: ThreadMedia }) {
  return media.kind === THREAD_MEDIA.PICTURE ? (
    <Picture source={media.source} alt={media.alt} />
  ) : (
    <Video source={media.source} label={media.label} onOpenElsewhere={media.onOpenElsewhere} />
  );
}

/** One message as the panel's comment: the writer's face or tile, name and time, and under them its words and files. */
function MessageView({
  message,
  repository,
  onOpenPlace,
  pictureSource,
  videoAt,
  now,
}: Omit<ThreadPageProps, "path" | "status" | "title" | "messages"> & {
  readonly message: ThreadMessage;
}) {
  const colors = useColors();
  const { writer } = message;
  return (
    <VStack alignment="leading" spacing={SPACE.TIGHT}>
      <HStack spacing={SPACE.ROW} modifiers={[padding({ horizontal: SPACE.PAGE })]}>
        {writer.agent ? <AgentTile name={writer.name} /> : <Avatar name={writer.name} />}
        <Text
          modifiers={[
            font({ textStyle: "subheadline", weight: "semibold" }),
            foregroundStyle(colors.TEXT),
            lineLimit(1),
          ]}
        >
          {writer.name}
        </Text>
        <Text
          modifiers={[
            font({ textStyle: "caption" }),
            monospacedDigit(),
            foregroundStyle(colors.TEXT_MUTED),
          ]}
        >
          {sinceText(message.at, now ?? Date.now())}
        </Text>
        <Spacer />
      </HStack>
      <RNHostView matchContents={{ vertical: true }}>
        <View style={styles.words}>
          {message.words.trim() === "" ? null : (
            <Markdown
              words={message.words}
              repository={repository}
              onOpenPlace={onOpenPlace}
              typed={message.typed}
              pictureSource={pictureSource}
              videoAt={videoAt}
            />
          )}
          {message.media.map((media) => (
            <MediaView key={media.key} media={media} />
          ))}
        </View>
      </RNHostView>
    </VStack>
  );
}

/**
 * A thread's page, in a `Screen` or a split view's detail alike: SwiftUI
 * scrolls it and draws its head and each comment's writer, and each
 * message's words and files stand in a React Native host as wide as the
 * page and as tall as they are, since SwiftUI has no piece that draws the
 * panel's Markdown. A message that lands while it is open is drawn at its
 * foot, as the thread's document moves.
 */
export function ThreadPage({ path, status, title, messages, ...drawing }: ThreadPageProps) {
  return (
    <ScrollView>
      <VStack
        alignment="leading"
        spacing={SPACE.PAGE}
        modifiers={[
          frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
          padding({ bottom: SPACE.PAGE }),
        ]}
      >
        <ThreadHead path={path} status={status} title={title} />
        {messages.map((message) => (
          <MessageView key={message.id} message={message} {...drawing} />
        ))}
      </VStack>
    </ScrollView>
  );
}
