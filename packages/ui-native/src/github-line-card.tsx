// github-line-card.tsx -- what GitHub said on an agent's pull request, as the transcript's folding card: its head saying who did what to which pull request, opening on their words, each inline comment, and the checks it names.

import {
  CONCLUSION_WORDS,
  type GitHubLineFold,
  githubCheckState,
} from "@repo/features/transcript-lines";
import { SymbolView } from "expo-symbols";
import { StyleSheet, Text, View } from "react-native";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { GLYPH, glyphSymbol, type MarkLook } from "./glyph.js";
import { CopyWordsMenu } from "./held-menu.js";
import { Markdown } from "./markdown.js";
import { Press } from "./press.js";
import { CHECK_LOOK, githubLineLook } from "./pull-request-look.js";
import { toneColor, useColors } from "./tokens/colors.js";
import { MARK_SIZE, RADIUS, SPACE } from "./tokens/space.js";
import { MONOSPACE_FONT, ROLE_SIZE, TEXT_FONT } from "./tokens/type.js";

/** What VoiceOver hears of a card's fold and its press. */
const HEARD = {
  COLLAPSED: "Collapsed",
  HINT: "Shows or hides what GitHub said",
  OPEN_ON_GITHUB: { name: "openOnGitHub", label: "Open on GitHub" },
} as const;

/** How far a card's words stand in from its edge. */
const CARD_PADDING = SPACE.ROW;

const styles = StyleSheet.create({
  card: {
    alignSelf: "stretch",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.CARD,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.ROW - 2,
    minHeight: 28,
    paddingHorizontal: CARD_PADDING,
    paddingVertical: SPACE.TIGHT + 2,
  },
  headWords: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5, minWidth: 0 },
  wrapped: { flexWrap: "wrap" },
  chip: {
    flexShrink: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.TAG,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  body: {
    gap: SPACE.ROW,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: CARD_PADDING,
  },
  comment: { gap: SPACE.TIGHT },
  where: { flexDirection: "row", alignItems: "center", gap: 6 },
  check: { flexDirection: "row", alignItems: "center", gap: SPACE.ROW - 2 },
});

/** A mark in the card's ink for what it says, through the system's symbol view, so a card costs no SwiftUI host. */
function LookGlyph({ look, size }: { readonly look: MarkLook; readonly size: number }) {
  const colors = useColors();

  return (
    <SymbolView
      name={glyphSymbol(look.symbol)}
      size={size}
      tintColor={toneColor(colors, look.tone)}
      accessibilityElementsHidden
    />
  );
}

/** What the card holds once opened: their words, each inline comment under its file and line, then the checks it names, each saying how it ended, as the panel's card lists them. */
function FoldBody({
  fold,
  width,
  repository,
  onOpenLink,
}: {
  readonly fold: GitHubLineFold;
  readonly width: number;
  readonly repository: string | null | undefined;
  readonly onOpenLink: (address: string) => void;
}) {
  const colors = useColors();
  const glyph = useScaledSize(MARK_SIZE.GLYPH);
  const words = width - 2 * CARD_PADDING;

  return (
    <View style={[styles.body, { borderTopColor: colors.CHIP_EDGE }]}>
      {fold.said === "" ? null : (
        <Markdown words={fold.said} repository={repository} onOpenLink={onOpenLink} width={words} />
      )}
      {fold.comments.map((comment, at) => (
        // Note that two comments may share a file and a line, so each is keyed by its place.
        <View key={`${at}`} style={styles.comment}>
          <Press
            onPress={() => onOpenLink(comment.url)}
            accessibilityRole="link"
            style={styles.where}
          >
            <SymbolView
              name={glyphSymbol(GLYPH.FILE)}
              size={glyph}
              tintColor={colors.TEXT_MUTED}
              accessibilityElementsHidden
            />
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 1,
                fontSize: ROLE_SIZE.TIME,
                fontFamily: MONOSPACE_FONT,
                color: colors.TEXT_BODY,
              }}
            >
              {comment.path}
            </Text>
            {comment.line === undefined ? null : (
              <Text
                style={{
                  fontFamily: TEXT_FONT,
                  fontSize: ROLE_SIZE.TIME,
                  color: colors.TEXT_MUTED,
                }}
              >
                L{comment.line}
              </Text>
            )}
          </Press>
          {comment.body === "" ? null : (
            <Markdown
              words={comment.body}
              repository={repository}
              onOpenLink={onOpenLink}
              width={words}
            />
          )}
        </View>
      ))}
      {fold.checks.map((check, at) => (
        // Note that two checks may share a name across Apps, so a row is keyed by its place too.
        <Press
          key={`${at}`}
          disabled={check.url === undefined}
          onPress={() => (check.url === undefined ? undefined : onOpenLink(check.url))}
          accessibilityLabel={`${check.name}, ${CONCLUSION_WORDS[check.conclusion]}`}
          style={styles.check}
        >
          <LookGlyph look={CHECK_LOOK[githubCheckState(check.conclusion)]} size={glyph} />
          <Text
            numberOfLines={1}
            style={{
              flex: 1,
              fontFamily: TEXT_FONT,
              fontSize: ROLE_SIZE.ROW_LINE,
              color: colors.TEXT,
            }}
          >
            {check.name}
          </Text>
          <Text
            style={{
              fontFamily: TEXT_FONT,
              fontSize: ROLE_SIZE.ROW_LINE,
              color: colors.TEXT_MUTED,
            }}
          >
            {CONCLUSION_WORDS[check.conclusion]}
          </Text>
        </Press>
      ))}
    </View>
  );
}

