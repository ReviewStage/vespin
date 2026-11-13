// bar-title.tsx -- a pushed page's title in the system's bar with a quiet line under it, as Mail names a mailbox over how fresh it stands: an agent's name over where it stands.

import { StyleSheet, Text, View } from "react-native";
import { useColors } from "./tokens/colors.js";
import { BAR_TITLE } from "./tokens/type.js";

const styles = StyleSheet.create({
  title: { alignItems: "center" },
});

/**
 * The bar's title view: the page's name in the bar's own words, and under
 * it, where given, a line in the quiet ink, such as an agent's Working or
 * Failed, which stays in view as the page scrolls. Note that it is set as the
 * stack's title view, since the system's own subtitle (iOS 26's
 * `UINavigationItem.subtitle`) isn't one react-native-screens offers, and
 * its words keep the bar's fixed sizes, as the system's title does. With no
 * line it stands as the bare title would.
 */
export function BarTitle({
  title,
  subtitle,
}: {
  readonly title: string;
  readonly subtitle?: string | undefined;
}) {
  const colors = useColors();
  const line = subtitle === undefined || subtitle === "" ? undefined : subtitle;

  return (
    <View
      style={styles.title}
      accessible
      accessibilityRole="header"
      accessibilityLabel={line === undefined ? title : `${title}, ${line}`}
    >
      <Text
        numberOfLines={1}
        allowFontScaling={false}
        style={[BAR_TITLE.SCREEN, { color: colors.TEXT }]}
      >
        {title}
      </Text>
      {line === undefined ? null : (
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={[BAR_TITLE.SUBTITLE, { color: colors.TEXT_MUTED }]}
        >
          {line}
        </Text>
      )}
    </View>
  );
}
