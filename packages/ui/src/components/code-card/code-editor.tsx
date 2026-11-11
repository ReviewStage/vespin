import type { CodeLines } from "@repo/features/tasks-view";
import { Fragment, type KeyboardEvent, type ReactNode, useLayoutEffect, useRef } from "react";
import { isComposingKey } from "../../composing-key.js";
import { cssCustomProperties } from "../../css.js";
import { lineRuns } from "./code-card.js";

/**
 * code-editor.tsx -- a field for a block of code, its lines colored as a code card colors them while it is typed in.
 *
 * A text area takes the typing, its own words drawn transparent over the
 * same words drawn beneath it in the host's colors (`CodeLines`), so the
 * caret, the selection, the undo stack, and the keyboard stay the browser's
 * own. Both layers stand in one grid cell, set in the same face, size,
 * leading, inset, and wrapping, so the words line up and the field grows
 * with its lines from `rows` tall, never scrolling inside itself. Lines wrap
 * rather than scroll sideways, so neither layer has to follow the other's
 * scroll.
 *
 * The colors are handed in, and may be for words a few keystrokes old: a
 * line is drawn in them only where they spell that line exactly, and plain
 * in the code's own ink otherwise, so a stale coloring never lands on the
 * wrong characters. The colored layer is left out of the screen recording
 * (`ph-no-capture`), as a code card's lines are.
 *
 * A numbered editor (`lineNumbers`) draws each line's number in a gutter
 * before it, as a code editor's gutter does: the colored layer draws each
 * line as a block of its own with its number hung in the gutter beside its
 * first row, and both layers stand their words the gutter's width in, so a
 * line that wraps keeps one number and its later rows stand under its words.
 * The gutter is as wide as the last line's number, and never narrower than
 * two digits, so the words do not move as a short script grows.
 *
 * A field that holds an edit not yet saved says so (`changed`): its border
 * takes the accent, as a changed setting's does, so an unsaved edit is seen
 * from across the page. Where it is handed `onSave`, ⌘S (Ctrl+S off a Mac)
 * in it answers it, as in any code editor, the browser's own Save Page never
 * opening, and so does ⌘↩ (Ctrl+Enter), as a form's multi-line field is sent; where it is handed `onEscape`, Escape in it answers that, as the
 * text field's does. A key an input method is composing is the input
 * method's.
 */

/** The field's well, a text area's, whose ground lightens while the caret is in it. */
const WELL =
  "ui-code-editor grid min-w-0 rounded-control border border-border-strong bg-field transition-[border-color,background-color] duration-(--ui-duration-hover) ease-plain focus-within:bg-field-focus data-[changed=true]:border-accent-fill has-aria-invalid:border-destructive has-disabled:opacity-disabled";

/** What both layers share, so their words stand on the same places, less where their words start. */
const LAYER_BASE =
  "col-start-1 row-start-1 m-0 box-border min-w-0 border-0 pr-control-inset py-ui-6 font-mono text-body leading-reading whitespace-pre-wrap [overflow-wrap:anywhere] [tab-size:2]";

/** Where both layers' words start: at the field's inset, or past the gutter's numbers where it is numbered. */
const LAYER_START = {
  PLAIN: "pl-control-inset",
  NUMBERED:
    "pl-[calc(var(--spacing-control-inset)+var(--ui-code-editor-gutter)+var(--spacing-ui-12))]",
} as const;

/** The colored words beneath, which take no pointer. */
const SHOWN =
  "ui-code-editor-lines ph-no-capture pointer-events-none text-code [&_span]:text-code-run";

/** The text area over them, its words transparent and its caret in the text's ink. */
const TYPED =
  "ui-code-editor-input block h-full w-full resize-none overflow-hidden bg-transparent text-transparent caret-foreground outline-none placeholder:text-muted-foreground disabled:cursor-default";

/** A numbered line beneath: a block of its own, so its number hangs beside its first row however it wraps. */
const NUMBERED_LINE = "ui-code-editor-line relative block";

/**
 * A line's number, hung in the gutter before its words, right-aligned to them, in the muted ink a gutter's numbers take.
 * Note that it never wraps, because hung outside its line it is only as wide as its narrowest piece, and the
 * layers' `overflow-wrap: anywhere` would make that one digit, breaking a line's 10 into a 1 over a 0.
 */
const LINE_NUMBER =
  "ui-code-editor-line-number absolute top-0 right-full mr-ui-12 select-none whitespace-nowrap tabular-nums text-muted-foreground";

/** The fewest digits the gutter stands wide for, so the words do not move as a script passes nine lines. */
const GUTTER_DIGITS = 2;

/** An empty line's stand-in beneath, so its block stands a line tall as the text area's empty line does. */
const ZERO_WIDTH_SPACE = "\u200b";

/** A Latin letter, as a key's character is on a layout that types them. */
const LATIN_LETTER = /^[a-z]$/i;

