/**
 * line-clamp.tsx -- words stopped after a few lines with Show more, as a feed stops a long message, and whole again with Show less.
 *
 * PROTOTYPE: added on the Inbox feed's prototype branch, where no component
 * stopped a message's words. It measures whether its words run past their
 * lines, so a short message offers no Show more, and draws the press in the
 * words' own line under them (`TextButton`).
 */

import { SHOW_LESS_WORDS, SHOW_MORE_WORDS } from "@repo/features/words";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { TEXT_BUTTON_TONE, TextButton } from "../text-button/text-button.js";

/** How many lines the words stand at before Show more. */
export const LINE_CLAMP_LINES = {
  SIX: "six",
} as const;

export type LineClampLines = (typeof LINE_CLAMP_LINES)[keyof typeof LINE_CLAMP_LINES];

const CLAMP_CLASS: Record<LineClampLines, string> = {
  [LINE_CLAMP_LINES.SIX]: "line-clamp-6",
};

/** Words stopped at `lines` with Show more where they run longer; whole once it is pressed, with Show less. */
export function LineClamp({
  lines = LINE_CLAMP_LINES.SIX,
  children,
}: {
  lines?: LineClampLines;
  children: ReactNode;
}): React.JSX.Element {
  const [whole, setWhole] = useState(false);
  const [runsOver, setRunsOver] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = box.current;

    if (element === null || whole) return undefined;
    const measure = () => setRunsOver(element.scrollHeight > element.clientHeight + 1);
    measure();
    const watching = new ResizeObserver(measure);
    watching.observe(element);

    return () => watching.disconnect();
  }, [whole]);

  return (
    <div className="ui-line-clamp flex min-w-0 flex-col items-start">
      <div ref={box} className={whole ? "min-w-0" : `min-w-0 ${CLAMP_CLASS[lines]}`}>
        {children}
      </div>
      {runsOver || whole ? (
        <TextButton tone={TEXT_BUTTON_TONE.ACCENT} onClick={() => setWhole((was) => !was)}>
          {whole ? SHOW_LESS_WORDS : SHOW_MORE_WORDS}
        </TextButton>
      ) : null}
    </div>
  );
}
