// held-menu.tsx -- the menu a long press opens on a picture, a recording, a file, or a message, as iOS's own apps open one: its acts in the system's menu over the thing lifted, and the full-screen viewer's share button holding the same acts.

import { Button, ContextMenu, Host, Image, Menu, RNHostView } from "@expo/ui/swift-ui";
import { accessibilityIdentifier, accessibilityLabel } from "@expo/ui/swift-ui/modifiers";
import { createContext, type ReactElement, type ReactNode, useContext } from "react";
import { StyleSheet } from "react-native";
import { InlineHost } from "./inline-host.js";
import {
  KEEP_ACT,
  KEEP_SYMBOL,
  KEEP_WORDS,
  type KeepAct,
  type Kept,
  keepActs,
} from "./keep-model.js";
import type { SfSymbol } from "./sf-symbol.js";
import { MARK_SIZE } from "./tokens/space.js";

/** What a message's own Copy is called, as the panel's Copy under a message names it. */
const COPY_MESSAGE = "Copy message";

/** What the viewer's share button is heard as. */
const SHARE_LABEL = "Share";

const styles = StyleSheet.create({
  // Note that the menu's host spans the width it stands in, since a host sized by its SwiftUI alone would stand no wider than nothing.
  host: { alignSelf: "stretch" },
});

/** One act of a held thing's menu: its words, its glyph, and what a press does. */
export interface HeldAct {
  readonly label: string;
  readonly symbol: SfSymbol;
  readonly onPress: () => void;
}

/**
 * What the app does with what is held: copies a picture or a text file's
 * words, saves a picture or a recording to Photos, or shares any of them in
 * the system's share sheet; and copies a message's words. The app answers
 * them with the device's own pasteboard, Photos, and share sheet, and says
 * what did not go; nothing here reaches the device.
 */
export interface Keeping {
  readonly keep: (kept: Kept, act: KeepAct) => void;
  readonly copyWords: (words: string) => void;
}

const KeepingDoor = createContext<Keeping | undefined>(undefined);

/** Hands every picture, recording, file, and message under it what the app does with what is held; none offers no menu. */
export function KeepingProvider({
  keeping,
  children,
}: {
  readonly keeping: Keeping;
  readonly children: ReactNode;
}) {
  return <KeepingDoor.Provider value={keeping}>{children}</KeepingDoor.Provider>;
}

/** The acts a kept thing's menu offers, in their order; none where nothing is kept yet, or no app answers them. */
export function useKeptActs(kept: Kept | undefined): readonly HeldAct[] {
  const keeping = useContext(KeepingDoor);

  if (keeping === undefined || kept === undefined) return [];

  return keepActs(kept).map((act) => ({
    label: KEEP_WORDS[act],
    symbol: KEEP_SYMBOL[act],
    onPress: () => keeping.keep(kept, act),
  }));
}

/** A message's Copy, which copies its words as they were written, Markdown and all, as the panel's does; none for a message of no words. */
function useCopyWordsActs(words: string): readonly HeldAct[] {
  const keeping = useContext(KeepingDoor);

  if (keeping === undefined || words.trim() === "") return [];

  return [
    {
      label: COPY_MESSAGE,
      symbol: KEEP_SYMBOL[KEEP_ACT.COPY],
      onPress: () => keeping.copyWords(words),
    },
  ];
}

function HeldActButtons({ acts }: { readonly acts: readonly HeldAct[] }) {
  return acts.map((act) => (
    <Button key={act.label} label={act.label} systemImage={act.symbol} onPress={act.onPress} />
  ));
}

/**
 * SwiftUI content a long press opens its acts on, lifted as the system lifts
 * a held thing, such as a thread's message; the content alone where it
 * offers none.
 */
export function HeldSwiftMenu({
  acts,
  children,
}: {
  readonly acts: readonly HeldAct[];
  readonly children: ReactElement;
}) {
  if (acts.length === 0) return children;

  return (
    <ContextMenu>
      <ContextMenu.Items>
        <HeldActButtons acts={acts} />
      </ContextMenu.Items>
      <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
    </ContextMenu>
  );
}

/**
 * React Native views a long press opens its acts on, as Photos and Messages
 * open one on a picture: SwiftUI's own menu, hosted at the width the views
 * stand in and the height they draw, the views hosted back inside it, so a
 * press still reaches them. The views alone where they offer no act.
 */
export function HeldMenu({
  acts,
  children,
}: {
  readonly acts: readonly HeldAct[];
  readonly children: ReactElement;
}) {
  if (acts.length === 0) return children;

  return (
    <InlineHost matchContents={{ vertical: true }} style={styles.host}>
      <HeldSwiftMenu acts={acts}>
        <RNHostView matchContents={{ vertical: true }}>{children}</RNHostView>
      </HeldSwiftMenu>
    </InlineHost>
  );
}

/** The full-screen viewer's share button: the system's share glyph in white, opening the same acts as the held thing's menu; nothing where it offers none. */
export function HeldActsButton({ acts }: { readonly acts: readonly HeldAct[] }) {
  if (acts.length === 0) return null;

  return (
    <Host matchContents>
      <Menu
        label={
          <Image systemName={KEEP_SYMBOL[KEEP_ACT.SHARE]} size={MARK_SIZE.LEAD + 4} color="white" />
        }
        modifiers={[accessibilityLabel(SHARE_LABEL), accessibilityIdentifier("viewer-share")]}
      >
        <HeldActButtons acts={acts} />
      </Menu>
    </Host>
  );
}

/** A message's React Native views, whose long press offers Copy message; the views alone for a message of no words. */
export function CopyWordsMenu({
  words,
  children,
}: {
  readonly words: string;
  readonly children: ReactElement;
}) {
  return <HeldMenu acts={useCopyWordsActs(words)}>{children}</HeldMenu>;
}

/** A message drawn in SwiftUI, such as a thread's, whose long press offers Copy message; the message alone where it has no words. */
export function CopyWordsSwiftMenu({
  words,
  children,
}: {
  readonly words: string;
  readonly children: ReactElement;
}) {
  return <HeldSwiftMenu acts={useCopyWordsActs(words)}>{children}</HeldSwiftMenu>;
}
