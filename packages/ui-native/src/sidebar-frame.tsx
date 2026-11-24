// sidebar-frame.tsx -- an iPad's window with its own sidebar standing beside the tabs, so every page, a pushed one included, keeps it beside it, sliding away as it folds.

import { type ReactNode, useState } from "react";
import { LayoutAnimation, StyleSheet, View } from "react-native";
import { useReduceMotion } from "./accessibility.js";

/** How wide the sidebar stands, as the panel's sidebar stands beside its pages. */
const SIDEBAR_WIDTH = 300;

const styles = StyleSheet.create({
  frame: { flex: 1, flexDirection: "row" },
  // Note that the sidebar's own width never changes as it folds, only the room it is given, so its rows slide away whole rather than squeezing as they go.
  room: { overflow: "hidden" },
  sidebar: { flex: 1, width: SIDEBAR_WIDTH },
  page: { flex: 1 },
});

/**
 * The window's frame on an iPad: its own sidebar (`SidebarPane`) at the
 * leading edge, and the tabs beside it, whose pages, pushed ones included,
 * keep the sidebar beside them, as the panel's pages and Mail's messages do.
 * Folded, the sidebar gives its room to the page, sliding away on the
 * system's ease unless the reader reduces motion, and stays mounted, so its
 * list keeps its place and nothing under the tabs mounts again.
 */
export function SidebarFrame({
  sidebar,
  shown,
  children,
}: {
  readonly sidebar: ReactNode;
  readonly shown: boolean;
  readonly children: ReactNode;
}) {
  const reduceMotion = useReduceMotion();
  const [was, setWas] = useState(shown);

  // Note that the slide is asked for as the render that moves it begins, because React Native's layout animation takes the next layout it commits, and an effect runs after that one.
  if (was !== shown) {
    setWas(shown);

    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  }

  return (
    <View style={styles.frame}>
      <View style={[styles.room, { width: shown ? SIDEBAR_WIDTH : 0 }]}>
        <View style={styles.sidebar}>{sidebar}</View>
      </View>
      <View style={styles.page}>{children}</View>
    </View>
  );
}