/**
 * What GitHub said on the agent's pull request, as the panel's folding card:
 * the chevron where it folds anything, its mark, who did it, what they did,
 * the pull request's chip, which opens it, and how many inline comments it
 * holds; a press on the head opens it onto what it holds. Closed as it lands,
 * since its head already says what happened, and its body is drawn only once
 * opened, so a long transcript lays out no review it keeps shut. A long press
 * copies the line as the panel's copy reads it.
 */
export function GitHubLineCard({
  fold,
  open,
  copy,
  width,
  repository,
  onToggle,
  onOpenLink,
}: {
  readonly fold: GitHubLineFold;
  readonly open: boolean;
  readonly copy: string;
  /** How wide the card stands, known before it is laid out. */
  readonly width: number;
  readonly repository: string | null | undefined;
  readonly onToggle: () => void;
  /** Opens a link the card names, such as its pull request's page on GitHub. */
  readonly onOpenLink: (address: string) => void;
}) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const glyph = useScaledSize(MARK_SIZE.GLYPH);
  const chevron = useScaledSize(MARK_SIZE.GLYPH - 3);
  // Note that at an accessibility size the head's words wrap rather than cut to a word or two.
  const lines = large ? undefined : 1;
  const openPage = () => onOpenLink(fold.page);

  return (
    <CopyWordsMenu words={copy} width={width}>
      <View
        style={[styles.card, { backgroundColor: colors.SURFACE, borderColor: colors.CHIP_EDGE }]}
      >
        <Press
          disabled={!fold.folds}
          onPress={onToggle}
          accessibilityRole={fold.folds ? "button" : undefined}
          accessibilityState={fold.folds ? { expanded: open } : undefined}
          accessibilityLabel={fold.heard}
          accessibilityValue={fold.folds && !open ? { text: HEARD.COLLAPSED } : undefined}
          accessibilityHint={fold.folds ? HEARD.HINT : undefined}
          accessibilityActions={[HEARD.OPEN_ON_GITHUB]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === HEARD.OPEN_ON_GITHUB.name) openPage();
          }}
          style={styles.head}
        >
          {fold.folds ? (
            <SymbolView
              name={glyphSymbol(open ? GLYPH.UNFOLDED : GLYPH.FOLDED)}
              size={chevron}
              tintColor={colors.TEXT_MUTED}
              style={{ width: glyph, height: glyph }}
              accessibilityElementsHidden
            />
          ) : null}
          <LookGlyph look={githubLineLook(fold.mark)} size={glyph} />
          <View style={[styles.headWords, large ? styles.wrapped : null]}>
            {fold.by === undefined ? null : (
              <Text
                numberOfLines={lines}
                style={{
                  flexShrink: 0,
                  maxWidth: "45%",
                  fontFamily: TEXT_FONT,
                  fontSize: ROLE_SIZE.ROW_LINE,
                  fontWeight: "600",
                  color: colors.TEXT,
                }}
              >
                {fold.by}
              </Text>
            )}
            <Text
              numberOfLines={lines}
              style={{
                flexShrink: 1,
                fontFamily: TEXT_FONT,
                fontSize: ROLE_SIZE.ROW_LINE,
                color: colors.TEXT_MUTED,
              }}
            >
              {fold.does}
            </Text>
            <Press
              onPress={openPage}
              style={[
                styles.chip,
                { backgroundColor: colors.SURFACE, borderColor: colors.CHIP_EDGE },
              ]}
            >
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: TEXT_FONT,
                  fontSize: ROLE_SIZE.TIME,
                  color: colors.TEXT_BODY,
                  fontWeight: "500",
                }}
              >
                {fold.target}
              </Text>
            </Press>
          </View>
          {/* Note that the count gives way first where the head runs out of room, as the panel's fades first. */}
          {fold.count === undefined ? null : (
            <Text
              numberOfLines={lines}
              style={{
                flexShrink: 1000,
                fontFamily: TEXT_FONT,
                fontSize: ROLE_SIZE.ROW_LINE,
                color: colors.TEXT_MUTED,
              }}
            >
              {fold.count}
            </Text>
          )}
        </Press>
        {open ? (
          <FoldBody fold={fold} width={width} repository={repository} onOpenLink={onOpenLink} />
        ) : null}
      </View>
    </CopyWordsMenu>
  );
}
