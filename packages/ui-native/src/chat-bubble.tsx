// chat-bubble.tsx -- one message of a chat as Messages draws it: the reader's own at the trailing side in copper, everyone else's at the leading side in the raised fill, a sender's run standing tight with one tail under its last.
//
// Note that it is drawn of plain React Native views, its tail included, rather than a system piece, because neither iOS, SwiftUI, nor the Expo SDK offers a message bubble: a chat's bubble is the app's own content, as Messages' is Apple's.

import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { OnAccentInk, useColors } from "./tokens/colors.js";
import { RADIUS } from "./tokens/space.js";

/** Which side of the chat sent the message: the reader, at the column's trailing side, or anyone else, at its leading side. */
export const CHAT_SIDE = {
  SENT: "sent",
  RECEIVED: "received",
} as const;

type ChatSide = (typeof CHAT_SIDE)[keyof typeof CHAT_SIDE];

/** Where a message stands in its sender's run: alone, or its first, a middle one, or its last. */
export const CHAT_RUN = {
  ALONE: "alone",
  FIRST: "first",
  MIDDLE: "middle",
  LAST: "last",
} as const;

type ChatRun = (typeof CHAT_RUN)[keyof typeof CHAT_RUN];

/** The most of its row a bubble spans, as Messages leaves the far side open. */
export const BUBBLE_SHARE = 0.75;

/** How far a bubble's words stand in from its sides, and from its top and foot, as Messages pads a line of the body style to a 36 pt bubble. */
export const BUBBLE_PADDING = { HORIZONTAL: 12, VERTICAL: 7 } as const;

/**
 * The tail's measure, as Messages curls one out of a bubble's foot: a
 * fill standing half under the bubble's corner and half past its side,
 * rounded where it meets the bubble's foot, and a cut of the ground past
 * the side whose curve carves the tail's inner edge, leaving a tip that
 * reaches about 5 pt past the bubble.
 */
const TAIL = {
  WIDTH: 20,
  HEIGHT: 25,
  RADIUS: 25,
  CUT_HEIGHT: 35,
  CUT_DROP: 6,
  CUT_RADIUS: 18,
} as const;

/** Whether a bubble wears the run's tail: the run's last and a bubble alone do, as Messages tails only the foot of a run. */
const TAILED: Record<ChatRun, boolean> = {
  [CHAT_RUN.ALONE]: true,
  [CHAT_RUN.FIRST]: false,
  [CHAT_RUN.MIDDLE]: false,
  [CHAT_RUN.LAST]: true,
};

const styles = StyleSheet.create({
  bubble: {
    maxWidth: `${BUBBLE_SHARE * 100}%`,
    borderRadius: RADIUS.BUBBLE,
    paddingHorizontal: BUBBLE_PADDING.HORIZONTAL,
    paddingVertical: BUBBLE_PADDING.VERTICAL,
  },
  // Note that the tail is two plain views standing out of the layout, the fill's curl and the ground cutting its inner curve, so it costs no measure and no host of its own.
  tail: { position: "absolute", bottom: 0, width: TAIL.WIDTH, height: TAIL.HEIGHT },
  cut: {
    position: "absolute",
    bottom: -TAIL.CUT_DROP,
    width: TAIL.WIDTH,
    height: TAIL.CUT_HEIGHT,
  },
});

/** Two hex digits of a color's channel, read as a share of 255. */
function channel(hex: string, at: number): number {
  return Number.parseInt(hex.slice(at, at + 2), 16);
}

/**
 * A fill as it stands over `ground`, opaque: the brand's raised fill is
 * translucent, which a tail laid over the bubble's corner would show
 * doubled, so the bubble and its tail are both drawn in the color it reads
 * as on the page.
 */
function overGround(fill: string, ground: string): string {
  if (fill.length !== 9) return fill;
  const alpha = channel(fill, 7) / 255;

  const mixed = [1, 3, 5].map((at) =>
    Math.round(channel(fill, at) * alpha + channel(ground, at) * (1 - alpha))
      .toString(16)
      .padStart(2, "0"),
  );

  return `#${mixed.join("")}`;
}

/** Where a message stands in its run, from whether it joins the message above it and the one below. */
export function chatRunOf(joinsAbove: boolean, joinsBelow: boolean): ChatRun {
  if (!joinsAbove) return joinsBelow ? CHAT_RUN.FIRST : CHAT_RUN.ALONE;

  return joinsBelow ? CHAT_RUN.MIDDLE : CHAT_RUN.LAST;
}

/** The tail a run's last bubble curls out of its foot, toward its own side. */
function BubbleTail({ side, fill }: { readonly side: ChatSide; readonly fill: string }) {
  const colors = useColors();
  const sent = side === CHAT_SIDE.SENT;

  return (
    <>
      <View
        style={[
          styles.tail,
          { backgroundColor: fill },
          sent
            ? { right: -TAIL.WIDTH / 2, borderBottomLeftRadius: TAIL.RADIUS }
            : { left: -TAIL.WIDTH / 2, borderBottomRightRadius: TAIL.RADIUS },
        ]}
      />
      <View
        style={[
          styles.cut,
          { backgroundColor: colors.GROUND },
          sent
            ? { right: -TAIL.WIDTH, borderBottomLeftRadius: TAIL.CUT_RADIUS }
            : { left: -TAIL.WIDTH, borderBottomRightRadius: TAIL.CUT_RADIUS },
        ]}
      />
    </>
  );
}

/**
 * One message's bubble, `children` its words, as Messages draws one: round
 * at every corner, at most `BUBBLE_SHARE` of its row, and, as the last of
 * its sender's run or a bubble alone, curling a tail out of its foot toward
 * its own side. In a Manager's chat (`accent`) the reader's own
 * (`CHAT_SIDE.SENT`) stands in copper with every ink inside it read on
 * copper (`OnAccentInk`), as Messages draws yours in its blue; anyone
 * else's, and the reader's own in an agent's transcript, in the raised fill
 * under the page's ink.
 * It is the one bubble of every chat: a Manager's, and the lines sent to
 * any agent. Where it stands in its row, and the spacing of its run, are
 * its caller's.
 */
export function ChatBubble({
  side,
  run,
  accent = false,
  children,
}: {
  readonly side: ChatSide;
  readonly run: ChatRun;
  /** Whether the reader's own bubble stands in copper, as a Manager's chat draws it; in the raised fill where not, as an agent's transcript draws the lines sent it. */
  readonly accent?: boolean | undefined;
  readonly children: ReactNode;
}) {
  const colors = useColors();
  const copper = accent && side === CHAT_SIDE.SENT;
  const fill = copper ? colors.ACCENT : overGround(colors.FILL_STRONG, colors.GROUND);

  return (
    <View style={[styles.bubble, { backgroundColor: fill }]}>
      {TAILED[run] ? <BubbleTail side={side} fill={fill} /> : null}
      {copper ? <OnAccentInk>{children}</OnAccentInk> : children}
    </View>
  );
}
