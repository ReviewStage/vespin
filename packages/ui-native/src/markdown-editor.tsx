// markdown-editor.tsx -- a page of Markdown written whole, as GitHub's iPhone app edits an issue's body: its source in the system's own multi-line field, its preview drawn as the page draws it, and the Write and Preview switch pinned over the keyboard.

import { Host, RNHostView, ScrollView, VStack } from "@expo/ui/swift-ui";
import { frame, padding, scrollDismissesKeyboard, tint } from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";
import { View } from "react-native";
import { SCOPE_LOOK, ScopeControl } from "./button.js";
import { releaseFields } from "./field-focus.js";
import { WORDS_LOOK, WordsField } from "./form-rows.js";
import { DockRow, GlassDock, useDockRoom } from "./glass-bar.js";
import { Markdown, type MarkdownFile, type MarkdownVideo } from "./markdown.js";
import { ProblemLine } from "./problem-line.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";

/** What the editor shows: the words' source to write, or the words as the page draws them. */
const EDITOR_SHOWS = {
  WRITE: "Write",
  PREVIEW: "Preview",
} as const;

type EditorShows = (typeof EDITOR_SHOWS)[keyof typeof EDITOR_SHOWS];

/** What VoiceOver hears the Write and Preview switch as, before the side chosen. */
const SHOWS_LABEL = "Show";

type MarkdownEditorProps = {
  /** The words as the holder keeps them, written into the field where they move apart from what was typed, as Keep mine's merged words are. */
  readonly words: string;
  readonly onWords: (words: string) => void;
  /** What the field says while it holds nothing: "Add a description". */
  readonly placeholder: string;
  /** What VoiceOver hears the field as. */
  readonly label: string;
  /** The name a flow finds the field by. */
  readonly testId: string;
  /** Holds the words as they stand, such as while they are being saved. */
  readonly disabled?: boolean | undefined;
  /** What went wrong, said under the words, such as a conflict with the words someone else wrote meanwhile; none while nothing did. */
  readonly problem?: string | undefined;
  /** The task's repository, `owner/name`, whose GitHub pages the preview's chips are. */
  readonly repository?: string | null | undefined;
  /** Opens a link or a chip pressed in the preview. */
  readonly onOpenLink: (address: string) => void;
  /** The address the preview draws a picture from, by the address its words name it by, as the page reads the description's own. */
  readonly pictureSource?: ((written: string) => string | null | undefined) | undefined;
  /** The video a picture's address names, played in its place in the preview. */
  readonly videoAt?: ((written: string) => MarkdownVideo | undefined) | undefined;
  /** The file a picture's address names, drawn as its chip in the preview. */
  readonly fileAt?: ((written: string) => MarkdownFile | undefined) | undefined;
};

/** The words drawn as the page draws them, in React Native views hosted in SwiftUI's scroller, since SwiftUI has no piece that draws the panel's Markdown. */
function Preview(props: MarkdownEditorProps) {
  return (
    <RNHostView matchContents={{ vertical: true }}>
      <View>
        <Markdown
          words={props.words}
          repository={props.repository}
          onOpenLink={props.onOpenLink}
          pictureSource={props.pictureSource}
          videoAt={props.videoAt}
          fileAt={props.fileAt}
          headings
          diagrams
        />
      </View>
    </RNHostView>
  );
}

/** The editor's page: the source to write or its preview, what went wrong under it, clear of the switch at its foot. */
function EditorPage({ shows, ...props }: MarkdownEditorProps & { readonly shows: EditorShows }) {
  const colors = useColors();
  const room = useDockRoom();

  return (
    <Host style={{ flex: 1, backgroundColor: colors.GROUND }} modifiers={[tint(colors.TEXT)]}>
      <ScrollView modifiers={[scrollDismissesKeyboard("interactively")]}>
        <VStack
          alignment="leading"
          spacing={SPACE.ROW}
          modifiers={[
            frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
            padding({ horizontal: SPACE.EDGE, top: SPACE.ROW, bottom: room + SPACE.ROW }),
          ]}
        >
          {props.problem === undefined ? null : <ProblemLine text={props.problem} />}
          {shows === EDITOR_SHOWS.WRITE ? (
            <WordsField
              placeholder={props.placeholder}
              initialWords={props.words}
              words={props.words}
              onWords={props.onWords}
              autoFocus
              testId={props.testId}
              label={props.label}
              disabled={props.disabled}
              look={WORDS_LOOK.PAGE}
            />
          ) : (
            <Preview {...props} />
          )}
        </VStack>
      </ScrollView>
    </Host>
  );
}

/**
 * A page of Markdown written whole, as GitHub's iPhone app edits an issue's
 * body: its source fills the page in the system's own multi-line field,
 * reference lines and pictures' addresses kept exactly as written, and
 * Preview draws the words as the page draws them, its pictures among them.
 * The Write and Preview switch is the system's segmented control pinned over
 * the keyboard in the dock, as a compose sheet's controls stand, so it rides
 * the keyboard up and stands at the foot once it is down. Note that the field
 * lets the keyboard go before Preview takes its place, since a field dropped
 * while it holds the keyboard can end the app. What went wrong, such as a
 * conflict with words written meanwhile, stands over the words. The screen's
 * own bar holds Cancel and Save.
 */
export function MarkdownEditor(props: MarkdownEditorProps) {
  const [shows, setShows] = useState<EditorShows>(EDITOR_SHOWS.WRITE);

  const show = (next: EditorShows) => {
    if (next === EDITOR_SHOWS.WRITE) setShows(next);
    else void releaseFields().then(() => setShows(next));
  };

  return (
    <GlassDock
      bar={
        <DockRow>
          <ScopeControl
            label={SHOWS_LABEL}
            look={SCOPE_LOOK.SEGMENTED}
            scopes={Object.values(EDITOR_SHOWS).map((each) => ({
              label: each,
              selected: each === shows,
              onPress: () => show(each),
            }))}
          />
        </DockRow>
      }
    >
      <EditorPage {...props} shows={shows} />
    </GlassDock>
  );
}
