/**
 * draft-card.tsx -- words an agent wrote to be sent elsewhere, drawn in a message as they will look there, as the panel's `DraftCard` draws them: a Slack message with its marks and links, an email under its subject, or a plain draft, with a Copy that keeps their formatting.
 *
 * The words are read by the panel's own reader (`@repo/features/draft-text`)
 * and named in its words (`DRAFT_WORDS`). A card is headed by where the
 * draft goes after its glyph ("Slack message", "Email", "Draft") with Copy
 * message at its end; an email's subject stands on a row of its own after
 * the word "Subject", with a Copy of its own, since a subject is pasted into
 * a field of its own. The body stands on the card's surface in the words'
 * own type, each line break where the agent put it, a Slack message's marks
 * drawn as Slack draws them and its links pressed open as the message opens
 * any. Copy message puts the body on the pasteboard as rich text and plain
 * (`draftCopy`) through the app's `Keeping`, so it pastes into Slack or Mail
 * with its links and bold; Copy subject copies its words alone. VoiceOver hears the
 * body as one element and offers each link as one of its actions ("Open …"),
 * as a line of Markdown does. A card under
 * no `KeepingProvider` offers no Copy.
 */

import {
  DRAFT_KIND,
  DRAFT_MARK,
  DRAFT_RUN,
  DRAFT_WORDS,
  type Draft,
  type DraftKind,
  type DraftMark,
  type DraftRun,
  draftCopy,
} from "@repo/features/draft-text";
import { SymbolView } from "expo-symbols";
import {
  type AccessibilityActionEvent,
  Pressable,
  StyleSheet,
  Text,
  type TextStyle,
  View,
} from "react-native";
import { glyphSymbol } from "./glyph.js";
import { useKeeping } from "./held-menu.js";
import { KEEP_ACT, KEEP_SYMBOL } from "./keep-model.js";
import type { SfSymbol } from "./sf-symbol.js";
import { type BrandColors, useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { MONOSPACE_FONT, PROSE_SIZE, TEXT_SIZE } from "./tokens/type.js";

/** The SF Symbol each draft's header leads with, the closest to the panel's: a message's bubble for Slack, whose mark SF Symbols has no drawing of, an envelope, and a pen. */
const DRAFT_SYMBOL = {
  [DRAFT_KIND.SLACK]: "bubble.left",
  [DRAFT_KIND.EMAIL]: "envelope",
  [DRAFT_KIND.DRAFT]: "pencil.line",
} as const satisfies Record<DraftKind, SfSymbol>;

/** How each Slack mark is drawn, as Slack draws it. */
const MARK_LOOK = {
  [DRAFT_MARK.BOLD]: { fontWeight: "600" },
  [DRAFT_MARK.ITALIC]: { fontStyle: "italic" },
  [DRAFT_MARK.STRIKE]: { textDecorationLine: "line-through" },
  [DRAFT_MARK.CODE]: { fontFamily: MONOSPACE_FONT, fontSize: TEXT_SIZE.FOOTNOTE },
} as const satisfies Record<DraftMark, TextStyle>;

/** The room a Copy's press reaches past its glyph, so a finger finds it. */
const PRESS_REACH = 10;

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, overflow: "hidden" },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.TIGHT + 2,
    paddingHorizontal: SPACE.ROW,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barWords: { flex: 1 },
  body: { padding: SPACE.ROW },
});

/** What a VoiceOver action that opens a link says before the link's words, as a line of Markdown says it. */
const OPEN_WORD = "Open";

/** One link a draft holds, as VoiceOver offers it: the action's name, what it says, and the address it opens. */
type DraftLink = { readonly name: string; readonly label: string; readonly url: string };

/** Runs' plain words, as a link's words are heard. */
function runsWords(runs: readonly DraftRun[]): string {
  return runs.map((run) => (run.kind === DRAFT_RUN.TEXT ? run.text : runsWords(run.runs))).join("");
}

/** Every link a draft's runs hold, in the order they stand, nested marks and links walked. */
function draftLinks(runs: readonly DraftRun[], found: DraftLink[] = []): DraftLink[] {
  for (const run of runs) {
    if (run.kind === DRAFT_RUN.LINK) {
      found.push({
        name: `open-${found.length}`,
        label: `${OPEN_WORD} ${runsWords(run.runs) || run.url}`,
        url: run.url,
      });
    }

    if (run.kind !== DRAFT_RUN.TEXT) draftLinks(run.runs, found);
  }

  return found;
}

