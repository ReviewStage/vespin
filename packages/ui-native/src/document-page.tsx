// document-page.tsx -- a page a document is edited whole on, as Notion edits a page: its rich field filling the page, what went wrong over it, and the people and things an `@` offers docked over the keyboard.

import { Host } from "@expo/ui/swift-ui";
import type { Ref } from "react";
import { StyleSheet, View } from "react-native";
import type { CaretAtWord } from "./caret-at-word.js";
import {
  type MentionCrumb,
  type MentionSuggestionGroup,
  MentionSuggestions,
} from "./composer-head.js";
import { DocumentField, type DocumentFieldHandle } from "./document-field.js";
import { GlassBar, GlassDock, useDockKeyboard, useDockRoom } from "./glass-bar.js";
import { ProblemLine } from "./problem-line.js";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";

/** What an `@` being typed offers, as a composer's head offers it. */
export interface DocumentPageMentions {
  readonly groups: readonly MentionSuggestionGroup[];
  readonly empty: string | undefined;
  readonly crumb?: MentionCrumb | undefined;
  readonly onPick: (group: string, id: string) => void;
}

interface DocumentPageProps {
  readonly ref?: Ref<DocumentFieldHandle> | undefined;
  /** The document, as the Markdown it is saved as. */
  readonly value: string;
  readonly onChange: (markdown: string) => void;
  /** What the field says while it holds nothing. */
  readonly placeholder: string;
  /** Holds the words as they stand, such as while they are being saved. */
  readonly editable?: boolean | undefined;
  /** The task's repository, `owner/name`, whose GitHub pages a mention names as its files. */
  readonly repository?: string | null | undefined;
  /** What went wrong, said over the words, such as a conflict with words someone else wrote meanwhile; none while nothing did. */
  readonly problem?: string | undefined;
  /** The `@` word the caret stands in as it changes, which the screen reads to offer mentions. */
  readonly onAtWord?: ((word: CaretAtWord | undefined) => void) | undefined;
  /** What the `@` word offers; none while the caret stands in no `@` word. */
  readonly mentions?: DocumentPageMentions | undefined;
  readonly testID?: string | undefined;
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  // Note that the field stands in from the page's edges by its margins rather than padding, which never reaches the text view's own words, so its words line up with the task page's.
  field: { flex: 1, marginHorizontal: SPACE.EDGE },
  problem: { paddingHorizontal: SPACE.EDGE, paddingTop: SPACE.ROW },
});

/** The page's words, inside the dock, so they end over the keyboard and over the offer the dock lifts with it. */
function PageWords({
  field,
  ...props
}: Omit<DocumentPageProps, "ref"> & { readonly field: Ref<DocumentFieldHandle> | undefined }) {
  const colors = useColors();
  const keyboard = useDockKeyboard();
  const room = useDockRoom();
  // Note that the words end where the dock's offer begins while one stands, so the caret's line is never under it; the field keeps its own caret clear of the keyboard otherwise.
  const foot = keyboard + (props.mentions === undefined ? 0 : room);

  return (
    <View style={[styles.page, { backgroundColor: colors.GROUND }]}>
      {props.problem === undefined ? null : (
        <Host matchContents={{ vertical: true }} style={styles.problem}>
          <ProblemLine text={props.problem} />
        </Host>
      )}
      <DocumentField
        ref={field}
        value={props.value}
        onChange={props.onChange}
        repository={props.repository}
        placeholder={props.placeholder}
        editable={props.editable}
        onAtWord={props.onAtWord}
        style={[styles.field, { marginBottom: foot }]}
        testID={props.testID}
      />
    </View>
  );
}

/**
 * A document edited whole on a page of its own, as Notion edits a page: the
 * rich field (`DocumentField`) fills it, each block drawn with no syntax and
 * formatted from the selection's Format menu and the bar over the keyboard;
 * what went wrong, such as a conflict, stands over it; and while the caret
 * stands in an `@` word, what it offers stands docked over the keyboard, as
 * a composer's head offers it, a pick standing as its pill in the word's
 * place. The screen's own bar holds Cancel and Save.
 */
export function DocumentPage({ ref, ...props }: DocumentPageProps) {
  const { mentions } = props;

  const bar =
    mentions === undefined ? null : (
      <GlassBar>
        <MentionSuggestions
          groups={mentions.groups}
          empty={mentions.empty}
          crumb={mentions.crumb}
          onPick={mentions.onPick}
        />
      </GlassBar>
    );

  return (
    <GlassDock bar={bar}>
      <PageWords field={ref} {...props} />
    </GlassDock>
  );
}
