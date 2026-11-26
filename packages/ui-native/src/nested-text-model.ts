// nested-text-model.ts -- what a Text's nested words and looks are, as one value that changes whenever any of them does.

import { Children, Fragment, isValidElement, type ReactNode } from "react";

/** What a nested Text hands its parent: its words, its looks, and the Texts nested in it in turn. */
interface NestedText {
  readonly modifiers: unknown;
  readonly markdownEnabled: unknown;
  readonly children: readonly NestedPart[];
}

type NestedPart = string | NestedText;

/** The props a nested Text element carries, as far as its parent draws them. */
interface NestedTextProps {
  readonly children?: ReactNode;
  readonly modifiers?: unknown;
  readonly markdownEnabled?: unknown;
}

/**
 * A Text's children as React lists them, fragments opened in place, so a
 * word or a Text inside a fragment counts as one of the parent's own, as
 * `@expo/ui`'s Text draws it.
 */
export function textChildrenOf(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? textChildrenOf(child.props.children)
      : [child],
  );
}

/** One child as its parent draws it: a nested Text's words and looks, or words, which is all else React leaves of a Text's children. */
function partOf(child: ReactNode): NestedPart {
  if (!isValidElement<NestedTextProps>(child)) return String(child);
  const { modifiers, markdownEnabled } = child.props;

  return {
    modifiers: modifiers ?? null,
    markdownEnabled: markdownEnabled ?? null,
    children: partsOf(child.props.children),
  };
}

function partsOf(children: ReactNode): readonly NestedPart[] {
  return textChildrenOf(children).map(partOf);
}

/**
 * What a Text's nested Texts draw, as one value: the same while their words
 * and looks are, and another as soon as any changes. Note that a modifier's
 * handler, such as a tap's, is left out, as JSON leaves out a function, since
 * it changes with every render and draws nothing.
 */
export function nestedTextKey(children: ReactNode): string {
  return JSON.stringify(partsOf(children));
}