/** "Copy message" or "Copy subject". */
function copyName(what: string): string {
  return `Copy ${what}`;
}

/** A draft's Copy: the system's copy glyph, named for what it copies. */
function CopyPress({
  what,
  onPress,
  colors,
}: {
  readonly what: string;
  readonly onPress: () => void;
  readonly colors: BrandColors;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={copyName(what)}
      hitSlop={PRESS_REACH}
    >
      <SymbolView
        name={glyphSymbol(KEEP_SYMBOL[KEEP_ACT.COPY])}
        size={MARK_SIZE.GLYPH}
        tintColor={colors.TEXT_MUTED}
      />
    </Pressable>
  );
}

/** Runs drawn as their marks, links, and words. */
function DraftRuns({
  runs,
  onOpenLink,
  colors,
}: {
  readonly runs: readonly DraftRun[];
  readonly onOpenLink: (address: string) => void;
  readonly colors: BrandColors;
}) {
  return runs.map((run, at) => {
    // Note that a run's place is its identity: a draft's runs are read afresh, never reordered.
    if (run.kind === DRAFT_RUN.TEXT) return <Text key={at}>{run.text}</Text>;
    const inner = <DraftRuns runs={run.runs} onOpenLink={onOpenLink} colors={colors} />;

    if (run.kind === DRAFT_RUN.MARK) {
      const code = run.mark === DRAFT_MARK.CODE && { backgroundColor: colors.WELL };

      return (
        <Text key={at} style={[MARK_LOOK[run.mark], code]}>
          {inner}
        </Text>
      );
    }

    return (
      <Text
        key={at}
        onPress={() => onOpenLink(run.url)}
        accessibilityRole="link"
        style={{ color: colors.TEXT_BODY, textDecorationLine: "underline" }}
      >
        {inner}
      </Text>
    );
  });
}

/** A draft as it will look when sent, in a card headed by where it goes, with its Copy. */
export function DraftCard({
  draft,
  onOpenLink,
}: {
  readonly draft: Draft;
  /** Opens a link the draft holds, by its address. */
  readonly onOpenLink: (address: string) => void;
}) {
  const colors = useColors();
  const keeping = useKeeping();
  const edge = { borderColor: colors.CHIP_EDGE };
  const quiet = { fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED };
  const { subject } = draft;
  const links = draftLinks(draft.runs);

  // Note that iOS lists only the body's words to VoiceOver, never a link inside them, so each link is offered as one of the body's actions, as a line of Markdown offers its own.
  const linkActions =
    links.length === 0
      ? {}
      : {
          accessibilityActions: links.map(({ name, label }) => ({ name, label })),
          onAccessibilityAction: (event: AccessibilityActionEvent) => {
            const link = links.find(({ name }) => name === event.nativeEvent.actionName);

            if (link !== undefined) onOpenLink(link.url);
          },
        };

  return (
    <View style={[styles.card, edge, { backgroundColor: colors.SURFACE }]}>
      <View style={[styles.bar, edge, { backgroundColor: colors.WELL }]}>
        <SymbolView
          name={DRAFT_SYMBOL[draft.kind]}
          size={MARK_SIZE.GLYPH}
          tintColor={colors.TEXT_MUTED}
          accessibilityElementsHidden
        />
        <Text style={[styles.barWords, quiet]}>{DRAFT_WORDS.TITLE[draft.kind]}</Text>
        {keeping === undefined ? null : (
          <CopyPress
            what={DRAFT_WORDS.COPY_WHAT.BODY}
            onPress={() => keeping.copyRich(draftCopy(draft))}
            colors={colors}
          />
        )}
      </View>
      {subject === undefined ? null : (
        <View style={[styles.bar, edge]}>
          <Text style={quiet}>{DRAFT_WORDS.SUBJECT}</Text>
          <Text selectable style={[styles.barWords, { fontSize: PROSE_SIZE, color: colors.TEXT }]}>
            {subject}
          </Text>
          {keeping === undefined ? null : (
            <CopyPress
              what={DRAFT_WORDS.COPY_WHAT.SUBJECT}
              onPress={() => keeping.copyWords(subject)}
              colors={colors}
            />
          )}
        </View>
      )}
      <View style={styles.body}>
        <Text selectable style={{ fontSize: PROSE_SIZE, color: colors.TEXT }} {...linkActions}>
          <DraftRuns runs={draft.runs} onOpenLink={onOpenLink} colors={colors} />
        </Text>
      </View>
    </View>
  );
}
