import { type ReactNode, useLayoutEffect, useRef } from "react";

/**
 * landing-caret.tsx -- the caret a scene's story types behind: a field's words as typed so far, a caret standing after the last of them.
 *
 * A scene's composer is inert, so its field never takes the focus and the
 * browser draws no caret of its own. While a story types into it, a copy of
 * the field's words lies over the field in its own type and padding, the
 * words themselves clear and a caret after them, so the caret stands where
 * the next key would land, wrapping as the words wrap. A picture: no reader
 * is told of it.
 */

/** The field's look the copy takes, so its words wrap where the field's do. */
const MIRRORED = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "boxSizing",
  "width",
] as const;

/** `children`, a composer's field, with a caret after `words` while `typing`. */
export function TypingCaret({
  words,
  typing,
  children,
}: {
  words: string;
  typing: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);

  // Note that the copy reads the field's look as it draws, because the field's padding and type come from its own sheet.
  useLayoutEffect(() => {
    const field = box.current?.querySelector("textarea");
    const mirror = copy.current;

    if (!field || !mirror) return;

    const look = getComputedStyle(field);

    for (const name of MIRRORED) mirror.style[name] = look[name];

    mirror.style.top = `${String(field.offsetTop)}px`;
    mirror.style.left = `${String(field.offsetLeft)}px`;
  }, [typing, words]);

  return (
    <div ref={box} className="ui-landing-typed">
      {children}
      {typing ? (
        <div ref={copy} className="ui-landing-typed-copy" aria-hidden="true">
          <span className="ui-landing-typed-words">{words}</span>
          <span className="ui-landing-caret" />
        </div>
      ) : null}
    </div>
  );
}
