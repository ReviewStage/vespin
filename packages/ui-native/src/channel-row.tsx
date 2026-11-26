// channel-row.tsx -- a Manager's chat drawn as a team channel, as the panel's `ChannelMessage` draws it: who sent a message by their face and name over its words, a thread's replies summed under the message they answer, and the rule over a thread's replies.
//
// Note that it is drawn of React Native views, the faces alone SwiftUI's in a host of their own, because the transcript it stands in is React Native's own list (`AgentTranscript`) and no system piece draws a chat's row.

import type { ManagerFace as ManagerFaceValue } from "@repo/features/manager-face";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useScaledSize } from "./accessibility.js";
import { InlineHost } from "./inline-host.js";
import { Avatar, ManagerFace } from "./marks.js";
import { Press } from "./press.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { ROLE_SIZE } from "./tokens/type.js";
import type { ChatSender, ChatThreadMark } from "./transcript-model.js";

/** A sender's face at a channel row's seat, and how far its words stand past it, as the panel's channel stands its avatars in a gutter; fixed rather than scaled, so a turn's work and what the Manager showed, drawn as rows of their own, line up with the words past it. */
const CHANNEL_FACE = { SIZE: MARK_SIZE.AVATAR, GAP: 8 } as const;

/** How wide a channel row's seat stands, its face and the gap after it, which every line of a run's words starts past. */
export const CHANNEL_SEAT = CHANNEL_FACE.SIZE + CHANNEL_FACE.GAP;

/** How many of a thread's repliers' faces its summary shows, the rest counted in its words alone, as the panel's shows three. */
const REPLIER_FACES = 3;

/** How far the summary's press reaches past its line, above and below, so a short line takes a press across the system's least target. */
const SUMMARY_REACH = { top: 10, bottom: 10 } as const;

const styles = StyleSheet.create({
  seated: { flexDirection: "row", alignItems: "flex-start" },
  seat: { width: CHANNEL_SEAT },
  body: { flex: 1, minWidth: 0, gap: SPACE.TIGHT },
  head: { flexDirection: "row", alignItems: "baseline", gap: SPACE.TIGHT + 2 },
  name: { flexShrink: 1, fontWeight: "600" },
  summary: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6 },
  faces: { flexDirection: "row", gap: 2 },
  rule: { flexDirection: "row", alignItems: "center", gap: SPACE.ROW },
  ruleLine: { flex: 1, height: StyleSheet.hairlineWidth },
});

/** Who a channel's faces are drawn for: the Manager's face, and a person's picture by their account. */
export interface ChannelFaces {
  /** The Manager's face; none where a service older than faces names none, when its letters stand. */
  readonly manager: ManagerFaceValue | undefined;
  /** A person's picture by their account; none where the app holds none, when their letters stand. */
  readonly picture?: ((userId: string | undefined) => string | undefined) | undefined;
}

/** A sender's face at `size`: the Manager's, livelier while it works, or a person's picture or letters, in a SwiftUI host of its own. */
function SenderFace({
  sender,
  faces,
  size,
  working,
}: {
  readonly sender: ChatSender;
  readonly faces: ChannelFaces;
  readonly size: number;
  readonly working: boolean;
}) {
  const face =
    sender.manager && faces.manager !== undefined ? (
      <ManagerFace face={faces.manager} size={size} working={working} />
    ) : (
      <Avatar
        name={sender.name}
        picture={faces.picture?.(sender.userId)}
        id={sender.userId ?? sender.name}
        size={size}
      />
    );

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <InlineHost style={{ width: size, height: size }}>{face}</InlineHost>
    </View>
  );
}

/**
 * One message of a channel: its sender's face in the row's seat and their
 * name in bold with when it was sent (`stamp`) over what it holds, where it
 * opens their run (`opens`); its words alone past the seat where it goes on
 * the run, so a run reads as one block, as the panel's channel stands it.
 */
export function ChannelMessage({
  sender,
  faces,
  opens,
  stamp,
  working = false,
  children,
}: {
  readonly sender: ChatSender;
  readonly faces: ChannelFaces;
  readonly opens: boolean;
  /** When it was sent, as its head says it; none where it is not known. */
  readonly stamp?: string | undefined;
  /** Whether the Manager works on, which its face says. */
  readonly working?: boolean | undefined;
  readonly children: ReactNode;
}) {
  const colors = useColors();

  return (
    <View style={styles.seated}>
      <View style={styles.seat}>
        {opens ? (
          <SenderFace sender={sender} faces={faces} size={CHANNEL_FACE.SIZE} working={working} />
        ) : null}
      </View>
      <View style={styles.body}>
        {opens ? (
          <View style={styles.head} accessibilityRole="header">
            <Text
              numberOfLines={1}
              style={[styles.name, { fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT }]}
            >
              {sender.name}
            </Text>
            {stamp === undefined ? null : (
              <Text style={{ fontSize: ROLE_SIZE.TIME, color: colors.TEXT_MUTED }}>{stamp}</Text>
            )}
          </View>
        ) : null}
        {children}
      </View>
    </View>
  );
}

/**
 * A thread's summary under the message it hangs on: up to three of its
 * repliers' faces and how many replies it holds, in the ink a link stands
 * in, which opens the thread (`onOpen`); none where no one answered it.
 */
export function ThreadReplies({
  thread,
  faces,
  onOpen,
}: {
  readonly thread: ChatThreadMark;
  readonly faces: ChannelFaces;
  readonly onOpen: (root: string) => void;
}) {
  const colors = useColors();
  const faceSize = useScaledSize(MARK_SIZE.WRITER);

  if (thread.replies === 0) return null;

  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={thread.words}
      hitSlop={SUMMARY_REACH}
      style={styles.summary}
      onPress={() => onOpen(thread.root)}
    >
      <View style={styles.faces}>
        {thread.repliers.slice(0, REPLIER_FACES).map((sender) => (
          <SenderFace
            key={sender.manager ? "manager" : (sender.userId ?? sender.name)}
            sender={sender}
            faces={faces}
            size={faceSize}
            working={false}
          />
        ))}
      </View>
      <Text style={{ fontSize: ROLE_SIZE.TIME, fontWeight: "600", color: colors.TEXT }}>
        {thread.words}
      </Text>
    </Press>
  );
}

/** The rule over the first message after the reader's mark of the chat, in copper, saying New at its end, as the panel's chat draws it. */
export function NewRule({ words }: { readonly words: string }) {
  const colors = useColors();

  return (
    <View style={styles.rule}>
      <View style={[styles.ruleLine, { backgroundColor: colors.ACCENT }]} />
      <Text style={{ fontSize: ROLE_SIZE.TIME, fontWeight: "600", color: colors.ACCENT_TEXT }}>
        {words}
      </Text>
    </View>
  );
}

/** The rule under a thread's message on its own page, counting the replies after it, as the panel's thread tab draws it. */
export function ThreadRule({ words }: { readonly words: string }) {
  const colors = useColors();

  return (
    <View style={styles.rule}>
      <Text style={{ fontSize: ROLE_SIZE.TIME, color: colors.TEXT_MUTED }}>{words}</Text>
      <View style={[styles.ruleLine, { backgroundColor: colors.CHIP_EDGE }]} />
    </View>
  );
}
