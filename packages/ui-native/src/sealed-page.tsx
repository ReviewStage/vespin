// sealed-page.tsx -- a page an agent showed, drawn whole in the app's one web view: its HTML handed in, sealed from every network and every navigation, in the brand's theme.

import {
  PAGE_THEME_SCHEME,
  PAGE_THEME_VARIABLE,
  type PageTheme,
  type PageThemeVariable,
} from "@repo/features/page-theme";
import { sealedPageDocument } from "@repo/features/sealed-page";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Linking,
  StyleSheet,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { type BrandColors, useColors } from "./tokens/colors.js";
import { TEXT_SIZE } from "./tokens/type.js";

/** The address a page handed in as HTML stands at, the one place it may stand. */
const HANDED_IN = "about:blank";

/** The web view's whitelist: every address, so that each navigation reaches `staysSealed`. */
const EVERY_ADDRESS = ["*"];

/** The charts' inks a page reads, as the panel's palette names them in both themes. */
const CHART_INKS = ["#2f9bd8", "#8b6cd9", "#2e9e6a", "#cd5394", "#868b94"] as const;

/** The system's faces, which a page reads as the brand's. */
const FONT = {
  SANS: "-apple-system, system-ui, sans-serif",
  MONO: "ui-monospace, Menlo, monospace",
} as const;

/** The room a page stands in from the screen's edges, as the panel keeps it in a narrow tab. */
const PAGE_INSET = "16px";

/** How long the loading ground takes to give way to the page once it has loaded, as a cross-fade. */
const REVEAL_MS = 200;

/** The empty page WebKit starts on while the page's HTML is still read, named by `title` so its load is told from the page's own. */
function startingDocument(title: string): string {
  return `<title>${title}</title>`;
}

/** What the loading ground is heard as while it stands, as Safari's own page is heard while it loads. */
const LOADING_HEARD = "Loading";

const styles = StyleSheet.create({
  page: { flex: 1 },
  loading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
});

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
 * The script that scales every word on the page by the reader's text size,
 * run before the page's own: WebKit's text size adjustment, which grows the
 * page's words whatever size its own styles set them at, the theme's or a
 * fixed one, and never twice, since the theme's size stands at the body's.
 * Note that a web view takes no Dynamic Type of its own, and that the root
 * element may not stand yet as the script runs, so it waits for it.
 */
function textScaleScript(fontScale: number): string {
  const percent = `${String(Math.round(fontScale * 100))}%`;

  return `(function () {
  var scale = function () { document.documentElement.style.webkitTextSizeAdjust = ${JSON.stringify(percent)}; };
  if (document.documentElement) scale(); else document.addEventListener("DOMContentLoaded", scale);
})();
true;`;
}

/**
 * Whether the web view may stand at an address: the page handed in alone.
 * Note that a link the reader presses out of the page opens in Safari
 * instead, as the panel opens a page's links outside its frame, and every
 * other navigation, a script's included, is refused. Every navigation is
 * asked here, because react-native-webview opens an address its
 * `originWhitelist` refuses with `Linking.openURL` without asking, which
 * would let a page's script open any address or app with no press.
 */
function staysSealed(request: WebViewNavigation): boolean {
  if (request.url === HANDED_IN) return true;

  if (request.navigationType === "click" && /^https?:\/\//u.test(request.url)) {
    Linking.openURL(request.url).catch((cause: unknown) =>
      console.error("The page's link did not open.", cause),
    );
  }

  return false;
}

type SealedPageProps = {
  /** The page's HTML, as the agent wrote it; none while it is still read. */
  readonly html: string | undefined;
  /** What the page is, heard in its place. */
  readonly title: string;
  /** Told once the page has first loaded, as its loading ground starts to fade, so its opener can count how long it took. */
  readonly onLoaded?: (() => void) | undefined;
};

/**
 * The system's spinner on the brand's ground over a page until its web view
 * has loaded, then fading to the page, as Safari's own views stand while
 * they load, rather than a blank body while WebKit starts cold. While it
 * stands it is heard as one element, Loading, as the system's progress
 * indicator is, and the page under it is not heard at all, so its words
 * reach VoiceOver, and a flow waiting for them, only once they are seen.
 */
