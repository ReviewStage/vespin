/**
 * example.ts -- what one example of the catalog is, apart from the list of them all.
 *
 * Every example module declares itself as one, and `examples.ts` imports
 * every example module, so the shape lives here rather than in the list.
 */

/** One entry of the index: its address, its heading, and what it draws. */
export interface Example {
  readonly id: string;
  readonly title: string;
  readonly Render: () => React.JSX.Element;
}
