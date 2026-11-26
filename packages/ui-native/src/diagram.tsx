// diagram.tsx -- a description's Mermaid fence drawn as its diagram, as the panel's card draws it: Mermaid run in one hidden sealed web view while the words stand, each picture kept by its appearance and code, Show code and Show diagram, and its code where Mermaid could not draw it.

import {
  DIAGRAM_ROLE,
  DIAGRAM_WORDS,
  type DiagramRole,
  diagramAlt,
  diagramThemeVariablesOf,
} from "@repo/features/mermaid-diagram";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { StyleSheet, Text, useColorScheme, View } from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import {
  DIAGRAM_ANSWER,
  type DiagramAnswer,
  diagramAnswerOf,
  diagramAskScript,
  diagramDocument,
} from "./diagram-page.js";
import type { MediaSize } from "./media-frame.js";
import { Press } from "./press.js";
import { type BrandColors, useColors } from "./tokens/colors.js";
import { SPACE } from "./tokens/space.js";
import { ROLE_SIZE } from "./tokens/type.js";

/** The address the page is handed in at, the one place it may stand. */
const HANDED_IN = "about:blank";

/** The web view's whitelist: every address, so that each navigation reaches `staysHandedIn`. */
const EVERY_ADDRESS = ["*"];

/** How many pictures the app keeps in each appearance, the oldest let go first; enough for every diagram in a few descriptions. */
const HELD_PICTURES = 32;

/** Each role's color in the brand's palette, as the panel's diagram reads the same roles off its own. */
const ROLE_COLOR = {
  [DIAGRAM_ROLE.GROUND]: "GROUND",
  [DIAGRAM_ROLE.WORDS]: "TEXT",
  [DIAGRAM_ROLE.LINES]: "TEXT_MUTED",
  [DIAGRAM_ROLE.BOX]: "CHIP",
  [DIAGRAM_ROLE.RAISED]: "CHIP_HOVER",
  [DIAGRAM_ROLE.EDGE]: "CHIP_EDGE_STRONG",
  [DIAGRAM_ROLE.GROUP]: "WELL",
  [DIAGRAM_ROLE.GROUP_EDGE]: "CHIP_EDGE",
} as const satisfies Record<DiagramRole, keyof BrandColors>;

