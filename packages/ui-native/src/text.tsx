// text.tsx -- the package's one Text: `@expo/ui`'s, drawn anew whenever the words or looks nested in it change.

import { Text as SwiftUIText } from "@expo/ui/swift-ui";
import { type ComponentProps, createElement, isValidElement, type ReactNode } from "react";
import { nestedTextKey, textChildrenOf } from "./nested-text-model.js";

type TextProps = ComponentProps<typeof SwiftUIText>;

/** A child as `@expo/ui`'s Text takes it: a Text of ours handed on as its own, so its words are kept rather than dropped as a stranger's. */
function swiftUIChild(child: ReactNode, at: number): ReactNode {
  if (!isValidElement<TextProps>(child) || child.type !== Text) return child;

  return createElement(
    SwiftUIText,
    { ...child.props, key: at },
    swiftUIChildren(child.props.children),
  );
}

function swiftUIChildren(children: ReactNode): ReactNode[] {
  return textChildrenOf(children).map(swiftUIChild);
}

/**
 * `@expo/ui`'s Text, as every view of this package draws words. Note that a
 * Text holding nested Texts is keyed by what they draw, because `@expo/ui`'s
 * SwiftUI `TextView` folds its children's words into its own as it builds,
 * yet observes only its own props, so a nested title or time that changed,
 * or a nested color the appearance flipped, never redrew: a new key builds
 * the Text anew from its children as they stand. A Text of words alone
 * observes them itself and is never keyed.
 */
export function Text(props: TextProps) {
  const children = swiftUIChildren(props.children);

  if (!children.some(isValidElement)) return <SwiftUIText {...props} />;

  return (
    <SwiftUIText key={nestedTextKey(children)} {...props}>
      {children}
    </SwiftUIText>
  );
}
