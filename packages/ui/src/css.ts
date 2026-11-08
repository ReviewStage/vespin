import type { CSSProperties } from "react";

declare module "react" {
  /** A custom property a stylesheet reads, which React's own CSSProperties leaves out. */
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}

/** Custom properties as the style a surface's stylesheet reads them from; layout-only. */
export function cssCustomProperties(properties: {
  readonly [property: `--${string}`]: string | number;
}): CSSProperties {
  return properties;
}