const styles = StyleSheet.create({
  renderer: { position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  card: { gap: SPACE.TIGHT },
});

/** A fence drawn: its picture, as a PNG's `data:` address, and its own size in points. */
export interface DiagramPicture {
  readonly source: string;
  readonly size: MediaSize;
}

/** A fence's drawing: its picture, `null` where Mermaid could not draw it, or none while it is drawn. */
export type DiagramDrawing = DiagramPicture | null | undefined;

/**
 * Each picture drawn, by the palette it was drawn in and then by its code,
 * oldest first. Note that it is kept by the palette itself, one of
 * `useColors`' few, rather than by the appearance alone, so a diagram drawn
 * before Increase Contrast was turned on is drawn again in the new colors.
 */
const drawn = new Map<BrandColors, Map<string, DiagramPicture | null>>();

/** What is told when a picture lands. */
const listeners = new Set<() => void>();

/** How many pictures have landed, which a reader of several fences reads to know when to read them again. */
let landings = 0;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

/** A drawing kept as the newest in its palette, the oldest past the bound let go. */
function keep(palette: BrandColors, code: string, drawing: DiagramPicture | null): void {
  const held = drawn.get(palette) ?? new Map<string, DiagramPicture | null>();
  held.delete(code);
  held.set(code, drawing);

  for (const oldest of held.keys()) {
    if (held.size <= HELD_PICTURES) break;
    held.delete(oldest);
  }

  drawn.set(palette, held);
  landings += 1;

  for (const listener of listeners) listener();
}

/** One fence waiting to be drawn, or being drawn: its number, its code, the palette it is drawn in, and whether that palette is dark. */
interface Asked {
  readonly id: number;
  readonly code: string;
  readonly palette: BrandColors;
  readonly dark: boolean;
}

/** The page a renderer draws in, as the queue reaches it: what it is asked to run. */
interface DiagramPage {
  readonly injectJavaScript: (script: string) => void;
}

/** What a renderer offers the fences inside it: the palette it draws in, by which their pictures are kept, and what asks it for one. */
interface DiagramAsking {
  readonly palette: BrandColors;
  readonly ask: (code: string) => void;
}

const DiagramAskContext = createContext<DiagramAsking | undefined>(undefined);

/** A navigation the page may make: none but standing where it was handed in. */
function staysHandedIn(request: WebViewNavigation): boolean {
  return request.url === HANDED_IN;
}

/**
 * The fences a renderer draws, one at a time since Mermaid's settings are
 * one for its page, each sent once the page stands ready: what is asked,
 * the fence being drawn, and the page drawing them, once it stands.
 */
function drawingQueue() {
  const waiting: Asked[] = [];
  let ready = false;
  let gone = false;
  let page: DiagramPage | null = null;
  let drawing: Asked | undefined;
  let next = 0;

  const pump = () => {
    if (!ready || page === null || drawing !== undefined) return;
    const asked = waiting.shift();

    if (asked === undefined) return;
    drawing = asked;
    const { palette } = asked;
    const theme = diagramThemeVariablesOf((role) => palette[ROLE_COLOR[role]], asked.dark);
    page.injectJavaScript(diagramAskScript({ id: asked.id, code: asked.code, theme }));
  };

  return {
    hold: (view: DiagramPage | null) => {
      page = view;
      pump();
    },
    ask: (code: string, palette: BrandColors, dark: boolean) => {
      if (drawn.get(palette)?.has(code) === true) return;

      // Note that a fence asked once the page is lost stands as its code at once, as those it held do, since no page will draw it.
      if (gone) {
        keep(palette, code, null);

        return;
      }

      if (drawing?.code === code && drawing.palette === palette) return;

      if (waiting.some((each) => each.code === code && each.palette === palette)) return;
      next += 1;
      waiting.push({ id: next, code, palette, dark });
      pump();
    },
    answered: (answer: DiagramAnswer) => {
      if (answer.kind === DIAGRAM_ANSWER.READY) {
        ready = true;
      } else if (drawing !== undefined && answer.id === drawing.id) {
        const picture =
          answer.kind === DIAGRAM_ANSWER.DRAWN
            ? { source: answer.picture, size: { width: answer.width, height: answer.height } }
            : null;

        keep(drawing.palette, drawing.code, picture);
        drawing = undefined;
      }

      pump();
    },
    // Note that a page that could not load, or whose process the system ended, draws nothing more, so every fence it held, and every one asked after, stands as its code rather than spinning.
    lost: () => {
      const held = drawing === undefined ? waiting.splice(0) : [drawing, ...waiting.splice(0)];
      drawing = undefined;
      ready = false;
      gone = true;

      for (const each of held) keep(each.palette, each.code, null);
    },
  };
}

/** The sealed page, built from Mermaid's 3.5 MB of source once the app first draws a diagram (`diagramDocument`), and kept for every later one. */
let sealedDocument: string | undefined;

/**
 * Mermaid's one-file build as its words (`mermaid-source.d.ts`), required
 * as the first diagram draws rather than imported, since an import ran its
 * module, and made its 3.5 MB string, in every launch, before the first
 * frame, through the screens that import this package.
 */
function mermaidSource(): string {
  // SAFETY: the app's Babel config makes this module's value Mermaid's words, one string (`apps/mobile/babel.config.js`).
  return require("mermaid/dist/mermaid.min.js") as string;
}

/** The sealed page, built on its first ask, since reading Mermaid's whole source into it took a task's page some 300 ms on every open. */
function sealedPage(): string {
  sealedDocument ??= diagramDocument(mermaidSource());

  return sealedDocument;
}

/**
 * The renderer a page of words draws its diagrams through, around those
 * words: Mermaid in one sealed web view, hidden and the size of nothing,
 * made only once a fence asks for a picture not already drawn, and gone
 * with the words, so a description with no diagram, or with every one
 * already drawn, holds no web view at all. The page reaches nothing and
 * goes nowhere (`diagramDocument`), so neither Mermaid nor a fence's words
 * can load, send, or open anything.
 */
export function DiagramRenderer({ children }: { readonly children: ReactNode }) {
  const palette = useColors();
  const [queue] = useState(drawingQueue);
  const [needed, setNeeded] = useState(false);
  const dark = useColorScheme() === "dark";

  const ask = (code: string) => {
    if (drawn.get(palette)?.has(code) === true) return;
    setNeeded(true);
    queue.ask(code, palette, dark);
  };

  return (
    <DiagramAskContext value={{ palette, ask }}>
      {children}
      {needed ? (
        <WebView
          ref={(view) => queue.hold(view)}
          source={{ html: sealedPage() }}
          originWhitelist={EVERY_ADDRESS}
          onShouldStartLoadWithRequest={staysHandedIn}
          onMessage={(event: WebViewMessageEvent): void => {
            const answer = diagramAnswerOf(event.nativeEvent.data);

            if (answer !== undefined) queue.answered(answer);
          }}
          onError={queue.lost}
          onContentProcessDidTerminate={queue.lost}
          javaScriptEnabled
          domStorageEnabled={false}
          cacheEnabled={false}
          incognito
          allowsLinkPreview={false}
          allowFileAccess={false}
          setSupportMultipleWindows={false}
          style={styles.renderer}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
    </DiagramAskContext>
  );
}

/** A fence's drawing in the palette of the renderer around it, asked of that renderer once; none while it is drawn, and `null` where it could not be. */
function useDiagram(code: string): DiagramDrawing {
  const asking = useContext(DiagramAskContext);

  const held = useSyncExternalStore(subscribe, () =>
    asking === undefined ? undefined : drawn.get(asking.palette)?.get(code),
  );

  useEffect(() => {
    if (held === undefined) asking?.ask(code);
  }, [asking, code, held]);

  // Note that words drawn with no renderer around them, which nothing asks, stand as their code.
  return asking === undefined ? null : held;
}

/** How many pictures have landed so far. */
function landed(): number {
  return landings;
}

/**
 * Several fences' drawings in the palette of the renderer around them, each
 * asked of that renderer once, as `useDiagram` asks one: what each fence's
 * code is drawn as, read again as each picture lands. Note that words drawn
 * with no renderer around them, which nothing asks, stand as their code.
 */
export function useDiagramPictures(codes: readonly string[]): (code: string) => DiagramDrawing {
  const asking = useContext(DiagramAskContext);
  const seen = useSyncExternalStore(subscribe, landed);

  useEffect(() => {
    if (asking === undefined) return;

    for (const code of codes) {
      if (drawn.get(asking.palette)?.get(code) === undefined) asking.ask(code);
    }
  }, [asking, codes, seen]);

  return useMemo(() => {
    const palette = asking?.palette;

    return (code: string) => (palette === undefined ? null : drawn.get(palette)?.get(code));
  }, [asking, seen]);
}

/**
 * A Mermaid fence as the panel's card draws it: "Diagram" at its head, with
 * Show code and Show diagram trading the picture for its code and back, the
 * picture at its own size, held to the column, which a press opens full
 * screen to zoom (`picture`, the words' own picture), and while it is drawn
 * the picture's well with the system's spinner. A fence Mermaid could not
 * draw stands as its code (`code`), as it did before the app drew diagrams.
 */
export function DiagramBlock({
  code,
  picture,
  codeView,
}: {
  readonly code: string;
  readonly picture: (drawing: DiagramPicture | undefined, alt: string) => ReactElement;
  readonly codeView: ReactElement;
}) {
  const colors = useColors();
  const drawing = useDiagram(code);
  const [showingCode, setShowingCode] = useState(false);

  if (drawing === null) return codeView;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text
          style={{ fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT_MUTED }}
          accessibilityRole="header"
        >
          {DIAGRAM_WORDS.HEAD}
        </Text>
        {drawing === undefined ? null : (
          <Press onPress={() => setShowingCode(!showingCode)} accessibilityRole="button">
            <Text style={{ fontSize: ROLE_SIZE.ROW_LINE, color: colors.TEXT, fontWeight: "500" }}>
              {showingCode ? DIAGRAM_WORDS.SHOW_DIAGRAM : DIAGRAM_WORDS.SHOW_CODE}
            </Text>
          </Press>
        )}
      </View>
      {showingCode ? codeView : picture(drawing, diagramAlt(code))}
    </View>
  );
}
