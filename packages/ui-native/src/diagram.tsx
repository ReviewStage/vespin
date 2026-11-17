// diagram.tsx -- a description's Mermaid fence drawn as its diagram, as the panel's card draws it: Mermaid run in one hidden sealed web view while the words stand, each picture kept by its appearance and code, Show code and Show diagram, and its code where Mermaid could not draw it.

import {
  DIAGRAM_ROLE,
  DIAGRAM_WORDS,
  type DiagramRole,
  diagramAlt,
  diagramThemeVariablesOf,
} from "@repo/features/mermaid-diagram";
import mermaidSource from "mermaid/dist/mermaid.min.js";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
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
import { TEXT_SIZE } from "./tokens/type.js";

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
interface DiagramPicture {
  readonly source: string;
  readonly size: MediaSize;
}

/** A fence's drawing: its picture, `null` where Mermaid could not draw it, or none while it is drawn. */
type Drawing = DiagramPicture | null | undefined;

/** Each picture drawn, by whether it was drawn dark and then by its code, oldest first. */
const drawn = new Map<boolean, Map<string, DiagramPicture | null>>();

/** What is told when a picture lands. */
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

/** A drawing kept as the newest in its appearance, the oldest past the bound let go. */
function keep(dark: boolean, code: string, drawing: DiagramPicture | null): void {
  const held = drawn.get(dark) ?? new Map<string, DiagramPicture | null>();
  held.delete(code);
  held.set(code, drawing);

  for (const oldest of held.keys()) {
    if (held.size <= HELD_PICTURES) break;
    held.delete(oldest);
  }

  drawn.set(dark, held);

  for (const listener of listeners) listener();
}

/** One fence waiting to be drawn, or being drawn: its number, its code, and the appearance it is drawn in. */
interface Asked {
  readonly id: number;
  readonly code: string;
  readonly dark: boolean;
}

/** The page a renderer draws in, as the queue reaches it: what it is asked to run. */
interface DiagramPage {
  readonly injectJavaScript: (script: string) => void;
}

/** What asks the renderer for a fence's picture in the window's appearance. */
type AskDiagram = (code: string) => void;

const DiagramAskContext = createContext<AskDiagram | undefined>(undefined);

/** A navigation the page may make: none but standing where it was handed in. */
function staysHandedIn(request: WebViewNavigation): boolean {
  return request.url === HANDED_IN;
}

/**
 * The fences a renderer draws, one at a time since Mermaid's settings are
 * one for its page, each sent once the page stands ready: what is asked,
 * the fence being drawn, and the page drawing them, once it stands.
 */
function drawingQueue(colors: () => BrandColors) {
  const waiting: Asked[] = [];
  let ready = false;
  let page: DiagramPage | null = null;
  let drawing: Asked | undefined;
  let next = 0;

  const pump = () => {
    if (!ready || page === null || drawing !== undefined) return;
    const asked = waiting.shift();

    if (asked === undefined) return;
    drawing = asked;
    const palette = colors();
    const theme = diagramThemeVariablesOf((role) => palette[ROLE_COLOR[role]], asked.dark);
    page.injectJavaScript(diagramAskScript({ id: asked.id, code: asked.code, theme }));
  };

  return {
    hold: (view: DiagramPage | null) => {
      page = view;
      pump();
    },
    ask: (code: string, dark: boolean) => {
      if (drawn.get(dark)?.has(code) === true) return;

      if (drawing?.code === code && drawing.dark === dark) return;

      if (waiting.some((each) => each.code === code && each.dark === dark)) return;
      next += 1;
      waiting.push({ id: next, code, dark });
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

        keep(drawing.dark, drawing.code, picture);
        drawing = undefined;
      }

      pump();
    },
    // Note that a page that could not load, or whose process the system ended, draws nothing more, so every fence it held stands as its code rather than spinning.
    lost: () => {
      const held = drawing === undefined ? waiting.splice(0) : [drawing, ...waiting.splice(0)];
      drawing = undefined;
      ready = false;

      for (const each of held) keep(each.dark, each.code, null);
    },
  };
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
  const colors = useColors();
  const [palette] = useState(() => ({ now: colors }));
  palette.now = colors;
  const [queue] = useState(() => drawingQueue(() => palette.now));
  const [needed, setNeeded] = useState(false);
  const [document] = useState(() => diagramDocument(mermaidSource));
  const dark = useColorScheme() === "dark";

  const ask: AskDiagram = (code) => {
    if (drawn.get(dark)?.has(code) === true) return;
    setNeeded(true);
    queue.ask(code, dark);
  };

  return (
    <DiagramAskContext.Provider value={ask}>
      {children}
      {needed ? (
        <WebView
          ref={(view) => queue.hold(view)}
          source={{ html: document }}
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
    </DiagramAskContext.Provider>
  );
}

/** A fence's drawing in the window's appearance, asked of the renderer around it once; none while it is drawn, and `null` where it could not be. */
function useDiagram(code: string): Drawing {
  const ask = useContext(DiagramAskContext);
  const dark = useColorScheme() === "dark";
  const held = useSyncExternalStore(subscribe, () => drawn.get(dark)?.get(code));

  useEffect(() => {
    if (held === undefined) ask?.(code);
  }, [ask, code, held]);

  // Note that words drawn with no renderer around them, which nothing asks, stand as their code.
  return ask === undefined ? null : held;
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
          style={{ fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT_MUTED }}
          accessibilityRole="header"
        >
          {DIAGRAM_WORDS.HEAD}
        </Text>
        {drawing === undefined ? null : (
          <Press onPress={() => setShowingCode(!showingCode)} accessibilityRole="button">
            <Text style={{ fontSize: TEXT_SIZE.FOOTNOTE, color: colors.TEXT, fontWeight: "500" }}>
              {showingCode ? DIAGRAM_WORDS.SHOW_DIAGRAM : DIAGRAM_WORDS.SHOW_CODE}
            </Text>
          </Press>
        )}
      </View>
      {showingCode ? codeView : picture(drawing, diagramAlt(code))}
    </View>
  );
}
