// markdown-page.tsx -- a detail page of words: its title in SwiftUI, and the Markdown under it in React Native views hosted inside SwiftUI's scroller.

import { RNHostView, ScrollView, VStack } from "@expo/ui/swift-ui";
import { frame } from "@expo/ui/swift-ui/modifiers";
import type { TaskStatus } from "@repo/features/task-wire";
import { View } from "react-native";
import { Markdown, type MarkdownPlace } from "./markdown.js";
import { PageHeader } from "./page-header.js";
import { SPACE } from "./tokens/space.js";

const WORDS_FRAME = { paddingHorizontal: SPACE.EDGE, paddingBottom: SPACE.PAGE } as const;

type MarkdownPageProps = {
  readonly title: string;
  /** A line under the title: where the thing stands, or what it asks. */
  readonly summary?: string | undefined;
  /** A task's status, drawn as its chip under the title. */
  readonly status?: TaskStatus | undefined;
  readonly words: string;
  /** The task's repository, `owner/name`, whose GitHub pages are its files' chips. */
  readonly repository?: string | null | undefined;
  /** Routes a link or a chip naming a place in the app; every other link opens in Safari. */
  readonly onOpenPlace: (place: MarkdownPlace) => void;
  /** Whether a person typed the words line by line, whose line breaks are kept. */
  readonly typed?: boolean | undefined;
};

/**
 * A page of a message or a description, in a `Screen` or a split view's
 * detail alike: SwiftUI scrolls it and draws its title, and the words stand
 * in a React Native host as wide as the page and as tall as they are, since
 * SwiftUI has no piece that draws the panel's Markdown.
 */
export function MarkdownPage({
  title,
  summary,
  status,
  words,
  repository,
  onOpenPlace,
  typed,
}: MarkdownPageProps) {
  return (
    <ScrollView>
      <VStack
        alignment="leading"
        spacing={0}
        modifiers={[frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" })]}
      >
        <PageHeader title={title} summary={summary} status={status} />
        <RNHostView matchContents={{ vertical: true }}>
          <View style={WORDS_FRAME}>
            <Markdown
              words={words}
              repository={repository}
              onOpenPlace={onOpenPlace}
              typed={typed}
            />
          </View>
        </RNHostView>
      </VStack>
    </ScrollView>
  );
}
