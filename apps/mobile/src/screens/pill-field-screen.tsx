// pill-field-screen.tsx -- the pill field's scratch page: the field laid in with a mention of every kind and a picture's and a file's marker, the acts that put a pill in, and the Markdown it writes, so a flow shoots the field and its value side by side.

import { nextPictureName } from "@repo/features/file-marker";
import { filePill, mentionPill } from "@repo/features/pill-words";
import {
  BUTTON_LOOK,
  BUTTON_SIZE,
  Button,
  type CaretAtWord,
  InlineHost,
  Markdown,
  PillField,
  type PillFieldHandle,
  SPACE,
  useColors,
} from "@repo/ui-native";
import { useRef, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useOpenLink } from "../open-link.js";

/** The repository the page's mentions read GitHub pages against. */
const REPOSITORY = "ReviewStage/vespin";

/** The person a press of Mention puts in, as an `@` pick does. */
const PICKED = { name: "Ada Lovelace", target: "https://vespin.dev/stage/person/u-ada" } as const;

/** The words the page opens on: a mention of every kind the panel writes, a picture's marker, and a file's. */
const LAID_IN = [
  "Ask [@Dean Stratakos](https://vespin.dev/stage/person/u-dean) and",
  "[@Fix the refresh](https://vespin.dev/stage/agent/a-refresh) about [@iOS app](https://vespin.dev/stage/task/t-ios),",
  "its [@Rollout plan](https://vespin.dev/stage/task/t-ios/page/p-plan), the thread",
  "[@Attachments in the composer](https://vespin.dev/stage/task/t-ios/inbox/i-attach),",
  "[@#42 Fix the refresh](https://github.com/ReviewStage/vespin/pull/42) by",
  "[@Nov 20, 2026](mention://date/2026-11-20). See [Picture 1] and [File: spec.pdf].",
].join(" ");

/** What the page's acts say. */
const WORDS = {
  PLACEHOLDER: "Message",
  MENTION: "Mention Ada",
  ATTACH: "Attach a picture",
  CLEAR: "Clear",
} as const;

const styles = StyleSheet.create({
  page: { padding: SPACE.EDGE, gap: SPACE.PAGE },
  field: {
    paddingHorizontal: SPACE.ROW + 2,
    paddingVertical: SPACE.ROW,
    borderRadius: SPACE.PAGE,
    borderWidth: StyleSheet.hairlineWidth,
  },
  acts: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.ROW },
});

/** The value as a fenced block, so the page shows the very Markdown the field writes. */
function fenced(value: string): string {
  return ["```", value, "```"].join("\n");
}

/**
 * The pill field on its own, laid in with every pill it draws: the field,
 * Mention (which puts Ada in place of the `@` word the caret stands in, or at
 * the caret, as a pick from the `@` offer does), Attach (a picture's marker at
 * the caret, as a picture attached from the composer's + will), Clear, and
 * under them the Markdown the field writes.
 */
export function PillFieldScreen() {
  const colors = useColors();
  const openLink = useOpenLink();
  const field = useRef<PillFieldHandle>(null);
  const [value, setValue] = useState(LAID_IN);
  const [files, setFiles] = useState<ReadonlySet<string>>(() => new Set(["Picture 1", "spec.pdf"]));
  const [atWord, setAtWord] = useState<CaretAtWord | undefined>(undefined);

  const attach = () => {
    const name = nextPictureName(files);
    setFiles(new Set([...files, name]));
    field.current?.pick(filePill(name));
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.GROUND }}
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <View style={[styles.field, { borderColor: colors.CHIP_EDGE }]}>
        <PillField
          ref={field}
          value={value}
          onChange={setValue}
          files={files}
          repository={REPOSITORY}
          placeholder={WORDS.PLACEHOLDER}
          onAtWord={setAtWord}
          testID="pill-field"
        />
      </View>
      <View style={styles.acts}>
        <InlineHost matchContents>
          <Button
            label={atWord === undefined ? WORDS.MENTION : `${WORDS.MENTION} for @${atWord.query}`}
            look={BUTTON_LOOK.BORDERED}
            size={BUTTON_SIZE.SMALL}
            onPress={() => field.current?.pick(mentionPill(PICKED.name, PICKED.target))}
          />
        </InlineHost>
        <InlineHost matchContents>
          <Button
            label={WORDS.ATTACH}
            look={BUTTON_LOOK.BORDERED}
            size={BUTTON_SIZE.SMALL}
            onPress={attach}
          />
        </InlineHost>
        <InlineHost matchContents>
          <Button
            label={WORDS.CLEAR}
            look={BUTTON_LOOK.BORDERED}
            size={BUTTON_SIZE.SMALL}
            onPress={() => setValue("")}
          />
        </InlineHost>
      </View>
      <Markdown words={fenced(value)} repository={REPOSITORY} onOpenLink={openLink} />
    </ScrollView>
  );
}