/**
 * Whether a key is a save chord: ⌘S or ⌘↩ on a Mac, Ctrl+S or Ctrl+Enter
 * elsewhere, with no other modifier. The character is read, as the app's
 * shortcuts read it, so a Dvorak S is S; the physical S key answers too
 * where its character is no Latin letter, as on a Cyrillic or Greek layout,
 * which would type none.
 */
function savingKey(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  const isS = key === "s" || (event.code === "KeyS" && !LATIN_LETTER.test(key));
  const saves = isS || event.key === "Enter";
  return saves && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}

/** One line as drawn beneath: in its colors where they spell it, plain where they do not. */
function drawnLine(text: string, tokens: CodeLines[number] | undefined): ReactNode {
  const spelled = tokens?.map((token) => token.text).join("") === text;
  return spelled && tokens !== undefined ? lineRuns(tokens) : text;
}

/** The lines as drawn beneath, one run of text, each in its colors where they spell it. */
function shownLines(code: string, lines: CodeLines | undefined): ReactNode {
  return (
    <>
      {code.split("\n").map((text, at) => (
        // Note that a line's place is its identity here, since the layer is drawn again on every keystroke.
        <Fragment key={at}>
          {at > 0 ? "\n" : null}
          {drawnLine(text, lines?.[at])}
        </Fragment>
      ))}
      {/* Note that a closing newline keeps a last empty line a line tall, as the text area draws it. */}
      {"\n"}
    </>
  );
}

/** The lines as drawn beneath with their numbers, each a block of its own. */
function numberedLines(code: string, lines: CodeLines | undefined): ReactNode {
  return code.split("\n").map((text, at) => (
    // Note that a line's place is its identity here, since the layer is drawn again on every keystroke.
    <span key={at} className={NUMBERED_LINE}>
      <span className={LINE_NUMBER}>{at + 1}</span>
      {text === "" ? ZERO_WIDTH_SPACE : drawnLine(text, lines?.[at])}
    </span>
  ));
}

/** A block of code to type in, colored as it is typed where the host colored it. */
export function CodeEditor({
  value,
  onChange,
  lines,
  id,
  label,
  describedBy,
  invalid,
  placeholder,
  rows = 1,
  lineNumbers = false,
  changed = false,
  onSave,
  onEscape,
  disabled,
  readOnly,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The host's coloring of the code, possibly of words a few keystrokes old; none draws it plain. */
  lines?: CodeLines | undefined;
  /** The id its field wears, which a form field's visible label names it by. */
  id?: string | undefined;
  /** The accessible name. */
  label: string;
  /** The id of the words that describe it, its error among them while it has one. */
  describedBy?: string | undefined;
  /** Whether what it holds is refused. */
  invalid?: boolean | undefined;
  placeholder?: string | undefined;
  /** How many lines tall it stands while it holds fewer. */
  rows?: number;
  /** Whether each line's number stands in a gutter before it, as in a script. */
  lineNumbers?: boolean;
  /** Whether it holds an edit not yet saved, which its border says in the accent. */
  changed?: boolean;
  /** What ⌘S (Ctrl+S off a Mac) in it does; none leaves the key to the browser. */
  onSave?: (() => void) | undefined;
  /** What Escape in it does; none leaves the key to the window. */
  onEscape?: (() => void) | undefined;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
  /** Whether the caret lands in it as it is drawn, as in a script just added. */
  autoFocus?: boolean | undefined;
}): React.JSX.Element {
  const field = useRef<HTMLTextAreaElement | null>(null);
  // Note that it is read once, so the caret lands as the field is drawn and never again on a later draw.
  const focusFirst = useRef(autoFocus === true);
  useLayoutEffect(() => {
    if (focusFirst.current) field.current?.focus();
  }, []);
  const start = lineNumbers ? LAYER_START.NUMBERED : LAYER_START.PLAIN;
  const lineCount = value.split("\n").length;
  const gutter = lineNumbers
    ? cssCustomProperties({
        "--ui-code-editor-gutter": `${Math.max(GUTTER_DIGITS, String(lineCount).length)}ch`,
      })
    : undefined;
  // Note that a key taken is marked even mid-composition, so the browser's Save Page never opens, and answered only once composing ends.
  const answerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const answer =
      onSave !== undefined && savingKey(event)
        ? onSave
        : onEscape !== undefined && event.key === "Escape"
          ? onEscape
          : undefined;
    if (answer === undefined) return;
    event.preventDefault();
    if (!isComposingKey(event)) answer();
  };
  return (
    <div className={WELL} style={gutter} data-changed={changed || undefined}>
      <pre className={`${LAYER_BASE} ${start} ${SHOWN}`} aria-hidden>
        {lineNumbers ? numberedLines(value, lines) : shownLines(value, lines)}
      </pre>
      <textarea
        ref={field}
        className={`${LAYER_BASE} ${start} ${TYPED}`}
        id={id}
        rows={rows}
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={invalid === true ? true : undefined}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onSave === undefined && onEscape === undefined ? undefined : answerKey}
      />
    </div>
  );
}
