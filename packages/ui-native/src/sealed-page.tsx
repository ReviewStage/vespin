// sealed-page.tsx -- a page an agent showed, drawn whole in the app's one web view: its HTML handed in, sealed from every network and every navigation, in the brand's theme.

import {
  PAGE_THEME_SCHEME,
  PAGE_THEME_VARIABLE,
  type PageTheme,
  type PageThemeVariable,
} from "@repo/features/page-theme";
import { sealedPageDocument } from "@repo/features/sealed-page";
import { useMemo } from "react";
import { Linking, StyleSheet, useColorScheme } from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { type BrandColors, useColors } from "./tokens/colors.js";
import { TEXT_SIZE } from "./tokens/type.js";

/** The address a page handed in as HTML stands at, the one place it may stand. */
const HANDED_IN = "about:blank";

/** The charts' inks a page reads, as the panel's palette names them in both themes. */
const CHART_INKS = ["#2f9bd8", "#8b6cd9", "#2e9e6a", "#cd5394", "#868b94"] as const;

/** The system's faces, which a page reads as the brand's. */
const FONT = {
  SANS: "-apple-system, system-ui, sans-serif",
  MONO: "ui-monospace, Menlo, monospace",
} as const;

/** The room a page stands in from the screen's edges, as the panel keeps it in a narrow tab. */
const PAGE_INSET = "16px";

const styles = StyleSheet.create({ page: { flex: 1 } });

/** The theme a page reads, in the brand's colors for the window's scheme, as the panel hands a page its own. */
function themeOf(colors: BrandColors, dark: boolean): PageTheme {
  const [chart1, chart2, chart3, chart4, chart5] = CHART_INKS;
  const variables: Record<PageThemeVariable, string> = {
    [PAGE_THEME_VARIABLE.BACKGROUND]: colors.GROUND,
    [PAGE_THEME_VARIABLE.FOREGROUND]: colors.TEXT,
    [PAGE_THEME_VARIABLE.MUTED_FOREGROUND]: colors.TEXT_MUTED,
    [PAGE_THEME_VARIABLE.SURFACE]: colors.SURFACE,
    [PAGE_THEME_VARIABLE.WELL]: colors.WELL,
    [PAGE_THEME_VARIABLE.BORDER]: colors.CHIP_EDGE,
    [PAGE_THEME_VARIABLE.BORDER_STRONG]: colors.TEXT_MUTED,
    [PAGE_THEME_VARIABLE.ACCENT]: colors.ACCENT,
    [PAGE_THEME_VARIABLE.ACCENT_TEXT]: colors.ACCENT_TEXT,
    [PAGE_THEME_VARIABLE.SUCCESS]: colors.COMPLETE,
    [PAGE_THEME_VARIABLE.WARNING]: colors.ATTENTION,
    [PAGE_THEME_VARIABLE.DANGER]: colors.DANGER,
    [PAGE_THEME_VARIABLE.CHART_1]: chart1,
    [PAGE_THEME_VARIABLE.CHART_2]: chart2,
    [PAGE_THEME_VARIABLE.CHART_3]: chart3,
    [PAGE_THEME_VARIABLE.CHART_4]: chart4,
    [PAGE_THEME_VARIABLE.CHART_5]: chart5,
    [PAGE_THEME_VARIABLE.FONT_SANS]: FONT.SANS,
    [PAGE_THEME_VARIABLE.FONT_MONO]: FONT.MONO,
    [PAGE_THEME_VARIABLE.TEXT_SIZE]: `${String(TEXT_SIZE.BODY)}px`,
    [PAGE_THEME_VARIABLE.TEXT_LEADING]: "1.5",
    [PAGE_THEME_VARIABLE.RADIUS]: "10px",
    [PAGE_THEME_VARIABLE.READING_WIDTH]: "100%",
  };
  return {
    scheme: dark ? PAGE_THEME_SCHEME.DARK : PAGE_THEME_SCHEME.LIGHT,
    variables,
    inset: PAGE_INSET,
    narrowInset: PAGE_INSET,
  };
}

/**
 * Whether the web view may stand at an address: the page handed in alone.
 * Note that a link the reader presses out of the page opens in Safari
 * instead, as the panel opens a page's links outside its frame, and every
 * other navigation, a script's included, is refused.
 */
function staysSealed(request: WebViewNavigation): boolean {
  if (request.url === HANDED_IN) return true;
  if (request.navigationType === "click" && /^https?:\/\//u.test(request.url)) {
    Linking.openURL(request.url).catch((error: unknown) =>
      console.error("The page's link did not open.", error),
    );
  }
  return false;
}

type SealedPageProps = {
  /** The page's HTML, as the agent wrote it. */
  readonly html: string;
  /** What the page is, heard in its place. */
  readonly title: string;
};

/**
 * A page drawn whole in a web view of its own, the app's one: its HTML
 * handed in with the policy that seals it (`@repo/features/sealed-page`),
 * so it fetches, frames, and loads nothing, and stays where it was handed
 * in; its scripts run, so a chart draws and a table sorts. It reads the
 * brand's theme in the window's scheme, and is drawn anew as the scheme
 * flips.
 */
export function SealedPage({ html, title }: SealedPageProps) {
  const colors = useColors();
  const dark = useColorScheme() === "dark";
  const document = useMemo(
    () => sealedPageDocument(html, themeOf(colors, dark)),
    [html, colors, dark],
  );
  return (
    <WebView
      source={{ html: document }}
      originWhitelist={[HANDED_IN]}
      onShouldStartLoadWithRequest={staysSealed}
      javaScriptEnabled
      domStorageEnabled={false}
      cacheEnabled={false}
      incognito
      allowsLinkPreview={false}
      allowFileAccess={false}
      allowsInlineMediaPlayback
      setSupportMultipleWindows={false}
      contentInsetAdjustmentBehavior="automatic"
      style={[styles.page, { backgroundColor: colors.GROUND }]}
      accessibilityLabel={title}
    />
  );
}
