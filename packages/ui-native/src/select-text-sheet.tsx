// select-text-sheet.tsx -- the sheet a held message's Select text opens: its words, as selectable as a note's, under the sheet's title with Done in its bar, as Messages' and ChatGPT's Select text stands.

import {
  BottomSheet,
  Group,
  Host,
  NavigationStack,
  RNHostView,
  Button as SwiftUIButton,
  Toolbar,
  ToolbarItem,
  VStack,
} from "@expo/ui/swift-ui";
import {
  background,
  navigationBarTitleDisplayMode,
  navigationTitle,
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { StyleSheet, TextInput, View } from "react-native";
import { useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { PROSE_SIZE } from "./tokens/type.js";

/** The sheet's words, as iOS's own Select text names its sheet and closes it. */
const SELECT_WORDS = { TITLE: "Select Text", DONE: "Done" } as const;

const styles = StyleSheet.create({
  page: { flex: 1 },
  words: { flex: 1, padding: SPACE.EDGE, fontSize: PROSE_SIZE },
});

/**
 * The sheet a message's Select text opens over the window: its words whole,
 * where a press and a drag pick any span of them and iOS's own menu copies,
 * looks up, or shares it, as a note's words are picked. Note that they stand
 * in the system's text view held read-only rather than in a line of text,
 * since iOS lets a span of a line of text be picked only through such a
 * view. In dark it draws on the lifted ground, as iOS lifts what it
 * presents. It stands while `words` is given, and goes by Done or a drag
 * down.
 */
export function SelectTextSheet({
  words,
  onDone,
}: {
  readonly words: string | undefined;
  readonly onDone: () => void;
}) {
  const colors = useColors(true);

  return (
    <Host matchContents style={{ position: "absolute" }}>
      <BottomSheet
        isPresented={words !== undefined}
        onIsPresentedChange={(shown) => {
          if (!shown) onDone();
        }}
      >
        <Group
          modifiers={[
            presentationDetents(["large"]),
            presentationDragIndicator("visible"),
            presentationBackground(colors.GROUND),
          ]}
        >
          <NavigationStack modifiers={[tint(colors.TEXT)]}>
            <Toolbar>
              <VStack
                modifiers={[
                  background(colors.GROUND),
                  navigationTitle(SELECT_WORDS.TITLE),
                  navigationBarTitleDisplayMode("inline"),
                ]}
              >
                <RNHostView>
                  <View style={styles.page}>
                    <TextInput
                      value={words ?? ""}
                      editable={false}
                      multiline
                      scrollEnabled
                      style={[styles.words, { color: colors.TEXT }]}
                    />
                  </View>
                </RNHostView>
              </VStack>
              <Toolbar.Content>
                <ToolbarItem placement="confirmationAction">
                  <SwiftUIButton label={SELECT_WORDS.DONE} onPress={onDone} />
                </ToolbarItem>
              </Toolbar.Content>
            </Toolbar>
          </NavigationStack>
        </Group>
      </BottomSheet>
    </Host>
  );
}
