// share-bar.tsx -- the share page's bar in the app: its title, the system's search field stacked under it, and the system's ✕, through the app's native stack.

import { SHARE_PAGE_WORDS } from "@repo/features/ios-share-page-model";
import { GLYPH, glyphSymbol, useColors } from "@repo/ui-native";
import { Stack } from "expo-router";
import { useMemo } from "react";
import type { SharePageBarProps } from "./share-page.js";

/** The page's bar in the app's stack: its title, the system's search field under it, and the system's ✕. */
export function StackShareBar({ onSearch, onCancel }: SharePageBarProps) {
  const colors = useColors();

  // Note that the options are made once, because the stack sets a screen's options again whenever a new object comes.
  const options = useMemo(
    () => ({
      headerShown: true,
      title: SHARE_PAGE_WORDS.TITLE,
      headerTintColor: colors.TEXT,
      headerShadowVisible: false,
      contentStyle: { backgroundColor: colors.GROUND },
    }),
    [colors],
  );

  return (
    <>
      {/* Note that the field stands open under the title, rather than behind a button, since searching is how a place beyond Recent is found. */}
      <Stack.Screen options={options}>
        <Stack.SearchBar
          placeholder={SHARE_PAGE_WORDS.SEARCH}
          placement="stacked"
          allowToolbarIntegration={false}
          onChangeText={(event) => onSearch(event.nativeEvent.text)}
          onCancelButtonPress={() => onSearch("")}
        />
      </Stack.Screen>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.CLOSE)}
          accessibilityLabel={SHARE_PAGE_WORDS.CANCEL}
          onPress={onCancel}
        >
          {SHARE_PAGE_WORDS.CANCEL}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}
