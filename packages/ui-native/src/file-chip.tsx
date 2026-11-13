// file-chip.tsx -- a file a message carried that is neither a picture nor a video, such as a PDF: its chip after the message's words, naming it and its size, which opens a PDF full screen in a web view and any other file in the system's share sheet, and whose long press offers Share and, for a text file, Copy.

import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { ActivityIndicator, Linking, Modal, Share, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewNavigation } from "react-native-webview";
import { useAccessibilitySize } from "./accessibility.js";
import { GLYPH, type Glyph, glyphSymbol } from "./glyph.js";
import { HeldMenu, useKeptActs } from "./held-menu.js";
import { KEPT_KIND } from "./keep-model.js";
import { Press } from "./press.js";
import { useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, RADIUS, SPACE } from "./tokens/space.js";
import { TEXT_SIZE } from "./tokens/type.js";

/** The type a PDF is read as, which its chip names as a PDF. */
const PDF_TYPE = "application/pdf";

/** The glyph a file's chip leads with, as the panel's: a page of words for a PDF or a text file, a blank page for any other. */
const FILE_SYMBOL = {
  DOCUMENT: GLYPH.FILE_TEXT,
  OTHER: GLYPH.FILE,
} as const satisfies Record<string, Glyph>;

/** What a file's chip and its viewer say. */
const FILE_WORDS = {
  /** A file whose type names no extension. */
  FILE: "File",
  PDF: "PDF",
  OPENS: "Opens the file",
  SHARES: "Shares the file",
  DONE: "Done",
  SHARE: "Share",
  CANNOT_SHOW: "This file can't be shown here. Share it to open it in another app.",
} as const;

/** The longest extension a chip names a file's kind by, past which it says File. */
const MAX_EXTENSION = 5;

/** The address a PDF's page links to, which opens in Safari rather than in the viewer. */
const WEB_ADDRESS = /^https?:\/\//u;

/** The scheme of an address on the device, the file's own. */
const FILE_ADDRESS = "file://";

/** What the viewer's page stands as to a flow that drives the app, once the PDF has loaded and is drawn. */
const FILE_VIEWER_ID = "file-viewer";

/** The web view's whitelist: every address, so that each navigation reaches `staysOnFile`. */
const EVERY_ADDRESS = ["*"];

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    minHeight: PRESS_SIZE,
    gap: SPACE.ROW,
    paddingHorizontal: SPACE.ROW + 2,
    paddingVertical: SPACE.TIGHT * 2,
    borderRadius: RADIUS.TAG * 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  words: { flexShrink: 1, gap: 1 },
  facts: { flexDirection: "row", flexWrap: "wrap", columnGap: SPACE.ROW - 2 },
  viewer: { flex: 1 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.ROW,
    paddingHorizontal: SPACE.EDGE,
    paddingBottom: SPACE.TIGHT * 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barPress: { minWidth: PRESS_SIZE, minHeight: PRESS_SIZE, justifyContent: "center" },
  barEnd: { alignItems: "flex-end" },
  barTitle: { flex: 1, textAlign: "center" },
  page: { flex: 1 },
  cannot: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACE.PAGE },
  loading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
});

/** A file's kind as its chip names it: PDF, its extension in capitals, or File where it has none to name. */
function kindOf(name: string, mediaType: string): string {
  if (mediaType === PDF_TYPE) return FILE_WORDS.PDF;
  const dot = name.lastIndexOf(".");
  const extension = dot <= 0 ? "" : name.slice(dot + 1);

  return extension === "" || extension.length > MAX_EXTENSION
    ? FILE_WORDS.FILE
    : extension.toUpperCase();
}

/** Whether a file is a PDF, the one kind the viewer draws. */
function isPdf(mediaType: string): boolean {
  return mediaType === PDF_TYPE;
}

/** Whether a file is drawn as a page of words: a PDF or a text file. */
function isDocument(mediaType: string): boolean {
  return mediaType === PDF_TYPE || mediaType.startsWith("text/");
}