function PageLoading({
  loaded,
  onGone,
}: {
  readonly loaded: boolean;
  readonly onGone: () => void;
}) {
  const colors = useColors();
  const [shown] = useState(() => new Animated.Value(1));

  // Note that the fade runs once, the first time the page loads, since a later load of the same view redraws a page already standing.
  useEffect(() => {
    if (!loaded) return;

    Animated.timing(shown, { toValue: 0, duration: REVEAL_MS, useNativeDriver: true }).start(
      onGone,
    );
  }, [loaded, shown, onGone]);

  return (
    <Animated.View
      pointerEvents="none"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={LOADING_HEARD}
      style={[styles.loading, { backgroundColor: colors.GROUND, opacity: shown }]}
    >
      <ActivityIndicator color={colors.TEXT_MUTED} />
    </Animated.View>
  );
}

/** The page at one text size, with its loading ground until it first loads. */
function SealedPageAt({
  html,
  title,
  onLoaded,
  fontScale,
}: SealedPageProps & { readonly fontScale: number }) {
  const colors = useColors();
  const dark = useColorScheme() === "dark";
  const [loaded, setLoaded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const reveal = useCallback(() => setRevealed(true), []);
  const starting = `vespin-starting-${useId()}`;
  // Note that the last HTML handed in stands while a later version is read, so a page followed to its newest never gives way to the empty page it started on.
  const [drawn, setDrawn] = useState(html);

  if (html !== undefined && html !== drawn) setDrawn(html);

  const document = useMemo(
    () => sealedPageDocument(drawn ?? startingDocument(starting), themeOf(colors, dark)),
    [drawn, starting, colors, dark],
  );

  // Note that the empty page WebKit starts on ends its load too, maybe only once the page's HTML has landed, so it is told apart by its title and only the page itself ends the ground.
  const loadEnded = (event: { readonly nativeEvent: { readonly title: string } }) => {
    if (drawn === undefined || event.nativeEvent.title === starting) return;
    setLoaded(true);
    onLoaded?.();
  };

  // Note that the web view is hidden from accessibility until the ground has gone, because WebKit hands its words to accessibility before they are drawn.
  // Note that a failed load ends the ground too, since react-native-webview calls `onLoadEnd` on an error, and so does WebKit's page process ending before it loaded, which calls neither, so the ground never stands for good.
  return (
    <View style={styles.page}>
      <WebView
        source={{ html: document }}
        injectedJavaScriptBeforeContentLoaded={textScaleScript(fontScale)}
        originWhitelist={EVERY_ADDRESS}
        onShouldStartLoadWithRequest={staysSealed}
        onLoadEnd={loadEnded}
        onContentProcessDidTerminate={() => setLoaded(true)}
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
        accessibilityElementsHidden={!revealed}
        importantForAccessibility={revealed ? "auto" : "no-hide-descendants"}
      />
      {revealed ? null : <PageLoading loaded={loaded} onGone={reveal} />}
    </View>
  );
}

/**
 * A page drawn whole in a web view of its own, the app's one: its HTML
 * handed in with the policy that seals it (`@repo/features/sealed-page`),
 * so it fetches, frames, and loads nothing, and stays where it was handed
 * in; its scripts run, so a chart draws and a table sorts. It reads the
 * brand's theme in the window's scheme at the reader's text size, and is
 * drawn anew as either changes. Until it first loads, the system's spinner
 * stands over it, heard as Loading in the page's place (`PageLoading`).
 * Note that the web view is drawn before the HTML is read, on an empty page
 * of its own, so that WebKit, which starts cold, starts while the page is
 * still read rather than after it, and the page draws the sooner once it
 * lands.
 */
export function SealedPage({ html, title, onLoaded }: SealedPageProps) {
  const { fontScale } = useWindowDimensions();

  // Note that the page is drawn anew at a new text size, since its script runs once, before the page, and so waits on its load again.
  return (
    <SealedPageAt
      key={fontScale}
      html={html}
      title={title}
      onLoaded={onLoaded}
      fontScale={fontScale}
    />
  );
}
