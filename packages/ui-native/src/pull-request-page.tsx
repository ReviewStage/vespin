// pull-request-page.tsx -- a pull request's page: its heading with where it stands and its branches, the rows of its checks and reviews, the line a change GitHub refused leaves, and the question an act asks first.

import {
  ConfirmationDialog,
  Host,
  HStack,
  Button as SwiftUIButton,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  frame,
  lineLimit,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  monospacedDigit,
} from "@expo/ui/swift-ui/modifiers";
import type { PullRequestState } from "@repo/features/agent-wire";
import type { ReactElement } from "react";
import { FieldChip } from "./button.js";
import type { MarkLook } from "./glyph.js";
import { RowFrame, RowHead } from "./list-row.js";
import { ToneGlyph } from "./marks.js";
import { pullRequestLook } from "./pull-request-look.js";
import { STATUS_TONE, useColors } from "./tokens/colors.js";
import { LUCIDE_SYMBOL } from "./tokens/lucide-symbols.js";
import { SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** What joins a pull request's branches, the one it merges from after the one it merges into, as GitHub writes it. */
const BRANCH_ARROW = "←";

type PullRequestHeadProps = {
  readonly title: string;
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
};

/** One branch, as the panel's header names it: Lucide's branch glyph, then its name in the monospaced face. */
function Branch({ name }: { readonly name: string }) {
  const colors = useColors();
  return (
    <HStack spacing={SPACE.TIGHT}>
      <ToneGlyph
        glyph={LUCIDE_SYMBOL.GIT_BRANCH}
        tone={STATUS_TONE.NEUTRAL}
        textStyle={TYPE_ROLE.ROW_LINE}
        hidden
      />
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.ROW_LINE, design: "monospaced" }),
          foregroundStyle(colors.TEXT_BODY),
          lineLimit(1),
        ]}
      >
        {name}
      </Text>
    </HStack>
  );
}

/**
 * A pull request's heading, as a list's first row: its title in 20 pt
 * semibold with its number muted after it, then where it stands as a chip,
 * its state's glyph in GitHub's color and its word, then its branches on a
 * line of their own, the one it merges into first, then GitHub's sentence of
 * whether it would merge, in the body's ink.
 */
export function PullRequestHead({
  title,
  number,
  state,
  queued,
  stateLabel,
  branches,
  sentence,
}: PullRequestHeadProps) {
  const colors = useColors();
  const look = pullRequestLook(state, queued);
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
      {branches === undefined ? null : (
        <HStack spacing={SPACE.TIGHT + 2}>
          <Branch name={branches.base} />
          <Text
            modifiers={[
              font({ textStyle: TYPE_ROLE.ROW_LINE }),
              foregroundStyle(colors.TEXT_MUTED),
            ]}
          >
            {BRANCH_ARROW}
          </Text>
          <Branch name={branches.head} />
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

type MarkRowProps = {
  /** The row's id, which its list's `onSelect` is called with. */
  readonly id: string;
  /** Its leading mark: where the thing it names stands, in that tone. */
  readonly mark: MarkLook;
  readonly title: string;
  /** What ends its line, muted: where it stands in words, or how long it ran. */
  readonly detail?: string | undefined;
};

/**
 * A row of a pull request's page, such as a check or a reviewer: its mark
 * in the lead column, its name in 15 pt, and what ends its line, 12 pt and
 * muted, standing as every list row does, plain and edge to edge with a
 * hairline under the words.
 */
export function MarkRow({ id, mark, title, detail }: MarkRowProps) {
  const colors = useColors();
  const row: ReactElement = (
    <RowHead
      unread={false}
      faded={false}
      lead={<ToneGlyph glyph={mark.symbol} tone={mark.tone} textStyle={TYPE_ROLE.ROW_TITLE} />}
      title={title}
      ink={colors.TEXT_BODY}
      end={
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
        )
      }
    />
  );
  return <RowFrame id={id} row={row} />;
}

/**
 * What a change GitHub did not make leaves to say, as a list's row: our
 * sentence by a warning in the danger ink, and GitHub's own words quoted
 * under it where it said some.
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
        glyph="exclamationmark.triangle"
        tone={STATUS_TONE.DANGER}
        textStyle={TYPE_ROLE.ROW_LINE}
        hidden
      />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ textStyle: TYPE_ROLE.ROW_LINE }), foregroundStyle(colors.TEXT)]}>
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

type ConfirmAskProps = {
  /** The question, as the panel's confirm asks it: "Remove from the merge queue?" */
  readonly title: string;
  /** What the act costs, under the question. */
  readonly message?: string | undefined;
  /** The act's own words, the dialog's one act beside Cancel. */
  readonly act: string;
  /** Whether the act ends or takes away something, which the system draws red. */
  readonly destructive?: boolean | undefined;
  readonly presented: boolean;
  readonly onAct: () => void;
  /** Called as the dialog goes, by its act, Cancel, or a tap outside it. */
  readonly onDismiss: () => void;
};

/**
 * The question an act asks first, as the system's confirmation dialog: its
 * question, what it costs, its act, and Cancel, which iOS adds. It stands
 * in a host of its own, the size of nothing, so a screen draws it beside
 * whatever it shows and presents it from a press anywhere, its toolbar's
 * among them.
 */
export function ConfirmAsk({
  title,
  message,
  act,
  destructive = false,
  presented,
  onAct,
  onDismiss,
}: ConfirmAskProps) {
  return (
    <Host matchContents style={{ position: "absolute" }}>
      <ConfirmationDialog
        title={title}
        titleVisibility="visible"
        isPresented={presented}
        onIsPresentedChange={(shown) => {
          if (!shown) onDismiss();
        }}
      >
        <ConfirmationDialog.Trigger>
          <Text modifiers={[frame({ width: 0, height: 0 })]}>{""}</Text>
        </ConfirmationDialog.Trigger>
        <ConfirmationDialog.Actions>
          <SwiftUIButton
            label={act}
            role={destructive ? "destructive" : "default"}
            onPress={onAct}
          />
        </ConfirmationDialog.Actions>
        {message === undefined ? null : (
          <ConfirmationDialog.Message>
            <Text>{message}</Text>
          </ConfirmationDialog.Message>
        )}
      </ConfirmationDialog>
    </Host>
  );
}