/** Opens the system's share sheet on the file, which saves it to Files or opens it in another app. */
function shareFile(source: string, name: string): void {
  Share.share({ url: source, title: name }).catch((cause: unknown) =>
    console.error("The file's share sheet did not open.", cause),
  );
}

type FileViewerProps = {
  /** The file's address on the device, under the app's caches. */
  readonly source: string;
  /** The file's name, in the viewer's bar. */
  readonly name: string;
  readonly visible: boolean;
  readonly onClose: () => void;
};

/**
 * A PDF full screen: its name in a bar with Done and Share, and its pages
 * under it in a web view, drawn as Safari draws them, scrolled and zoomed by
 * the reader. Note that the web view stands on the file alone: a link
 * pressed in the PDF opens in Safari, and every other navigation is
 * refused, since react-native-webview opens an address its whitelist
 * refuses without asking. Only a PDF is handed it, cached under its `.pdf`
 * extension, because WebKit draws a file by its extension, and any other
 * file, an HTML one among them, would be drawn as a page that loads what it
 * names from the web. While WebKit reads the PDF the system's spinner stands
 * over the page, as Photos stands one, and a PDF the web view cannot draw
 * says so in its place, and Share still opens it in another app.
 */
function FileViewer({ source, name, visible, onClose }: FileViewerProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const staysOnFile = (request: WebViewNavigation): boolean => {
    // Note that any file's address is let through, since the web view may read the file alone (`allowingReadAccessToURL`) and spells its address as WebKit escapes it.
    if (request.url.startsWith(FILE_ADDRESS)) return true;

    if (request.navigationType === "click" && WEB_ADDRESS.test(request.url)) {
      Linking.openURL(request.url).catch((cause: unknown) =>
        console.error("The file's link did not open.", cause),
      );
    }

    return false;
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      supportedOrientations={["portrait", "landscape"]}
      onRequestClose={onClose}
    >
      <View style={[styles.viewer, { backgroundColor: colors.GROUND }]} accessibilityViewIsModal>
        <View
          style={[
            styles.bar,
            {
              paddingTop: insets.top,
              paddingLeft: insets.left + SPACE.EDGE,
              paddingRight: insets.right + SPACE.EDGE,
              borderBottomColor: colors.CHIP_EDGE,
              backgroundColor: colors.SURFACE,
            },
          ]}
        >
          <Press
            onPress={onClose}
            accessibilityRole="button"
            testID="file-viewer-done"
            style={styles.barPress}
          >
            <Text style={{ fontSize: TEXT_SIZE.BODY, fontWeight: "600", color: colors.TEXT }}>
              {FILE_WORDS.DONE}
            </Text>
          </Press>
          <Text
            numberOfLines={1}
            ellipsizeMode="middle"
            accessibilityRole="header"
            style={[
              styles.barTitle,
              { fontSize: TEXT_SIZE.HEADLINE, fontWeight: "600", color: colors.TEXT },
            ]}
          >
            {name}
          </Text>
          <Press
            onPress={() => shareFile(source, name)}
            accessibilityRole="button"
            accessibilityLabel={FILE_WORDS.SHARE}
            testID="file-viewer-share"
            style={[styles.barPress, styles.barEnd]}
          >
            <SymbolView
              name={glyphSymbol(GLYPH.SHARE)}
              size={MARK_SIZE.LEAD + 2}
              tintColor={colors.TEXT}
            />
          </Press>
        </View>
        {failed ? (
          <View style={styles.cannot}>
            <Text
              style={{
                fontSize: TEXT_SIZE.FOOTNOTE,
                color: colors.TEXT_MUTED,
                textAlign: "center",
              }}
            >
              {FILE_WORDS.CANNOT_SHOW}
            </Text>
          </View>
        ) : (
          <View style={styles.page}>
            <WebView
              source={{ uri: source }}
              allowingReadAccessToURL={source}
              originWhitelist={EVERY_ADDRESS}
              onShouldStartLoadWithRequest={staysOnFile}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
              javaScriptEnabled={false}
              domStorageEnabled={false}
              cacheEnabled={false}
              incognito
              allowsLinkPreview={false}
              setSupportMultipleWindows={false}
              accessibilityLabel={name}
              testID={loaded ? FILE_VIEWER_ID : undefined}
              style={[styles.page, { backgroundColor: colors.GROUND }]}
            />
            {loaded ? null : (
              <View style={styles.loading} pointerEvents="none">
                <ActivityIndicator color={colors.TEXT_MUTED} />
              </View>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}

type FileChipProps = {
  /** The file's name, as it was attached. */
  readonly name: string;
  /** The file's type, which names its kind and its glyph. */
  readonly mediaType: string;
  /** The file's address on the device, under the app's caches; none while its bytes are on their way. */
  readonly source: string | undefined;
  /** The file's size in words, such as "48 KB"; none until its bytes are read. */
  readonly size: string | undefined;
};

/**
 * A file's chip after a message's words, as the panel stands a file's chip:
 * its glyph, its name on one line, cut in its middle so its extension
 * stays, and its kind and its size under it as muted words apart, on
 * `SURFACE` inside a hairline. A press opens a PDF full screen
 * (`FileViewer`) and any other file in the system's share sheet, which
 * opens it in an app that reads it; while its bytes are on their way the
 * system's spinner stands in its glyph's place and a press does nothing. At
 * an accessibility size its name wraps rather than cuts.
 */
export function FileChip({ name, mediaType, source, size }: FileChipProps) {
  const colors = useColors();
  const large = useAccessibilitySize();
  const [open, setOpen] = useState(false);
  const kind = kindOf(name, mediaType);
  const heard = [name, kind, size].filter((part) => part !== undefined).join(", ");
  const fact = { fontSize: TEXT_SIZE.CAPTION, color: colors.TEXT_MUTED };
  const viewed = isPdf(mediaType);

  const acts = useKeptActs(
    source === undefined ? undefined : { kind: KEPT_KIND.FILE, source, name, mediaType },
  );

  const press = () => {
    if (source === undefined) return;

    if (viewed) setOpen(true);
    else shareFile(source, name);
  };

  return (
    <>
      <HeldMenu acts={acts}>
        <Press
          onPress={press}
          disabled={source === undefined}
          accessibilityRole="button"
          accessibilityLabel={heard}
          accessibilityHint={viewed ? FILE_WORDS.OPENS : FILE_WORDS.SHARES}
          accessibilityState={{ busy: source === undefined }}
          style={[styles.chip, { backgroundColor: colors.SURFACE, borderColor: colors.CHIP_EDGE }]}
        >
          {source === undefined ? (
            <ActivityIndicator color={colors.TEXT_MUTED} style={{ width: MARK_SIZE.LEAD }} />
          ) : (
            <SymbolView
              name={glyphSymbol(isDocument(mediaType) ? FILE_SYMBOL.DOCUMENT : FILE_SYMBOL.OTHER)}
              size={MARK_SIZE.LEAD}
              tintColor={colors.TEXT_MUTED}
            />
          )}
          <View style={styles.words}>
            <Text
              numberOfLines={large ? undefined : 1}
              ellipsizeMode="middle"
              style={{ fontSize: TEXT_SIZE.SUBHEADLINE, fontWeight: "500", color: colors.TEXT }}
            >
              {name}
            </Text>
            {/* Note that its kind and its size stand as two muted words apart, never joined by a separator. */}
            <View style={styles.facts}>
              <Text style={fact}>{kind}</Text>
              {size === undefined ? null : <Text style={fact}>{size}</Text>}
            </View>
          </View>
        </Press>
      </HeldMenu>
      {source === undefined || !viewed ? null : (
        <FileViewer source={source} name={name} visible={open} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
