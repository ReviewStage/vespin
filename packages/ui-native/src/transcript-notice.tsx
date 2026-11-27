// transcript-notice.tsx -- a quiet notice an agent's transcript keeps between its stretches of work, as the panel draws each: a line where the session was compacted, cleared, or moved, or where its goal moved; a card where the agent lost its connection; a card that folds a goal's verdict; and the warning card where it reached its usage limit, offering Use reset on a pause.

import { SymbolView } from "expo-symbols";
import { StyleSheet, Text, View } from "react-native";
import { useAccessibilitySize, useScaledSize } from "./accessibility.js";
import { BUTTON_LOOK, BUTTON_SIZE, Button } from "./button.js";
import { GLYPH, type Glyph, glyphSymbol } from "./glyph.js";
import { InlineHost } from "./inline-host.js";
import { Markdown } from "./markdown.js";
import { NoteLine } from "./note-line.js";
import { Press } from "./press.js";
import { toneColor, useColors } from "./tokens/colors.js";
import { MARK_SIZE, RADIUS, SPACE } from "./tokens/space.js";
import { STATUS_TONE } from "./tokens/status-tone.js";
import { ROLE_SIZE } from "./tokens/type.js";
import {
  NOTICE_MARK,
  type NoticeMark,
  TRANSCRIPT_NOTICE,
  type TranscriptNotice,
} from "./transcript-model.js";

/** What VoiceOver hears of a goal card's fold. */
const HEARD = {
  COLLAPSED: "Collapsed",
  HINT: "Shows or hides why",
} as const;

/** How far a card's words stand in from its edge. */
const CARD_PADDING = SPACE.ROW;

/** The glyph each notice's line leads with, the panel's own for it. */
const NOTICE_GLYPH = {
  [NOTICE_MARK.COMPACTED]: GLYPH.COMPACTED,
  [NOTICE_MARK.NEW_SESSION]: GLYPH.NEW_SESSION,
  [NOTICE_MARK.MOVED]: GLYPH.MOVE,
  [NOTICE_MARK.GOAL]: GLYPH.GOAL,
  [NOTICE_MARK.GOAL_MET]: GLYPH.GOAL_MET,
  [NOTICE_MARK.GOAL_PAUSED]: GLYPH.PAUSE,
  [NOTICE_MARK.GOAL_RESUMED]: GLYPH.PLAY,
} as const satisfies Record<NoticeMark, Glyph>;

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
  lost: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: SPACE.ROW,
    padding: CARD_PADDING,
  },
  lostWords: { flex: 1, gap: 2 },
  limitPress: { alignSelf: "flex-start", marginTop: SPACE.TIGHT },
  body: { borderTopWidth: StyleSheet.hairlineWidth, padding: CARD_PADDING },
});

/** Where the agent lost the connection to its model's provider: the loss, then that it waits or when it came back, its glyph in the working tone while it waits, as the panel's card says it. */
function ConnectionLostCard({
  words,
  caption,
  waiting,
}: {
  readonly words: string;
  readonly caption: string;
  readonly waiting: boolean;
}) {
  const colors = useColors();
  const glyph = useScaledSize(MARK_SIZE.GLYPH);

  return (
    <View
      accessible
      accessibilityLabel={`${words}. ${caption}`}
      style={[
        styles.card,
        styles.lost,
        { backgroundColor: colors.SURFACE, borderColor: colors.CHIP_EDGE },
      ]}
    >
      <SymbolView
        name={glyphSymbol(GLYPH.CONNECTION_LOST)}
        size={glyph}
        tintColor={toneColor(colors, waiting ? STATUS_TONE.WORKING : STATUS_TONE.NEUTRAL)}
        accessibilityElementsHidden
      />
      <View style={styles.lostWords}>
        <Text style={{ fontSize: ROLE_SIZE.ROW_LINE, fontWeight: "500", color: colors.TEXT }}>
          {words}
        </Text>
        <Text style={{ fontSize: ROLE_SIZE.TIME, color: colors.TEXT_MUTED }}>{caption}</Text>
      </View>
    </View>
  );
}

/** A reset credit a usage limit's pause offers, as the screen's press stands: its words, whether a spend is under way, and the press that asks first. */
export interface UsageLimitReset {
  readonly words: string;
  /** What the press says while a spend is under way. */
  readonly running: string;
  readonly busy: boolean;
  readonly use: () => void;
}

/**
 * Where the agent reached its usage limit, as the panel's warning card: the
 * clock in the attention tone, the limit reached, what comes next where it
 * says (a worker's says its title alone), and Use reset where a pause
 * offers a credit on the agent's plan.
 */
