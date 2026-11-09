import type { CodeLines } from "@repo/features/tasks-view";
import { Fragment, type ReactNode, useLayoutEffect, useRef } from "react";
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
 */

/** The field's well, a text area's, whose ground lightens while the caret is in it. */
const WELL =
  "ui-code-editor grid min-w-0 rounded-control border border-border-strong bg-field transition-[border-color,background-color] duration-(--ui-duration-hover) ease-plain focus-within:bg-field-focus has-aria-invalid:border-destructive has-disabled:opacity-disabled";

/** What both layers share, so their words stand on the same places. */
const LAYER =
  "col-start-1 row-start-1 m-0 box-border min-w-0 border-0 px-control-inset py-ui-6 font-mono text-body leading-reading whitespace-pre-wrap [overflow-wrap:anywhere] [tab-size:2]";

/** The colored words beneath, which take no pointer. */
const SHOWN = `${LAYER} ui-code-editor-lines ph-no-capture pointer-events-none text-code [&_span]:text-code-run`;

/** The text area over them, its words transparent and its caret in the text's ink. */
const TYPED = `${LAYER} ui-code-editor-input block h-full w-full resize-none overflow-hidden bg-transparent text-transparent caret-foreground outline-none placeholder:text-muted-foreground disabled:cursor-default`;

/** The lines as drawn beneath: each in its colors where they spell it, plain where they do not. */
function shownLines(code: string, lines: CodeLines | undefined): ReactNode {
  return code.split("\n").map((text, at) => {
    const tokens = lines?.[at];
    const spelled = tokens?.map((token) => token.text).join("") === text;
    return (
      // Note that a line's place is its identity here, since the layer is drawn again on every keystroke.
      <Fragment key={at}>
        {at > 0 ? "\n" : null}
        {spelled && tokens !== undefined ? lineRuns(tokens) : text}
      </Fragment>
    );
  });
}

/** A block of code to type in, colored as it is typed where the host colored it. */
export function CodeEditor({
  value,
  onChange,
  lines,
  label,
  describedBy,
  invalid,
  placeholder,
  rows = 1,
  disabled,
  readOnly,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  /** The host's coloring of the code, possibly of words a few keystrokes old; none draws it plain. */
  lines?: CodeLines | undefined;
  /** The accessible name. */
  label: string;
  /** The id of the words that describe it, its error among them while it has one. */
  describedBy?: string | undefined;
  /** Whether what it holds is refused. */
  invalid?: boolean | undefined;
  placeholder?: string | undefined;
  /** How many lines tall it stands while it holds fewer. */
  rows?: number;
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
  return (
    <div className={WELL}>
      <pre className={SHOWN} aria-hidden>
        {shownLines(value, lines)}
        {/* Note that a closing newline keeps a last empty line a line tall, as the text area draws it. */}
        {"\n"}
      </pre>
      <textarea
        ref={field}
        className={TYPED}
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
      />
    </div>
  );
}
