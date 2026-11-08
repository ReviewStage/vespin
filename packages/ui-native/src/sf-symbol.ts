// sf-symbol.ts -- an SF Symbol's name, as the components take it.

import type { ImageProps } from "@expo/ui/swift-ui";

/** An SF Symbol's name, as `@expo/ui` types it. */
export type SfSymbol = NonNullable<ImageProps["systemName"]>;
