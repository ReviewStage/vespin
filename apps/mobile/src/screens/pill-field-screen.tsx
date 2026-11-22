// pill-field-screen.tsx -- the pill field's scratch page: the field laid in with a mention of every kind and a picture's and a file's marker, the acts that put a pill in, and the Markdown it writes, so a flow shoots the field and its value side by side; and under them a document's field drawn in its looks as it is written, and a description edited as rich text with the Markdown it saves.

import { nextPictureName } from "@repo/features/file-marker";
import { filePill, mentionPill } from "@repo/features/pill-words";
import {
  BUTTON_LOOK,
  BUTTON_SIZE,
  Button,
  type CaretAtWord,
  DocumentField,
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

/** The document the styled field opens on: a heading, bold and italic words, inline code, a mention, a list, a quote, and a fenced block, each drawn as the page draws it. */
const DOCUMENT = [
  "## Invites",
  "",
  "Ask [@Dean Stratakos](https://vespin.dev/stage/person/u-dean) whether an invite expires after **seven days** or *never*; run `pnpm test`.",
  "",
  "- Withdraw a pending invite",
  "- Resend an expired one",
  "",
  "> Owners and admins may withdraw.",
  "",
  "```ts",
  "const days = 7;",
  "```",
].join("\n");

/** The description the rich field opens on: each block it draws with no syntax, and a table and a diagram it stands as cards. */
const DESCRIPTION = [
  "# Teammate invitations",
  "",
  "Ask [@Dean Stratakos](https://vespin.dev/stage/person/u-dean) before an invite expires after **seven days**, or _never_; run `pnpm test`.",
  "",
  "- Withdraw a pending invite",
  "- Resend an expired one",
  "",
  "1. Model",
  "2. Screen",
  "",
  "- [x] Owners may withdraw",
  "- [ ] Admins may withdraw",
  "",
  "> The link stops working once it is used.",
  "",
  "```ts",
  "const days = 7;",
  "```",
  "",
  "---",
  "",
  "| Role | May withdraw |",
  "| - | - |",
  "| Owner | yes |",
  "",
  "```mermaid",
  "graph TD",
  "  Invite-->Accept",
  "```",
  "",
].join("\n");

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
  document: {
    height: 560,
    padding: SPACE.ROW,
    borderRadius: SPACE.PAGE,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fill: { flex: 1 },
});

/** The shortest fence Markdown reads, which a longer run of backticks in the words would close early. */
const FENCE_LEAST = 3;

/** The value as a fenced block, so the page shows the very Markdown the field writes, its fence longer than any run of backticks in it. */
function fenced(value: string): string {
  const longest = Math.max(0, ...(value.match(/`+/gu) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(FENCE_LEAST, longest + 1));

  return [fence, value, fence].join("\n");
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
  const [writing, setWriting] = useState(DOCUMENT);
  const [description, setDescription] = useState(DESCRIPTION);

  const attach = () => {
    const name = nextPictureName(files);
    setFiles(new Set([...files, name]));
    field.current?.place([filePill(name)]);
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.GROUND }}
      contentContainerStyle={styles.page}
      // Note that the page starts under the stack's bar, as UIKit insets a scroller under a translucent bar, since React Native's scroller insets nothing by default and the field stood under the bar.
      contentInsetAdjustmentBehavior="automatic"
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
      <View style={[styles.field, { borderColor: colors.CHIP_EDGE }]}>
        <PillField
          value={writing}
          onChange={setWriting}
          repository={REPOSITORY}
          placeholder={WORDS.PLACEHOLDER}
          maxLines={16}
          styled
          testID="pill-field-styled"
        />
      </View>
      <View style={[styles.document, { borderColor: colors.CHIP_EDGE }]}>
        <DocumentField
          value={description}
          onChange={setDescription}
          repository={REPOSITORY}
          placeholder={WORDS.PLACEHOLDER}
          style={styles.fill}
          testID="document-field"
        />
      </View>
      <Markdown words={fenced(description)} repository={REPOSITORY} onOpenLink={openLink} />
    </ScrollView>
  );
}