function UsageLimitCard({
  title,
  next,
  reset,
}: {
  readonly title: string;
  readonly next: string | undefined;
  readonly reset: UsageLimitReset | undefined;
}) {
  const colors = useColors();
  const glyph = useScaledSize(MARK_SIZE.GLYPH);

  return (
    <View
      style={[
        styles.card,
        styles.lost,
        { backgroundColor: colors.SURFACE, borderColor: colors.CHIP_EDGE },
      ]}
    >
      <SymbolView
        name={glyphSymbol(GLYPH.TIME)}
        size={glyph}
        tintColor={toneColor(colors, STATUS_TONE.ATTENTION)}
        accessibilityElementsHidden
      />
      <View style={styles.lostWords}>
        <View accessible accessibilityLabel={next === undefined ? title : `${title}. ${next}`}>
          <Text style={{ fontSize: ROLE_SIZE.ROW_LINE, fontWeight: "500", color: colors.TEXT }}>
            {title}
          </Text>
          {next === undefined ? null : (
            <Text style={{ fontSize: ROLE_SIZE.TIME, color: colors.TEXT_MUTED }}>{next}</Text>
          )}
        </View>
        {reset === undefined ? null : (
          <View style={styles.limitPress}>
            <InlineHost matchContents>
              <Button
                label={reset.busy ? reset.running : reset.words}
                look={BUTTON_LOOK.BORDERED}
                size={BUTTON_SIZE.SMALL}
                disabled={reset.busy}
                onPress={reset.use}
              />
            </InlineHost>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * A verdict on the goal, or another end of it, as the panel's card: the
 * chevron where its reason folds, the goal's glyph (blocked's where the
 * checker judged it can never hold), what happened, the reason's first line,
 * and the turn it came on; a press on the head opens the reason whole.
 * Closed as it lands, its head already saying what happened.
 */
function GoalCard({
  notice,
  width,
  repository,
  onToggle,
  onOpenLink,
}: {
  readonly notice: Extract<TranscriptNotice, { kind: typeof TRANSCRIPT_NOTICE.GOAL_CARD }>;
  readonly width: number;
  readonly repository: string | null | undefined;
  readonly onToggle: () => void;
  readonly onOpenLink: (address: string) => void;
}) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const glyph = useScaledSize(MARK_SIZE.GLYPH);
  const chevron = useScaledSize(MARK_SIZE.GLYPH - 3);
  const folds = notice.reason !== undefined;
  const lines = large ? undefined : 1;

  return (
    <View style={[styles.card, { backgroundColor: colors.SURFACE, borderColor: colors.CHIP_EDGE }]}>
      <Press
        disabled={!folds}
        onPress={onToggle}
        accessibilityRole={folds ? "button" : undefined}
        accessibilityState={folds ? { expanded: notice.open } : undefined}
        accessibilityLabel={notice.words}
        accessibilityValue={
          folds && !notice.open
            ? { text: [notice.turn, HEARD.COLLAPSED].filter(Boolean).join(", ") }
            : notice.turn === undefined
              ? undefined
              : { text: notice.turn }
        }
        accessibilityHint={folds ? HEARD.HINT : undefined}
        style={styles.head}
      >
        {folds ? (
          <SymbolView
            name={glyphSymbol(notice.open ? GLYPH.UNFOLDED : GLYPH.FOLDED)}
            size={chevron}
            tintColor={colors.TEXT_MUTED}
            style={{ width: glyph, height: glyph }}
            accessibilityElementsHidden
          />
        ) : null}
        <SymbolView
          name={glyphSymbol(notice.blocked ? GLYPH.GOAL_BLOCKED : GLYPH.GOAL)}
          size={glyph}
          tintColor={colors.TEXT_MUTED}
          accessibilityElementsHidden
        />
        <Text
          numberOfLines={lines}
          style={{ flexShrink: 0, fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT_MUTED }}
        >
          {notice.words}
        </Text>
        <Text
          numberOfLines={1}
          style={{ flex: 1, fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT }}
        >
          {notice.open ? "" : (notice.reason ?? "")}
        </Text>
        {notice.turn === undefined ? null : (
          <Text style={{ fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT_MUTED }}>
            {notice.turn}
          </Text>
        )}
      </Press>
      {notice.open && notice.reason !== undefined ? (
        <View style={[styles.body, { borderTopColor: colors.CHIP_EDGE }]}>
          <Markdown
            words={notice.reason}
            repository={repository}
            onOpenLink={onOpenLink}
            width={width - 2 * CARD_PADDING}
          />
        </View>
      ) : null}
    </View>
  );
}

/** A notice as the panel draws it, in the transcript's row. */
export function NoticeRow({
  notice,
  width,
  repository,
  reset,
  onToggle,
  onOpenLink,
}: {
  readonly notice: TranscriptNotice;
  /** How wide the row's words stand, known before it is laid out. */
  readonly width: number;
  readonly repository: string | null | undefined;
  /** The reset credit the agent's plan offers, which a usage limit's pause still standing draws as its press; none where it offers none. */
  readonly reset?: UsageLimitReset | undefined;
  /** Opens or closes a goal card's reason. */
  readonly onToggle: () => void;
  readonly onOpenLink: (address: string) => void;
}) {
  const colors = useColors();

  switch (notice.kind) {
    case TRANSCRIPT_NOTICE.LINE:
      return (
        <NoteLine
          glyph={NOTICE_GLYPH[notice.mark]}
          words={notice.words}
          // Note that a met goal's tick stands in the complete tone, as the panel's does.
          glyphInk={
            notice.mark === NOTICE_MARK.GOAL_MET
              ? toneColor(colors, STATUS_TONE.COMPLETE)
              : undefined
          }
        />
      );
    case TRANSCRIPT_NOTICE.CONNECTION_LOST:
      return (
        <ConnectionLostCard
          words={notice.words}
          caption={notice.caption}
          waiting={notice.waiting}
        />
      );
    case TRANSCRIPT_NOTICE.USAGE_LIMIT:
      return (
        <UsageLimitCard
          title={notice.title}
          next={notice.next}
          reset={notice.pause ? reset : undefined}
        />
      );
    case TRANSCRIPT_NOTICE.GOAL_CARD:
      return (
        <GoalCard
          notice={notice}
          width={width}
          repository={repository}
          onToggle={onToggle}
          onOpenLink={onOpenLink}
        />
      );
  }
}
